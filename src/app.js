'use strict';

const path = require('path');
const express = require('express');
const multer = require('multer');
const V = require('./views');
const { Servicio } = require('./servicio');
const { rucDGI } = require('./util');
const { excelInforme03, nombreArchivoInforme03 } = require('./informe03');
const { excelPlanilla03, nombreArchivoPlanilla03 } = require('./planilla03');
const { excelTalonarios, nombreArchivoTalonarios, modoValido } = require('./talonarios');

const MAX_ARCHIVOS = 36;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function crearApp({ store, auth }) {
  const svc = new Servicio(store);
  const app = express();
  const subir = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    next();
  });

  const envolver = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const flash = (req) => ({ aviso: req.query.ok, error: req.query.error });

  app.get('/login', (req, res) => res.send(V.login({ configurado: auth.configurado, error: req.query.error })));
  app.post('/login', (req, res) => {
    if (!auth.validar(req.body.usuario || '', req.body.clave || '')) return res.redirect('/login?error=' + encodeURIComponent('Usuario o clave incorrectos.'));
    auth.iniciar(res, req.body.usuario);
    return res.redirect('/');
  });
  app.post('/logout', (req, res) => { auth.cerrar(res); res.redirect('/login'); });

  app.use(auth.requerir);

  app.get('/', envolver(async (req, res) => {
    const empresas = await svc.listarEmpresas();
    for (const e of empresas) {
      const ds = await svc.listarDetalles(e.ruc);
      e.ultimo = ds.length ? ds[0].periodo : null;
      e.periodos = ds.map((d) => String(d.periodo));
    }
    res.send(V.inicio({ empresas, usuario: req.usuario, ...flash(req) }));
  }));

  // Acepta uno o varios detalles. Con uno solo va directo a su revisión; con varios
  // muestra un resumen por archivo. Cada mes queda guardado y alimenta la Planilla 03.
  app.post('/cargar', subir.array('archivo', MAX_ARCHIVOS), envolver(async (req, res) => {
    const archivos = req.files || [];
    if (!archivos.length) return res.redirect('/?error=' + encodeURIComponent('Selecciona el archivo del detalle de planilla.'));
    if (archivos.length === 1) {
      try {
        const { detalle, reemplazo } = await svc.cargarDetalle(archivos[0].buffer, archivos[0].originalname);
        return res.redirect(`/carga/${encodeURIComponent(detalle.empresa.ruc)}/${detalle.periodo}${reemplazo ? '?reemplazo=1' : ''}`);
      } catch (e) {
        return res.redirect('/?error=' + encodeURIComponent(e.message));
      }
    }
    const resultados = [];
    for (const f of archivos) {
      try {
        const { detalle, reemplazo } = await svc.cargarDetalle(f.buffer, f.originalname);
        const inf = await svc.informe03(detalle.empresa.ruc, detalle.periodo);
        resultados.push({ archivo: f.originalname, empresa: inf.empresa, detalle, reemplazo, cuadres: inf.cuadres });
      } catch (e) {
        resultados.push({ archivo: f.originalname, error: e.message });
      }
    }
    // Meses que ya tiene cada empresa (los de antes más los de esta carga), para la tira.
    const periodos = new Map();
    for (const r of resultados) {
      if (r.error || periodos.has(r.empresa.ruc)) continue;
      periodos.set(r.empresa.ruc, (await svc.listarDetalles(r.empresa.ruc)).map((d) => String(d.periodo)));
    }
    for (const r of resultados) if (!r.error) r.empresa.periodos = periodos.get(r.empresa.ruc);
    resultados.sort((a, b) => (a.error ? 1 : 0) - (b.error ? 1 : 0)
      || String(a.empresa && a.empresa.razonSocial).localeCompare(String(b.empresa && b.empresa.razonSocial))
      || String(a.detalle && a.detalle.periodo).localeCompare(String(b.detalle && b.detalle.periodo)));
    return res.send(V.resultadoLote({ resultados, usuario: req.usuario }));
  }));

  app.get('/carga/:ruc/:periodo', envolver(async (req, res) => {
    const inf = await svc.informe03(req.params.ruc, req.params.periodo);
    if (!inf) return res.status(404).send(V.errorPagina('No existe ese mes para esa empresa.', req.usuario));
    const buscar = await svc.buscador();
    const faltantes = inf.detalle.empleados
      .map((e) => ({ e, m: buscar(e.cedula) }))
      .filter(({ m }) => !m || !m.nombreCompleto || m.dv === '' || m.dv === undefined)
      .map(({ e, m }) => ({ cedula: e.cedula, nombreCSS: `${e.nombre} ${e.apellido}`, nombre: m && m.nombreCompleto, dv: m && m.dv }));
    res.send(V.resultadoCarga({ ...inf, informe: inf, reemplazo: !!req.query.reemplazo, faltantes, usuario: req.usuario }));
  }));

  app.get('/empresa/:ruc', envolver(async (req, res) => {
    const empresa = await svc.empresa(req.params.ruc);
    if (!empresa) return res.status(404).send(V.errorPagina('Empresa no encontrada.', req.usuario));
    res.send(V.empresaPagina({ empresa, detalles: await svc.listarDetalles(empresa.ruc), usuario: req.usuario, ...flash(req) }));
  }));

  app.post('/empresa/:ruc/config', envolver(async (req, res) => {
    const volver = `/empresa/${encodeURIComponent(req.params.ruc)}`;
    const cambios = { idPlanilla: String(req.body.idPlanilla || '').trim() };
    if (req.body.nombreTalonario !== undefined) cambios.nombreTalonario = String(req.body.nombreTalonario).replace(/\s+/g, ' ').trim();
    if (req.body.rucDGI !== undefined) {
      const r = String(req.body.rucDGI).trim().toUpperCase().replace(/\s+/g, '');
      // Debe ser el mismo RUC de la CSS, solo que con guiones.
      if (r && r.replace(/-/g, '') !== String(req.params.ruc).replace(/-/g, '').toUpperCase()) {
        return res.redirect(`${volver}?error=` + encodeURIComponent(`El RUC con guiones debe tener los mismos dígitos que el de la CSS (${req.params.ruc}).`));
      }
      cambios.rucDGI = r === req.params.ruc ? '' : r;
    }
    await svc.guardarEmpresa(req.params.ruc, cambios);
    res.redirect(`${volver}?ok=` + encodeURIComponent('Datos de la empresa guardados.'));
  }));

  app.post('/empresa/:ruc/borrar/:periodo', envolver(async (req, res) => {
    await svc.borrarDetalle(req.params.ruc, req.params.periodo);
    res.redirect(`/empresa/${encodeURIComponent(req.params.ruc)}?ok=` + encodeURIComponent('Mes borrado.'));
  }));

  app.get('/empresa/:ruc/informe03/:periodo', envolver(async (req, res) => {
    const inf = await svc.informe03(req.params.ruc, req.params.periodo);
    if (!inf) return res.status(404).send(V.errorPagina('No existe ese mes para esa empresa.', req.usuario));
    res.send(V.informe03Pagina({ ...inf, usuario: req.usuario }));
  }));

  app.get('/empresa/:ruc/informe03/:periodo/excel', envolver(async (req, res) => {
    const inf = await svc.informe03(req.params.ruc, req.params.periodo);
    if (!inf) return res.sendStatus(404);
    const buf = await excelInforme03({ ruc: rucDGI(inf.empresa), periodo: inf.detalle.periodo, filas: inf.filas });
    res.attachment(nombreArchivoInforme03(rucDGI(inf.empresa), inf.detalle.periodo)).type(XLSX_MIME).send(Buffer.from(buf));
  }));

  app.get('/empresa/:ruc/planilla03/:anio', envolver(async (req, res) => {
    const p = await svc.planilla03(req.params.ruc, req.params.anio);
    if (!p) return res.status(404).send(V.errorPagina('Empresa no encontrada.', req.usuario));
    res.send(V.planilla03Pagina({ ...p, usuario: req.usuario }));
  }));

  app.get('/empresa/:ruc/planilla03/:anio/excel', envolver(async (req, res) => {
    const p = await svc.planilla03(req.params.ruc, req.params.anio);
    if (!p) return res.sendStatus(404);
    const buf = await excelPlanilla03(p);
    res.attachment(nombreArchivoPlanilla03(p.empresa, req.params.anio)).type(XLSX_MIME).send(Buffer.from(buf));
  }));

  app.get('/empresa/:ruc/talonarios/:periodo', envolver(async (req, res) => {
    const t = await svc.talonarios(req.params.ruc, req.params.periodo, modoValido(req.query.modo));
    if (!t) return res.status(404).send(V.errorPagina('No existe ese mes para esa empresa.', req.usuario));
    res.send(V.talonariosPagina({ ...t, usuario: req.usuario, ...flash(req) }));
  }));

  app.get('/empresa/:ruc/talonarios/:periodo/excel', envolver(async (req, res) => {
    const modo = modoValido(req.query.modo);
    const t = await svc.talonarios(req.params.ruc, req.params.periodo, modo);
    if (!t) return res.sendStatus(404);
    const buf = await excelTalonarios(t);
    res.attachment(nombreArchivoTalonarios(rucDGI(t.empresa), t.detalle.periodo, modo)).type(XLSX_MIME).send(Buffer.from(buf));
  }));

  // Correo y descuentos o adicionales fijos de un empleado; se repiten cada quincena.
  app.post('/empresa/:ruc/talonarios/:periodo/ajuste', envolver(async (req, res) => {
    const { ruc, periodo } = req.params;
    const filas = Math.min(Number(req.body.filas) || 0, 50);
    const conceptos = [];
    for (let i = 0; i < filas; i++) {
      conceptos.push({ tipo: req.body[`tipo_${i}`], nombre: req.body[`nombre_${i}`], monto: req.body[`monto_${i}`] });
    }
    const doc = await svc.guardarAjusteTalonario(ruc, req.body.cedula, { correo: req.body.correo, conceptos });
    const volver = `/empresa/${encodeURIComponent(ruc)}/talonarios/${encodeURIComponent(periodo)}?modo=${modoValido(req.body.modo)}`;
    res.redirect(`${volver}&ok=` + encodeURIComponent(`Talonario de ${doc.cedula} actualizado.`) + `#t-${encodeURIComponent(doc.cedula)}`);
  }));

  app.get('/empleados', envolver(async (req, res) => {
    const q = String(req.query.q || '').trim().toUpperCase();
    let empleados = await svc.listarEmpleados();
    if (q) empleados = empleados.filter((e) => e.cedula.includes(q) || String(e.nombreCompleto).includes(q));
    res.send(V.empleadosPagina({ empleados, q, usuario: req.usuario, ...flash(req) }));
  }));

  app.post('/empleados/guardar', envolver(async (req, res) => {
    try {
      await svc.guardarEmpleado(req.body.cedula, { nombreCompleto: req.body.nombreCompleto, dv: req.body.dv, otrasIds: req.body.otrasIds });
      res.redirect('/empleados?ok=' + encodeURIComponent(`Empleado ${String(req.body.cedula).toUpperCase()} guardado.`));
    } catch (e) {
      res.redirect('/empleados?error=' + encodeURIComponent(e.message));
    }
  }));

  app.post('/empleados/lote', envolver(async (req, res) => {
    const total = Math.min(Number(req.body.total) || 0, 1000);
    for (let i = 0; i < total; i++) {
      const cedula = req.body[`cedula_${i}`];
      const nombre = String(req.body[`nombre_${i}`] || '').trim();
      const dv = String(req.body[`dv_${i}`] || '').trim();
      if (cedula && (nombre || dv)) {
        const cambios = {};
        if (nombre) cambios.nombreCompleto = nombre;
        if (dv) cambios.dv = dv;
        await svc.guardarEmpleado(cedula, cambios);
      }
    }
    const volver = String(req.body.volver || '/');
    res.redirect(volver.startsWith('/') && !volver.startsWith('//') ? volver : '/');
  }));

  app.post('/empleados/importar', subir.single('archivo'), envolver(async (req, res) => {
    if (!req.file) return res.redirect('/empleados?error=' + encodeURIComponent('Selecciona un archivo.'));
    try {
      const r = await svc.importarMaestro(req.file.buffer);
      res.redirect('/empleados?ok=' + encodeURIComponent(`Importados ${r.leidos} empleados (${r.nuevos} nuevos, ${r.actualizados} actualizados).`));
    } catch (e) {
      res.redirect('/empleados?error=' + encodeURIComponent(e.message));
    }
  }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Uno de los archivos es demasiado grande (máximo 15 MB).'
      : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? `Se pueden subir hasta ${MAX_ARCHIVOS} archivos a la vez.`
      : 'Error interno. Revisa el registro del servidor.';
    res.status(500).send(V.errorPagina(msg, req.usuario));
  });

  return app;
}

module.exports = { crearApp };
