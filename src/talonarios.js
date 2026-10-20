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

function nombreArchivoTalonarios(ruc, periodo, modo) {
  return `Talonarios_${ruc}_${periodo}_${MODOS[modoValido(modo)].archivo}.xlsx`;
}

/** Excel con un talonario por empleado, uno debajo del otro, como el modelo. */
async function excelTalonarios({ empresa, resultado }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Talonarios', {
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } },
  });
  ws.columns = [{ width: 33.43 }, { width: 25.43 }, { width: 5 }, { width: 11.43 }, { width: 14.43 }];
  const NUM = '#,##0.00';
  const BALBOAS = '_("B/." * #,##0.00_);_("B/." * (#,##0.00);_("B/." * "-"??_);_(@_)';
  const medio = { style: 'medium' };
  const nombreEmpresa = nombreEmpresaTalonario(empresa);
  let r = 1;

  for (const tal of resultado.talonarios) {
    const inicio = r;
    const centrada = (valor, { negrita = false } = {}) => {
      ws.mergeCells(r, 1, r, 5);
      const c = ws.getCell(r, 1);
      c.value = valor;
      c.alignment = { horizontal: 'center' };
      if (negrita) c.font = { bold: true };
      r++;
    };
    centrada(nombreEmpresa, { negrita: true });
    centrada('TALONARIO  DE PAGO', { negrita: true });
    centrada(tal.nombre);
    if (tal.correo) centrada({ text: tal.correo, hyperlink: `mailto:${tal.correo}` });
    centrada(`CED. ${tal.cedula}`);

    const ingresoIni = r;
    for (const i of tal.ingresos) {
      ws.getCell(r, 1).value = i.concepto;
      ws.getCell(r, 4).value = i.monto || null;
      r++;
    }
    const filaSub = r;
    ws.getCell(r, 1).value = resultado.modo === 'mes' ? 'SUB-TOTAL MES' : 'SUB-TOTAL QUINCENA';
    ws.getCell(r, 5).value = { formula: `SUM(D${ingresoIni}:D${r - 1})`, result: tal.subtotal };
    ws.getCell(r, 5).border = { top: { style: 'thin' }, right: medio };
    r++;
    const filaXiii = r;
    ws.getCell(r, 1).value = 'Mas:  XIII MES';
    ws.getCell(r, 5).value = tal.xiii || null;
    r++;
    let filaGr = null;
    if (tal.gr) {
      filaGr = r;
      ws.getCell(r, 1).value = 'Mas:  GASTO DE REPRESENTACION';
      ws.getCell(r, 5).value = tal.gr;
      r++;
    }
    ws.getCell(r, 1).value = 'MENOS:';
    r++;
    const dedIni = r;
    for (const d of tal.deducciones) {
      ws.getCell(r, 2).value = d.concepto;
      ws.getCell(r, 4).value = d.monto || null;
      r++;
    }
    const filaDed = r;
    ws.getCell(r, 4).value = { formula: `SUM(D${dedIni}:D${r - 1})`, result: tal.totalDeducciones };
    ws.getCell(r, 4).border = { top: { style: 'thin' } };
    r++;
    const adicIni = r;
    for (const a of tal.adicionales) {
      ws.getCell(r, 1).value = `MAS: ${a.concepto}`;
      ws.getCell(r, 4).value = a.monto;
      r++;
    }
    const adicFin = r - 1;
    r++;
    const filaNeta = r;
    const sumas = [`E${filaSub}`, `E${filaXiii}`, filaGr ? `E${filaGr}` : null].filter(Boolean).join('+');
    const adic = tal.adicionales.length ? `+SUM(D${adicIni}:D${adicFin})` : '';
    ws.getCell(r, 1).value = resultado.etiquetaNeto;
    ws.getCell(r, 1).font = { bold: true };
    ws.getCell(r, 5).value = { formula: `${sumas}-D${filaDed}${adic}`, result: tal.neto };
    ws.getCell(r, 5).font = { bold: true };
    ws.getCell(r, 5).numFmt = BALBOAS;
    ws.getCell(r, 5).border = { top: { style: 'thin' }, bottom: { style: 'double' }, right: medio };
    r += 2;
    ws.getCell(r, 1).value = 'RECIBI CONFORME:';
    ws.mergeCells(r, 2, r, 4);
    ws.getCell(r, 2).border = { bottom: { style: 'thin' } };
    r++;
    ws.getCell(r, 1).value = 'CEDULA:';
    ws.getCell(r, 1).alignment = { horizontal: 'right' };
    ws.mergeCells(r, 2, r, 4);
    ws.getCell(r, 2).value = tal.cedula;
    ws.getCell(r, 2).alignment = { horizontal: 'center' };
    const fin = r;

    // Marco del talonario y formato de montos.
    for (let i = inicio; i <= fin; i++) {
      for (const col of [4, 5]) if (i !== filaNeta) ws.getCell(i, col).numFmt = NUM;
      const a = ws.getCell(i, 1);
      const e = ws.getCell(i, 5);
      a.border = { ...a.border, left: medio, ...(i === inicio ? { top: medio } : {}), ...(i === fin ? { bottom: medio } : {}) };
      e.border = { ...e.border, right: medio, ...(i === inicio ? { top: medio } : {}), ...(i === fin ? { bottom: medio } : {}) };
      if (i === inicio || i === fin) {
        for (const col of [2, 3, 4]) {
          const c = ws.getCell(i, col);
          c.border = { ...c.border, ...(i === inicio ? { top: medio } : { bottom: medio }) };
        }
      }
    }
    r += 2;
  }
  return wb.xlsx.writeBuffer();
}

module.exports = { construirTalonarios, excelTalonarios, nombreArchivoTalonarios, nombreEmpresaTalonario, limpiarConceptos, modoValido, MODOS, tituloPeriodo };
