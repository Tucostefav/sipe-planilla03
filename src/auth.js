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

  // Entrada desde ENCARGA: un token JWT (HS256) firmado con ENCARGA_SECRET, que solo ENCARGA conoce.
  const secretoEncarga = env.ENCARGA_SECRET || '';
  const VIDA_MAX_S = 10 * 60;
  const usados = new Map(); // jti -> exp, para que un enlace no sirva dos veces

  function leerTokenEncarga(token, { unSoloUso = false } = {}) {
    if (!secretoEncarga || typeof token !== 'string') return null;
    const partes = token.split('.');
    if (partes.length !== 3) return null;
    const firma = crypto.createHmac('sha256', secretoEncarga).update(`${partes[0]}.${partes[1]}`).digest('base64url');
    if (!igual(firma, partes[2])) return null;
    let cab; let datos;
    try {
      cab = JSON.parse(Buffer.from(partes[0], 'base64url').toString());
      datos = JSON.parse(Buffer.from(partes[1], 'base64url').toString());
    } catch { return null; }
    if (!cab || cab.alg !== 'HS256' || !datos) return null;
    const ahora = Math.floor(Date.now() / 1000);
    const { iat, exp, jti } = datos;
    if (!Number.isFinite(iat) || !Number.isFinite(exp) || iat > ahora + 60 || exp < ahora || exp - iat > VIDA_MAX_S) return null;
    const usuario = String(datos.sub || '').replace(/[|\u0000-\u001f]/g, '').trim().slice(0, 80);
    if (!usuario) return null;
    if (unSoloUso) {
      if (typeof jti !== 'string' || !jti || usados.has(jti)) return null;
      for (const [k, v] of usados) if (v < ahora) usados.delete(k);
      usados.set(jti, exp);
    }
    // Solo rutas internas, para que el enlace no pueda mandar a otra página.
    const ir = typeof datos.ir === 'string' && /^\/(?![\/\\])/.test(datos.ir) && !/[\s\u0000-\u001f]/.test(datos.ir) ? datos.ir : '/';
    return { usuario, ir };
  }

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
    encarga: !!secretoEncarga,
    entrarConEncarga: (token) => leerTokenEncarga(token, { unSoloUso: true }),
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
      // ENCARGA también puede llamar directo (sin navegador) con Authorization: Bearer <token>.
      const bearer = /^Bearer (.+)$/i.exec(req.headers.authorization || '');
      if (bearer) {
        const t = leerTokenEncarga(bearer[1].trim());
        if (t) { req.usuario = t.usuario; return next(); }
        return res.status(401).json({ error: 'Token de ENCARGA no válido o vencido.' });
      }
      return res.redirect('/login');
    },
  };
}

module.exports = { crearAuth };
