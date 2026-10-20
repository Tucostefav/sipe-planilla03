'use strict';

const ExcelJS = require('exceljs');
const { round2, compararCedula, MESES } = require('./util');

const MESES_MAYUS = MESES.map((m) => m.toUpperCase());
const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Tasas de cuotas a la CSS. La de SS patronal subió de 12.25% a 13.25% en abril de 2025.
function tasas(periodo) {
  return {
    ssPatronal: Number(periodo) >= 202504 ? 0.1325 : 0.1225,
    ssXiiiPatronal: 0.1075,
    sePatronal: 0.015,
    ssEmpleado: 0.0975,
    ssXiiiEmpleado: 0.0725,
    seEmpleado: 0.0125,
  };
}

// ISR anual de asalariados (Panamá): 0% hasta 11,000; 15% hasta 50,000; 25% después (+5,850).
function isrAnual(renta) {
  if (renta <= 11000) return 0;
  if (renta <= 50000) return round2((renta - 11000) * 0.15);
  return round2(5850 + (renta - 50000) * 0.25);
}

/**
 * Valores de un empleado en un mes de la Planilla 03.
 * MES = lo que constituye salario sin la parte de la prima (sueldo, vacaciones, extras...).
 * PP = prima de producción reportada; PP SS = parte de la prima que pasa del 50% del salario.
 */
function valoresMes(e) {
  const prima = e.componentes.PRIMA_PRODUCCION || { reportado: 0, constituyeSalario: 0 };
  const mes = round2(e.salario - prima.constituyeSalario);
  const pp = round2(prima.reportado);
  return {
    mes,
    pp,
    ppSS: round2(Math.max(0, pp - mes / 2)),
    xiii: round2((e.componentes.DTM || {}).reportado || 0),
    isr: round2((e.componentes.ISR || {}).reportado || 0),
    // El gasto de representación paga seguro social pero no seguro educativo.
    gr: round2((e.componentes.GASTO_REPRESENTACION || {}).constituyeSalario || 0),
  };
}

/**
 * Arma la Planilla 03 de un año con todos los detalles de la CSS cargados para esa empresa.
 * @param {object[]} detalles detalles del año (cualquier orden)
 */
function construirPlanilla03({ anio, detalles, buscarEmpleado }) {
  const porCedula = new Map();
  const meses = Array.from({ length: 12 }, () => null);
  for (const d of detalles) {
    const i = Number(String(d.periodo).slice(4, 6)) - 1;
    meses[i] = { periodo: d.periodo, totalesCSS: d.totales, tasaRiesgo: d.empresa.tasaRiesgo };
    for (const e of d.empleados) {
      const m = buscarEmpleado(e.cedula);
      let f = porCedula.get(e.cedula);
      if (!f) {
        f = { cedula: e.cedula, nombre: (m && m.nombreCompleto) || `${e.nombre} ${e.apellido}`.trim(), dv: m && m.dv !== '' && m.dv !== undefined ? m.dv : '', enMaestro: !!m, meses: Array(12).fill(null) };
        porCedula.set(e.cedula, f);
      }
      f.meses[i] = valoresMes(e);
    }
  }

  const filas = [...porCedula.values()].sort((a, b) => compararCedula(a.cedula, b.cedula));
  for (const f of filas) {
    f.total = round2(f.meses.reduce((s, v) => s + (v ? v.mes + v.pp + v.xiii : 0), 0));
    f.isrEstimado = isrAnual(f.total);
    f.isrRetenido = round2(f.meses.reduce((s, v) => s + (v ? v.isr : 0), 0));
    f.pendiente = round2(Math.max(0, f.isrEstimado - f.isrRetenido));
  }

  const resumen = meses.map((info, i) => {
    if (!info) return null;
    const sum = (k) => round2(filas.reduce((s, f) => s + (f.meses[i] ? f.meses[i][k] : 0), 0));
    const t = tasas(info.periodo);
    const riesgo = info.tasaRiesgo || 0;
    const salarios = sum('mes');
    const pp = sum('pp');
    const ppSS = sum('ppSS');
    const xiii = sum('xiii');
    const isr = sum('isr');
    // La CSS calcula y redondea cada cuota por empleado y luego suma; se hace igual
    // para que el total cuadre al centavo con el detalle.
    const cuota = (fn) => round2(filas.reduce((s, f) => {
      const v = f.meses[i];
      return v ? s + round2(fn(v.mes + v.ppSS, v)) : s;
    }, 0));
    const r = {
      periodo: info.periodo, salarios, pp, ppSS, xiii, isr,
      ssPatronal: cuota((b) => b * t.ssPatronal),
      ssXiiiPatronal: cuota((b, v) => v.xiii * t.ssXiiiPatronal),
      // Seguro educativo: la CSS redondea la tasa combinada (2.75%) por empleado;
      // la parte patronal es lo que queda al restar la del empleado.
      sePatronal: cuota((b, v) => round2((v.mes - v.gr) * (t.sePatronal + t.seEmpleado)) - round2((v.mes - v.gr) * t.seEmpleado)),
      riesgo: cuota((b) => b * riesgo),
      ssEmpleado: cuota((b) => b * t.ssEmpleado),
      ssXiiiEmpleado: cuota((b, v) => v.xiii * t.ssXiiiEmpleado),
      seEmpleado: cuota((b, v) => (v.mes - v.gr) * t.seEmpleado),
      tasas: { ...t, riesgo },
    };
    r.subtotalPatronal = round2(r.ssPatronal + r.ssXiiiPatronal + r.sePatronal + r.riesgo);
    r.subtotalEmpleado = round2(r.ssEmpleado + r.ssXiiiEmpleado + r.seEmpleado + isr);
    r.total = round2(r.subtotalPatronal + r.subtotalEmpleado);
    const c = info.totalesCSS || {};
    r.totalCSS = round2((c.SS || 0) + (c.SS_DTM || 0) + (c.SE || 0) + (c.RIESGO || 0) + (c.ISR || 0));
    r.diferencia = round2(r.total - r.totalCSS);
    return r;
  });

  return { anio, filas, resumen, mesesCargados: meses.map((m) => !!m) };
}

const colLetra = (n) => {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** Exporta la Planilla 03 anual con la misma estructura del Excel que se usa hoy. */
async function excelPlanilla03({ empresa, planilla }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Planilla03', { views: [{ state: 'frozen', xSplit: 3, ySplit: 5, showGridLines: false, zoomScale: 110 }] });
  const f11 = { name: 'Calibri', family: 2, size: 11 };
  const encab = { font: { ...f11, bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { indexed: 22 } } };
  const ident = { font: f11, fill: { type: 'pattern', pattern: 'solid', fgColor: { theme: 6, tint: 0.5999938962981048 } } };
  const num = '#,##0.00';
  const contab = '_-* #,##0.00_-;-* #,##0.00_-;_-* "-"??_-;_-@_-';

  const nF = planilla.filas.length;
  const r0 = 6;
  const rUlt = r0 + nF - 1;
  const rTot = rUlt + 1;

  // Columnas: A nombre, B identificación, C DV, luego 4 por mes desde D.
  const colMes = (i, k) => 4 + i * 4 + k; // k: 0 MES, 1 PP, 2 PP SS, 3 XIII
  const cTotal = 4 + 48;
  const cIsrEst = cTotal + 1;
  const cIsrMes = (i) => cIsrEst + 1 + i;
  const cIsrRet = cIsrMes(11) + 1;
  const cPend = cIsrRet + 1;
  const L = colLetra;

  ws.getCell('A1').value = `${empresa.razonSocial || empresa.ruc} ${planilla.anio}`;
  ws.getCell('A1').style = { font: { ...f11, size: 12, bold: true, color: { argb: 'FFFF0000' } }, alignment: { horizontal: 'center' } };
  ws.mergeCells('A1:C1');
  ws.getCell('A2').value = 'NO. PATRONAL ';
  ws.getCell('C2').value = empresa.patronal || '';
  ws.getCell('A3').value = 'RUC';
  ws.getCell('C3').value = empresa.ruc;

  const h = ws.getRow(5);
  const setH = (c, v) => { const cell = h.getCell(c); cell.value = v; cell.style = encab; };
  setH(1, 'NOMBRE'); setH(2, 'IDENTIFICACION'); setH(3, 'DV');
  MESES_MAYUS.forEach((m, i) => {
    setH(colMes(i, 0), m); setH(colMes(i, 1), 'PP'); setH(colMes(i, 2), 'PP SS'); setH(colMes(i, 3), 'XIII');
    ws.getColumn(colMes(i, 1)).hidden = true;
  });
  setH(cTotal, 'Totales'); setH(cIsrEst, 'ISR anual est.');
  MESES_CORTOS.forEach((m, i) => setH(cIsrMes(i), m));
  setH(cIsrRet, 'ISR retenido'); setH(cPend, 'Pend x desc');

  ws.getColumn(1).width = 35; ws.getColumn(2).width = 17; ws.getColumn(3).width = 6;
  for (let c = 4; c <= cPend; c++) ws.getColumn(c).width = 10.5;
  ws.getColumn(cTotal).width = 13; ws.getColumn(cIsrEst).width = 13;

  planilla.filas.forEach((f, idx) => {
    const r = r0 + idx;
    const row = ws.getRow(r);
    row.getCell(1).value = f.nombre; row.getCell(1).style = ident;
    row.getCell(2).value = f.cedula; row.getCell(2).style = ident;
    row.getCell(3).value = f.dv === '' ? null : Number(f.dv);
    row.getCell(3).style = { ...ident, alignment: { horizontal: 'center' } };
    f.meses.forEach((v, i) => {
      if (!v) return;
      const mes = L(colMes(i, 0)); const pp = L(colMes(i, 1));
      row.getCell(colMes(i, 0)).value = v.mes;
      row.getCell(colMes(i, 1)).value = v.pp;
      row.getCell(colMes(i, 2)).value = { formula: `IF((${mes}${r}/2)-${pp}${r}>0,0,((${mes}${r}/2)-${pp}${r})*-1)`, result: v.ppSS };
      row.getCell(colMes(i, 3)).value = v.xiii;
      row.getCell(cIsrMes(i)).value = v.isr;
    });
    for (let c = 4; c < cTotal; c++) row.getCell(c).numFmt = num;
    const sumaMeses = MESES.map((_, i) => `${L(colMes(i, 0))}${r}+${L(colMes(i, 1))}${r}+${L(colMes(i, 3))}${r}`).join('+');
    row.getCell(cTotal).value = { formula: sumaMeses, result: f.total };
    row.getCell(cTotal).style = { ...encab, font: f11, numFmt: num };
    const T = `${L(cTotal)}${r}`;
    row.getCell(cIsrEst).value = { formula: `IF(${T}<=11000,0,IF(${T}<=50000,(${T}-11000)*15%,5850+(${T}-50000)*25%))`, result: f.isrEstimado };
    row.getCell(cIsrEst).numFmt = num;
    row.getCell(cIsrRet).value = { formula: `SUM(${L(cIsrMes(0))}${r}:${L(cIsrMes(11))}${r})`, result: f.isrRetenido };
    row.getCell(cPend).value = { formula: `IF((${L(cIsrEst)}${r}-${L(cIsrRet)}${r})<0,0,${L(cIsrEst)}${r}-${L(cIsrRet)}${r})`, result: f.pendiente };
    for (let c = cIsrMes(0); c <= cPend; c++) row.getCell(c).numFmt = contab;
  });

  // Totales por columna
  const tot = ws.getRow(rTot);
  tot.getCell(1).value = 'Total de salarios';
  tot.getCell(1).font = { ...f11, bold: true };
  for (let c = 4; c <= cPend; c++) {
    if (c === cIsrEst) continue;
    const l = L(c);
    tot.getCell(c).value = { formula: `SUM(${l}${r0}:${l}${rUlt})` };
    tot.getCell(c).style = { font: { ...f11, bold: true }, numFmt: num };
  }

  // Cuotas a la CSS por mes
  const lineas = [
    ['XIII MES', 'xiii'], ['SS Patronal', 'ssPatronal', 'ssPatronal'], ['SS XIII mes Patronal', 'ssXiiiPatronal', 'ssXiiiPatronal'],
    ['SE Patronal', 'sePatronal', 'sePatronal'], ['Riesgo Profesional', 'riesgo', 'riesgo'], ['Sub-Total patronal', 'subtotalPatronal'],
    null,
    ['SS Empleado', 'ssEmpleado', 'ssEmpleado'], ['SS XIII mes Empleado', 'ssXiiiEmpleado', 'ssXiiiEmpleado'], ['SE Empleado', 'seEmpleado', 'seEmpleado'],
    ['Imp sobre la renta Emp', 'isr'], ['Sub-Total empleado', 'subtotalEmpleado'],
    null,
    ['Total calculado', 'total'], ['Total según detalle CSS', 'totalCSS'], ['Diferencia', 'diferencia'],
  ];
  let r = rTot + 1;
  for (const linea of lineas) {
    r++;
    if (!linea) continue;
    const [titulo, clave, tasa] = linea;
    const row = ws.getRow(r);
    row.getCell(1).value = titulo;
    const destacado = clave === 'total' || clave === 'totalCSS';
    if (destacado) row.getCell(1).style = { font: { ...f11, bold: true, color: { theme: 0 } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { indexed: 17 } } };
    planilla.resumen.forEach((res, i) => {
      if (!res) return;
      const cell = row.getCell(colMes(i, 0));
      cell.value = res[clave];
      cell.numFmt = num;
      if (destacado) cell.style = { font: { ...f11, bold: true, color: { theme: 0 } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { indexed: 17 } }, numFmt: num };
      if (tasa) { const tc = row.getCell(colMes(i, 1)); tc.value = res.tasas[tasa]; tc.numFmt = '0.00%'; }
    });
  }

  ws.autoFilter = `A5:${L(cPend)}5`;
  return wb.xlsx.writeBuffer();
}

function nombreArchivoPlanilla03(empresa, anio) {
  const nombre = String(empresa.razonSocial || empresa.ruc).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_');
  return `Planilla_03_${nombre}_${anio}.xlsx`;
}

module.exports = { construirPlanilla03, excelPlanilla03, nombreArchivoPlanilla03, valoresMes, isrAnual, tasas, MESES_MAYUS, MESES_CORTOS };
