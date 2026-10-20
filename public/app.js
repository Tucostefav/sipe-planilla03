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
