'use strict';

const ExcelJS = require('exceljs');
const { cellText, toNumber, round2, norm, periodoDesdeTexto } = require('./util');

// Conceptos del bloque "Componentes" del detalle de la CSS -> código interno.
const CONCEPTOS = [
  ['SUELDO', (n) => n === 'sueldo' || n === 'salario'],
  ['VACACIONES', (n) => n.startsWith('vacacion')],
  ['PRIMA_PRODUCCION', (n) => n.includes('prima') && n.includes('produccion')],
  ['DTM', (n) => n.includes('decimo') || n === 'xiii mes' || n === 'dtm'],
  ['ISR', (n) => n.includes('impuesto sobre la renta')],
  ['VIATICOS', (n) => n.startsWith('viatico')],
  ['HORAS_EXTRAS', (n) => n.includes('extra')],
  ['COMISIONES', (n) => n.startsWith('comision')],
  ['BONIFICACIONES', (n) => n.startsWith('bonificacion')],
  ['SALARIO_ESPECIE', (n) => n.includes('especie')],
  ['DIETA', (n) => n.startsWith('dieta')],
  ['GRATIFICACION_AGUINALDOS', (n) => n.includes('gratificacion') || n.includes('aguinaldo')],
  ['GASTO_REPRESENTACION', (n) => n.includes('representacion')],
];

function codigoConcepto(nombre) {
  const n = norm(nombre);
  const hit = CONCEPTOS.find(([, test]) => test(n));
  return hit ? hit[0] : null;
}

// Cuotas del bloque "Tipo Cuenta Ingreso"
const CUOTAS = {
  'seguro social': 'SS',
  'seguro educativo': 'SE',
  dtm: 'SS_DTM',
  'riesgos profesionales': 'RIESGO',
  'impuesto sobre la renta': 'ISR',
};

const TOTALES = {
  'riesgos profesionales': 'RIESGO',
  dtm: 'SS_DTM',
  'seguro educativo': 'SE',
  'seguro social': 'SS',
  'impuesto sobre la renta': 'ISR',
  salario: 'SALARIO',
  'salario ajustado': 'SALARIO_AJUSTADO',
};

/**
 * Lee el "Desglose de reporte de empleados de planilla" que emite la CSS (SIPE).
 * Aunque la CSS lo descarga como .xls, por dentro es un .xlsx.
 * @param {Buffer|string} input buffer del archivo o ruta
 */
async function parseDetalleCSS(input) {
  const wb = new ExcelJS.Workbook();
  try {
    if (Buffer.isBuffer(input)) await wb.xlsx.load(input);
    else await wb.xlsx.readFile(input);
  } catch (e) {
    throw new Error('No se pudo leer el archivo. Debe ser el detalle de planilla descargado de la CSS (formato Excel).');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('El archivo no tiene hojas.');

  const txt = (r, c) => cellText(ws.getRow(r).getCell(c));
  // Las celdas vienen combinadas y su ancho cambia según el archivo (el RUC puede estar en
  // la columna H o en la J): el valor es la primera celda a la derecha distinta de la etiqueta.
  const valorDe = (r, cEtiqueta) => {
    const etiqueta = norm(txt(r, cEtiqueta));
    for (let c = cEtiqueta + 1; c <= 20; c++) {
      const t = txt(r, c);
      if (t && norm(t) !== etiqueta) return t;
    }
    return '';
  };
  const titulo = norm(txt(1, 2));
  if (!titulo.includes('planilla') || !titulo.includes('seguro')) {
    throw new Error('El archivo no parece un detalle de planilla de la CSS (falta el título "DESGLOSE DE REPORTE DE EMPLEADOS DE PLANILLA").');
  }

  const empresa = {};
  const totales = {};
  const empleados = [];
  const avisos = [];
  let cur = null;
  let seccion = 'encabezado';
  let tipoDocumento = '';
  let colSexo = 11;

  for (let r = 2; r <= ws.rowCount; r++) {
    const b = txt(r, 2);
    const nb = norm(b);
    const c = txt(r, 3);
    const d = txt(r, 4);

    // Encabezado de cada empleado. La segunda columna dice "Cédula" o "Pasaporte"
    // según el documento del empleado; se reconoce por "Apellido" en la columna D.
    if (nb === 'seguro social' && norm(d) === 'apellido') {
      tipoDocumento = norm(c);
      colSexo = 11;
      for (let k = 5; k <= 20; k++) if (norm(txt(r, k)) === 'sexo') { colSexo = k; break; }
      seccion = 'id';
      continue;
    }
    if (seccion === 'id') {
      cur = {
        seguroSocial: b,
        cedula: c.toUpperCase(),
        tipoDocumento,
        apellido: d,
        nombre: txt(r, 6),
        sexo: txt(r, colSexo),
        componentes: {},
        conceptosNoMapeados: [],
        cuotas: {},
        novedades: [],
        salario: 0,
        salarioAjustado: 0,
      };
      empleados.push(cur);
      seccion = 'datos';
      continue;
    }

    if (seccion === 'encabezado' || seccion === 'totales') {
      if (nb === 'totales planilla') { seccion = 'totales'; continue; }
      if (seccion === 'totales') {
        const k = TOTALES[nb];
        if (k) totales[k] = round2(toNumber(d));
        continue;
      }
      const e = norm(txt(r, 5));
      const j = valorDe(r, 5);
      if (nb === 'razon social') empresa.razonSocial = c;
      if (nb === 'nombre comercial') empresa.nombreComercial = c;
      if (nb === 'grupo de empleados') empresa.grupoEmpleados = c;
      if (nb === 'direccion') empresa.direccion = c;
      if (nb.startsWith('mes c')) empresa.mesCuota = c;
      if (e === 'ruc') empresa.ruc = j;
      if (e === 'patronal') empresa.patronal = j;
      if (e === 'telefono') empresa.telefono = j;
      if (e === 'tasa de riesgo') empresa.tasaRiesgo = toNumber(j);
      continue;
    }

    if (!cur || !b) continue;
    if (nb === 'componentes') { seccion = 'componentes'; continue; }
    if (nb === 'tipo cuenta ingreso') { seccion = 'cuotas'; continue; }
    if (nb === 'tipo novedad') { seccion = 'novedades'; continue; }
    if (nb === 'salario') { cur.salario = round2(toNumber(d)); continue; }
    if (nb === 'salario ajustado') { cur.salarioAjustado = round2(toNumber(d)); continue; }

    if (seccion === 'componentes') {
      if (nb === 'total') continue;
      const reportado = round2(toNumber(d));
      const constituyeSalario = round2(toNumber(txt(r, 7)));
      const cod = codigoConcepto(b);
      if (!cod) {
        cur.conceptosNoMapeados.push({ nombre: b, reportado, constituyeSalario });
        avisos.push(`${cur.cedula}: concepto "${b}" (${reportado}) no está en ninguna columna del Informe 03.`);
        continue;
      }
      const prev = cur.componentes[cod] || { reportado: 0, constituyeSalario: 0 };
      cur.componentes[cod] = {
        reportado: round2(prev.reportado + reportado),
        constituyeSalario: round2(prev.constituyeSalario + constituyeSalario),
      };
    } else if (seccion === 'cuotas') {
      const k = CUOTAS[nb] || b;
      cur.cuotas[k] = round2(toNumber(d));
    } else if (seccion === 'novedades') {
      const fin = txt(r, 8) || txt(r, 9);
      cur.novedades.push({ tipo: b, inicio: d, fin });
    }
  }

  empresa.ruc = String(empresa.ruc || '').trim();
  if (!empresa.ruc) throw new Error('No encontré el RUC de la empresa en el encabezado del detalle.');
  const periodo = periodoDesdeTexto(empresa.mesCuota);
  if (!periodo) throw new Error(`No pude leer el mes de cuota ("${empresa.mesCuota || ''}").`);
  if (!empleados.length) throw new Error('El detalle no tiene empleados.');

  const cedulas = new Set();
  for (const e of empleados) {
    if (!e.cedula) avisos.push(`Hay un empleado sin cédula (${e.nombre} ${e.apellido}).`);
    if (cedulas.has(e.cedula)) avisos.push(`La cédula ${e.cedula} aparece más de una vez.`);
    cedulas.add(e.cedula);
    if (e.salario !== e.salarioAjustado) {
      avisos.push(`${e.cedula}: Salario (${e.salario}) y Salario Ajustado (${e.salarioAjustado}) son distintos; se usa Salario.`);
    }
  }

  return { empresa, periodo, totales, empleados, avisos };
}

module.exports = { parseDetalleCSS, codigoConcepto };
