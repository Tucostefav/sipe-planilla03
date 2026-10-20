'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { parseDetalleCSS } = require('../src/parseDetalleCSS');
const { construirInforme03, excelInforme03, COLUMNAS } = require('../src/informe03');
const { construirPlanilla03, excelPlanilla03, isrAnual } = require('../src/planilla03');
const { construirTalonarios, excelTalonarios } = require('../src/talonarios');
const { periodoDesdeTexto, round2 } = require('../src/util');
const { FileStore } = require('../src/store/fileStore');
const { Servicio } = require('../src/servicio');

const FIXTURE = path.join(__dirname, 'fixtures', 'detalle_ejemplo.xls');

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
  assert.equal(ws.getCell('A5').value, 'NOMBRE');
  assert.equal(ws.getCell('B6').value, '2-700-800');
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
  assert.equal(filas.filter(([, a]) => a === 'TALONARIO  DE PAGO').length, ago.empleados.length);
  const netas = filas.filter(([, a]) => a === 'QUINCENA NETA').map(([, , e]) => e.result);
  assert.deepEqual(netas, t1.talonarios.map((t) => t.neto));
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
