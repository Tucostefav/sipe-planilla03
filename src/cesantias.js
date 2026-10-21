'use strict';

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { round2, nombreMes } = require('./util');

// Reporte trimestral al fondo de cesantías (PROGRESO), con el mismo cálculo que el modelo en Excel:
// salario base = el mayor entre el promedio del trimestre y el último mes;
// prima de antigüedad = base × 1.92% × meses; aporte de indemnización = base × 6.54% × 5% × meses.
const TASA_PRIMA = 0.0192;
const TASA_INDEMNIZACION = 0.0654 * 0.05;
const ORDINAL = ['1er', '2do', '3er', '4to'];

function trimestreValido(t) {
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : null;
}

// AAAAMM de los tres meses del trimestre.
function periodosTrimestre(anio, trimestre) {
  return [1, 2, 3].map((k) => `${anio}${String((trimestre - 1) * 3 + k).padStart(2, '0')}`);
}

function trimestreDePeriodo(periodo) {
  return Math.ceil(Number(String(periodo).slice(4, 6)) / 3);
}

function tituloTrimestre(anio, trimestre) {
  return `${ORDINAL[trimestre - 1]} trimestre ${anio}`;
}

// Meses que cuenta el aporte, igual que la fórmula del modelo: 1 si entró en el 3er mes,
// 2 si entró en el 2do y 3 en los demás casos (también si salió antes de terminar el trimestre).
function mesesQueCuentan([m1, m2]) {
  if (m1 + m2 === 0) return 1;
  if (m1 === 0) return 2;
  return 3;
}

function calcularFila(salarios) {
  const promedio = (salarios[0] + salarios[1] + salarios[2]) / 3;
  const base = round2(promedio > salarios[2] ? promedio : salarios[2]);
  const meses = mesesQueCuentan(salarios);
  const prima = round2(base * TASA_PRIMA * meses);
  const indemnizacion = round2(base * TASA_INDEMNIZACION * meses);
  return { promedio, base, meses, prima, indemnizacion, total: round2(prima + indemnizacion) };
}

// La CSS trae el sexo como "FEMENINO" o "MASCULINO"; en el reporte va F o M.
function sexoCorto(v) {
  const t = String(v || '').trim().toUpperCase();
  if (t.startsWith('F')) return 'F';
  if (t.startsWith('M')) return 'M';
  return t.slice(0, 10);
}

const textoLimpio = (v, max = 60) => String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

/** Deja solo los datos que se escriben a mano, con su formato. */
function limpiarDatosCesantias(d = {}) {
  const edad = String(d.edad === undefined || d.edad === null ? '' : d.edad).trim();
  const fecha = String(d.fechaIngreso || '').trim();
  return {
    numero: textoLimpio(d.numero, 20),
    seguroSocial: textoLimpio(d.seguroSocial, 20),
    edad: /^\d{1,3}$/.test(edad) ? Number(edad) : '',
    sexo: sexoCorto(textoLimpio(d.sexo, 10)),
    fechaIngreso: /^\d{4}-\d{2}-\d{2}$/.test(fecha) && !Number.isNaN(Date.parse(fecha)) ? fecha : '',
  };
}

/**
 * @param {object[]} detalles  los detalles CSS ya cargados de la empresa (se usan los del trimestre)
 * @param {(cedula: string) => object|null} datos  lo que se escribió a mano de cada empleado
 */
function construirCesantias({ anio, trimestre, detalles, datos = () => null }) {
  const periodos = periodosTrimestre(anio, trimestre);
  const porPeriodo = new Map(detalles.map((d) => [String(d.periodo), d]));
  const faltan = periodos.filter((p) => !porPeriodo.has(p));
  const empleados = new Map();
  periodos.forEach((p, i) => {
    const d = porPeriodo.get(p);
    if (!d) return;
    for (const e of d.empleados) {
      const ced = String(e.cedula || '').trim().toUpperCase();
      if (!ced) continue;
      const fila = empleados.get(ced) || { cedula: ced, salarios: [0, 0, 0], css: {} };
      fila.salarios[i] = round2(fila.salarios[i] + (Number(e.salario) || 0));
      // El último mes que aparece manda en nombre, sexo y seguro social.
      fila.css = { nombre: e.nombre, apellido: e.apellido, sexo: e.sexo, seguroSocial: e.seguroSocial };
      empleados.set(ced, fila);
    }
  });
  const filas = [...empleados.values()].map((f) => {
    const manual = limpiarDatosCesantias(datos(f.cedula) || {});
    return {
      cedula: f.cedula,
      nombre: textoLimpio(f.css.nombre),
      apellido: textoLimpio(f.css.apellido),
      numero: manual.numero,
      seguroSocial: manual.seguroSocial || textoLimpio(f.css.seguroSocial, 20),
      edad: manual.edad,
      sexo: manual.sexo || sexoCorto(f.css.sexo),
      fechaIngreso: manual.fechaIngreso,
      manual,
      salarios: f.salarios,
      ...calcularFila(f.salarios),
    };
  }).sort((a, b) => a.apellido.localeCompare(b.apellido, 'es') || a.nombre.localeCompare(b.nombre, 'es') || a.cedula.localeCompare(b.cedula));
  const suma = (k) => round2(filas.reduce((s, f) => s + f[k], 0));
  const totales = {
    salarios: [0, 1, 2].map((i) => round2(filas.reduce((s, f) => s + f.salarios[i], 0))),
    promedio: suma('promedio'), base: suma('base'), prima: suma('prima'), indemnizacion: suma('indemnizacion'), total: suma('total'),
  };
  const avisos = faltan.map((p) => `No se ha subido el detalle de ${nombreMes(p)}. Ese mes cuenta como 0 en todos los empleados.`);
  const sinDatos = filas.filter((f) => !f.fechaIngreso || f.edad === '' || !f.sexo).length;
  if (sinDatos) avisos.push(`${sinDatos === 1 ? 'Un empleado no tiene' : `${sinDatos} empleados no tienen`} completa la edad, el sexo o la fecha de ingreso.`);
  return { anio: String(anio), trimestre, titulo: tituloTrimestre(anio, trimestre), periodos, faltan, filas, totales, avisos };
}

function nombreHoja(anio, trimestre) {
  return tituloTrimestre(anio, trimestre);
}

function nombreArchivoCesantias(ruc, anio, trimestre) {
  return trimestre ? `Cesantias_${ruc}_${anio}_T${trimestre}.xlsx` : `Cesantias_${ruc}_${anio}.xlsx`;
}

function nombreEmpresaCesantias(empresa) {
  return empresa.cesNombre || empresa.nombreComercial || empresa.razonSocial || '';
}

const AZUL = 'FF3366FF';
const GRIS = 'FFC0C0C0';
const BLANCO = 'FFFFFFFF';
const fino = { style: 'thin' };
const caja = { top: fino, left: fino, bottom: fino, right: fino };
let logoProgreso = null;

// Una hoja con el formato del modelo del fondo.
function hojaCesantias(wb, { empresa, resultado }) {
  const { anio, trimestre, filas } = resultado;
  const ws = wb.addWorksheet(nombreHoja(anio, trimestre), {
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 } },
  });
  [9.3, 10, 10, 12, 10, 7, 7, 11, 11.6, 10.2, 11.6, 12.2, 12.2, 11.5, 13.5, 12.9].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // Encabezado azul con el logo del fondo y los datos de la empresa.
  for (let r = 1; r <= 6; r++) {
    ws.getRow(r).height = 15.75;
    for (let c = 1; c <= 16; c++) ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
  }
  if (!logoProgreso) logoProgreso = fs.readFileSync(path.join(__dirname, 'recursos', 'progreso.jpeg'));
  const idLogo = wb.addImage({ buffer: logoProgreso, extension: 'jpeg' });
  ws.addImage(idLogo, { tl: { col: 0.15, row: 0.45 }, ext: { width: 200, height: 49 }, editAs: 'oneCell' });
  const blanco = (size, bold = true) => ({ name: 'Calibri', size, bold, color: { argb: BLANCO } });
  Object.assign(ws.getCell('A5'), { value: 'PROGRESO (FONDO DE CESANTIAS)', font: { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFF00' } } });
  ws.mergeCells('N1:P1');
  Object.assign(ws.getCell('N1'), { value: `${String(trimestre).padStart(2, '0')} Trimestre ${anio}`, font: { name: 'Arial', size: 12, bold: true, color: { argb: BLANCO } }, alignment: { horizontal: 'right' } });
  const dato = (fila, etiqueta, valor) => {
    Object.assign(ws.getCell(fila, 9), { value: etiqueta, font: blanco(12) });
    ws.mergeCells(fila, 11, fila, 14);
    Object.assign(ws.getCell(fila, 11), { value: valor || '', font: blanco(12) });
  };
  dato(3, 'EMPRESA', nombreEmpresaCesantias(empresa));
  dato(4, 'Contacto:', empresa.cesContacto || '');
  dato(5, 'Teléfono:', empresa.cesTelefono || '');

  // Encabezados de columnas (tres renglones, como el modelo).
  const titulos = [
    ['', 'NOMBRE DEL EMPLEADO', '', '', '', '', '', '', '', '', '', '', '', 'APORTE', '', ''],
    ['#', '', '', '', 'SEGURO', '', '', 'FECHA DE', 'SALARIO', 'SALARIO', 'SALARIO', 'SALARIO', 'SALARIO', 'PRIMA', 'APORTE', 'TOTAL'],
    ['ASIGNADO', 'NOMBRE', 'APELLIDO', 'CEDULA', 'SOCIAL', 'EDAD', 'SEXO', 'INGRESO',
      ...resultado.periodos.map((p) => `MES${p.slice(4)}`), 'PROMEDIO', 'BASE', 'ANTIGUEDAD', 'INDEMNIZACION', 'A PAGAR'],
  ];
  titulos.forEach((fila, i) => {
    const r = 7 + i;
    ws.getRow(r).height = 12;
    fila.forEach((t, c) => Object.assign(ws.getCell(r, c + 1), {
      value: t || null,
      font: { name: 'Arial', size: 8, bold: true },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      border: { left: fino, right: fino, top: i === 0 ? fino : undefined, bottom: i === 2 ? fino : undefined },
    }));
  });
  ws.mergeCells('B7:C7');
  ws.getRow(10).height = 6;
  for (let c = 1; c <= 16; c++) ws.getCell(10, c).border = caja;

  // Empleados, con las fórmulas del modelo (y su resultado ya calculado).
  const R0 = 11;
  filas.forEach((f, i) => {
    const r = R0 + i;
    const fecha = f.fechaIngreso ? new Date(`${f.fechaIngreso}T00:00:00Z`) : null;
    const valores = [f.numero || null, f.nombre, f.apellido, f.cedula, f.seguroSocial || null, f.edad === '' ? null : f.edad, f.sexo || null, fecha,
      ...f.salarios,
      { formula: `(I${r}+J${r}+K${r})/3`, result: f.promedio },
      { formula: `ROUND(IF(L${r}>K${r},(L${r}),(K${r})),2)`, result: f.base },
      { formula: `ROUND(IF((I${r}+J${r}=0),(M${r}*1.92%*1),IF((I${r}=0),(M${r}*1.92%*2),IF((I${r}+J${r}+K${r}<>0),M${r}*1.92%*3))),2)`, result: f.prima },
      { formula: `ROUND(IF((I${r}+J${r}=0),(M${r}*6.54%*5%*1),IF((I${r}=0),(M${r}*6.54%*5%*2),IF((I${r}+J${r}+K${r}<>0),M${r}*6.54%*5%*3))),2)`, result: f.indemnizacion },
      { formula: `ROUND(SUM(N${r}:O${r}),2)`, result: f.total }];
    valores.forEach((v, c) => {
      const cell = ws.getCell(r, c + 1);
      cell.value = v;
      cell.border = caja;
      cell.font = { name: c >= 1 && c <= 3 ? 'Calibri' : 'Arial', size: 10 };
      if (c >= 8) Object.assign(cell, { numFmt: '#,##0.00', alignment: { horizontal: c >= 11 ? 'center' : 'right' } });
      else if (c === 7) Object.assign(cell, { numFmt: 'dd/mm/yyyy', alignment: { horizontal: 'center' } });
      else if (c === 0 || c === 3 || c === 5 || c === 6) cell.alignment = { horizontal: 'center', vertical: 'middle' };
      else cell.alignment = { horizontal: 'left', vertical: 'middle' };
    });
  });

  // Total de la empresa: suma todas las filas de empleados.
  const rT = R0 + Math.max(filas.length, 1);
  const rFin = rT - 1;
  ws.getRow(rT).height = 18;
  ws.mergeCells(rT, 1, rT, 8);
  Object.assign(ws.getCell(rT, 1), { value: 'TOTAL GLOBAL DE APORTE DE LA EMPRESA', font: { name: 'Arial', size: 10, bold: true }, alignment: { horizontal: 'left', vertical: 'middle' } });
  const t = resultado.totales;
  const resultados = [...t.salarios, t.promedio, t.base, t.prima, t.indemnizacion, t.total];
  'IJKLMNOP'.split('').forEach((col, k) => {
    Object.assign(ws.getCell(`${col}${rT}`), {
      value: { formula: `SUM(${col}${R0}:${col}${rFin})`, result: resultados[k] },
      numFmt: k >= 3 ? '"$"#,##0.00' : '#,##0.00',
      font: { name: 'Arial', size: 11, bold: k >= 5 },
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
  });
  for (let c = 1; c <= 16; c++) ws.getCell(rT, c).border = { top: fino, left: fino, right: fino, bottom: { style: 'double' } };
  return ws;
}

/** Excel con una hoja por trimestre (uno solo o los del año que se pidan). */
async function excelCesantias({ empresa, trimestres }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Planilla 03';
  for (const resultado of trimestres) hojaCesantias(wb, { empresa, resultado });
  return wb.xlsx.writeBuffer();
}

module.exports = { construirCesantias, excelCesantias, limpiarDatosCesantias, nombreArchivoCesantias, nombreEmpresaCesantias,
  periodosTrimestre, trimestreDePeriodo, trimestreValido, tituloTrimestre, calcularFila, ORDINAL };
