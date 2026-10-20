'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { crearApp } = require('../src/app');
const { FileStore } = require('../src/store/fileStore');
const { crearAuth } = require('../src/auth');
const jpeg = require('jpeg-js');
const { crearDetalleEjemplo } = require('../scripts/crearDetalleEjemplo');

// Logo de prueba: fondo blanco con una barra azul grande y un cuadro rojo.
function logoDePrueba() {
  const w = 120; const h = 60; const data = Buffer.alloc(w * h * 4, 255);
  for (let y = 10; y < 50; y++) {
    for (let x = 10; x < 110; x++) {
      const i = (y * w + x) * 4;
      if (x < 40) { data[i] = 240; data[i + 1] = 0; data[i + 2] = 0; } else { data[i] = 0; data[i + 1] = 0; data[i + 2] = 200; }
    }
  }
  return jpeg.encode({ data, width: w, height: h }, 95).data;
}

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

  // RUC con guiones: mismos dígitos que el de la CSS; se usa en el archivo para la DGI.
  r = await fetch(`${base}/empresa/1234-5-67890/config`, { method: 'POST', headers: { cookie }, redirect: 'manual', body: new URLSearchParams({ idPlanilla: '12345678', rucDGI: '12345-678-90' }) });
  assert.match(r.headers.get('location'), /ok=/);
  r = await get('/empresa/1234-5-67890/informe03/202608/excel');
  assert.match(r.headers.get('content-disposition'), /Informe03_12345-678-90_202608\.xlsx/);
  await r.arrayBuffer();
  r = await fetch(`${base}/empresa/1234-5-67890/config`, { method: 'POST', headers: { cookie }, redirect: 'manual', body: new URLSearchParams({ idPlanilla: '12345678', rucDGI: '999-1-2' }) });
  assert.match(decodeURIComponent(r.headers.get('location')), /mismos dígitos/);

  // Talonarios del mes: descuentos y adicionales fijos por empleado, Excel por quincena.
  html = await (await get('/empresa/1234-5-67890/talonarios/202608')).text();
  assert.match(html, /1ra quincena de agosto de 2026/);
  r = await fetch(`${base}/empresa/1234-5-67890/talonarios/202608/ajuste`, { method: 'POST', headers: { cookie }, redirect: 'manual',
    body: new URLSearchParams({ cedula: '8-100-200', modo: '2', filas: '2', tipo_0: 'descuento', nombre_0: 'Vantia', monto_0: '25', tipo_1: 'adicional', nombre_1: 'Transporte', monto_1: '', correo: 'juan@prueba.com' }) });
  assert.match(r.headers.get('location'), /talonarios\/202608\?modo=2&ok=.*#t-8-100-200$/);
  html = await (await get('/empresa/1234-5-67890/talonarios/202608?modo=2')).text();
  assert.match(html, /2da quincena de agosto de 2026/);
  assert.match(html, /Vantia/);
  assert.match(html, /juan@prueba\.com/);
  assert.doesNotMatch(html, /Más: Transporte/);
  r = await get('/empresa/1234-5-67890/talonarios/202608/excel?modo=2');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /Talonarios_12345-678-90_202608_2da-quincena\.xlsx/);
  await r.arrayBuffer();

  // Logo en JPG con fondo blanco: el servidor le quita el fondo y toma sus colores.
  const logo = new FormData();
  logo.append('archivo', new Blob([logoDePrueba()]), 'logo.jpg');
  logo.append('principal', '#0d5a4a');
  logo.append('secundario', '#17252b');
  r = await fetch(`${base}/empresa/1234-5-67890/logo`, { method: 'POST', body: logo, headers: { cookie }, redirect: 'manual' });
  assert.match(decodeURIComponent(r.headers.get('location')), /Logo guardado/);
  const malLogo = new FormData();
  malLogo.append('archivo', new Blob([Buffer.from('no es imagen')]), 'logo.jpg');
  r = await fetch(`${base}/empresa/1234-5-67890/logo`, { method: 'POST', body: malLogo, headers: { cookie }, redirect: 'manual' });
  assert.match(decodeURIComponent(r.headers.get('location')), /JPG o PNG/);
  r = await get('/empresa/1234-5-67890/logo.png');
  assert.equal(r.headers.get('content-type'), 'image/png');
  await r.arrayBuffer();
  html = await (await get('/empresa/1234-5-67890/talonarios/202608')).text();
  assert.match(html, /class="t-logo"/);
  assert.match(html, /--t-principal:#0{2}[0-9a-f]{2}[c-f][0-9a-f]/);
  r = await get('/empresa/1234-5-67890/talonarios/202608/pdf?modo=1&ver=1');
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.match(r.headers.get('content-disposition'), /^inline; filename="Talonarios_12345-678-90_202608_1ra-quincena\.pdf"/);
  assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  assert.match(html, /pdf\?modo=1&amp;cedula=8-100-200&amp;ver=1/);
  r = await get('/empresa/1234-5-67890/talonarios/202608/pdf?modo=2&cedula=8-100-200');
  assert.match(r.headers.get('content-disposition'), /^attachment; filename="Talonario_.*_8-100-200_202608_2da-quincena\.pdf"/);
  assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  assert.equal((await get('/empresa/1234-5-67890/talonarios/202608/pdf?cedula=no-existe')).status, 404);
  r = await get('/empresa/1234-5-67890/talonarios/202608/zip?modo=mes');
  assert.equal(r.headers.get('content-type'), 'application/zip');
  assert.match(r.headers.get('content-disposition'), /Talonarios_12345-678-90_202608_.*\.zip/);
  const zip = Buffer.from(await r.arrayBuffer());
  const empleados = (html.match(/<article class="talonario"/g) || []).length;
  assert.equal(zip.readUInt16LE(zip.length - 12), empleados);
  const largoNombre = zip.readUInt16LE(26);
  assert.match(zip.subarray(30, 30 + largoNombre).toString(), /^Talonario_.*\.pdf$/);
  const primero = require('zlib').inflateRawSync(zip.subarray(30 + largoNombre, 30 + largoNombre + zip.readUInt32LE(18)));
  assert.equal(primero.subarray(0, 5).toString(), '%PDF-');
  r = await fetch(`${base}/empresa/1234-5-67890/logo/borrar`, { method: 'POST', headers: { cookie }, redirect: 'manual' });
  assert.equal((await get('/empresa/1234-5-67890/logo.png')).status, 404);

  html = await (await get('/empleados?q=JUAN')).text();
  assert.match(html, /8-100-200/);

  const malo = new FormData();
  malo.append('archivo', new Blob([Buffer.from('no es excel')]), 'x.xls');
  r = await fetch(`${base}/cargar`, { method: 'POST', body: malo, headers: { cookie }, redirect: 'manual' });
  assert.match(decodeURIComponent(r.headers.get('location')), /No se pudo leer/);
});
