'use strict';

const { escapeHtml: h, nombreMes, MESES } = require('./util');
const { COLUMNAS } = require('./informe03');
const { MESES_MAYUS } = require('./planilla03');

const fmt = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const enc = encodeURIComponent;

function layout(titulo, cuerpo, { usuario, aviso, error } = {}) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(titulo)} · SIPE Planilla 03</title>
<link rel="stylesheet" href="/estilos.css"></head>
<body>
${usuario ? `<header><a class="marca" href="/">SIPE · Planilla 03</a><nav><a href="/">Inicio</a><a href="/empleados">Empleados</a>
<form method="post" action="/logout"><button class="enlace">Salir</button></form></nav></header>` : ''}
<main>
${aviso ? `<p class="ok">${h(aviso)}</p>` : ''}
${error ? `<p class="error">${h(error)}</p>` : ''}
${cuerpo}
</main></body></html>`;
}

function login({ error, configurado }) {
  return layout('Entrar', `
<section class="tarjeta login">
<h1>Entrar</h1>
${configurado ? '' : '<p class="error">Falta configurar APP_CLAVE en las variables de entorno.</p>'}
<form method="post" action="/login">
<label>Usuario <input name="usuario" autocomplete="username" required></label>
<label>Clave <input name="clave" type="password" autocomplete="current-password" required></label>
<button>Entrar</button>
</form></section>`, { error });
}

function formSubir() {
  return `<form class="subir" method="post" action="/cargar" enctype="multipart/form-data">
<label>Detalle de planilla de la CSS (.xls o .xlsx)
<input type="file" name="archivo" accept=".xls,.xlsx" required></label>
<button>Procesar</button></form>`;
}

function inicio({ empresas, usuario, aviso, error }) {
  const filas = empresas.map((e) => `<tr>
<td><a href="/empresa/${enc(e.ruc)}">${h(e.razonSocial || e.ruc)}</a></td><td>${h(e.ruc)}</td>
<td>${e.ultimo ? h(nombreMes(e.ultimo)) : ''}</td>
<td class="acciones">${e.ultimo ? `<a href="/empresa/${enc(e.ruc)}/informe03/${e.ultimo}">Informe 03</a>
<a href="/empresa/${enc(e.ruc)}/planilla03/${String(e.ultimo).slice(0, 4)}">Planilla 03 ${String(e.ultimo).slice(0, 4)}</a>` : ''}</td></tr>`).join('');
  return layout('Inicio', `
<h1>Subir detalle de planilla</h1>
<section class="tarjeta">${formSubir()}
<p class="nota">El sistema reconoce la empresa por el RUC y el mes por el "Mes cuota" del detalle. Si subes otra vez el mismo mes, se reemplaza.</p></section>
<h2>Empresas</h2>
${empresas.length ? `<div class="scroll"><table><thead><tr><th>Empresa</th><th>RUC</th><th>Último mes</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>`
    : '<p class="nota">Todavía no hay empresas. Sube el primer detalle de planilla.</p>'}`, { usuario, aviso, error });
}

function listaAvisos(avisos) {
  if (!avisos || !avisos.length) return '';
  return `<details class="avisos" open><summary>${avisos.length} aviso(s)</summary><ul>${avisos.map((a) => `<li>${h(a.texto || a)}</li>`).join('')}</ul></details>`;
}

function cuadres(lista) {
  return `<table class="cuadre"><thead><tr><th>Cuadre</th><th>Reporte</th><th>Detalle CSS</th><th></th></tr></thead><tbody>
${lista.map((c) => `<tr><td>${h(c.concepto)}</td><td class="n">${fmt(c.informe)}</td><td class="n">${fmt(c.css)}</td><td>${c.ok ? '<span class="si">Cuadra</span>' : '<span class="no">No cuadra</span>'}</td></tr>`).join('')}
</tbody></table>`;
}

// Formulario para completar nombre completo y DV de los que no están en el maestro.
function formFaltantes(faltantes, volver) {
  if (!faltantes.length) return '';
  return `<section class="tarjeta"><h2>Empleados por completar (${faltantes.length})</h2>
<p class="nota">La CSS solo trae primer nombre y primer apellido. Escribe el nombre completo y el DV como van en el Informe 03. Se guardan en el maestro y se usan siempre.</p>
<form method="post" action="/empleados/lote"><input type="hidden" name="volver" value="${h(volver)}">
<div class="scroll"><table><thead><tr><th>Cédula</th><th>Nombre según CSS</th><th>Nombre completo</th><th>DV</th></tr></thead><tbody>
${faltantes.map((f, i) => `<tr><td>${h(f.cedula)}<input type="hidden" name="cedula_${i}" value="${h(f.cedula)}"></td><td>${h(f.nombreCSS)}</td>
<td><input name="nombre_${i}" value="${h(f.nombre || '')}" placeholder="NOMBRE SEGUNDO APELLIDO APELLIDO"></td>
<td><input name="dv_${i}" value="${h(f.dv || '')}" inputmode="numeric" size="3" maxlength="2"></td></tr>`).join('')}
</tbody></table></div><input type="hidden" name="total" value="${faltantes.length}"><button>Guardar en el maestro</button></form></section>`;
}

function resultadoCarga({ empresa, detalle, informe, reemplazo, faltantes, usuario }) {
  const anio = String(detalle.periodo).slice(0, 4);
  const base = `/empresa/${enc(empresa.ruc)}`;
  return layout('Detalle procesado', `
<h1>${h(empresa.razonSocial)} · ${h(nombreMes(detalle.periodo))}</h1>
<p class="ok">${reemplazo ? 'Se reemplazó el mes que ya estaba cargado.' : 'Detalle cargado.'} ${detalle.empleados.length} empleados reportados a la CSS.</p>
<div class="botones"><a class="boton" href="${base}/informe03/${detalle.periodo}">Ver Informe 03</a>
<a class="boton" href="${base}/planilla03/${anio}">Ver Planilla 03 ${anio}</a></div>
${cuadres(informe.cuadres)}
${listaAvisos([...detalle.avisos, ...informe.avisos.filter((a) => a.tipo === 'empresa')])}
${formFaltantes(faltantes, `/carga/${enc(empresa.ruc)}/${detalle.periodo}`)}
<h2>Empleados reportados</h2>
<div class="scroll"><table><thead><tr><th>Cédula</th><th>Nombre (CSS)</th><th class="n">Salario</th><th>Novedades</th></tr></thead><tbody>
${detalle.empleados.map((e) => `<tr><td>${h(e.cedula)}</td><td>${h(`${e.nombre} ${e.apellido}`)}</td><td class="n">${fmt(e.salario)}</td>
<td>${e.novedades.map((n) => h(`${n.tipo} ${n.inicio}${n.fin ? ` al ${n.fin}` : ''}`)).join('<br>')}</td></tr>`).join('')}
</tbody></table></div>`, { usuario });
}

function empresaPagina({ empresa, detalles, usuario, aviso }) {
  const base = `/empresa/${enc(empresa.ruc)}`;
  const anios = [...new Set(detalles.map((d) => String(d.periodo).slice(0, 4)))];
  return layout(empresa.razonSocial || empresa.ruc, `
<h1>${h(empresa.razonSocial || empresa.ruc)}</h1>
<p class="nota">RUC ${h(empresa.ruc)} · Patronal ${h(empresa.patronal || '')}</p>
<section class="tarjeta"><form method="post" action="${base}/config" class="fila">
<label>ID_PLANILLA (código interno de la CSS para el Informe 03)
<input name="idPlanilla" value="${h(empresa.idPlanilla || '')}" inputmode="numeric"></label><button>Guardar</button></form></section>
<h2>Planilla 03</h2>
<div class="botones">${anios.map((a) => `<a class="boton" href="${base}/planilla03/${a}">Planilla 03 ${a}</a>`).join('') || '<span class="nota">Sin meses cargados.</span>'}</div>
<h2>Meses cargados</h2>
<div class="scroll"><table><thead><tr><th>Mes</th><th class="n">Empleados</th><th class="n">Salario</th><th>Archivo</th><th></th></tr></thead><tbody>
${detalles.map((d) => `<tr><td>${h(nombreMes(d.periodo))}</td><td class="n">${d.empleados.length}</td><td class="n">${fmt(d.totales.SALARIO)}</td>
<td>${h(d.archivo || '')}</td><td class="acciones"><a href="${base}/informe03/${d.periodo}">Informe 03</a>
<a href="/carga/${enc(empresa.ruc)}/${d.periodo}">Revisar</a>
<form method="post" action="${base}/borrar/${d.periodo}" onsubmit="return confirm('¿Borrar ${h(nombreMes(d.periodo))}? Se quita también de la Planilla 03.')"><button class="enlace peligro">Borrar</button></form></td></tr>`).join('')}
</tbody></table></div>
<section class="tarjeta">${formSubir()}</section>`, { usuario, aviso });
}

function informe03Pagina({ empresa, detalle, filas, avisos, cuadres: cs, totales, usuario }) {
  const base = `/empresa/${enc(empresa.ruc)}`;
  const numericas = new Set(COLUMNAS.slice(6));
  const faltan = avisos.filter((a) => a.cedula).length;
  return layout(`Informe 03 ${detalle.periodo}`, `
<p class="migas"><a href="${base}">${h(empresa.razonSocial)}</a></p>
<h1>Informe 03 · ${h(nombreMes(detalle.periodo))}</h1>
<div class="botones"><a class="boton" href="${base}/informe03/${detalle.periodo}/excel">Descargar Excel para la DGI</a>
<a class="boton secundario" href="${base}/planilla03/${String(detalle.periodo).slice(0, 4)}">Planilla 03</a></div>
${cuadres(cs)}
${faltan ? `<p class="error">Hay ${faltan} dato(s) de empleados sin completar (nombre completo o DV). <a href="/carga/${enc(empresa.ruc)}/${detalle.periodo}">Completar</a></p>` : ''}
${listaAvisos(avisos.filter((a) => !a.cedula))}
<div class="scroll"><table class="dgi"><thead><tr>${COLUMNAS.map((c) => `<th>${h(c)}</th>`).join('')}</tr></thead><tbody>
${filas.map((f) => `<tr>${COLUMNAS.map((c) => `<td${numericas.has(c) ? ' class="n"' : ''}>${numericas.has(c) ? fmt(f[c]) : h(f[c])}</td>`).join('')}</tr>`).join('')}
</tbody><tfoot><tr>${COLUMNAS.map((c, i) => `<td class="n">${i === 5 ? 'Totales' : numericas.has(c) ? fmt(totales[c]) : ''}</td>`).join('')}</tr></tfoot></table></div>`, { usuario });
}

function planilla03Pagina({ empresa, planilla, usuario }) {
  const base = `/empresa/${enc(empresa.ruc)}`;
  const idx = planilla.mesesCargados.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  const res = planilla.resumen;
  const filaRes = (titulo, k, clase = '') => `<tr class="${clase}"><td>${h(titulo)}</td>${idx.map((i) => `<td class="n">${fmt(res[i][k])}</td>`).join('')}</tr>`;
  return layout(`Planilla 03 ${planilla.anio}`, `
<p class="migas"><a href="${base}">${h(empresa.razonSocial)}</a></p>
<h1>Planilla 03 · ${h(planilla.anio)}</h1>
<p class="nota">Meses cargados: ${idx.map((i) => MESES[i]).join(', ') || 'ninguno'}. Cada mes se llena al subir su detalle de planilla.</p>
<div class="botones"><a class="boton" href="${base}/planilla03/${planilla.anio}/excel">Descargar Excel</a></div>
<div class="scroll"><table class="planilla"><thead>
<tr><th rowspan="2" class="fija">Nombre</th><th rowspan="2">Identificación</th><th rowspan="2">DV</th>
${idx.map((i) => `<th colspan="4">${MESES_MAYUS[i]}</th>`).join('')}<th rowspan="2">Totales</th><th rowspan="2">ISR anual est.</th><th rowspan="2">ISR retenido</th><th rowspan="2">Pend x desc</th></tr>
<tr>${idx.map(() => '<th>Salario</th><th>PP</th><th>PP SS</th><th>XIII</th>').join('')}</tr></thead><tbody>
${planilla.filas.map((f) => `<tr><td class="fija">${h(f.nombre)}${f.enMaestro ? '' : ' <span class="no" title="No está en el maestro">*</span>'}</td><td>${h(f.cedula)}</td><td>${h(f.dv)}</td>
${idx.map((i) => { const v = f.meses[i]; return v ? `<td class="n">${fmt(v.mes)}</td><td class="n">${fmt(v.pp)}</td><td class="n">${fmt(v.ppSS)}</td><td class="n">${fmt(v.xiii)}</td>` : '<td></td><td></td><td></td><td></td>'; }).join('')}
<td class="n">${fmt(f.total)}</td><td class="n">${fmt(f.isrEstimado)}</td><td class="n">${fmt(f.isrRetenido)}</td><td class="n">${fmt(f.pendiente)}</td></tr>`).join('')}
</tbody></table></div>
<h2>Cuotas a la CSS por mes</h2>
<div class="scroll"><table><thead><tr><th>Concepto</th>${idx.map((i) => `<th>${MESES_MAYUS[i]}</th>`).join('')}</tr></thead><tbody>
${filaRes('Salarios', 'salarios')}${filaRes('XIII mes', 'xiii')}
${filaRes('SS patronal', 'ssPatronal')}${filaRes('SS XIII mes patronal', 'ssXiiiPatronal')}${filaRes('SE patronal', 'sePatronal')}${filaRes('Riesgo profesional', 'riesgo')}
${filaRes('Subtotal patronal', 'subtotalPatronal', 'sub')}
${filaRes('SS empleado', 'ssEmpleado')}${filaRes('SS XIII mes empleado', 'ssXiiiEmpleado')}${filaRes('SE empleado', 'seEmpleado')}${filaRes('ISR empleado', 'isr')}
${filaRes('Subtotal empleado', 'subtotalEmpleado', 'sub')}
${filaRes('Total calculado', 'total', 'tot')}${filaRes('Total según detalle CSS', 'totalCSS', 'tot')}${filaRes('Diferencia', 'diferencia')}
</tbody></table></div>`, { usuario });
}

function empleadosPagina({ empleados, usuario, aviso, error, q }) {
  return layout('Empleados', `
<h1>Maestro de empleados</h1>
<p class="nota">Aquí se guarda el nombre completo y el DV de cada cédula. La CSS no los trae completos.</p>
<section class="tarjeta"><h2>Importar desde un Informe 03 o Planilla 03 anterior</h2>
<form method="post" action="/empleados/importar" enctype="multipart/form-data" class="fila">
<input type="file" name="archivo" accept=".xlsx" required><button>Importar</button></form></section>
<section class="tarjeta"><h2>Agregar empleado</h2>
<form method="post" action="/empleados/guardar" class="fila">
<input name="cedula" placeholder="Cédula" required><input name="nombreCompleto" placeholder="Nombre completo" required>
<input name="dv" placeholder="DV" size="3" maxlength="2"><input name="otrasIds" placeholder="Otras identificaciones (pasaporte)"><button>Agregar</button></form></section>
<form method="get" class="fila"><input name="q" value="${h(q || '')}" placeholder="Buscar por cédula o nombre"><button class="secundario">Buscar</button></form>
<div class="scroll"><table><thead><tr><th>Cédula</th><th>Nombre completo</th><th>DV</th><th>Otras identificaciones</th><th></th></tr></thead><tbody>
${empleados.map((e, i) => `<tr><td>${h(e.cedula)}</td>
<td><input form="emp_${i}" name="nombreCompleto" value="${h(e.nombreCompleto)}"></td><td><input form="emp_${i}" name="dv" value="${h(e.dv)}" size="3" maxlength="2"></td>
<td><input form="emp_${i}" name="otrasIds" value="${h((e.otrasIds || []).join(', '))}"></td>
<td><form id="emp_${i}" method="post" action="/empleados/guardar"><input type="hidden" name="cedula" value="${h(e.cedula)}"><button class="secundario">Guardar</button></form></td></tr>`).join('')}
</tbody></table></div>`, { usuario, aviso, error });
}

function errorPagina(mensaje, usuario) {
  return layout('Error', `<h1>Algo salió mal</h1><p class="error">${h(mensaje)}</p><p><a href="/">Volver al inicio</a></p>`, { usuario });
}

module.exports = { login, inicio, resultadoCarga, empresaPagina, informe03Pagina, planilla03Pagina, empleadosPagina, errorPagina };
