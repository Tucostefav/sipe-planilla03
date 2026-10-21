'use strict';

const ExcelJS = require('exceljs');
const { cellText, norm, compararCedula } = require('./util');
const { parseDetalleCSS } = require('./parseDetalleCSS');
const { construirInforme03 } = require('./informe03');
const { construirPlanilla03 } = require('./planilla03');
const { construirTalonarios, limpiarConceptos } = require('./talonarios');
const { prepararLogo } = require('./logo');
const { construirCesantias, limpiarDatosCesantias, periodosTrimestre } = require('./cesantias');

// Colecciones: empresas (id = RUC), detalles (id = RUC|AAAAMM), empleados (id = cédula),
// talonarios (id = RUC|cédula: correo y descuentos o adicionales fijos de cada empleado),
// logos (id = RUC: logo PNG sin fondo para los talonarios; aparte para no cargarlo con la empresa),
// cesantias (id = RUC|cédula: # asignado, seguro social, edad, sexo y fecha de ingreso, escritos a mano).
class Servicio {
  constructor(store) {
    this.store = store;
  }

  // ---------- Empresas y detalles ----------

  async listarEmpresas() {
    const empresas = await this.store.list('empresas');
    return empresas.sort((a, b) => String(a.razonSocial).localeCompare(String(b.razonSocial)));
  }

  async empresa(ruc) {
    return this.store.get('empresas', ruc);
  }

  async guardarEmpresa(ruc, cambios) {
    const actual = (await this.empresa(ruc)) || { ruc };
    const nueva = { ...actual, ...cambios, ruc };
    await this.store.put('empresas', ruc, nueva);
    return nueva;
  }

  /** Procesa un detalle de planilla subido: guarda empresa y mes (reemplaza si ya existía). */
  async cargarDetalle(buffer, nombreArchivo) {
    const detalle = await parseDetalleCSS(buffer);
    const { ruc } = detalle.empresa;
    const previa = await this.empresa(ruc);
    await this.guardarEmpresa(ruc, {
      razonSocial: detalle.empresa.razonSocial,
      nombreComercial: detalle.empresa.nombreComercial,
      patronal: detalle.empresa.patronal,
      idPlanilla: (previa && previa.idPlanilla) || '',
    });
    const id = `${ruc}|${detalle.periodo}`;
    const reemplazo = !!(await this.store.get('detalles', id));
    await this.store.put('detalles', id, { ...detalle, archivo: nombreArchivo || '', cargado: new Date().toISOString() });
    return { detalle, reemplazo };
  }

  async detalle(ruc, periodo) {
    return this.store.get('detalles', `${ruc}|${periodo}`);
  }

  async listarDetalles(ruc) {
    const ds = await this.store.list('detalles', `${ruc}|`);
    return ds.sort((a, b) => String(b.periodo).localeCompare(String(a.periodo)));
  }

  async borrarDetalle(ruc, periodo) {
    await this.store.delete('detalles', `${ruc}|${periodo}`);
  }

  // ---------- Reportes ----------

  async informe03(ruc, periodo) {
    const [empresa, detalle, buscar] = await Promise.all([this.empresa(ruc), this.detalle(ruc, periodo), this.buscador()]);
    if (!empresa || !detalle) return null;
    return { empresa, detalle, ...construirInforme03(detalle, { idPlanilla: empresa.idPlanilla, buscarEmpleado: buscar }) };
  }

  async planilla03(ruc, anio) {
    const empresa = await this.empresa(ruc);
    if (!empresa) return null;
    const detalles = (await this.listarDetalles(ruc)).filter((d) => String(d.periodo).startsWith(String(anio)));
    const buscar = await this.buscador();
    return { empresa, planilla: construirPlanilla03({ anio, detalles, buscarEmpleado: buscar }) };
  }

  async talonarios(ruc, periodo, modo, { conLogo = false } = {}) {
    const [empresa, detalle, ajustes, logo] = await Promise.all([this.empresa(ruc), this.detalle(ruc, periodo),
      this.store.list('talonarios', `${ruc}|`), conLogo ? this.logo(ruc) : null]);
    if (!empresa || !detalle) return null;
    const porCedula = new Map(ajustes.map((a) => [a.cedula, a]));
    return { empresa, detalle, logo, resultado: construirTalonarios(detalle, { modo, ajustes: (c) => porCedula.get(c) || null }) };
  }

  /** Reporte de cesantías de un trimestre; trimestres dice cuáles del año tienen algún mes cargado. */
  async cesantias(ruc, anio, trimestre) {
    const [empresa, detalles, datos] = await Promise.all([this.empresa(ruc), this.listarDetalles(ruc), this.store.list('cesantias', `${ruc}|`)]);
    if (!empresa) return null;
    const delAnio = detalles.filter((d) => String(d.periodo).startsWith(String(anio)));
    const cargados = new Set(delAnio.map((d) => String(d.periodo)));
    const porCedula = new Map(datos.map((d) => [d.cedula, d]));
    const armar = (t) => construirCesantias({ anio, trimestre: t, detalles: delAnio, datos: (c) => porCedula.get(c) || null });
    const trimestres = [1, 2, 3, 4].filter((t) => periodosTrimestre(anio, t).some((p) => cargados.has(p)));
    return { empresa, trimestres, resultado: trimestre ? armar(trimestre) : null, armar };
  }

  /** Guarda lo que se escribe a mano en el reporte de cesantías y los datos del encabezado. */
  async guardarDatosCesantias(ruc, { encabezado, filas }) {
    const docs = filas.filter((f) => f.cedula).map((f) => {
      const cedula = String(f.cedula).trim().toUpperCase();
      return [`${ruc}|${cedula}`, { ruc, cedula, ...limpiarDatosCesantias(f) }];
    });
    if (docs.length) await this.store.putMany('cesantias', docs);
    if (encabezado) {
      const t = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      await this.guardarEmpresa(ruc, { cesNombre: t(encabezado.cesNombre), cesContacto: t(encabezado.cesContacto), cesTelefono: t(encabezado.cesTelefono) });
    }
  }

  /** Logo PNG de la empresa (Buffer) o null. */
  async logo(ruc) {
    const doc = await this.store.get('logos', ruc);
    return doc ? Buffer.from(doc.png, 'base64') : null;
  }

  /**
   * Guarda el logo (JPG o PNG tal como lo subieron): se le quita el fondo y se recorta aquí.
   * Si no se escogieron colores a mano, se usan los del logo.
   */
  async guardarLogo(ruc, imagen, { principal, secundario, coloresManual = false } = {}) {
    const { png, colores } = prepararLogo(imagen);
    await this.store.put('logos', ruc, { ruc, png: png.toString('base64') });
    const elegidos = coloresManual ? { principal, secundario } : { principal: colores.principal || principal, secundario: colores.secundario || secundario };
    await this.guardarEmpresa(ruc, { logo: Date.now(), colores: limpiarColores(elegidos) });
  }

  async guardarColores(ruc, colores) {
    await this.guardarEmpresa(ruc, { colores: limpiarColores(colores) });
  }

  async borrarLogo(ruc) {
    await this.store.delete('logos', ruc);
    await this.guardarEmpresa(ruc, { logo: false });
  }

  async guardarAjusteTalonario(ruc, cedula, { correo, conceptos }) {
    const id = String(cedula).trim().toUpperCase();
    if (!id) throw new Error('Falta la cédula.');
    const doc = { ruc, cedula: id, correo: String(correo || '').trim(), conceptos: limpiarConceptos(conceptos) };
    await this.store.put('talonarios', `${ruc}|${id}`, doc);
    return doc;
  }

  // ---------- Maestro de empleados ----------

  async listarEmpleados() {
    const es = await this.store.list('empleados');
    return es.sort((a, b) => compararCedula(a.cedula, b.cedula));
  }

  /** Función cedula -> empleado del maestro (también busca en otras identificaciones). */
  async buscador() {
    const es = await this.store.list('empleados');
    const idx = new Map();
    for (const e of es) {
      for (const alias of e.otrasIds || []) idx.set(String(alias).toUpperCase(), e);
    }
    for (const e of es) idx.set(String(e.cedula).toUpperCase(), e);
    return (cedula) => idx.get(String(cedula).toUpperCase()) || null;
  }

  async guardarEmpleado(cedula, { nombreCompleto, dv, otrasIds }) {
    const id = String(cedula).trim().toUpperCase();
    if (!id) throw new Error('Falta la cédula.');
    const actual = (await this.store.get('empleados', id)) || { cedula: id };
    const nuevo = {
      ...actual,
      nombreCompleto: limpiarNombre(nombreCompleto !== undefined ? nombreCompleto : actual.nombreCompleto),
      dv: normalizarDV(dv !== undefined ? dv : actual.dv),
      otrasIds: otrasIds !== undefined ? parsearIds(otrasIds) : actual.otrasIds || [],
    };
    await this.store.put('empleados', id, nuevo);
    return nuevo;
  }

  async borrarEmpleado(cedula) {
    await this.store.delete('empleados', String(cedula).toUpperCase());
  }

  /** Lee un Informe 03 o una Planilla 03 en Excel y llena el maestro con nombre completo y DV. */
  async importarMaestro(buffer) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer);
    } catch (e) {
      throw new Error('No se pudo leer el archivo. Debe ser un Informe 03 o una Planilla 03 en Excel (.xlsx).');
    }
    const encontrados = [];
    for (const ws of wb.worksheets) {
      const t = (r, c) => cellText(ws.getRow(r).getCell(c));
      for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
        const a = norm(t(r, 1));
        if (a === 'id_planilla' && norm(t(r, 4)) === 'numero_documento') {
          for (let i = r + 1; i <= ws.rowCount; i++) {
            const ced = t(i, 4);
            if (ced) encontrados.push({ cedula: ced, dv: t(i, 5), nombreCompleto: t(i, 6) });
          }
          break;
        }
        if (a === 'nombre' && norm(t(r, 2)).startsWith('identificacion')) {
          for (let i = r + 1; i <= ws.rowCount; i++) {
            const nombre = t(i, 1);
            if (norm(nombre).startsWith('total')) break;
            const ced = t(i, 2);
            if (ced && nombre) encontrados.push({ cedula: ced, dv: t(i, 3), nombreCompleto: nombre });
          }
          break;
        }
      }
    }
    if (!encontrados.length) throw new Error('No encontré empleados. El archivo debe ser un Informe 03 (encabezados en la fila 4) o una Planilla 03 (encabezados NOMBRE / IDENTIFICACION).');

    const actuales = new Map((await this.store.list('empleados')).map((e) => [e.cedula, e]));
    const docs = [];
    let nuevos = 0;
    let actualizados = 0;
    for (const e of encontrados) {
      const id = e.cedula.trim().toUpperCase();
      const prev = actuales.get(id);
      const dv = normalizarDV(e.dv);
      const nombre = limpiarNombre(e.nombreCompleto);
      const doc = {
        cedula: id,
        otrasIds: [],
        ...prev,
        nombreCompleto: nombre || (prev && prev.nombreCompleto) || '',
        dv: dv !== '' ? dv : (prev ? prev.dv : ''),
      };
      if (prev) actualizados++; else nuevos++;
      actuales.set(id, doc);
      docs.push([id, doc]);
    }
    await this.store.putMany('empleados', docs);
    return { leidos: encontrados.length, nuevos, actualizados };
  }
}

function limpiarColores({ principal, secundario } = {}) {
  const c = (v) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : '');
  return { principal: c(principal), secundario: c(secundario) };
}

function normalizarDV(dv) {
  const s = String(dv === null || dv === undefined ? '' : dv).trim();
  if (!/^\d{1,2}$/.test(s)) return '';
  return String(Number(s));
}

function limpiarNombre(n) {
  return String(n || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function parsearIds(v) {
  const arr = Array.isArray(v) ? v : String(v || '').split(/[,;\n]/);
  return [...new Set(arr.map((x) => String(x).trim().toUpperCase()).filter(Boolean))];
}

module.exports = { Servicio };
