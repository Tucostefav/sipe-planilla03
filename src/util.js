'use strict';

// Texto plano de una celda de ExcelJS (richText, fórmula, número, fecha).
function cellText(cell) {
  const v = cell && cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('').trim();
    if (v.result !== undefined) return String(v.result).trim();
    if (v.text !== undefined) return String(v.text).trim();
    if (v instanceof Date) return v.toISOString();
  }
  return String(v).trim();
}

// "1,053.33" -> 1053.33 ; vacío -> 0
function toNumber(text) {
  if (typeof text === 'number') return text;
  const s = String(text || '').replace(/[,$\s]/g, '').replace(/^B\/\./i, '');
  if (s === '' || s === '-') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// minúsculas sin acentos ni espacios dobles
function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];

// "Agosto 2026" -> "202608"
function periodoDesdeTexto(texto) {
  const t = norm(texto).replace('setiembre', 'septiembre');
  const anio = (t.match(/(20\d\d)/) || [])[1];
  const mes = MESES.findIndex((m) => t.includes(m));
  if (!anio || mes < 0) return null;
  return `${anio}${String(mes + 1).padStart(2, '0')}`;
}

function nombreMes(periodo) {
  const m = Number(String(periodo).slice(4, 6));
  const n = MESES[m - 1] || '';
  return n.charAt(0).toUpperCase() + n.slice(1) + ' ' + String(periodo).slice(0, 4);
}

// Orden de cédulas igual que Excel ordena texto (lo usa la DGI en el ejemplo).
function compararCedula(a, b) {
  const x = String(a).toUpperCase();
  const y = String(b).toUpperCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

function escapeHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// RUC tal como se presenta a la DGI: el que se escribió con guiones en la empresa o, si no, el de la CSS.
function rucDGI(empresa) {
  return String((empresa && (empresa.rucDGI || empresa.ruc)) || '');
}

module.exports = { rucDGI, cellText, toNumber, round2, norm, MESES, periodoDesdeTexto, nombreMes, compararCedula, escapeHtml };
