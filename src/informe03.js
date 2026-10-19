'use strict';

const ExcelJS = require('exceljs');
const { round2, compararCedula } = require('./util');

// Columnas del Informe 03 v5 de la DGI, en orden (A..AG).
const COLUMNAS = [
  'ID_PLANILLA', 'PERIODO', 'TIPO', 'NUMERO_DOCUMENTO', 'DV', 'NOMBRE_EMPLEADO', 'SALARIO', 'SUELDO',
  'HORAS_EXTRAS', 'VACACIONES', 'COMISIONES', 'BONIFICACIONES', 'SALARIO_ESPECIE', 'DIETA',
  'PRIMA_PRODUCCION', 'DTM', 'GRATIFICACION_AGUINALDOS', 'GASTO_REPRESENTACION', 'DEDUCCION_CONJUNTA',
  'INTERESES_HIPOTECARIOS', 'INTERESES_EDUCATIVOS', 'PRIMAS_SEGURO', 'APORTE_FONDO_DE_JUBILACION',
  'TOTAL_DE_DEDUCCIONES', 'RENTA_NETA_GRAVABLE', 'IMPUESTO_RENTA', 'IMP_RENTA_REPRESENTACION',
  'RETENCIONES_SALARIO', 'RETENCIONES_GR', 'LIQUI_T_LABORAL', 'ISR_LIQUI_T_LABORAL',
  'A_FAVOR_DEL_FISCO', 'A_FAVOR_DEL_EMPLEADO',
];

// Conceptos del detalle CSS que pasan tal cual (monto reportado) a una columna.
const DESDE_COMPONENTE = {
  SUELDO: 'SUELDO',
  HORAS_EXTRAS: 'HORAS_EXTRAS',
  VACACIONES: 'VACACIONES',
  COMISIONES: 'COMISIONES',
  BONIFICACIONES: 'BONIFICACIONES',
  SALARIO_ESPECIE: 'SALARIO_ESPECIE',
  DIETA: 'DIETA',
  PRIMA_PRODUCCION: 'PRIMA_PRODUCCION',
  DTM: 'DTM',
  GRATIFICACION_AGUINALDOS: 'GRATIFICACION_AGUINALDOS',
  GASTO_REPRESENTACION: 'GASTO_REPRESENTACION',
  IMPUESTO_RENTA: 'ISR',
};

const ANCHOS = [11, 8, 4.57, 19.57, 3.29, 32.86, 7.71, 7.14, 13, 11.14, 10.86, 14.14, 14.43, 5.43, 17.71, 7,
  24.57, 21, 19.86, 21.29, 19.71, 14.14, 27.14, 20.86, 20.43, 15, 24.86, 19.29, 14.57, 15, 18.29, 17.57, 22];

/**
 * Arma las filas del Informe 03 a partir de un mes del detalle de la CSS.
 * @param {object} detalle resultado de parseDetalleCSS
 * @param {object} opts { idPlanilla, buscarEmpleado(cedula) -> {nombreCompleto, dv} | null }
 */
function construirInforme03(detalle, { idPlanilla, buscarEmpleado }) {
  const avisos = [];
  const filas = detalle.empleados
    .slice()
    .sort((a, b) => compararCedula(a.cedula, b.cedula))
    .map((e) => {
      const m = buscarEmpleado(e.cedula);
      const f = Object.fromEntries(COLUMNAS.map((c) => [c, 0]));
      f.ID_PLANILLA = idPlanilla ? Number(idPlanilla) || idPlanilla : '';
      f.PERIODO = Number(detalle.periodo);
      f.TIPO = 1;
      f.NUMERO_DOCUMENTO = e.cedula;
      f.DV = m && m.dv !== undefined && m.dv !== null && m.dv !== '' ? Number(m.dv) : 0;
      f.NOMBRE_EMPLEADO = (m && m.nombreCompleto) || `${e.nombre} ${e.apellido}`.trim();
      f.SALARIO = round2(e.salario);
      for (const [col, cod] of Object.entries(DESDE_COMPONENTE)) {
        f[col] = round2((e.componentes[cod] || {}).reportado || 0);
      }
      // El ISR del mes ya fue retenido en planilla: las retenciones copian el impuesto,
      // así A_FAVOR_DEL_FISCO y A_FAVOR_DEL_EMPLEADO quedan en 0.
      f.RETENCIONES_SALARIO = f.IMPUESTO_RENTA;
      f.RETENCIONES_GR = f.IMP_RENTA_REPRESENTACION;
      calcularFormulas(f);
      if (!m || !m.nombreCompleto) avisos.push({ cedula: e.cedula, tipo: 'nombre', texto: `${e.cedula}: no está en el maestro de empleados; se usó el nombre de la CSS (${f.NOMBRE_EMPLEADO}).` });
      if (!m || m.dv === undefined || m.dv === null || m.dv === '') avisos.push({ cedula: e.cedula, tipo: 'dv', texto: `${e.cedula}: no tiene DV en el maestro; se puso 0.` });
      return f;
    });
  if (!idPlanilla) avisos.unshift({ tipo: 'empresa', texto: 'La empresa no tiene ID_PLANILLA configurado; la columna A queda vacía.' });

  const suma = (c) => round2(filas.reduce((s, f) => s + (Number(f[c]) || 0), 0));
  const cuadres = [
    { concepto: 'Salario', informe: suma('SALARIO'), css: detalle.totales.SALARIO },
    { concepto: 'Impuesto sobre la renta', informe: suma('IMPUESTO_RENTA'), css: detalle.totales.ISR },
  ].map((c) => ({ ...c, ok: c.css === undefined || Math.abs(c.informe - c.css) < 0.005 }));

  return { filas, avisos, cuadres, totales: Object.fromEntries(COLUMNAS.slice(6).map((c) => [c, suma(c)])) };
}

// Mismo resultado que las fórmulas que lleva la plantilla de la DGI.
function calcularFormulas(f) {
  f.TOTAL_DE_DEDUCCIONES = round2(f.DEDUCCION_CONJUNTA + f.INTERESES_HIPOTECARIOS + f.INTERESES_EDUCATIVOS + f.PRIMAS_SEGURO + f.APORTE_FONDO_DE_JUBILACION);
  f.RENTA_NETA_GRAVABLE = round2(f.SUELDO + f.HORAS_EXTRAS + f.VACACIONES + f.COMISIONES + f.BONIFICACIONES + f.SALARIO_ESPECIE + f.DIETA + f.PRIMA_PRODUCCION + f.DTM + f.GRATIFICACION_AGUINALDOS - f.TOTAL_DE_DEDUCCIONES);
  const dif = round2(f.IMPUESTO_RENTA - f.RETENCIONES_SALARIO);
  f.A_FAVOR_DEL_FISCO = dif >= 0 ? dif : 0;
  f.A_FAVOR_DEL_EMPLEADO = dif < 0 ? -dif : 0;
}

function nombreArchivoInforme03(ruc, periodo) {
  return `Informe03_${ruc}_${periodo}.xlsx`;
}

/** Genera el .xlsx con el formato exacto de la plantilla Informe 03 v5 de la DGI. */
async function excelInforme03({ ruc, periodo, filas }) {
  const wb = new ExcelJS.Workbook();
  const nombreHoja = `Informe03_${ruc}_${periodo}`.slice(0, 31);
  const ws = wb.addWorksheet(nombreHoja, { views: [{ showGridLines: false }] });
  ws.properties.defaultRowHeight = 15;
  ws.pageSetup.margins = { left: 0.75, right: 0.75, top: 1, bottom: 1, header: 0.5, footer: 0.5 };
  ANCHOS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const fuente = { name: 'Calibri', family: 2, scheme: 'minor', size: 10, color: { theme: 1 } };
  const borde = { style: 'thin', color: { argb: 'FF000000' } };
  const estilo = {
    font: fuente,
    border: { left: borde, right: borde, top: borde, bottom: borde },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' }, bgColor: { indexed: 64 } },
    alignment: { wrapText: true },
  };

  ws.getCell('A1').value = 'INFORME 03v5 - FORMATO A DILIGENCIAR Versión vigente del 2022 en adelante.';
  ws.getCell('A1').font = { ...fuente, size: 11, bold: true };
  ws.getCell('A2').value = 'Esta sección de encabezado no se debe modificar.';
  ws.getCell('A3').value = 'Los datos de este informe deben ser registrados a partir de la línea 5 en adelante.';

  const encabezado = ws.getRow(4);
  COLUMNAS.forEach((c, i) => {
    const cell = encabezado.getCell(i + 1);
    cell.value = c;
    cell.style = { ...estilo, font: { ...fuente, bold: true } };
  });

  filas.forEach((f, idx) => {
    const r = 5 + idx;
    const row = ws.getRow(r);
    COLUMNAS.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      let v = f[c];
      if (c === 'TOTAL_DE_DEDUCCIONES') v = { formula: `S${r}+T${r}+U${r}+V${r}+W${r}`, result: f[c] };
      else if (c === 'RENTA_NETA_GRAVABLE') v = { formula: `H${r}+I${r}+J${r}+K${r}+L${r}+M${r}+N${r}+O${r}+P${r}+Q${r}-X${r}`, result: f[c] };
      else if (c === 'A_FAVOR_DEL_FISCO') v = { formula: `IF(Z${r}-AB${r}>=0,Z${r}-AB${r},0)`, result: f[c] };
      else if (c === 'A_FAVOR_DEL_EMPLEADO') v = { formula: `IF(Z${r}-AB${r}<0,AB${r}-Z${r},0)`, result: f[c] };
      else if (c === 'NUMERO_DOCUMENTO' || c === 'NOMBRE_EMPLEADO') v = String(v);
      cell.value = v;
      cell.style = estilo;
    });
  });

  ws.autoFilter = 'A4:AG4';
  return wb.xlsx.writeBuffer();
}

module.exports = { COLUMNAS, construirInforme03, excelInforme03, nombreArchivoInforme03 };
