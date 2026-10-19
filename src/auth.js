'use strict';

const crypto = require('crypto');

const COOKIE = 'sipe_sesion';
const DURACION_MS = 12 * 60 * 60 * 1000;

// Un usuario y clave definidos en variables de entorno (APP_USUARIO / APP_CLAVE).
function crearAuth(env = process.env) {
  const usuario = env.APP_USUARIO || 'admin';
  const clave = env.APP_CLAVE || '';
  const secreto = env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
  const seguro = env.NODE_ENV === 'production';

  const firmar = (txt) => crypto.createHmac('sha256', secreto).update(txt).digest('base64url');
  const igual = (a, b) => {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };

  function leerCookie(req) {
    const raw = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
    if (!raw) return null;
    const [datos, firma] = decodeURIComponent(raw.slice(COOKIE.length + 1)).split('.');
    if (!datos || !firma || !igual(firmar(datos), firma)) return null;
    const [u, exp] = Buffer.from(datos, 'base64url').toString().split('|');
    return Number(exp) > Date.now() ? u : null;
  }

  return {
    configurado: !!clave,
    validar: (u, c) => !!clave && igual(u, usuario) && igual(c, clave),
    iniciar(res, u) {
      const datos = Buffer.from(`${u}|${Date.now() + DURACION_MS}`).toString('base64url');
      res.cookie(COOKIE, `${datos}.${firmar(datos)}`, { httpOnly: true, sameSite: 'lax', secure: seguro, maxAge: DURACION_MS });
    },
    cerrar(res) {
      res.clearCookie(COOKIE);
    },
    requerir(req, res, next) {
      const u = leerCookie(req);
      if (u) { req.usuario = u; return next(); }
      return res.redirect('/login');
    },
  };
}

module.exports = { crearAuth };
