'use strict';

// Crea un detalle de planilla de la CSS de ejemplo, con datos inventados, para pruebas y demostración.
const path = require('path');
const ExcelJS = require('exceljs');

const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const EMPLEADOS = [
  { ss: '1000001', cedula: '8-100-200', apellido: 'PEREZ', nombre: 'JUAN', sexo: 'Masculino', doc: 'Pasaporte',
    comp: [['Primas de Producción', 400, 80], ['Décimo tercer mes', 213.33, 0], ['Sueldo', 640, 640], ['Impuesto sobre la renta', 36, 0]] },
  { ss: '', cedula: '4-50-60', apellido: 'GOMEZ', nombre: 'ANA', sexo: 'Femenino',
    comp: [['Vacaciones', 800.29, 800.29], ['Décimo tercer mes', 249.9, 0]],
    novedad: ['Vacaciones', '1 de agosto de 2026', '30 de agosto de 2026'] },
  { ss: '', cedula: 'E-8-12345', apellido: 'RIVERA', nombre: 'LUIS', sexo: 'Masculino',
    comp: [['Viáticos', 350, 0], ['Décimo tercer mes', 670.83, 0], ['Sueldo', 2300, 2300], ['Impuesto sobre la renta', 286, 0]] },
  { ss: '2000002', cedula: '2-700-800', apellido: 'MORA', nombre: 'ROSA', sexo: 'Femenino',
    comp: [['Primas de Producción', 100, 0], ['Décimo tercer mes', 26.17, 0], ['Sueldo', 628.16, 628.16]],
    novedad: ['Aviso Entrada', '1 de agosto de 2026', ''] },
];

async function crearDetalleEjemplo(destino, mesCuota = 'Agosto 2026') {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  const set = (r, c, v) => { ws.getRow(r).getCell(c).value = v; };

  set(1, 2, 'DESGLOSE DE REPORTE DE EMPLEADOS DE PLANILLA CAJA DE SEGUROSOCIAL');
  set(2, 2, 'Razon social'); set(2, 3, 'EMPRESA DEMO,S.A.'); set(2, 5, 'RUC'); set(2, 10, '1234-5-67890');
  set(3, 2, 'Nombre Comercial'); set(3, 3, 'EMPRESA DEMO,S.A.');
  set(4, 2, 'Grupo de Empleados'); set(4, 3, '11111'); set(4, 5, 'Patronal'); set(4, 10, '87-000-00000');
  set(5, 2, 'Dirección'); set(5, 3, 'CIUDAD DE PANAMA'); set(5, 5, 'Teléfono'); set(5, 10, '2000000');
  set(6, 2, 'Mes couta'); set(6, 3, mesCuota); set(6, 5, 'Tasa de Riesgo'); set(6, 10, '0.0364');

  let salarioTotal = 0;
  let isrTotal = 0;
  for (const e of EMPLEADOS) {
    e.salario = e.comp.reduce((s, c) => s + c[2], 0);
    salarioTotal += e.salario;
    isrTotal += e.comp.filter((c) => c[0].startsWith('Impuesto')).reduce((s, c) => s + c[1], 0);
  }
  set(8, 2, 'Totales Planilla'); set(8, 4, 'Valor');
  const totales = [['Riesgos Profesionales', salarioTotal * 0.0364], ['DTM', 0], ['Seguro Educativo', 0], ['Seguro Social', salarioTotal * 0.23],
    ['Impuesto Sobre la Renta', isrTotal], ['Salario', salarioTotal], ['Salario Ajustado', salarioTotal]];
  totales.forEach(([k, v], i) => { set(9 + i, 2, k); set(9 + i, 4, fmt(v)); });

  let r = 17;
  for (const e of EMPLEADOS) {
    set(r, 2, 'Seguro Social'); set(r, 3, e.doc || 'Cédula'); set(r, 4, 'Apellido'); set(r, 6, 'Nombre'); set(r, 11, 'Sexo'); r++;
    set(r, 2, e.ss); set(r, 3, e.cedula); set(r, 4, e.apellido); set(r, 6, e.nombre); set(r, 11, e.sexo); r++;
    set(r, 2, 'Componentes'); set(r, 4, 'Montos Reportados (B/.)'); set(r, 7, 'Montos que Constituyen Salario'); r++;
    for (const [n, rep, sal] of e.comp) { set(r, 2, n); set(r, 4, fmt(rep)); set(r, 7, fmt(sal)); r++; }
    set(r, 2, 'Total'); set(r, 4, fmt(e.comp.reduce((s, c) => s + c[1], 0))); set(r, 7, fmt(e.salario)); r += 2;
    set(r, 2, 'Salario'); set(r, 4, fmt(e.salario)); r++;
    set(r, 2, 'Salario Ajustado'); set(r, 4, fmt(e.salario)); r += 2;
    set(r, 2, 'Tipo Cuenta Ingreso'); set(r, 4, 'Valor'); r++;
    set(r, 2, 'Seguro Educativo'); set(r, 4, fmt(e.salario * 0.0275)); r++;
    set(r, 2, 'Seguro Social'); set(r, 4, fmt(e.salario * 0.23)); r++;
    if (e.novedad) {
      r++;
      set(r, 2, 'Tipo Novedad'); set(r, 4, 'Fecha Inicio'); set(r, 9, 'Fecha Fin'); r++;
      set(r, 2, e.novedad[0]); set(r, 4, e.novedad[1]); set(r, 8, e.novedad[2]); r++;
    }
    r += 2;
  }
  await wb.xlsx.writeFile(destino);
  return destino;
}

if (require.main === module) {
  const destino = process.argv[2] || path.join(__dirname, '..', 'test', 'fixtures', 'detalle_ejemplo.xls');
  crearDetalleEjemplo(destino).then((f) => console.log('Creado', f));
}

module.exports = { crearDetalleEjemplo, EMPLEADOS };
