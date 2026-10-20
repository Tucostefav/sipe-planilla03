'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { crearApp } = require('../src/app');
const { FileStore } = require('../src/store/fileStore');
const { crearAuth } = require('../src/auth');
const { crearDetalleEjemplo } = require('../scripts/crearDetalleEjemplo');

const FIXTURE = path.join(__dirname, 'fixtures', 'detalle_ejemplo.xls');

test('flujo completo por HTTP: entrar, subir, ver y descargar', async (t) => {
  const store = new FileStore(fs.mkdtempSync(path.join(os.tmpdir(), 'sipe-app-')));
  const auth = crearAuth({ APP_USUARIO: 'admin', APP_CLAVE: 'secreta', SESSION_SECRET: 'x'.repeat(32) });
  const server = crearApp({ store, auth }).listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  let r = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login');

  r = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ usuario: 'admin', clave: 'mala' }) });
  assert.match(r.headers.get('location'), /error/);

  r = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ usuario: 'admin', clave: 'secreta' }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const get = (u) => fetch(base + u, { headers: { cookie }, redirect: 'manual' });

  const form = new FormData();
  form.append('archivo', new Blob([fs.readFileSync(FIXTURE)]), 'Detalle_Planilla.xls');
  r = await fetch(`${base}/cargar`, { method: 'POST', body: form, headers: { cookie }, redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/carga/1234-5-67890/202608');

  // Varios archivos a la vez: cada mes se guarda y alimenta la Planilla 03.
  const julio = await crearDetalleEjemplo(path.join(os.tmpdir(), `detalle_julio_${process.pid}.xlsx`), 'Julio 2026');
  const lote = new FormData();
  lote.append('archivo', new Blob([fs.readFileSync(julio)]), 'julio.xlsx');
  lote.append('archivo', new Blob([fs.readFileSync(FIXTURE)]), 'agosto.xls');
  lote.append('archivo', new Blob([Buffer.from('no es excel')]), 'otro.txt');
  r = await fetch(`${base}/cargar`, { method: 'POST', body: lote, headers: { cookie }, redirect: 'manual' });
  assert.equal(r.status, 200);
  let html = await r.text();
  assert.match(html, /2 meses procesados/);
  assert.match(html, /informe03\/202607\/excel/);
  assert.match(html, /informe03\/202608\/excel/);
  assert.match(html, /planilla03\/2026\/excel/);
  assert.match(html, /otro\.txt/);
  r = await get('/empresa/1234-5-67890/planilla03/2026');
  html = await r.text();
  assert.match(html, /JULIO/);
  assert.match(html, /AGOSTO/);

  r = await get('/carga/1234-5-67890/202608');
  html = await r.text();
  assert.match(html, /Empleados por completar \(4\)/);
  assert.match(html, /Cuadra/);

  r = await fetch(`${base}/empleados/lote`, { method: 'POST', headers: { cookie }, redirect: 'manual',
    body: new URLSearchParams({ total: '1', cedula_0: '8-100-200', nombre_0: 'Juan Carlos Perez Diaz', dv_0: '45', volver: '/carga/1234-5-67890/202608' }) });
  assert.equal(r.headers.get('location'), '/carga/1234-5-67890/202608');
  html = await (await get('/carga/1234-5-67890/202608')).text();
  assert.match(html, /Empleados por completar \(3\)/);

  html = await (await get('/empresa/1234-5-67890/informe03/202608')).text();
  assert.match(html, /JUAN CARLOS PEREZ DIAZ/);
  assert.match(html, /ID_PLANILLA/);

  r = await get('/empresa/1234-5-67890/informe03/202608/excel');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /Informe03_1234-5-67890_202608\.xlsx/);
  assert.ok((await r.arrayBuffer()).byteLength > 1000);

  html = await (await get('/empresa/1234-5-67890/planilla03/2026')).text();
  assert.match(html, /AGOSTO/);
  r = await get('/empresa/1234-5-67890/planilla03/2026/excel');
  assert.equal(r.status, 200);

  r = await fetch(`${base}/empresa/1234-5-67890/config`, { method: 'POST', headers: { cookie }, redirect: 'manual', body: new URLSearchParams({ idPlanilla: '12345678' }) });
  html = await (await get('/empresa/1234-5-67890')).text();
  assert.match(html, /12345678/);

  html = await (await get('/empleados?q=JUAN')).text();
  assert.match(html, /8-100-200/);

  const malo = new FormData();
  malo.append('archivo', new Blob([Buffer.from('no es excel')]), 'x.xls');
  r = await fetch(`${base}/cargar`, { method: 'POST', body: malo, headers: { cookie }, redirect: 'manual' });
  assert.match(decodeURIComponent(r.headers.get('location')), /No se pudo leer/);
});
