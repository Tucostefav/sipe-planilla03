'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { crearApp } = require('../src/app');
const { FileStore } = require('../src/store/fileStore');
const { crearAuth } = require('../src/auth');

const SECRETO = 'clave-compartida-con-encarga-de-prueba';

// Lo mismo que hace ENCARGA: un JWT HS256 firmado con el secreto compartido.
function token(datos, { secreto = SECRETO, alg = 'HS256' } = {}) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const ahora = Math.floor(Date.now() / 1000);
  const cuerpo = `${b64({ alg, typ: 'JWT' })}.${b64({ iat: ahora, exp: ahora + 120, jti: crypto.randomUUID(), ...datos })}`;
  return `${cuerpo}.${crypto.createHmac('sha256', secreto).update(cuerpo).digest('base64url')}`;
}

test('entrada desde ENCARGA: enlace de un solo uso y llamadas con Bearer', async (t) => {
  const store = new FileStore(fs.mkdtempSync(path.join(os.tmpdir(), 'sipe-encarga-')));
  const auth = crearAuth({ APP_CLAVE: 'secreta', SESSION_SECRET: 'x'.repeat(32), ENCARGA_SECRET: SECRETO });
  const server = crearApp({ store, auth }).listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const sso = (tk) => fetch(`${base}/sso?token=${encodeURIComponent(tk)}`, { redirect: 'manual' });

  const bueno = token({ sub: 'mlopez', ir: '/empleados' });
  let r = await sso(bueno);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/empleados');
  const cookie = r.headers.get('set-cookie').split(';')[0];
  r = await fetch(`${base}/`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /action="\/logout"/);

  // El mismo enlace no sirve dos veces.
  assert.match((await sso(bueno)).headers.get('location'), /^\/login\?error=/);
  // Firma con otro secreto, vencido, demasiado largo, sin usuario, otro algoritmo o redirección a otro sitio.
  const ahora = Math.floor(Date.now() / 1000);
  for (const malo of [
    token({ sub: 'x' }, { secreto: 'otro' }),
    token({ sub: 'x', iat: ahora - 600, exp: ahora - 10 }),
    token({ sub: 'x', exp: ahora + 3600 }),
    token({ sub: '' }),
    token({ sub: 'x' }, { alg: 'none' }),
    token({ sub: 'x', jti: undefined }),
    'basura',
  ]) assert.match((await sso(malo)).headers.get('location'), /^\/login\?error=/);
  for (const ir of ['//otro-sitio.com', '/\\otro-sitio.com', '/\t/otro-sitio.com', 'https://otro-sitio.com']) {
    assert.equal((await sso(token({ sub: 'x', ir }))).headers.get('location'), '/');
  }

  // Llamadas directas desde el servidor de ENCARGA.
  r = await fetch(`${base}/empleados`, { headers: { authorization: `Bearer ${token({ sub: 'encarga' })}` }, redirect: 'manual' });
  assert.equal(r.status, 200);
  r = await fetch(`${base}/empleados`, { headers: { authorization: `Bearer ${token({ sub: 'x' }, { secreto: 'otro' })}` }, redirect: 'manual' });
  assert.equal(r.status, 401);

  // Sin ENCARGA_SECRET no hay entrada sin clave.
  const sinEncarga = crearApp({ store, auth: crearAuth({ APP_CLAVE: 'secreta', SESSION_SECRET: 'x'.repeat(32) }) }).listen(0);
  t.after(() => sinEncarga.close());
  r = await fetch(`http://127.0.0.1:${sinEncarga.address().port}/sso?token=${bueno}`, { redirect: 'manual' });
  assert.equal(r.status, 404);
  r = await fetch(`http://127.0.0.1:${sinEncarga.address().port}/empleados`, { headers: { authorization: `Bearer ${token({ sub: 'encarga' })}` }, redirect: 'manual' });
  assert.equal(r.status, 401);
});
