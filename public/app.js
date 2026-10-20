'use strict';

// Zona para subir: muestra el archivo elegido y acepta arrastrar y soltar.
document.querySelectorAll('[data-subir]').forEach((form) => {
  const zona = form.querySelector('.zona');
  const input = form.querySelector('input[type="file"]');
  const nombre = form.querySelector('[data-nombre]');
  const boton = form.querySelector('[data-procesar]');
  const ayuda = form.querySelector('[data-ayuda]');
  const mostrar = () => {
    const fs = [...(input.files || [])];
    if (!fs.length) return;
    nombre.textContent = fs.length === 1 ? fs[0].name : `${fs.length} archivos listos para procesar`;
    if (ayuda && fs.length > 1) ayuda.textContent = fs.map((f) => f.name).join(' · ');
    zona.classList.add('lista');
  };
  input.addEventListener('change', mostrar);
  ['dragenter', 'dragover'].forEach((ev) => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('encima'); }));
  ['dragleave', 'drop'].forEach((ev) => zona.addEventListener(ev, () => zona.classList.remove('encima')));
  zona.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) { input.files = e.dataTransfer.files; mostrar(); }
  });
  form.addEventListener('submit', () => {
    form.classList.add('procesando');
    boton.textContent = 'Procesando…';
  });
});

// Filtro instantáneo de filas por cédula o nombre.
document.querySelectorAll('[data-filtro]').forEach((input) => {
  const tabla = document.querySelector(input.dataset.filtro);
  if (!tabla) return;
  const filas = [...tabla.tBodies[0].rows];
  const textos = filas.map((tr) => (tr.textContent + ' ' + [...tr.querySelectorAll('input')].map((i) => i.value).join(' ')).toUpperCase());
  const aplicar = () => {
    const q = input.value.trim().toUpperCase();
    filas.forEach((tr, i) => { tr.hidden = !!q && !textos[i].includes(q); });
  };
  input.addEventListener('input', aplicar);
  const form = input.closest('form');
  if (form) form.addEventListener('submit', (e) => { e.preventDefault(); aplicar(); });
  aplicar();
});

// Filtro instantáneo de tarjetas (talonarios) por cédula o nombre.
document.querySelectorAll('[data-filtro-tarjetas]').forEach((input) => {
  const caja = document.querySelector(input.dataset.filtroTarjetas);
  if (!caja) return;
  const tarjetas = [...caja.children];
  const textos = tarjetas.map((t) => t.querySelector('header').textContent.toUpperCase());
  input.addEventListener('input', () => {
    const q = input.value.trim().toUpperCase();
    tarjetas.forEach((t, i) => { t.hidden = !!q && !textos[i].includes(q); });
  });
});

// Logo de la empresa: vista previa sin fondo y sus dos colores principales. El servidor hace
// lo mismo al guardar, así que esto solo muestra cómo va a quedar.
document.querySelectorAll('[data-logo]').forEach((form) => {
  const archivo = form.querySelector('input[type="file"]');
  const manual = form.querySelector('input[name="coloresManual"]');
  const vista = form.querySelector('[data-logo-vista]');
  const colores = [...form.querySelectorAll('input[type="color"]')];
  const boton = form.querySelector('button');
  const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  colores.forEach((c) => c.addEventListener('input', () => { manual.value = '1'; }));
  form.addEventListener('submit', () => { if (boton) boton.textContent = 'Guardando…'; });

  archivo.addEventListener('change', () => {
    const f = archivo.files && archivo.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
      const w = Math.round(img.width * escala);
      const h = Math.round(img.height * escala);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const cx = cv.getContext('2d');
      cx.drawImage(img, 0, 0, w, h);
      const d = cx.getImageData(0, 0, w, h);
      const p = d.data;
      const filas = new Uint32Array(h);
      const cols = new Uint32Array(w);
      const grupos = new Map();
      for (let i = 0; i < p.length; i += 4) {
        const [r, g, b] = [p[i], p[i + 1], p[i + 2]];
        const min = Math.min(r, g, b);
        // Casi blanco -> transparente; el borde se suaviza para que no quede un halo blanco.
        let a = min >= 240 ? 0 : min <= 180 ? 255 : Math.round(((240 - min) / 60) * 255);
        a = Math.min(a, p[i + 3]);
        if (a > 0 && a < 255) {
          const f2 = a / 255;
          for (let k = 0; k < 3; k++) p[i + k] = Math.max(0, Math.min(255, Math.round((p[i + k] - (1 - f2) * 255) / f2)));
        }
        p[i + 3] = a;
        if (a > 200) {
          const px = (i / 4) % w;
          const py = Math.floor(i / 4 / w);
          filas[py]++; cols[px]++;
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
      cx.putImageData(d, 0, 0);
      // Recorte: ignora puntitos sueltos (filas o columnas con muy pocos píxeles).
      const minimo = 3;
      const desde = (arr) => arr.findIndex((v) => v >= minimo);
      const hasta = (arr) => arr.length - 1 - [...arr].reverse().findIndex((v) => v >= minimo);
      const x0 = desde(cols); const x1 = hasta(cols); const y0 = desde(filas); const y1 = hasta(filas);
      if (x0 < 0 || y0 < 0) { vista.hidden = false; vista.textContent = 'No encontré el logo: la imagen parece estar en blanco.'; return; }
      const m = Math.round(Math.max(w, h) * 0.01);
      const cw = Math.min(w, x1 + m + 1) - Math.max(0, x0 - m);
      const ch = Math.min(h, y1 + m + 1) - Math.max(0, y0 - m);
      const fin = Math.min(1, 900 / Math.max(cw, ch));
      const out = document.createElement('canvas');
      out.width = Math.round(cw * fin); out.height = Math.round(ch * fin);
      out.getContext('2d').drawImage(cv, Math.max(0, x0 - m), Math.max(0, y0 - m), cw, ch, 0, 0, out.width, out.height);
      const vistaPng = out.toDataURL('image/png');
      const top = [...grupos.values()].sort((a, b) => b.n - a.n).slice(0, 2).map((gr) => hex([gr.r / gr.n, gr.g / gr.n, gr.b / gr.n]));
      top.forEach((c, i) => { if (colores[i]) colores[i].value = c; });
      manual.value = '';
      vista.innerHTML = '';
      const muestra = new Image();
      muestra.src = vistaPng;
      muestra.alt = 'Logo sin fondo';
      vista.appendChild(muestra);
      vista.hidden = false;
      if (boton) boton.textContent = 'Guardar logo y colores';
    };
    img.onerror = () => { vista.hidden = false; vista.textContent = 'No se pudo abrir esa imagen. Usa un JPG o PNG.'; };
    img.src = URL.createObjectURL(f);
  });
});
