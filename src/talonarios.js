'use strict';

const ExcelJS = require('exceljs');
const { round2, MESES } = require('./util');
const { valoresMes, tasas } = require('./planilla03');

// Ingresos del detalle que van en el talonario (el XIII y el gasto de representación van aparte).
const INGRESOS = [
  ['SUELDO', null],
  ['VACACIONES', 'Vacaciones'],
  ['HORAS_EXTRAS', 'Horas extras'],
  ['PRIMA_PRODUCCION', 'Prima de producción'],
  ['COMISIONES', 'Comisiones'],
  ['BONIFICACIONES', 'Bonificaciones'],
  ['SALARIO_ESPECIE', 'Salario en especie'],
  ['DIETA', 'Dieta'],
  ['GRATIFICACION_AGUINALDOS', 'Gratificaciones y aguinaldos'],
  ['VIATICOS', 'Viáticos'],
];

// ISR del gasto de representación: 10% (hasta 25,000 al año), como en el talonario modelo.
const TASA_ISR_GR = 0.1;

const MODOS = {
  1: { corto: '1ra quincena', archivo: '1ra-quincena' },
  2: { corto: '2da quincena', archivo: '2da-quincena' },
  mes: { corto: 'Mes completo', archivo: 'mes' },
};

function modoValido(m) {
  return Object.prototype.hasOwnProperty.call(MODOS, String(m)) ? String(m) : '1';
}

function tituloPeriodo(periodo, modo) {
  const mes = MESES[Number(String(periodo).slice(4, 6)) - 1];
  const anio = String(periodo).slice(0, 4);
  if (modo === 'mes') return `Mes de ${mes} de ${anio}`;
  return `${MODOS[modo].corto} de ${mes} de ${anio}`;
}

/** Lista de conceptos fijos (descuentos o adicionales) escrita en el formulario. */
function limpiarConceptos(lista) {
  return (lista || [])
    .map((c) => ({
      tipo: c.tipo === 'adicional' ? 'adicional' : 'descuento',
      nombre: String(c.nombre || '').replace(/\s+/g, ' ').trim(),
      monto: round2(Number(String(c.monto || '').replace(/[,\s]/g, '')) || 0),
    }))
    .filter((c) => c.nombre && c.monto > 0);
}

/**
 * Arma los talonarios de pago de un mes del detalle de la CSS.
 * El detalle es mensual: en quincenas, la 1ra lleva la mitad redondeada y la 2da el resto, así
 * las dos suman lo que se reportó a la CSS. El XIII mes (y su SS) va completo en la 1ra quincena,
 * que es cuando se paga. Los descuentos y adicionales fijos son por quincena.
 * @param {object} detalle resultado de parseDetalleCSS
 * @param {object} opts { modo: '1'|'2'|'mes', ajustes: cedula -> {correo, conceptos} }
 */
function construirTalonarios(detalle, { modo = '1', ajustes = () => null } = {}) {
  modo = modoValido(modo);
  const t = tasas(detalle.periodo);
  const parte = (x) => {
    if (modo === 'mes') return round2(x);
    const primera = round2(x / 2);
    return modo === '1' ? primera : round2(x - primera);
  };
  const fijo = (x) => round2(modo === 'mes' ? x * 2 : x);
  const titulo = tituloPeriodo(detalle.periodo, modo);

  const talonarios = detalle.empleados.map((e) => {
    const v = valoresMes(e);
    const comp = (cod) => round2((e.componentes[cod] || {}).reportado || 0);
    const ajuste = ajustes(e.cedula) || {};
    const conceptos = limpiarConceptos(ajuste.conceptos);

    const ingresos = [];
    for (const [cod, nombre] of INGRESOS) {
      const monto = parte(comp(cod));
      if (monto || cod === 'SUELDO') ingresos.push({ concepto: nombre || titulo, monto });
    }
    for (const c of e.conceptosNoMapeados || []) {
      const monto = parte(c.reportado);
      if (monto) ingresos.push({ concepto: c.nombre, monto });
    }
    const subtotal = round2(ingresos.reduce((s, i) => s + i.monto, 0));
    const xiii = modo === '2' ? 0 : comp('DTM');
    const gr = parte(v.gr);

    const isrTotal = comp('ISR');
    const isrGRMes = Math.min(isrTotal, round2(v.gr * TASA_ISR_GR));
    // Mismas reglas que la CSS: SS sobre todo lo que es salario (con el GR), SE sin el GR.
    const ssSeMes = round2((v.mes + v.ppSS) * t.ssEmpleado) + round2((v.mes - v.gr) * t.seEmpleado);
    const deducciones = [{ concepto: 'ISR', monto: parte(isrTotal - isrGRMes) }];
    if (v.gr) deducciones.push({ concepto: 'ISR del GR', monto: parte(isrGRMes) });
    for (const c of conceptos.filter((x) => x.tipo === 'descuento')) deducciones.push({ concepto: c.nombre, monto: fijo(c.monto) });
    deducciones.push({ concepto: 'SS y SE de Salario', monto: parte(ssSeMes) });
    deducciones.push({ concepto: 'SS del XIII', monto: round2(xiii * t.ssXiiiEmpleado) });
    const totalDeducciones = round2(deducciones.reduce((s, d) => s + d.monto, 0));

    const adicionales = conceptos.filter((x) => x.tipo === 'adicional').map((c) => ({ concepto: c.nombre, monto: fijo(c.monto) }));
    const totalAdicionales = round2(adicionales.reduce((s, a) => s + a.monto, 0));

    return {
      cedula: e.cedula,
      nombre: `${e.nombre} ${e.apellido}`.replace(/\s+/g, ' ').trim().toUpperCase(),
      correo: String(ajuste.correo || '').trim(),
      conceptos,
      ingresos,
      subtotal,
      xiii,
      gr,
      deducciones,
      totalDeducciones,
      adicionales,
      totalAdicionales,
      neto: round2(subtotal + xiii + gr - totalDeducciones + totalAdicionales),
    };
  });
  return { modo, titulo, etiquetaNeto: modo === 'mes' ? 'NETO DEL MES' : 'QUINCENA NETA', talonarios };
}

function nombreEmpresaTalonario(empresa) {
  return String(empresa.nombreTalonario || empresa.nombreComercial || empresa.razonSocial || '').toUpperCase();
}

function nombreArchivoTalonarios(ruc, periodo, modo, ext = 'xlsx') {
  return `Talonarios_${ruc}_${periodo}_${MODOS[modoValido(modo)].archivo}.${ext}`;
}

// Colores de la marca de la empresa (los toma del logo); si no tiene, verde y tinta de la app.
function coloresTalonario(empresa) {
  const c = (empresa && empresa.colores) || {};
  return { principal: c.principal || '#0d5a4a', secundario: c.secundario || '#17252b' };
}

// Mezcla un color con blanco: aclarar('#0000c0', 0.9) -> el tono muy claro para los fondos.
function aclarar(hex, cuanto) {
  const n = parseInt(hex.slice(1), 16);
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * cuanto).toString(16).padStart(2, '0')).join('');
}

const argb = (hex) => 'FF' + hex.slice(1).toUpperCase();

// Ancho y alto de un PNG (cabecera IHDR).
function medidasPng(png) {
  return { ancho: png.readUInt32BE(16), alto: png.readUInt32BE(20) };
}

/** Excel con un talonario por empleado, uno debajo del otro, con el logo y los colores de la empresa. */
async function excelTalonarios({ empresa, resultado, logo }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Talonarios', {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 1, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
  });
  ws.columns = [{ width: 34 }, { width: 18 }, { width: 4 }, { width: 14 }, { width: 16 }];
  const { principal, secundario } = coloresTalonario(empresa);
  const claro = argb(aclarar(principal, 0.88));
  const NUM = '#,##0.00';
  const BALBOAS = '_("B/." * #,##0.00_);_("B/." * (#,##0.00);_("B/." * "-"??_);_(@_)';
  const fino = { style: 'thin', color: { argb: argb(aclarar(principal, 0.55)) } };
  const marco = { style: 'medium', color: { argb: argb(principal) } };
  const nombreEmpresa = nombreEmpresaTalonario(empresa);
  const idLogo = logo ? wb.addImage({ buffer: logo, extension: 'png' }) : null;
  const medidas = logo ? medidasPng(logo) : null;
  const ingresosMas = resultado.modo === 'mes' ? 'SUB-TOTAL MES' : 'SUB-TOTAL QUINCENA';
  let r = 1;

  for (const tal of resultado.talonarios) {
    const inicio = r;
    const fila = (alto) => { if (alto) ws.getRow(r).height = alto; return r++; };
    const unir = (f, c1, c2) => ws.mergeCells(f, c1, f, c2);

    // Encabezado: logo a la izquierda y el nombre de la empresa a la derecha.
    const fLogo = fila(52);
    if (idLogo !== null) {
      const alto = 46;
      const ancho = Math.min(230, (medidas.ancho / medidas.alto) * alto);
      ws.addImage(idLogo, { tl: { col: 0.15, row: fLogo - 1 + 0.08 }, ext: { width: ancho * 1.333, height: alto * 1.333 }, editAs: 'oneCell' });
      unir(fLogo, 2, 5);
      Object.assign(ws.getCell(fLogo, 2), { value: nombreEmpresa, font: { bold: true, size: 14, color: { argb: argb(principal) } }, alignment: { horizontal: 'right', vertical: 'middle' } });
    } else {
      unir(fLogo, 1, 5);
      Object.assign(ws.getCell(fLogo, 1), { value: nombreEmpresa, font: { bold: true, size: 14, color: { argb: argb(principal) } }, alignment: { horizontal: 'center', vertical: 'middle' } });
    }
    const fTitulo = fila(20);
    unir(fTitulo, 1, 5);
    Object.assign(ws.getCell(fTitulo, 1), {
      value: `TALONARIO DE PAGO  ·  ${resultado.titulo.toUpperCase()}`,
      font: { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }, alignment: { horizontal: 'center', vertical: 'middle' },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(principal) } },
    });
    const fRaya = fila(4);
    for (let c = 1; c <= 5; c++) ws.getCell(fRaya, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(secundario) } };

    const fNombre = fila(20);
    unir(fNombre, 1, 3);
    unir(fNombre, 4, 5);
    Object.assign(ws.getCell(fNombre, 1), { value: tal.nombre, font: { bold: true, size: 12 }, alignment: { vertical: 'middle' } });
    Object.assign(ws.getCell(fNombre, 4), { value: `CÉDULA ${tal.cedula}`, font: { size: 10, color: { argb: 'FF52646B' } }, alignment: { horizontal: 'right', vertical: 'middle' } });
    if (tal.correo) {
      const f = fila();
      unir(f, 1, 5);
      Object.assign(ws.getCell(f, 1), { value: { text: tal.correo, hyperlink: `mailto:${tal.correo}` }, font: { size: 9, color: { argb: argb(principal) }, underline: false } });
    }

    const seccion = (texto) => {
      const f = fila(17);
      for (let c = 1; c <= 5; c++) ws.getCell(f, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: claro } };
      Object.assign(ws.getCell(f, 1), { value: texto, font: { bold: true, size: 9, color: { argb: argb(principal) } }, alignment: { vertical: 'middle' } });
      return f;
    };
    const linea = (concepto, monto, { col = 4, negrita = false, sangria = true } = {}) => {
      const f = fila();
      Object.assign(ws.getCell(f, 1), { value: concepto, alignment: { indent: sangria ? 1 : 0 }, font: negrita ? { bold: true } : undefined });
      const c = ws.getCell(f, col);
      c.value = monto;
      c.numFmt = NUM;
      if (negrita) c.font = { bold: true };
      return f;
    };

    seccion('INGRESOS');
    const ingIni = r;
    for (const i of tal.ingresos) linea(i.concepto, i.monto || null);
    const fSub = linea(ingresosMas, { formula: `SUM(D${ingIni}:D${r - 1})`, result: tal.subtotal }, { col: 5, negrita: true, sangria: false });
    ws.getCell(fSub, 5).border = { top: fino };
    const fXiii = linea('Más: XIII mes', tal.xiii || null, { col: 5 });
    const fGr = tal.gr ? linea('Más: gasto de representación', tal.gr, { col: 5 }) : null;

    seccion('DEDUCCIONES');
    const dedIni = r;
    for (const d of tal.deducciones) linea(d.concepto, d.monto || null);
    const fDed = linea('TOTAL DEDUCCIONES', { formula: `SUM(D${dedIni}:D${r - 1})`, result: tal.totalDeducciones }, { col: 5, negrita: true, sangria: false });
    ws.getCell(fDed, 5).border = { top: fino };

    let fAdic = null;
    if (tal.adicionales.length) {
      seccion('ADICIONALES');
      const adIni = r;
      for (const a of tal.adicionales) linea(a.concepto, a.monto);
      fAdic = linea('TOTAL ADICIONALES', { formula: `SUM(D${adIni}:D${r - 1})`, result: tal.totalAdicionales }, { col: 5, negrita: true, sangria: false });
      ws.getCell(fAdic, 5).border = { top: fino };
    }

    fila(6);
    const fNeta = fila(24);
    unir(fNeta, 1, 4);
    const sumas = [`E${fSub}`, `E${fXiii}`, fGr ? `E${fGr}` : null].filter(Boolean).join('+');
    const relleno = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(principal) } };
    Object.assign(ws.getCell(fNeta, 1), { value: resultado.etiquetaNeto, fill: relleno, font: { bold: true, size: 12, color: { argb: 'FFFFFFFF' } }, alignment: { vertical: 'middle', indent: 1 } });
    Object.assign(ws.getCell(fNeta, 5), {
      value: { formula: `${sumas}-E${fDed}${fAdic ? `+E${fAdic}` : ''}`, result: tal.neto },
      numFmt: BALBOAS, fill: relleno, font: { bold: true, size: 12, color: { argb: 'FFFFFFFF' } }, alignment: { vertical: 'middle' },
    });

    fila(26);
    const fFirma = fila(18);
    Object.assign(ws.getCell(fFirma, 1), { value: 'Recibí conforme:', font: { size: 10, color: { argb: 'FF52646B' } }, alignment: { horizontal: 'right', vertical: 'bottom' } });
    unir(fFirma, 2, 5);
    ws.getCell(fFirma, 2).border = { bottom: { style: 'thin' } };
    const fCed = fila(18);
    Object.assign(ws.getCell(fCed, 1), { value: 'Cédula:', font: { size: 10, color: { argb: 'FF52646B' } }, alignment: { horizontal: 'right', vertical: 'bottom' } });
    unir(fCed, 2, 5);
    Object.assign(ws.getCell(fCed, 2), { value: tal.cedula, alignment: { horizontal: 'left', vertical: 'bottom', indent: 1 } });
    const fin = fila(6);

    // Marco del talonario en el color de la marca.
    for (let i = inicio; i <= fin; i++) {
      for (let c = 1; c <= 5; c++) {
        const b = { ...(ws.getCell(i, c).border || {}) };
        if (c === 1) b.left = marco;
        if (c === 5) b.right = marco;
        if (i === inicio) b.top = marco;
        if (i === fin) b.bottom = marco;
        if (c === 1 || c === 5 || i === inicio || i === fin) ws.getCell(i, c).border = b;
      }
    }
    // Uno por hoja al imprimir.
    ws.getRow(fin).addPageBreak();
    r += 2;
  }
  return wb.xlsx.writeBuffer();
}

/** PDF tamaño carta con dos talonarios por hoja (uno si es muy largo) y línea para recortar. */
function pdfTalonarios({ empresa, resultado, logo }) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'LETTER', margin: 36, info: { Title: `Talonarios ${resultado.titulo}`, Author: nombreEmpresaTalonario(empresa) } });
  const partes = [];
  doc.on('data', (b) => partes.push(b));
  const listo = new Promise((ok) => doc.on('end', () => ok(Buffer.concat(partes))));

  const { principal, secundario } = coloresTalonario(empresa);
  const claro = aclarar(principal, 0.9);
  const gris = '#52646b';
  const tinta = '#17252b';
  const X = 36;
  const W = 612 - 72;
  const MITAD = (792 - 72) / 2;
  const medidas = logo ? medidasPng(logo) : null;
  const n = (v) => (v ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
  const FILA = 13;
  const nombreEmpresa = nombreEmpresaTalonario(empresa);

  const alto = (t) => {
    const izq = t.ingresos.length + 2 + (t.gr ? 1 : 0) + t.adicionales.length;
    const der = t.deducciones.length;
    return 158 + Math.max(izq, der) * FILA + 26 + 64;
  };

  let y = 36;
  let usado = 0; // talonarios en la hoja actual
  resultado.talonarios.forEach((t) => {
    const h = alto(t);
    const cabeEnMitad = h <= MITAD - 12;
    if (usado > 0 && (!cabeEnMitad || usado >= 2 || y + h > 792 - 36)) { doc.addPage(); y = 36; usado = 0; }
    if (usado === 1) {
      // Línea para recortar entre los dos talonarios.
      doc.save().moveTo(X, y - 6).lineTo(X + W, y - 6).dash(4, { space: 3 }).lineWidth(0.6).strokeColor('#aebcb5').stroke().restore();
      doc.font('Helvetica').fontSize(6.5).fillColor('#aebcb5').text('recortar aquí', X, y - 13, { width: W, align: 'center' });
    }
    let cy = y + 6;

    // Encabezado.
    if (logo) {
      const lh = 60;
      const lw = Math.min(200, (medidas.ancho / medidas.alto) * lh);
      doc.image(logo, X, cy, { width: lw, height: lh });
    }
    doc.font('Helvetica-Bold').fontSize(14).fillColor(principal).text(nombreEmpresa, X, cy + 10, { width: W, align: logo ? 'right' : 'left' });
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(gris).text('TALONARIO DE PAGO', X, cy + 30, { width: W, align: logo ? 'right' : 'left', characterSpacing: 1.6 });
    doc.font('Helvetica').fontSize(10).fillColor(tinta).text(resultado.titulo, X, cy + 42, { width: W, align: logo ? 'right' : 'left' });
    cy += 66;
    doc.rect(X, cy, W, 3).fill(secundario);
    doc.rect(X, cy + 3, W, 1).fill(principal);
    cy += 12;

    // Empleado.
    doc.font('Helvetica-Bold').fontSize(12).fillColor(tinta).text(t.nombre, X, cy, { width: W * 0.65 });
    doc.font('Helvetica').fontSize(9).fillColor(gris).text(`Cédula ${t.cedula}`, X + W * 0.5, cy + 2, { width: W * 0.5, align: 'right' });
    cy += 16;
    if (t.correo) doc.font('Helvetica').fontSize(8.5).fillColor(principal).text(t.correo, X, cy, { width: W });
    cy += 16;

    // Dos columnas: ingresos y deducciones.
    const colW = (W - 16) / 2;
    const cols = [X, X + colW + 16];
    const cabecera = (x, texto) => {
      doc.rect(x, cy, colW, 16).fill(claro);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(principal).text(texto, x + 6, cy + 5, { width: colW - 12, characterSpacing: 1 });
    };
    cabecera(cols[0], 'INGRESOS');
    cabecera(cols[1], 'DEDUCCIONES');
    const renglones = (x, lista, y0) => {
      let yy = y0;
      for (const [txt, monto, negrita] of lista) {
        doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(tinta)
          .text(txt, x + 6, yy, { width: colW - 80, lineBreak: false, ellipsis: true })
          .text(n(monto), x + colW - 80, yy, { width: 74, align: 'right' });
        yy += FILA;
      }
      return yy;
    };
    const yIni = cy + 22;
    const izq = [
      ...t.ingresos.map((i) => [i.concepto, i.monto]),
      ['Más: XIII mes', t.xiii],
      ...(t.gr ? [['Más: gasto de representación', t.gr]] : []),
      ...t.adicionales.map((a) => [`Más: ${a.concepto}`, a.monto]),
    ];
    const der = t.deducciones.map((d) => [d.concepto, d.monto]);
    const filas = Math.max(izq.length, der.length);
    renglones(cols[0], izq, yIni);
    renglones(cols[1], der, yIni);
    let yTot = yIni + filas * FILA + 2;
    for (const x of cols) doc.moveTo(x + 6, yTot).lineTo(x + colW - 6, yTot).lineWidth(0.5).strokeColor(aclarar(principal, 0.5)).stroke();
    yTot += 4;
    const totalIngresos = round2(t.subtotal + t.xiii + t.gr + t.totalAdicionales);
    renglones(cols[0], [['Total ingresos', totalIngresos, true]], yTot);
    renglones(cols[1], [['Total deducciones', t.totalDeducciones, true]], yTot);
    cy = yTot + FILA + 8;

    // Neto a pagar.
    doc.rect(X, cy, W, 26).fill(principal);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff').text(resultado.etiquetaNeto, X + 10, cy + 8, { width: W / 2, characterSpacing: 1 });
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#ffffff').text(`B/. ${n(t.neto) || '0.00'}`, X + W / 2, cy + 6, { width: W / 2 - 10, align: 'right' });
    doc.rect(X, cy + 26, W, 2).fill(secundario);
    cy += 54;

    // Firma.
    const firmaW = 220;
    doc.moveTo(X + W - firmaW, cy + 12).lineTo(X + W, cy + 12).lineWidth(0.6).strokeColor(tinta).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(gris).text('Recibí conforme', X + W - firmaW, cy + 15, { width: firmaW, align: 'center' });
    doc.font('Helvetica').fontSize(8).fillColor(gris).text(`Cédula: ${t.cedula}`, X, cy + 15, { width: 200 });

    usado = cabeEnMitad ? usado + 1 : 2;
    y = cabeEnMitad ? 36 + MITAD + 6 : 792;
  });
  if (!resultado.talonarios.length) doc.font('Helvetica').fontSize(12).text('No hay empleados en este mes.');
  doc.end();
  return listo;
}

module.exports = { construirTalonarios, excelTalonarios, pdfTalonarios, nombreArchivoTalonarios, nombreEmpresaTalonario, coloresTalonario, limpiarConceptos, modoValido, MODOS, tituloPeriodo };
