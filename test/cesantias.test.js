'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { construirCesantias, excelCesantias, calcularFila } = require('../src/cesantias');
const { crearApp } = require('../src/app');
const { FileStore } = require('../src/store/fileStore');
const { crearAuth } = require('../src/auth');
const { crearDetalleEjemplo } = require('../scripts/crearDetalleEjemplo');

const FIXTURE = path.join(__dirname, 'fixtures', 'detalle_ejemplo.xls');
const emp = (cedula, nombre, apellido, salario) => ({ cedula, nombre, apellido, salario, sexo: 'F', seguroSocial: '' });

test('cesantías: mismo cálculo que el modelo del fondo', () => {
  // Valores del modelo en Excel (prima de antigüedad, indemnización y total).
  assert.deepEqual(pick(calcularFila([1150, 850, 850])), [950, 3, 54.72, 9.32, 64.04]);
  assert.deepEqual(pick(calcularFila([850, 850, 780.53])), [826.84, 3, 47.63, 8.11, 55.74]);
  assert.deepEqual(pick(calcularFila([2100, 2100, 2100])), [2100, 3, 120.96, 20.6, 141.56]);
  // Entró en el 3er o en el 2do mes; si salió antes de terminar el trimestre igual cuenta 3.
  assert.equal(calcularFila([0, 0, 900]).meses, 1);
  assert.equal(calcularFila([0, 900, 900]).meses, 2);
  assert.equal(calcularFila([900, 900, 0]).meses, 3);

  const detalles = [
    { periodo: '202610', empleados: [emp('8-1-1', 'ANA', 'BRAVO', 1000), emp('8-2-2', 'LUIS', 'ARIAS', 730)] },
    { periodo: '202611', empleados: [emp('8-1-1', 'ANA', 'BRAVO', 1000), emp('8-2-2', 'LUIS', 'ARIAS', 730), emp('8-3-3', 'EVA', 'CRUZ', 600)] },
  ];
  const r = construirCesantias({ anio: '2026', trimestre: 4, detalles, datos: (c) => (c === '8-1-1' ? { edad: '41', fechaIngreso: '2020-03-02', sexo: 'f' } : null) });
  assert.deepEqual(r.periodos, ['202610', '202611', '202612']);
  assert.deepEqual(r.faltan, ['202612']);
  assert.match(r.avisos[0], /Diciembre 2026/);
  assert.deepEqual(r.filas.map((f) => f.apellido), ['ARIAS', 'BRAVO', 'CRUZ']);
  const ana = r.filas[1];
  assert.equal(ana.edad, 41);
  assert.equal(ana.sexo, 'F');
  assert.equal(ana.fechaIngreso, '2020-03-02');
  assert.equal(r.filas[2].meses, 2);
  assert.equal(r.totales.total, Math.round(r.filas.reduce((s, f) => s + f.total, 0) * 100) / 100);
});

test('cesantías: el Excel suma a todos los empleados en el total', async () => {
  const detalles = ['202607', '202608', '202609'].map((periodo) => ({ periodo, empleados: [emp('1', 'A', 'A', 950), emp('2', 'B', 'B', 730), emp('3', 'C', 'C', 1500), emp('4', 'D', 'D', 2100)] }));
  const r = construirCesantias({ anio: '2026', trimestre: 3, detalles });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await excelCesantias({ empresa: { razonSocial: 'X', cesContacto: 'Ana' }, trimestres: [r] }));
  const ws = wb.getWorksheet('3er trimestre 2026');
  assert.equal(ws.getCell('N1').value, '03 Trimestre 2026');
  assert.equal(ws.getCell('I9').value, 'MES07');
  assert.equal(ws.getCell('K4').value, 'Ana');
  assert.equal(ws.getCell('M11').value.formula, 'ROUND(IF(L11>K11,(L11),(K11)),2)');
  assert.equal(ws.getCell('A15').value, 'TOTAL GLOBAL DE APORTE DE LA EMPRESA');
  assert.equal(ws.getCell('P15').value.formula, 'SUM(P11:P14)');
  assert.equal(ws.getCell('P15').value.result, 355.93);
  assert.equal(ws.getImages().length, 1);
});

test('cesantías por HTTP: página, datos a mano y Excel', async (t) => {
  const store = new FileStore(fs.mkdtempSync(path.join(os.tmpdir(), 'sipe-ces-')));
  const server = crearApp({ store, auth: crearAuth({ APP_USUARIO: 'admin', APP_CLAVE: 'secreta', SESSION_SECRET: 'x'.repeat(32) }) }).listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  let r = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ usuario: 'admin', clave: 'secreta' }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const get = (u) => fetch(base + u, { headers: { cookie }, redirect: 'manual' });
  const julio = await crearDetalleEjemplo(path.join(os.tmpdir(), `ces_julio_${process.pid}.xlsx`), 'Julio 2026');
  const lote = new FormData();
  lote.append('archivo', new Blob([fs.readFileSync(julio)]), 'julio.xlsx');
  lote.append('archivo', new Blob([fs.readFileSync(FIXTURE)]), 'agosto.xls');
  await (await fetch(`${base}/cargar`, { method: 'POST', body: lote, headers: { cookie } })).text();

  r = await get('/empresa/1234-5-67890/cesantias/2026');
  assert.equal(r.headers.get('location'), '/empresa/1234-5-67890/cesantias/2026/3');
  let html = await (await get('/empresa/1234-5-67890/cesantias/2026/3')).text();
  assert.match(html, /3er<span class="largo"> trimestre<\/span>/);
  assert.match(html, /Septiembre 2026/); // aviso: falta septiembre
  assert.match(html, /name="cedula_0" value="([^"]+)" form="ces"/);
  const cedula = html.match(/name="cedula_0" value="([^"]+)"/)[1];
  const filas = Number(html.match(/name="filas" value="(\d+)"/)[1]);
  // El filtro de la tabla no puede quedar dentro del formulario (su script cancela el envío del formulario que lo contiene).
  assert.ok(html.indexOf('data-filtro="#tabla-ces"') > html.indexOf('</form>'));
  assert.ok(filas > 0);

  r = await fetch(`${base}/empresa/1234-5-67890/cesantias/2026/3/datos`, { method: 'POST', headers: { cookie }, redirect: 'manual',
    body: new URLSearchParams({ filas: '1', cedula_0: cedula, numero_0: '15', edad_0: '33', sexo_0: 'M', fechaIngreso_0: '2024-08-07', seguroSocial_0: '', cesContacto: 'Rose Molina', cesTelefono: '6439-4127' }) });
  assert.match(decodeURIComponent(r.headers.get('location')), /Datos guardados/);
  html = await (await get('/empresa/1234-5-67890/cesantias/2026/3')).text();
  assert.match(html, /value="2024-08-07"/);
  assert.match(html, /value="Rose Molina"/);

  r = await get('/empresa/1234-5-67890/cesantias/2026/3/excel');
  assert.match(r.headers.get('content-disposition'), /Cesantias_1234-5-67890_2026_T3\.xlsx/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await r.arrayBuffer()));
  const ws = wb.worksheets[0];
  const fila = [...Array(filas).keys()].map((i) => 11 + i).find((n) => ws.getCell(`D${n}`).value === cedula);
  assert.equal(ws.getCell(`F${fila}`).value, 33);
  assert.equal(ws.getCell(`A${fila}`).value, '15');
  assert.equal(ws.getCell(`K${fila}`).value, 0); // septiembre no está cargado
  assert.equal((await get('/empresa/1234-5-67890/cesantias/2026/excel')).status, 200);
  assert.equal((await get('/empresa/1234-5-67890/cesantias/2026/5')).status, 404);
  html = await (await get('/empresa/1234-5-67890')).text();
  assert.match(html, /cesantias\/2026"/);
});

function pick(f) {
  return [f.base, f.meses, f.prima, f.indemnizacion, f.total];
}
