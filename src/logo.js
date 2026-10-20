'use strict';

const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

const LADO_TRABAJO = 1600; // se reduce antes de procesar para no gastar memoria con fotos grandes
const LADO_FINAL = 900;

function decodificar(buf) {
  if (buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    const { width, height, data } = PNG.sync.read(buf);
    return { ancho: width, alto: height, datos: data };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    const { width, height, data } = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 60, maxMemoryUsageInMB: 512 });
    return { ancho: width, alto: height, datos: data };
  }
  // Se reconoce por el contenido, no por el nombre: un .jpeg que en realidad es otro formato también llega aquí.
  const cabecera = buf.subarray(0, 16).toString('latin1');
  if (cabecera.startsWith('RIFF') && cabecera.slice(8, 12) === 'WEBP') throw new Error('Ese logo está en formato WebP aunque diga otra cosa. Ábrelo y guárdalo como JPG o PNG.');
  if (cabecera.slice(4, 8) === 'ftyp') throw new Error('Ese logo está en formato HEIC (de iPhone). Ábrelo y guárdalo como JPG o PNG.');
  throw new Error('El logo debe ser una imagen JPG o PNG.');
}

// Reduce la imagen promediando bloques de píxeles (pondera por transparencia).
function reducir(img, maxLado) {
  const f = Math.max(img.ancho, img.alto) / maxLado;
  if (f <= 1) return img;
  const ancho = Math.max(1, Math.round(img.ancho / f));
  const alto = Math.max(1, Math.round(img.alto / f));
  const datos = new Uint8Array(ancho * alto * 4);
  for (let y = 0; y < alto; y++) {
    const y0 = Math.floor(y * f);
    const y1 = Math.min(img.alto, Math.max(y0 + 1, Math.floor((y + 1) * f)));
    for (let x = 0; x < ancho; x++) {
      const x0 = Math.floor(x * f);
      const x1 = Math.min(img.ancho, Math.max(x0 + 1, Math.floor((x + 1) * f)));
      let r = 0; let g = 0; let b = 0; let a = 0; let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.ancho + xx) * 4;
          const al = img.datos[i + 3];
          r += img.datos[i] * al; g += img.datos[i + 1] * al; b += img.datos[i + 2] * al; a += al; n++;
        }
      }
      const o = (y * ancho + x) * 4;
      if (a) { datos[o] = r / a; datos[o + 1] = g / a; datos[o + 2] = b / a; }
      datos[o + 3] = a / n;
    }
  }
  return { ancho, alto, datos };
}

const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/**
 * Prepara el logo para los talonarios: quita el fondo blanco (queda transparente), lo recorta a
 * su contenido y saca sus dos colores principales.
 * @returns {{ png: Buffer, colores: { principal: string, secundario: string } }}
 */
function prepararLogo(buf) {
  const img = reducir(decodificar(buf), LADO_TRABAJO);
  const { ancho: w, alto: h } = img;
  const p = img.datos;
  const filas = new Uint32Array(h);
  const cols = new Uint32Array(w);
  const grupos = new Map();
  for (let i = 0; i < p.length; i += 4) {
    const min = Math.min(p[i], p[i + 1], p[i + 2]);
    // Casi blanco -> transparente; el borde se suaviza para que no quede un halo blanco.
    let a = min >= 240 ? 0 : min <= 180 ? 255 : Math.round(((240 - min) / 60) * 255);
    a = Math.min(a, p[i + 3]);
    if (a > 0 && a < 255) {
      const f = a / 255;
      for (let k = 0; k < 3; k++) p[i + k] = Math.max(0, Math.min(255, Math.round((p[i + k] - (1 - f) * 255) / f)));
    }
    p[i + 3] = a;
    if (a > 200) {
      const px = (i / 4) % w;
      filas[Math.floor(i / 4 / w)]++;
      cols[px]++;
      const max = Math.max(p[i], p[i + 1], p[i + 2]);
      const sat = max ? (max - Math.min(p[i], p[i + 1], p[i + 2])) / max : 0;
      if (sat > 0.45 && max > 60) {
        // Agrupa por tono (12 grupos) para encontrar los colores de la marca.
        const [R, G, B] = [p[i] / max, p[i + 1] / max, p[i + 2] / max];
        const tono = Math.round(((Math.atan2(Math.sqrt(3) * (G - B), 2 * R - G - B) * 180 / Math.PI + 360) % 360) / 30) % 12;
        const gr = grupos.get(tono) || { n: 0, r: 0, g: 0, b: 0 };
        gr.n++; gr.r += p[i]; gr.g += p[i + 1]; gr.b += p[i + 2];
        grupos.set(tono, gr);
      }
    }
  }
  // Recorte: ignora puntitos sueltos (filas o columnas con muy pocos píxeles).
  const MIN = 3;
  const desde = (arr) => arr.findIndex((v) => v >= MIN);
  const hasta = (arr) => { for (let k = arr.length - 1; k >= 0; k--) if (arr[k] >= MIN) return k; return -1; };
  const x0 = desde(cols); const y0 = desde(filas);
  if (x0 < 0 || y0 < 0) throw new Error('No encontré el logo: la imagen parece estar en blanco.');
  const m = Math.round(Math.max(w, h) * 0.01);
  const cx0 = Math.max(0, x0 - m); const cy0 = Math.max(0, y0 - m);
  const cw = Math.min(w, hasta(cols) + m + 1) - cx0;
  const ch = Math.min(h, hasta(filas) + m + 1) - cy0;
  const recorte = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) recorte.set(p.subarray(((cy0 + y) * w + cx0) * 4, ((cy0 + y) * w + cx0 + cw) * 4), y * cw * 4);
  const fin = reducir({ ancho: cw, alto: ch, datos: recorte }, LADO_FINAL);

  const png = new PNG({ width: fin.ancho, height: fin.alto });
  png.data = Buffer.from(fin.datos.buffer, fin.datos.byteOffset, fin.datos.byteLength);
  const top = [...grupos.values()].sort((a, b) => b.n - a.n).slice(0, 2).map((g) => hex([g.r / g.n, g.g / g.n, g.b / g.n]));
  return { png: PNG.sync.write(png), colores: { principal: top[0] || '', secundario: top[1] || '' } };
}

module.exports = { prepararLogo };
