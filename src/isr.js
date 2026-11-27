'use strict';

const { round2 } = require('./util');

// ISR anual de asalariados (Panamá): 0% hasta 11,000; 15% hasta 50,000; 25% después (+5,850).
function isrAnual(renta) {
  if (renta <= 11000) return 0;
  if (renta <= 50000) return round2((renta - 11000) * 0.15);
  return round2(5850 + (renta - 50000) * 0.25);
}

// ISR anual del gasto de representación (tabla propia): 10% hasta 25,000 y 15% sobre el
// excedente (+2,500). No se suma con el salario: cada uno se calcula y se reporta aparte.
function isrGastoRepresentacion(renta) {
  if (renta <= 0) return 0;
  if (renta <= 25000) return round2(renta * 0.1);
  return round2(2500 + (renta - 25000) * 0.15);
}

// ISR de un mes de gasto de representación: la tabla anual llevada a un mes.
function isrGastoRepresentacionMes(gr) {
  return round2(isrGastoRepresentacion(gr * 12) / 12);
}

/**
 * Separa el ISR de un empleado en un mes en la parte del salario y la del gasto de
 * representación. Si el detalle de la CSS trae el ISR del GR en su propia línea se usa tal
 * cual; si viene todo junto en "Impuesto sobre la renta", al GR le toca lo de su tabla (sin
 * pasar de lo retenido) y el resto es del salario.
 * @param {object} componentes componentes del empleado (de parseDetalleCSS)
 * @returns {{ salario: number, gr: number, total: number }}
 */
function separarIsr(componentes) {
  const c = componentes || {};
  const isr = round2((c.ISR || {}).reportado || 0);
  if (c.ISR_GR) {
    const gr = round2(c.ISR_GR.reportado || 0);
    return { salario: isr, gr, total: round2(isr + gr) };
  }
  const montoGR = round2((c.GASTO_REPRESENTACION || {}).reportado || 0);
  const gr = montoGR > 0 ? Math.min(isr, isrGastoRepresentacionMes(montoGR)) : 0;
  return { salario: round2(isr - gr), gr, total: isr };
}

module.exports = { isrAnual, isrGastoRepresentacion, isrGastoRepresentacionMes, separarIsr };
