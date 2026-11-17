'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { parseDetalleCSS } = require('../src/parseDetalleCSS');
const { construirInforme03, excelInforme03, COLUMNAS } = require('../src/informe03');
const { construirPlanilla03, excelPlanilla03, isrAnual, clasificarNovedad } = require('../src/planilla03');
const { construirTalonarios, excelTalonarios, pdfTalonarios } = require('../src/talonarios');
const { periodoDesdeTexto, round2 } = require('../src/util');
const { FileStore } = require('../src/store/fileStore');
const { Servicio } = require('../src/servicio');

const FIXTURE = path.join(__dirname, 'fixtures', 'detalle_ejemplo.xls');
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('lee encabezado, totales y empleados del detalle de la CSS', async () => {
  const d = await parseDetalleCSS(FIXTURE);
  assert.equal(d.empresa.ruc, '1234-5-67890');
  assert.equal(d.empresa.patronal, '87-000-00000');
  assert.equal(d.periodo, '202608');
  assert.equal(d.empleados.length, 4);
  // El primer empleado viene con "Pasaporte" en el encabezado en vez de "Cédula".
  const juan = d.empleados.find((e) => e.cedula === '8-100-200');
  assert.equal(juan.tipoDocumento, 'pasaporte');
  assert.equal(d.totales.SALARIO, round2(d.empleados.reduce((s, e) => s + e.salario, 0)));
  assert.equal(juan.salario, 720);
  assert.deepEqual(juan.componentes.PRIMA_PRODUCCION, { reportado: 400, constituyeSalario: 80 });
  assert.equal(juan.componentes.ISR.reportado, 36);
  const ana = d.empleados.find((e) => e.cedula === '4-50-60');
  assert.equal(ana.novedades[0].tipo, 'Vacaciones');
  assert.deepEqual(d.avisos, []);
});

test('lee el encabezado aunque los valores estén en otra columna', async () => {
  // Hay detalles de la CSS con el RUC, la patronal y la tasa en la columna H en vez de la J.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FIXTURE);
  const ws = wb.worksheets[0];
  for (let r = 2; r <= 6; r++) {
    const v = ws.getRow(r).getCell(10).value;
    if (v === null || v === undefined) continue;
    ws.getRow(r).getCell(8).value = v;
    ws.getRow(r).getCell(10).value = null;
  }
  const d = await parseDetalleCSS(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.equal(d.empresa.ruc, '1234-5-67890');
  assert.equal(d.empresa.patronal, '87-000-00000');
  assert.equal(d.empresa.tasaRiesgo, 0.0364);
  assert.equal(d.empleados.length, 4);
});

test('rechaza un archivo que no es el detalle de la CSS', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('x').getCell('A1').value = 'otra cosa';
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  await assert.rejects(parseDetalleCSS(buf), /no parece un detalle/);
  await assert.rejects(parseDetalleCSS(Buffer.from('hola')), /No se pudo leer/);
});

test('periodo desde "Mes cuota"', () => {
  assert.equal(periodoDesdeTexto('Agosto 2026'), '202608');
  assert.equal(periodoDesdeTexto('Setiembre 2026'), '202609');
  assert.equal(periodoDesdeTexto('Enero 2027'), '202701');
  assert.equal(periodoDesdeTexto('xx'), null);
});

test('Informe 03: mapeo de columnas, orden por cédula y fórmulas', async () => {
  const d = await parseDetalleCSS(FIXTURE);
  const maestro = { '8-100-200': { nombreCompleto: 'JUAN CARLOS PEREZ DIAZ', dv: '45' } };
  const inf = construirInforme03(d, { idPlanilla: '123456', buscarEmpleado: (c) => maestro[c] || null });
  assert.deepEqual(inf.filas.map((f) => f.NUMERO_DOCUMENTO), ['2-700-800', '4-50-60', '8-100-200', 'E-8-12345']);
  const juan = inf.filas.find((f) => f.NUMERO_DOCUMENTO === '8-100-200');
  assert.equal(juan.ID_PLANILLA, 123456);
  assert.equal(juan.PERIODO, 202608);
  assert.equal(juan.TIPO, 1);
  assert.equal(juan.DV, 45);
  assert.equal(juan.NOMBRE_EMPLEADO, 'JUAN CARLOS PEREZ DIAZ');
  assert.equal(juan.SALARIO, 720);
  assert.equal(juan.SUELDO, 640);
  assert.equal(juan.PRIMA_PRODUCCION, 400);
  assert.equal(juan.DTM, 213.33);
  assert.equal(juan.IMPUESTO_RENTA, 36);
  assert.equal(juan.RENTA_NETA_GRAVABLE, 1253.33);
  assert.equal(juan.RETENCIONES_SALARIO, 36, 'retención = ISR');
  assert.equal(juan.RETENCIONES_GR, juan.IMP_RENTA_REPRESENTACION);
  for (const f of inf.filas) {
    assert.equal(f.RETENCIONES_SALARIO, f.IMPUESTO_RENTA);
    assert.equal(f.A_FAVOR_DEL_FISCO, 0);
    assert.equal(f.A_FAVOR_DEL_EMPLEADO, 0);
  }
  const ana = inf.filas.find((f) => f.NUMERO_DOCUMENTO === '4-50-60');
  assert.equal(ana.SUELDO, 0);
  assert.equal(ana.VACACIONES, 800.29);
  assert.equal(ana.NOMBRE_EMPLEADO, 'ANA GOMEZ');
  assert.equal(ana.DV, 0);
  const luis = inf.filas.find((f) => f.NUMERO_DOCUMENTO === 'E-8-12345');
  assert.equal(luis.RENTA_NETA_GRAVABLE, 2970.83, 'los viáticos no van al Informe 03');
  assert.ok(inf.cuadres.every((c) => c.ok));
  assert.ok(inf.avisos.some((a) => a.cedula === '4-50-60' && a.tipo === 'dv'));
});

test('Informe 03: Excel con formato DGI', async () => {
  const d = await parseDetalleCSS(FIXTURE);
  const inf = construirInforme03(d, { idPlanilla: '123456', buscarEmpleado: () => null });
  const buf = await excelInforme03({ ruc: d.empresa.ruc, periodo: d.periodo, filas: inf.filas });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  assert.equal(wb.worksheets.length, 1);
  assert.equal(ws.name, 'Informe03_1234-5-67890_202608');
  assert.match(ws.getCell('A1').value, /^INFORME 03v5/);
  COLUMNAS.forEach((c, i) => assert.equal(ws.getRow(4).getCell(i + 1).value, c));
  assert.equal(ws.getCell('D5').value, '2-700-800');
  assert.equal(typeof ws.getCell('G5').value, 'number');
  assert.equal(ws.getCell('X5').formula, 'S5+T5+U5+V5+W5');
  assert.equal(ws.getCell('Y5').formula, 'H5+I5+J5+K5+L5+M5+N5+O5+P5+Q5-X5');
  assert.equal(ws.getCell('AF8').formula, 'IF(Z8-AB8>=0,Z8-AB8,0)');
  assert.equal(ws.getCell('AG8').formula, 'IF(Z8-AB8<0,AB8-Z8,0)');
  assert.equal(ws.rowCount, 8);
  assert.equal(ws.autoFilter, 'A4:AG4');
});

test('Planilla 03: columnas del mes, PP SS y acumulado anual', async () => {
  const ago = await parseDetalleCSS(FIXTURE);
  const jul = JSON.parse(JSON.stringify(ago));
  jul.periodo = '202607';
  jul.empleados = jul.empleados.filter((e) => e.cedula !== '2-700-800');
  const p = construirPlanilla03({ anio: 2026, detalles: [ago, jul], buscarEmpleado: () => null });
  assert.equal(p.filas.length, 4);
  assert.deepEqual(p.mesesCargados.map((m, i) => (m ? i : null)).filter((x) => x !== null), [6, 7]);
  const juan = p.filas.find((f) => f.cedula === '8-100-200');
  assert.deepEqual(juan.meses[7], { mes: 640, pp: 400, ppSS: 80, xiii: 213.33, isr: 36, gr: 0 });
  assert.equal(juan.total, 2506.66);
  assert.equal(juan.isrRetenido, 72);
  const rosa = p.filas.find((f) => f.cedula === '2-700-800');
  assert.equal(rosa.meses[6], null, 'entró en agosto');
  const ana = p.filas.find((f) => f.cedula === '4-50-60');
  assert.equal(ana.meses[7].mes, 800.29);
  const res = p.resumen[7];
  // Como la CSS: cada cuota se redondea por empleado y después se suma.
  const porEmpleado = (fn) => round2(p.filas.reduce((s, f) => s + (f.meses[7] ? round2(fn(f.meses[7])) : 0), 0));
  assert.equal(res.ssPatronal, porEmpleado((v) => (v.mes + v.ppSS) * 0.1325));
  assert.equal(round2(res.sePatronal + res.seEmpleado), porEmpleado((v) => v.mes * 0.0275));
  const buf = await excelPlanilla03({ empresa: ago.empresa, planilla: p });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Planilla03');
  // Estructura del modelo: A cédula, C nombre, desde E el salario de cada mes; sin columna PP SS.
  assert.equal(ws.getCell('A4').value, 'CEDULA');
  assert.equal(ws.getCell('C4').value, 'NOMBRE');
  assert.equal(ws.getCell('A5').value, '2-700-800');
  const encabezados = ws.getRow(4).values.filter(Boolean);
  assert.ok(!encabezados.includes('PP SS'));
  assert.deepEqual(encabezados.slice(0, 4), ['CEDULA', 'NOMBRE', 'Enero', 'Feb']);
  // Julio y agosto traen prima y XIII: cada uno con su columna PP y XIII.
  const col = (texto) => { let c = 1; while (ws.getRow(4).getCell(c).value !== texto) c++; return c; };
  const cAgo = col('Agost');
  assert.deepEqual([ws.getRow(4).getCell(cAgo + 1).value, ws.getRow(4).getCell(cAgo + 2).value], ['PP', 'XIII']);
  // Todo lo calculado queda como fórmula.
  const rJuan = 5 + p.filas.indexOf(juan);
  const cTot = col('TOTALES');
  assert.match(ws.getCell(rJuan, cTot).formula, /^SUM\(E\d+:/);
  assert.equal(ws.getCell(rJuan, cTot).result, 2506.66);
  assert.match(ws.getCell(rJuan, cTot + 1).formula, /^IF\(/);
  const rTot = 5 + p.filas.length;
  assert.equal(ws.getCell(rTot, 3).value, 'Total de salarios');
  assert.match(ws.getCell(rTot, cAgo).formula, /^SUM\(/);
  const L = (n) => ws.getColumn(n).letter;
  const [m, pp] = [L(cAgo), L(cAgo + 1)];
  assert.equal(ws.getCell(rTot + 2, cAgo).formula,
    `(${m}${rTot}+SUMPRODUCT((${pp}5:${pp}${rTot - 1}>${m}5:${m}${rTot - 1}/2)*(${pp}5:${pp}${rTot - 1}-${m}5:${m}${rTot - 1}/2)))*$A$${rTot + 2}`);
  assert.equal(ws.getCell(rTot + 2, 1).value, 0.1325);
  // Abajo solo queda el total según la CSS (sin "Total calculado" ni "Diferencia"),
  // y la fórmula da lo mismo que la CSS salvo centavos de redondeo.
  const rUltima = rTot + 13;
  assert.equal(ws.getCell(rUltima, 3).value, 'Total según CSS');
  assert.equal(ws.getCell(rUltima, cAgo).formula, `${m}${rTot + 6}+${m}${rTot + 12}`);
  assert.ok(Math.abs(ws.getCell(rUltima, cAgo).result - res.total) <= 0.05);
  assert.equal(ws.rowCount, rUltima);
  const textos = [];
  ws.eachRow((row) => row.eachCell((c) => { if (typeof c.value === 'string') textos.push(c.value); }));
  assert.ok(!textos.some((t) => /Diferencia|Total calculado/.test(t)));
});

test('Planilla 03: el gasto de representación va en su propia fila con ISR del 10%', async () => {
  const detalle = {
    periodo: '202609', empresa: { ruc: '1-1-1', tasaRiesgo: 0.0098 }, totales: {},
    empleados: [{ cedula: '8-1-1', nombre: 'Ana', apellido: 'Paz', salario: 1200, novedades: [], cuotas: {},
      componentes: { SUELDO: { reportado: 950, constituyeSalario: 950 }, GASTO_REPRESENTACION: { reportado: 250, constituyeSalario: 250 }, ISR: { reportado: 40.58 } } }],
  };
  const p = construirPlanilla03({ anio: 2026, detalles: [detalle], buscarEmpleado: () => null });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await excelPlanilla03({ empresa: detalle.empresa, planilla: p }));
  const ws = wb.getWorksheet('Planilla03');
  assert.deepEqual([ws.getCell('C5').value, ws.getCell('C6').value], ['ANA PAZ', 'ANA PAZ GR']);
  assert.deepEqual([ws.getCell('E4').value, ws.getCell('F4').value], ['Enero', 'GR']);
  // Septiembre: U salario, V GR.
  assert.equal(ws.getCell('U4').value, 'Sept');
  assert.equal(ws.getCell('U5').value, 950);
  assert.equal(ws.getCell('V6').value, 250);
  // ISR: al GR le toca su 10% (25) y el resto (15.58) al salario.
  assert.equal(ws.getCell('AC4').value, 'TOTALES');
  assert.match(ws.getCell('AD6').formula, /AC6\*10%/);
  assert.equal(ws.getCell('AN6').value, 25);
  assert.equal(ws.getCell('AN5').value, 15.58);
  assert.equal(ws.getCell('AS5').formula, 'AD5-AR5');
  // SS y riesgo sobre salario + GR; seguro educativo solo sobre el salario.
  assert.equal(ws.getCell('U9').formula, '(U7+V7)*$A$9');
  assert.equal(ws.getCell('U11').formula, 'U7*$A$11');
  assert.equal(ws.getCell('U20').formula, 'U13+U19');
});

test('Planilla 03: colores y comentarios de entrada, salida y vacaciones', async () => {
  const ago = await parseDetalleCSS(FIXTURE);
  const jul = JSON.parse(JSON.stringify(ago));
  jul.periodo = '202607';
  jul.empleados = jul.empleados.filter((e) => e.cedula !== '2-700-800').map((e) => ({ ...e, novedades: [] }));
  // En septiembre Juan sale con aviso de la CSS y Ana ya no aparece (salida sin aviso).
  const sep = JSON.parse(JSON.stringify(ago));
  sep.periodo = '202609';
  sep.empleados = sep.empleados.filter((e) => e.cedula !== '4-50-60').map((e) => ({ ...e, novedades: [] }));
  sep.empleados.find((e) => e.cedula === '8-100-200').novedades = [{ tipo: 'Aviso Salida', inicio: '15 de septiembre de 2026', fin: '' }];
  const p = construirPlanilla03({ anio: 2026, detalles: [jul, ago, sep], buscarEmpleado: () => null });
  const fila = (c) => p.filas.find((f) => f.cedula === c);

  assert.deepEqual(fila('2-700-800').marcas[7], { tipo: 'entrada', tipos: ['entrada'], comentario: 'FECHA DE INICIO:\n1 de agosto de 2026' });
  assert.equal(fila('4-50-60').marcas[7].tipo, 'salida', 'no aparece en septiembre');
  assert.deepEqual(fila('4-50-60').marcas[7].tipos, ['salida', 'vacaciones']);
  assert.match(fila('4-50-60').marcas[7].comentario, /VACACIONES:\n1 de agosto de 2026 al 30 de agosto de 2026/);
  assert.match(fila('4-50-60').marcas[7].comentario, /no aparece en septiembre/);
  assert.equal(fila('8-100-200').marcas[8].comentario, 'FECHA FIN:\n15 de septiembre de 2026');
  assert.equal(fila('8-100-200').marcas[6], null, 'julio es el primer mes cargado: no se deduce entrada');

  assert.equal(clasificarNovedad('Aviso Entrada'), 'entrada');
  assert.equal(clasificarNovedad('Vacaciones'), 'vacaciones');
  assert.equal(clasificarNovedad('Aviso de Terminación'), 'salida');
  assert.equal(clasificarNovedad('Incapacidad'), null);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await excelPlanilla03({ empresa: ago.empresa, planilla: p }));
  const ws = wb.getWorksheet('Planilla03');
  const col = (texto) => { let c = 1; while (ws.getRow(4).getCell(c).value !== texto) c++; return c; };
  const cTot = col('TOTALES');
  assert.deepEqual([-4, -3, -2].map((k) => ws.getRow(1).getCell(cTot + k).value), ['Sale', 'Nuevo', 'Vaca']);
  const r = 5 + p.filas.indexOf(fila('2-700-800'));
  const cAgo = col('Agost');
  const celda = ws.getCell(r, cAgo); // salario de agosto
  assert.equal(celda.fill.fgColor.argb, 'FF7030A0');
  assert.match(JSON.stringify(celda.note), /FECHA DE INICIO:\\n1 de agosto de 2026/);
  assert.equal(ws.getCell(r, col('Sept')).note, undefined);
});

test('Planilla 03: el gasto de representación no paga seguro educativo', () => {
  // Caso real: 1,500 de sueldo + 700 de gasto de representación; la CSS cobra SE solo sobre 1,500.
  const detalle = {
    periodo: '202609', empresa: { tasaRiesgo: 0.0119 }, totales: { SS: 506, SE: 41.25, RIESGO: 26.18, ISR: 0 },
    empleados: [{ cedula: '8-1-1', nombre: 'A', apellido: 'B', salario: 2200, novedades: [], cuotas: {},
      componentes: { SUELDO: { reportado: 1500, constituyeSalario: 1500 }, GASTO_REPRESENTACION: { reportado: 700, constituyeSalario: 700 } } }],
  };
  const r = construirPlanilla03({ anio: 2026, detalles: [detalle], buscarEmpleado: () => null }).resumen[8];
  assert.equal(round2(r.sePatronal + r.seEmpleado), 41.25);
  assert.equal(round2(r.ssPatronal + r.ssEmpleado), 506);
  assert.equal(r.diferencia, 0);
});

test('Talonarios: quincenas que suman el mes de la CSS, descuentos y adicionales fijos', async () => {
  // Como el modelo: sueldo + gasto de representación, un préstamo y transporte fijos por quincena.
  const detalle = {
    periodo: '202609', empresa: { razonSocial: 'EMPRESA DE PRUEBA, S.A.' }, totales: {},
    empleados: [{ cedula: '8-1-1', nombre: 'ANA', apellido: 'PEREZ', salario: 2200, novedades: [], cuotas: {}, conceptosNoMapeados: [],
      componentes: { SUELDO: { reportado: 1500, constituyeSalario: 1500 }, GASTO_REPRESENTACION: { reportado: 700, constituyeSalario: 700 }, ISR: { reportado: 176.15, constituyeSalario: 0 } } }],
  };
  const ajustes = () => ({ correo: 'ana@prueba.com', conceptos: [{ tipo: 'descuento', nombre: 'Préstamo', monto: 120.83 }, { tipo: 'adicional', nombre: 'Transporte', monto: 20 }] });
  const [q1, q2, mes] = ['1', '2', 'mes'].map((modo) => construirTalonarios(detalle, { modo, ajustes }).talonarios[0]);
  const ded = (t, c) => t.deducciones.find((d) => d.concepto === c).monto;
  assert.equal(q1.ingresos[0].concepto, '1ra quincena de septiembre de 2026');
  assert.equal(q1.subtotal, 750);
  assert.equal(q1.gr, 350);
  assert.equal(ded(q1, 'ISR del GR'), 35);
  // SS 9.75% sobre todo (2,200) y SE 1.25% sin el gasto de representación (1,500).
  assert.equal(ded(mes, 'SS y SE de Salario'), 233.25);
  assert.equal(round2(ded(q1, 'SS y SE de Salario') + ded(q2, 'SS y SE de Salario')), 233.25);
  assert.equal(round2(ded(q1, 'ISR') + ded(q2, 'ISR') + ded(q1, 'ISR del GR') + ded(q2, 'ISR del GR')), 176.15);
  assert.equal(ded(q2, 'Préstamo'), 120.83);
  assert.equal(ded(mes, 'Préstamo'), 241.66);
  assert.equal(q1.neto, round2(750 + 350 - q1.totalDeducciones + 20));
  assert.equal(round2(q1.neto + q2.neto), mes.neto);

  // El XIII mes va completo en la 1ra quincena con su SS.
  const ago = await parseDetalleCSS(FIXTURE);
  const t1 = construirTalonarios(ago, { modo: '1' });
  const juan = t1.talonarios.find((t) => t.cedula === '8-100-200');
  assert.equal(juan.xiii, 213.33);
  assert.equal(ded(juan, 'SS del XIII'), round2(213.33 * 0.0725));
  assert.equal(construirTalonarios(ago, { modo: '2' }).talonarios.find((t) => t.cedula === '8-100-200').xiii, 0);

  const buf = await excelTalonarios({ empresa: ago.empresa, resultado: t1 });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Talonarios');
  const filas = [];
  ws.eachRow((row, n) => filas.push([n, row.getCell(1).value, row.getCell(5).value]));
  assert.equal(filas.filter(([, a]) => String(a).startsWith('TALONARIO DE PAGO')).length, ago.empleados.length);
  const netas = filas.filter(([, a]) => a === 'QUINCENA NETA').map(([, , e]) => e.result);
  assert.deepEqual(netas, t1.talonarios.map((t) => t.neto));

  // Con logo y colores de la empresa: el Excel lleva la imagen y el PDF se genera.
  const empresa = { ...ago.empresa, colores: { principal: '#0000c0', secundario: '#f00000' } };
  const conLogo = await excelTalonarios({ empresa, resultado: t1, logo: PNG_1X1 });
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(conLogo);
  assert.equal(wb2.getWorksheet('Talonarios').getImages().length, ago.empleados.length);
  const pdf = await pdfTalonarios({ empresa, resultado: t1, logo: PNG_1X1 });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 2000);
});

test('ISR anual por tramos', () => {
  assert.equal(isrAnual(10000), 0);
  assert.equal(isrAnual(20000), 1350);
  assert.equal(isrAnual(60000), 8350);
});

test('servicio: carga, maestro e importación desde un Informe 03', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sipe-'));
  const svc = new Servicio(new FileStore(dir));
  const buf = fs.readFileSync(FIXTURE);
  const r1 = await svc.cargarDetalle(buf, 'detalle.xls');
  assert.equal(r1.reemplazo, false);
  const r2 = await svc.cargarDetalle(buf, 'detalle.xls');
  assert.equal(r2.reemplazo, true);
  await svc.guardarEmpresa('1234-5-67890', { idPlanilla: '999' });

  // Un Informe 03 "anterior" con nombres completos y DV sirve para llenar el maestro.
  const d = await parseDetalleCSS(FIXTURE);
  const filas = construirInforme03(d, { idPlanilla: '999', buscarEmpleado: () => null }).filas
    .map((f) => ({ ...f, NOMBRE_EMPLEADO: `${f.NOMBRE_EMPLEADO} COMPLETO`, DV: 7 }));
  const anterior = await excelInforme03({ ruc: d.empresa.ruc, periodo: d.periodo, filas });
  const imp = await svc.importarMaestro(Buffer.from(anterior));
  assert.deepEqual(imp, { leidos: 4, nuevos: 4, actualizados: 0 });

  await svc.guardarEmpleado('9-9-9', { nombreCompleto: 'luis  alberto rivera', dv: '3', otrasIds: 'E-8-12345' });
  await svc.borrarEmpleado('E-8-12345');
  const inf = await svc.informe03('1234-5-67890', '202608');
  const luis = inf.filas.find((f) => f.NUMERO_DOCUMENTO === 'E-8-12345');
  assert.equal(luis.NOMBRE_EMPLEADO, 'LUIS ALBERTO RIVERA', 'encuentra por otra identificación');
  assert.equal(luis.DV, 3);
  assert.equal(inf.filas[0].ID_PLANILLA, 999);
  assert.equal(inf.avisos.length, 0);

  const p = await svc.planilla03('1234-5-67890', 2026);
  assert.equal(p.planilla.filas.length, 4);
  await svc.borrarDetalle('1234-5-67890', '202608');
  assert.equal((await svc.listarDetalles('1234-5-67890')).length, 0);
});
