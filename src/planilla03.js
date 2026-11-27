'use strict';

const ExcelJS = require('exceljs');
const { round2, compararCedula, MESES, rucDGI, norm } = require('./util');
const { isrAnual, isrGastoRepresentacion, separarIsr } = require('./isr');

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

/**
 * Valores de un empleado en un mes de la Planilla 03.
 * MES = lo que constituye salario sin la parte de la prima (sueldo, vacaciones, extras...).
 * PP = prima de producción reportada; PP SS = parte de la prima que pasa del 50% del salario.
 */
function valoresMes(e) {
  const prima = e.componentes.PRIMA_PRODUCCION || { reportado: 0, constituyeSalario: 0 };
  const mes = round2(e.salario - prima.constituyeSalario);
  const pp = round2(prima.reportado);
  const isrMes = separarIsr(e.componentes);
  return {
    mes,
    pp,
    ppSS: round2(Math.max(0, pp - mes / 2)),
    xiii: round2((e.componentes.DTM || {}).reportado || 0),
    // ISR del salario y del gasto de representación, separados.
    isr: isrMes.salario,
    isrGR: isrMes.gr,
    // El gasto de representación paga seguro social pero no seguro educativo.
    gr: round2((e.componentes.GASTO_REPRESENTACION || {}).constituyeSalario || 0),
  };
}

// Marcas de la Planilla 03: color de la celda del mes y título del comentario.
const MARCAS = {
  entrada: { nombre: 'ENTRADA', color: 'FF7030A0', titulo: 'FECHA DE INICIO' },
  salida: { nombre: 'SALE', color: 'FFFF0000', titulo: 'FECHA FIN' },
  vacaciones: { nombre: 'VACACIONES', color: 'FF005E00', titulo: 'VACACIONES' },
};
// Si en un mes hay varias novedades, el color es el de la primera de esta lista.
const PRIORIDAD_MARCAS = ['salida', 'entrada', 'vacaciones'];

/** Tipo de novedad de la CSS ("Aviso Entrada", "Vacaciones"...) -> marca de la Planilla 03. */
function clasificarNovedad(tipo) {
  const n = norm(tipo);
  if (n.includes('vacacion')) return 'vacaciones';
  if (/salida|terminacion|retiro|renuncia|despido|baja|cese/.test(n)) return 'salida';
  if (/entrada|ingreso|reintegro/.test(n)) return 'entrada';
  return null;
}

function textoMarca(m) {
  const fecha = m.tipo === 'vacaciones' && m.fin ? `${m.inicio} al ${m.fin}` : m.inicio || m.fin;
  return `${MARCAS[m.tipo].titulo}:\n${fecha || 'sin fecha en el detalle'}`;
}

/**
 * Marcas de entrada, salida y vacaciones de cada mes, con el texto del comentario.
 * Vienen de las novedades del detalle de la CSS. Si la CSS no trae la entrada o la salida,
 * se deduce cuando el empleado aparece o deja de aparecer entre dos meses cargados.
 */
function marcasEmpleado(f, novedades, mesesCargados) {
  return f.meses.map((v, i) => {
    const lista = (novedades[i] || []).map((n) => ({ tipo: clasificarNovedad(n.tipo), inicio: n.inicio, fin: n.fin })).filter((m) => m.tipo);
    if (v && i > 0 && mesesCargados[i - 1] && !f.meses[i - 1] && !lista.some((m) => m.tipo === 'entrada')) {
      lista.push({ tipo: 'entrada', deducida: true });
    }
    if (v && i < 11 && mesesCargados[i + 1] && !f.meses[i + 1] && !lista.some((m) => m.tipo === 'salida')) {
      lista.push({ tipo: 'salida', deducida: true });
    }
    if (!lista.length) return null;
    lista.sort((a, b) => PRIORIDAD_MARCAS.indexOf(a.tipo) - PRIORIDAD_MARCAS.indexOf(b.tipo));
    const textos = lista.map((m) => (m.deducida
      ? `${MARCAS[m.tipo].titulo}:\nNo viene en el detalle de la CSS. ${m.tipo === 'entrada' ? `Primer mes con salario después de ${MESES[i - 1]}.` : `Último mes con salario; no aparece en ${MESES[i + 1]}.`}`
      : textoMarca(m)));
    return { tipo: lista[0].tipo, tipos: [...new Set(lista.map((m) => m.tipo))], comentario: [...new Set(textos)].join('\n\n') };
  });
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
        f = { cedula: e.cedula, nombre: (m && m.nombreCompleto) || `${e.nombre} ${e.apellido}`.trim(), dv: m && m.dv !== '' && m.dv !== undefined ? m.dv : '', enMaestro: !!m, meses: Array(12).fill(null), novedades: Array(12).fill(null) };
        porCedula.set(e.cedula, f);
      }
      f.meses[i] = valoresMes(e);
      f.novedades[i] = e.novedades || [];
    }
  }

  const filas = [...porCedula.values()].sort((a, b) => compararCedula(a.cedula, b.cedula));
  const mesesCargados = meses.map((m) => !!m);
  for (const f of filas) {
    f.marcas = marcasEmpleado(f, f.novedades, mesesCargados);
    delete f.novedades;
    f.total = round2(f.meses.reduce((s, v) => s + (v ? v.mes + v.pp + v.xiii : 0), 0));
    // El ISR del salario y el del gasto de representación se calculan cada uno con su
    // tabla y por separado: el GR no se suma al salario.
    f.totalGR = round2(f.meses.reduce((s, v) => s + (v ? v.gr : 0), 0));
    f.isrEstimado = isrAnual(round2(f.total - f.totalGR));
    f.isrRetenido = round2(f.meses.reduce((s, v) => s + (v ? v.isr : 0), 0));
    f.pendiente = round2(Math.max(0, f.isrEstimado - f.isrRetenido));
    f.isrGREstimado = isrGastoRepresentacion(f.totalGR);
    f.isrGRRetenido = round2(f.meses.reduce((s, v) => s + (v ? v.isrGR : 0), 0));
    f.pendienteGR = round2(Math.max(0, f.isrGREstimado - f.isrGRRetenido));
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
    const isrGR = sum('isrGR');
    // La CSS calcula y redondea cada cuota por empleado y luego suma; se hace igual
    // para que el total cuadre al centavo con el detalle.
    const cuota = (fn) => round2(filas.reduce((s, f) => {
      const v = f.meses[i];
      return v ? s + round2(fn(v.mes + v.ppSS, v)) : s;
    }, 0));
    const r = {
      periodo: info.periodo, salarios, pp, ppSS, xiii, isr, isrGR,
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
    r.subtotalEmpleado = round2(r.ssEmpleado + r.ssXiiiEmpleado + r.seEmpleado + isr + isrGR);
    r.total = round2(r.subtotalPatronal + r.subtotalEmpleado);
    const c = info.totalesCSS || {};
    r.totalCSS = round2((c.SS || 0) + (c.SS_DTM || 0) + (c.SE || 0) + (c.RIESGO || 0) + (c.ISR || 0));
    r.diferencia = round2(r.total - r.totalCSS);
    return r;
  });

  return { anio, filas, resumen, mesesCargados };
}

const colLetra = (n) => {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

// Encabezados de los meses tal como están en el modelo de la Planilla 03.
const MESES_PLANILLA = ['Enero', 'Feb', 'Mar', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agost', 'Sept', 'Oct', 'Nov', 'Dic'];
const MESES_ISR = MESES_CORTOS.map((m) => m.toUpperCase());

/**
 * Exporta la Planilla 03 anual con la estructura del modelo de la empresa:
 * A cédula, C nombre; por mes el salario y, cuando aplica, PP, XIII y GR; totales, I/R,
 * ISR descontado por mes, total descontado y saldo. El gasto de representación va en una
 * fila aparte ("NOMBRE GR"). Todo lo calculado queda como fórmula de Excel.
 */
async function excelPlanilla03({ empresa, planilla }) {
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  const ws = wb.addWorksheet('Planilla03', { views: [{ state: 'frozen', xSplit: 4, ySplit: 4, showGridLines: false, zoomScale: 110 }] });
  const L = colLetra;
  const f11 = { name: 'Calibri', family: 2, size: 11 };
  const num = '#,##0.00';
  const relleno = (fgColor) => ({ type: 'pattern', pattern: 'solid', fgColor });
  const encab = { font: { ...f11, bold: true }, fill: relleno({ indexed: 22 }), alignment: { horizontal: 'center' } };
  const subEncab = { font: { ...f11, bold: true }, alignment: { horizontal: 'center' } };
  const { filas, resumen } = planilla;

  const hayGR = filas.some((f) => f.meses.some((v) => v && v.gr));
  const hay = (k) => Array.from({ length: 12 }, (_, i) => filas.some((f) => f.meses[i] && f.meses[i][k]));
  const hayPP = hay('pp');
  const hayXIII = hay('xiii');

  // Columnas: A cédula, C nombre, D separador; desde E cada mes con su salario y,
  // solo cuando hay montos, PP y XIII; GR en todos los meses si la empresa tiene gasto de representación.
  let c = 5;
  const cols = MESES_PLANILLA.map((_, i) => ({ mes: c++, pp: hayPP[i] ? c++ : null, xiii: hayXIII[i] ? c++ : null, gr: hayGR ? c++ : null }));
  const cTot = c;
  const cIsr = c + 1;
  const cIsrMes = (i) => c + 3 + i;
  const cDesc = c + 15;
  const cSaldo = c + 16;

  // Encabezado
  ws.getCell('C1').value = `${empresa.razonSocial || empresa.ruc}  AÑO ${planilla.anio}`;
  ws.getCell('C1').style = { font: { ...f11, size: 12, bold: true, color: { argb: 'FFFF0000' } }, alignment: { horizontal: 'center' } };
  ws.mergeCells(1, 3, 1, cTot - 5);
  [['Sale', 'salida'], ['Nuevo', 'entrada'], ['Vaca', 'vacaciones']].forEach(([texto, tipo], k) => {
    const cell = ws.getCell(1, cTot - 4 + k);
    cell.value = texto;
    cell.style = { font: { ...f11, bold: true, color: { theme: 0 } }, fill: relleno({ argb: MARCAS[tipo].color }), alignment: { horizontal: 'center' } };
  });
  ws.getCell('A2').value = empresa.patronal || '';
  ws.getCell('C2').value = 'NO. PATRONAL';
  ws.getCell('A3').value = rucDGI(empresa);
  ws.getCell('C3').value = 'RUC';

  const h = ws.getRow(4);
  const setH = (col, v, st = encab) => { const cell = h.getCell(col); cell.value = v; cell.style = st; };
  setH(1, 'CEDULA'); setH(3, 'NOMBRE');
  cols.forEach((m, i) => {
    setH(m.mes, MESES_PLANILLA[i], { ...encab, alignment: { horizontal: 'right' } });
    if (m.pp) setH(m.pp, 'PP', subEncab);
    if (m.xiii) setH(m.xiii, 'XIII', subEncab);
    if (m.gr) setH(m.gr, 'GR', subEncab);
  });
  setH(cTot, 'TOTALES'); setH(cIsr, 'I/R', subEncab);
  MESES_ISR.forEach((m, i) => setH(cIsrMes(i), m, subEncab));
  setH(cDesc, 'Total desc', subEncab); setH(cSaldo, 'Saldo', subEncab);

  ws.getColumn(1).width = 12.6; ws.getColumn(2).width = 12.6; ws.getColumn(3).width = 25.1; ws.getColumn(4).width = 0.6;
  cols.forEach((m) => {
    ws.getColumn(m.mes).width = 9.6;
    if (m.pp) ws.getColumn(m.pp).width = 8.1;
    if (m.xiii) ws.getColumn(m.xiii).width = 7.1;
    if (m.gr) ws.getColumn(m.gr).width = 8.1;
  });
  ws.getColumn(cTot).width = 11.4; ws.getColumn(cIsr).width = 8.9; ws.getColumn(cTot + 2).width = 1.4;
  for (let i = 0; i < 12; i++) ws.getColumn(cIsrMes(i)).width = 7.1;
  ws.getColumn(cDesc).width = 9.6; ws.getColumn(cSaldo).width = 9.4;

  // Filas de empleados. El ISR del salario va en la fila del empleado y el del gasto de
  // representación en su fila "GR", cada uno por separado.
  const lineas = [];
  for (const f of filas) {
    const tieneGR = f.meses.some((v) => v && v.gr);
    const isrGR = f.meses.map((v) => (v ? v.isrGR : 0));
    const sal = { f, gr: false, valores: new Map(), isr: f.meses.map((v) => (v ? v.isr : 0)) };
    f.meses.forEach((v, i) => {
      if (!v) return;
      sal.valores.set(cols[i].mes, round2(v.mes - v.gr));
      if (v.pp) sal.valores.set(cols[i].pp, v.pp);
      if (v.xiii) sal.valores.set(cols[i].xiii, v.xiii);
    });
    lineas.push(sal);
    if (tieneGR) {
      const gr = { f, gr: true, valores: new Map(), isr: isrGR };
      f.meses.forEach((v, i) => { if (v && v.gr) gr.valores.set(cols[i].gr, v.gr); });
      lineas.push(gr);
    }
  }

  const r0 = 5;
  const rUlt = r0 + Math.max(lineas.length, 1) - 1;
  const rTot = rUlt + 1;
  const totales = new Map();
  const acumular = (col, v) => totales.set(col, round2((totales.get(col) || 0) + (v || 0)));
  const formula = (cell, f, result) => { cell.value = { formula: f, result: round2(result) }; };

  lineas.forEach((ln, idx) => {
    const r = r0 + idx;
    const row = ws.getRow(r);
    row.getCell(1).value = ln.f.cedula;
    row.getCell(3).value = `${ln.f.nombre.toUpperCase()}${ln.gr ? ' GR' : ''}`;
    for (const k of [1, 3]) row.getCell(k).alignment = { horizontal: 'left' };
    for (let col = 5; col < cTot; col++) row.getCell(col).numFmt = num;
    for (const [col, v] of ln.valores) { row.getCell(col).value = v; acumular(col, v); }
    if (!ln.gr) {
      ln.f.marcas.forEach((m, i) => {
        if (!m) return;
        const cell = row.getCell(cols[i].mes);
        cell.style = { font: { ...f11, color: { theme: 0 } }, fill: relleno({ argb: MARCAS[m.tipo].color }), numFmt: num };
        cell.note = { texts: [{ font: { size: 9, name: 'Tahoma', family: 2 }, text: m.comentario }] };
      });
    }
    const total = round2([...ln.valores.values()].reduce((s, v) => s + v, 0));
    formula(row.getCell(cTot), `SUM(E${r}:${L(cTot - 1)}${r})`, total);
    row.getCell(cTot).style = { font: { ...f11, bold: true }, fill: relleno({ theme: 0, tint: -0.249977111117893 }), numFmt: num };
    const T = `${L(cTot)}${r}`;
    const isrEst = ln.gr ? isrGastoRepresentacion(total) : isrAnual(total);
    formula(row.getCell(cIsr), ln.gr
      ? `IF(${T}<=25000,${T}*10%,2500+(${T}-25000)*15%)`
      : `IF(${T}<=11000,0,IF(${T}<=50000,(${T}-11000)*15%,5850+(${T}-50000)*25%))`, isrEst);
    ln.isr.forEach((v, i) => { if (v) row.getCell(cIsrMes(i)).value = v; });
    const desc = round2(ln.isr.reduce((s, v) => s + v, 0));
    formula(row.getCell(cDesc), `SUM(${L(cIsrMes(0))}${r}:${L(cIsrMes(11))}${r})`, desc);
    formula(row.getCell(cSaldo), `${L(cIsr)}${r}-${L(cDesc)}${r}`, isrEst - desc);
    acumular(cTot, total); acumular(cIsr, isrEst); acumular(cDesc, desc); acumular(cSaldo, isrEst - desc);
    ln.isr.forEach((v, i) => acumular(cIsrMes(i), v));
    for (let col = cIsr; col <= cSaldo; col++) row.getCell(col).style = { ...row.getCell(col).style, numFmt: num, alignment: { horizontal: 'center' } };
  });

  // Total de salarios
  const tot = ws.getRow(rTot);
  tot.getCell(3).value = 'Total de salarios';
  tot.getCell(3).font = { ...f11, bold: true, color: { argb: 'FFFF0000' } };
  const columnasSuma = [...cols.flatMap((m) => [m.mes, m.pp, m.xiii, m.gr].filter(Boolean)), cTot, cIsr, ...MESES.map((_, i) => cIsrMes(i)), cDesc, cSaldo];
  for (const col of columnasSuma) {
    formula(tot.getCell(col), `SUM(${L(col)}${r0}:${L(col)}${rUlt})`, totales.get(col) || 0);
    tot.getCell(col).style = { font: { ...f11, bold: true }, numFmt: num };
  }

  // Cuotas a la CSS por mes, con las tasas en la columna A como en el modelo.
  // Si hay gasto de representación, su ISR va en una fila propia, separado del ISR del salario.
  const g = hayGR ? 1 : 0;
  const R = { xiii: rTot + 1, ssP: rTot + 2, ssXP: rTot + 3, seP: rTot + 4, riesgo: rTot + 5, subP: rTot + 6, ssE: rTot + 8, seE: rTot + 9, ssXE: rTot + 10, isr: rTot + 11, isrGR: hayGR ? rTot + 12 : null, subE: rTot + 12 + g, total: rTot + 13 + g };
  const iUlt = resumen.map((x, i) => (x ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  const tasaBase = iUlt >= 0 ? resumen[iUlt].tasas : { ...tasas(`${planilla.anio}12`), riesgo: 0 };
  const filaTasa = { ssPatronal: R.ssP, ssXiiiPatronal: R.ssXP, sePatronal: R.seP, riesgo: R.riesgo, ssEmpleado: R.ssE, seEmpleado: R.seE, ssXiiiEmpleado: R.ssXE };
  for (const [k, r] of Object.entries(filaTasa)) { ws.getCell(r, 1).value = tasaBase[k]; ws.getCell(r, 1).numFmt = '0.00%'; }
  const titulos = [[R.xiii, 'XIII MES'], [R.ssP, 'SS Patronal'], [R.ssXP, 'SS XIII mes Patronal'], [R.seP, 'SE Patronal'], [R.riesgo, 'Riesgo Profesional'], [R.subP, 'Sub-Total x mes', true],
    [R.ssE, 'SS Empleado'], [R.seE, 'SE Empleado'], [R.ssXE, 'SS XIII mes Empleado'], [R.isr, 'Imp sobre la renta Emp'],
    ...(hayGR ? [[R.isrGR, 'Imp sobre la renta GR']] : []), [R.subE, 'Sub total x mes', true], [R.total, 'Total según CSS']];
  for (const [r, t, negrita] of titulos) { ws.getCell(r, 3).value = t; if (negrita) ws.getCell(r, 3).font = { ...f11, bold: true }; }
  const azul = { font: { ...f11, color: { argb: 'FFFFFFFF' } }, fill: relleno({ indexed: 17 }) };
  ws.getCell(R.total, 3).style = azul;

  cols.forEach((m, i) => {
    const M = L(m.mes);
    // Tasa del mes: la de la columna A, salvo que ese mes la CSS haya usado otra (p. ej. cambio de tasa).
    const tasa = (k) => {
      const t = resumen[i] ? resumen[i].tasas[k] : tasaBase[k];
      return { ref: t === tasaBase[k] ? `$A$${filaTasa[k]}` : String(t), v: t };
    };
    const mesTot = totales.get(m.mes) || 0;
    const grTot = m.gr ? totales.get(m.gr) || 0 : 0;
    const xiiiTot = m.xiii ? totales.get(m.xiii) || 0 : 0;
    // La parte de la prima que pasa del 50% del salario paga seguro social (antes columna PP SS).
    let excesoPP = 0;
    let fExcesoPP = '';
    if (m.pp) {
      const P = L(m.pp);
      const rp = `${P}${r0}:${P}${rUlt}`;
      const rm = `${M}${r0}:${M}${rUlt}`;
      fExcesoPP = `+SUMPRODUCT((${rp}>${rm}/2)*(${rp}-${rm}/2))`;
      excesoPP = lineas.reduce((s, ln) => s + Math.max(0, (ln.valores.get(m.pp) || 0) - (ln.valores.get(m.mes) || 0) / 2), 0);
    }
    const baseSS = `(${M}${rTot}${m.gr ? `+${L(m.gr)}${rTot}` : ''}${fExcesoPP})`;
    const vBaseSS = mesTot + grTot + excesoPP;
    const put = (r, f, v) => { const cell = ws.getCell(r, m.mes); formula(cell, f, v); cell.numFmt = num; return round2(v); };

    if (m.xiii) put(R.xiii, `SUM(${L(m.xiii)}${r0}:${L(m.xiii)}${rUlt})`, xiiiTot);
    const ssP = put(R.ssP, `${baseSS}*${tasa('ssPatronal').ref}`, vBaseSS * tasa('ssPatronal').v);
    const ssXP = put(R.ssXP, `${M}${R.xiii}*${tasa('ssXiiiPatronal').ref}`, xiiiTot * tasa('ssXiiiPatronal').v);
    const seP = put(R.seP, `${M}${rTot}*${tasa('sePatronal').ref}`, mesTot * tasa('sePatronal').v);
    const rie = put(R.riesgo, `${baseSS}*${tasa('riesgo').ref}`, vBaseSS * tasa('riesgo').v);
    const subP = put(R.subP, `SUM(${M}${R.ssP}:${M}${R.riesgo})`, ssP + ssXP + seP + rie);
    const ssE = put(R.ssE, `${baseSS}*${tasa('ssEmpleado').ref}`, vBaseSS * tasa('ssEmpleado').v);
    const seE = put(R.seE, `${M}${rTot}*${tasa('seEmpleado').ref}`, mesTot * tasa('seEmpleado').v);
    const ssXE = put(R.ssXE, `${M}${R.xiii}*${tasa('ssXiiiEmpleado').ref}`, xiiiTot * tasa('ssXiiiEmpleado').v);
    const I = L(cIsrMes(i));
    const isrMesTot = totales.get(cIsrMes(i)) || 0;
    let isr;
    let isrGR = 0;
    if (hayGR) {
      // Las filas "NOMBRE GR" llevan el ISR del gasto de representación; las demás, el del salario.
      const nombres = `$C$${r0}:$C$${rUlt}`;
      const vGR = round2(lineas.reduce((s, ln) => s + (ln.gr ? ln.isr[i] || 0 : 0), 0));
      isr = put(R.isr, `SUMIF(${nombres},"<>* GR",${I}${r0}:${I}${rUlt})`, isrMesTot - vGR);
      isrGR = put(R.isrGR, `SUMIF(${nombres},"* GR",${I}${r0}:${I}${rUlt})`, vGR);
    } else {
      isr = put(R.isr, `${I}${rTot}`, isrMesTot);
    }
    const subE = put(R.subE, `SUM(${M}${R.ssE}:${M}${R.subE - 1})`, ssE + seE + ssXE + isr + isrGR);
    put(R.total, `${M}${R.subP}+${M}${R.subE}`, subP + subE);
    for (const r of [R.subP, R.subE]) ws.getCell(r, m.mes).font = { ...f11, bold: true };
    ws.getCell(R.total, m.mes).style = { ...azul, numFmt: num };
  });

  ws.autoFilter = `A4:${L(cSaldo)}4`;
  return wb.xlsx.writeBuffer();
}

function nombreArchivoPlanilla03(empresa, anio) {
  const nombre = String(empresa.razonSocial || empresa.ruc).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_');
  return `Planilla_03_${nombre}_${anio}.xlsx`;
}

module.exports = { construirPlanilla03, clasificarNovedad, MARCAS, excelPlanilla03, nombreArchivoPlanilla03, valoresMes, isrAnual, tasas, MESES_MAYUS, MESES_CORTOS };
