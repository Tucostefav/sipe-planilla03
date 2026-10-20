'use strict';

const { escapeHtml: h, nombreMes, MESES, rucDGI } = require('./util');
const { COLUMNAS } = require('./informe03');
const { MESES_MAYUS, MESES_CORTOS } = require('./planilla03');
const { MODOS, nombreEmpresaTalonario, coloresTalonario } = require('./talonarios');

const fmt = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const enc = encodeURIComponent;
const anioDe = (periodo) => String(periodo).slice(0, 4);
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// Cambia en cada arranque para que el navegador no use un estilo o script viejo después de publicar.
const VERSION = Date.now().toString(36);

const FUENTES = 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=Public+Sans:ital,wght@0,400;0,600;0,700;1,400&family=Spline+Sans+Mono:wght@400;500;600&display=swap';

function layout(titulo, cuerpo, { usuario, aviso, error, seccion } = {}) {
  const nav = (href, texto, clave) => `<a href="${href}"${seccion === clave ? ' aria-current="page"' : ''}>${texto}</a>`;
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(titulo)} · Planilla 03</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FUENTES}">
<link rel="icon" type="image/png" href="/encarga.png"><meta name="theme-color" content="#001a4d">
<link rel="stylesheet" href="/estilos.css?v=${VERSION}"><script src="/app.js?v=${VERSION}" defer></script></head>
<body>
${usuario ? `<header class="barra"><a class="marca" href="/">${marca()}<span class="marca-texto">Planilla 03<small>ENCARGA · Detalle CSS → Informe DGI</small></span></a>
<nav>${nav('/', 'Empresas', 'empresas')}${nav('/empleados', 'Empleados', 'empleados')}
<form method="post" action="/logout"><button class="enlace">Salir</button></form></nav></header>` : ''}
<main>
${aviso ? `<p class="aviso-ok" role="status">${h(aviso)}</p>` : ''}
${error ? `<p class="aviso-error" role="alert">${h(error)}</p>` : ''}
${cuerpo}
</main></body></html>`;
}

function marca() {
  return '<img class="logo-marca" src="/encarga.png" alt="" width="38" height="40">';
}

function login({ error, configurado }) {
  return layout('Entrar', `
<section class="login">
<div class="login-marca">${marca()}<div><p class="ceja">Planilla 03</p><h1>Entrar</h1></div></div>
${configurado ? '' : '<p class="aviso-error">Falta configurar APP_CLAVE en las variables de entorno.</p>'}
<form method="post" action="/login">
<label>Usuario <input name="usuario" autocomplete="username" required autofocus></label>
<label>Clave <input name="clave" type="password" autocomplete="current-password" required></label>
<button class="boton">Entrar</button>
</form></section>`, { error });
}

function formSubir({ compacto = false } = {}) {
  return `<form class="subir${compacto ? ' compacto' : ''}" method="post" action="/cargar" enctype="multipart/form-data" data-subir>
<label class="zona">
<input type="file" name="archivo" accept=".xls,.xlsx" multiple required>
<svg class="zona-icono" viewBox="0 0 40 48" aria-hidden="true"><path d="M4 2h22l10 10v34H4z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><path d="M26 2v10h10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><path d="M11 24h18M11 30h18M11 36h12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
<span class="zona-texto"><strong data-nombre>Arrastra aquí uno o varios detalles de planilla</strong>
<span data-ayuda>o haz clic para elegirlos · .xls o .xlsx de la CSS, hasta 36 archivos de 15 MB</span></span>
</label>
<button class="boton" data-procesar>Procesar</button>
</form>`;
}

// Tira de 12 meses: cada casilla es un mes del año; las llenas ya tienen detalle cargado.
function tiraMeses(anio, periodos, href, { grande = false } = {}) {
  const cargados = new Set(periodos.map(String));
  return `<ol class="tira${grande ? ' grande' : ''}" aria-label="Meses cargados de ${h(anio)}">${MESES_CORTOS.map((m, i) => {
    const p = `${anio}${String(i + 1).padStart(2, '0')}`;
    const lleno = cargados.has(p);
    const titulo = `${MESES[i]} ${anio}: ${lleno ? 'cargado' : 'sin detalle'}`;
    return `<li>${lleno ? `<a class="mes lleno" href="${href(p)}" title="${h(titulo)}">` : `<span class="mes" title="${h(titulo)}">`}<span>${grande ? m : m[0]}</span>${lleno ? '</a>' : '</span>'}</li>`;
  }).join('')}</ol>`;
}

function inicio({ empresas, usuario, aviso, error }) {
  const tarjetas = empresas.map((e) => {
    const base = `/empresa/${enc(e.ruc)}`;
    const anio = e.ultimo ? anioDe(e.ultimo) : null;
    return `<article class="expediente">
<header><h3><a href="${base}">${h(e.razonSocial || e.ruc)}</a></h3>
<p class="dato">RUC <span class="mono">${h(rucDGI(e))}</span></p></header>
${anio ? tiraMeses(anio, e.periodos || [], (p) => `${base}/informe03/${p}`) : '<p class="nota">Sin meses cargados.</p>'}
${e.idPlanilla ? '' : `<p class="chip ambar"><a href="${base}">Falta ID_PLANILLA</a></p>`}
<footer>${e.ultimo ? `<a href="${base}/informe03/${e.ultimo}">Informe 03 · ${h(nombreMes(e.ultimo))}</a>
<a href="${base}/planilla03/${anio}">Planilla 03 · ${anio}</a>` : `<a href="${base}">Abrir</a>`}</footer>
</article>`;
  }).join('');
  return layout('Empresas', `
<section class="entrada">
<div class="entrada-texto"><p class="ceja">Cargar planilla</p>
<h1>Sube el detalle de planilla de la CSS</h1>
<p class="lead">Puedes subir un mes o todos los del año de una vez. El sistema reconoce la empresa por el RUC y el mes por el «Mes cuota»: cada mes arma su Informe 03 para la DGI y se suma a la Planilla 03 del año. Si subes otra vez el mismo mes, se reemplaza.</p></div>
${formSubir()}
</section>
<section>
<div class="titulo-seccion"><h2>Empresas</h2><span class="contador">${empresas.length}</span></div>
${empresas.length ? `<div class="expedientes">${tarjetas}</div>`
    : '<p class="vacio">Todavía no hay empresas. Sube el primer detalle de planilla y la empresa aparece aquí.</p>'}
</section>`, { usuario, aviso, error, seccion: 'empresas' });
}

function listaAvisos(avisos) {
  if (!avisos || !avisos.length) return '';
  return `<details class="avisos" open><summary>${plural(avisos.length, 'aviso', 'avisos')} para revisar</summary><ul>${avisos.map((a) => `<li>${h(a.texto || a)}</li>`).join('')}</ul></details>`;
}

// Sello de cuadre: la marca de la pantalla. Verde si todo coincide con la CSS, rojo si algo no.
function sello(lista, { mes, compacto = false } = {}) {
  const ok = lista.every((c) => c.ok);
  return `<div class="sello ${ok ? 'cuadra' : 'no-cuadra'}${compacto ? ' compacto' : ''}" role="img" aria-label="${ok ? 'Cuadra con el detalle de la CSS' : 'No cuadra con el detalle de la CSS'}">
<span class="sello-arriba">Comprobado contra CSS</span>
<span class="sello-palabra">${ok ? 'Cuadra' : 'No cuadra'}</span>
${mes ? `<span class="sello-abajo">${h(mes)}</span>` : ''}
</div>`;
}

function cuadres(lista) {
  return `<div class="scroll"><table class="cuadre"><thead><tr><th>Comprobación</th><th class="n">Reporte</th><th class="n">Detalle CSS</th><th class="n">Diferencia</th><th></th></tr></thead><tbody>
${lista.map((c) => {
    const dif = c.css === undefined ? null : Math.round((c.informe - c.css) * 100) / 100;
    return `<tr><td>${h(c.concepto)}</td><td class="n">${fmt(c.informe)}</td><td class="n">${fmt(c.css)}</td><td class="n">${dif === null ? '' : fmt(dif)}</td>
<td>${c.ok ? '<span class="chip verde">Cuadra</span>' : '<span class="chip rojo">No cuadra</span>'}</td></tr>`;
  }).join('')}
</tbody></table></div>`;
}

// Formulario para completar nombre completo y DV de los que no están en el maestro.
function formFaltantes(faltantes, volver) {
  if (!faltantes.length) return '';
  return `<section class="panel faltantes"><h2>Empleados por completar (${faltantes.length})</h2>
<p class="nota">La CSS solo trae primer nombre y primer apellido. Escribe el nombre completo y el DV como van en el Informe 03. Se guardan en el maestro y se usan cada mes.</p>
<form method="post" action="/empleados/lote"><input type="hidden" name="volver" value="${h(volver)}">
<div class="scroll"><table><thead><tr><th>Cédula</th><th>Nombre según CSS</th><th>Nombre completo</th><th>DV</th></tr></thead><tbody>
${faltantes.map((f, i) => `<tr><td class="mono">${h(f.cedula)}<input type="hidden" name="cedula_${i}" value="${h(f.cedula)}"></td><td>${h(f.nombreCSS)}</td>
<td><input name="nombre_${i}" value="${h(f.nombre || '')}" placeholder="NOMBRE SEGUNDO APELLIDO APELLIDO" aria-label="Nombre completo de ${h(f.cedula)}"></td>
<td><input class="dv" name="dv_${i}" value="${h(f.dv || '')}" inputmode="numeric" maxlength="2" aria-label="DV de ${h(f.cedula)}"></td></tr>`).join('')}
</tbody></table></div><input type="hidden" name="total" value="${faltantes.length}"><button class="boton">Guardar en el maestro</button></form></section>`;
}

function resultadoCarga({ empresa, detalle, informe, reemplazo, faltantes, usuario }) {
  const anio = anioDe(detalle.periodo);
  const base = `/empresa/${enc(empresa.ruc)}`;
  const mes = nombreMes(detalle.periodo);
  return layout('Detalle procesado', `
<p class="migas"><a href="/">Empresas</a> / <a href="${base}">${h(empresa.razonSocial)}</a></p>
<section class="cabecera-resultado">
<div><p class="ceja">${reemplazo ? 'Mes reemplazado' : 'Detalle procesado'}</p>
<h1>${h(empresa.razonSocial)}</h1>
<p class="subtitulo">${h(mes)} · ${plural(detalle.empleados.length, 'empleado reportado', 'empleados reportados')} a la CSS${detalle.archivo ? ` · <span class="mono">${h(detalle.archivo)}</span>` : ''}</p>
<div class="botones"><a class="boton" href="${base}/informe03/${detalle.periodo}">Ver Informe 03</a>
<a class="boton secundario" href="${base}/informe03/${detalle.periodo}/excel">Descargar Excel DGI</a>
<a class="boton secundario" href="${base}/planilla03/${anio}">Ver Planilla 03 ${anio}</a>
<a class="boton secundario" href="${base}/talonarios/${detalle.periodo}">Talonarios</a></div></div>
${sello(informe.cuadres, { mes })}
</section>
${cuadres(informe.cuadres)}
${listaAvisos([...detalle.avisos, ...informe.avisos.filter((a) => a.tipo === 'empresa')])}
${formFaltantes(faltantes, `/carga/${enc(empresa.ruc)}/${detalle.periodo}`)}
<div class="titulo-seccion"><h2>Empleados reportados</h2><span class="contador">${detalle.empleados.length}</span>
<input type="search" class="filtro" placeholder="Filtrar por cédula o nombre" data-filtro="#tabla-empleados" aria-label="Filtrar empleados"></div>
<div class="scroll alto"><table id="tabla-empleados"><thead><tr><th>Cédula</th><th>Nombre (CSS)</th><th class="n">Salario</th><th>Novedades</th></tr></thead><tbody>
${detalle.empleados.map((e) => `<tr><td class="mono">${h(e.cedula)}${e.tipoDocumento === 'pasaporte' ? ' <span class="chip">Pasaporte</span>' : ''}</td><td>${h(`${e.nombre} ${e.apellido}`)}</td><td class="n">${fmt(e.salario)}</td>
<td>${e.novedades.map((n) => `<span class="novedad">${h(`${n.tipo} ${n.inicio}${n.fin ? ` al ${n.fin}` : ''}`)}</span>`).join('')}</td></tr>`).join('')}
</tbody></table></div>`, { usuario, seccion: 'empresas' });
}

// Resumen de una carga de varios archivos: un renglón por archivo, con su Informe 03 para
// descargar por separado (se presenta mes a mes) y la Planilla 03 de cada empresa y año.
function resultadoLote({ resultados, usuario }) {
  const ok = resultados.filter((r) => !r.error);
  const fallidos = resultados.filter((r) => r.error);
  const planillas = new Map();
  for (const r of ok) {
    const anio = anioDe(r.detalle.periodo);
    const clave = `${r.empresa.ruc}|${anio}`;
    if (!planillas.has(clave)) planillas.set(clave, { empresa: r.empresa, anio, periodos: [] });
    planillas.get(clave).periodos.push(r.detalle.periodo);
  }
  const noCuadran = ok.filter((r) => !r.cuadres.every((c) => c.ok)).length;
  return layout('Carga de varios meses', `
<p class="migas"><a href="/">Empresas</a></p>
<section class="cabecera-empresa">
<div><p class="ceja">Carga de varios archivos</p>
<h1>${plural(ok.length, 'mes procesado', 'meses procesados')}</h1>
<p class="subtitulo">${plural(resultados.length, 'archivo subido', 'archivos subidos')}${fallidos.length ? ` · ${plural(fallidos.length, 'no se pudo leer', 'no se pudieron leer')}` : ''}${noCuadran ? ` · ${plural(noCuadran, 'mes no cuadra', 'meses no cuadran')}` : ''}</p></div>
</section>
${[...planillas.values()].map((p) => {
    const base = `/empresa/${enc(p.empresa.ruc)}`;
    return `<section class="anio panel">
<div class="titulo-seccion"><h2>${h(p.empresa.razonSocial)} · Planilla 03 ${p.anio}</h2>
<a class="boton" href="${base}/planilla03/${p.anio}/excel">Descargar Planilla 03 ${p.anio}</a>
<a class="boton secundario" href="${base}/planilla03/${p.anio}">Ver</a></div>
<p class="nota">La tira muestra todos los meses que ya tiene la Planilla 03; los de esta carga se suman a los que ya estaban.</p>
${tiraMeses(p.anio, p.empresa.periodos || p.periodos, (x) => `${base}/informe03/${x}`, { grande: true })}
</section>`;
  }).join('')}
<h2>Informes 03 para la DGI, uno por mes</h2>
<div class="scroll"><table><thead><tr><th>Empresa</th><th>Mes</th><th class="n">Empleados</th><th>Cuadre con la CSS</th><th>Archivo subido</th><th></th></tr></thead><tbody>
${ok.map((r) => {
    const base = `/empresa/${enc(r.empresa.ruc)}`;
    const cuadra = r.cuadres.every((c) => c.ok);
    return `<tr><td>${h(r.empresa.razonSocial)}</td><td>${h(nombreMes(r.detalle.periodo))}${r.reemplazo ? ' <span class="chip">reemplazado</span>' : ''}</td>
<td class="n">${r.detalle.empleados.length}</td><td>${cuadra ? '<span class="chip verde">Cuadra</span>' : '<span class="chip rojo">No cuadra</span>'}</td>
<td class="mono suave">${h(r.archivo)}</td>
<td class="acciones"><a class="boton pequeno" href="${base}/informe03/${r.detalle.periodo}/excel">Descargar Informe 03</a>
<a href="${base}/talonarios/${r.detalle.periodo}">Talonarios</a>
<a href="/carga/${enc(r.empresa.ruc)}/${r.detalle.periodo}">Revisar</a></td></tr>`;
  }).join('') || '<tr><td colspan="6">Ningún archivo se pudo procesar.</td></tr>'}
</tbody></table></div>
${fallidos.length ? `<h2>Archivos que no se procesaron</h2>
<div class="scroll"><table><thead><tr><th>Archivo</th><th>Motivo</th></tr></thead><tbody>
${fallidos.map((r) => `<tr><td class="mono">${h(r.archivo)}</td><td class="peligro">${h(r.error)}</td></tr>`).join('')}
</tbody></table></div>` : ''}
<h2>Subir más meses</h2>
${formSubir({ compacto: true })}`, { usuario, seccion: 'empresas' });
}

function empresaPagina({ empresa, detalles, usuario, aviso }) {
  const base = `/empresa/${enc(empresa.ruc)}`;
  const anios = [...new Set(detalles.map((d) => anioDe(d.periodo)))];
  const periodos = detalles.map((d) => d.periodo);
  return layout(empresa.razonSocial || empresa.ruc, `
<p class="migas"><a href="/">Empresas</a></p>
<section class="cabecera-empresa">
<div><h1>${h(empresa.razonSocial || empresa.ruc)}</h1>
<p class="subtitulo">RUC <span class="mono">${h(rucDGI(empresa))}</span> · Patronal <span class="mono">${h(empresa.patronal || '—')}</span></p></div>
<form method="post" action="${base}/config" class="config${empresa.idPlanilla ? '' : ' pendiente'}">
<label>ID_PLANILLA <span class="nota">Código de planilla de la CSS. Va en la columna A del Informe 03.</span>
<input name="idPlanilla" value="${h(empresa.idPlanilla || '')}" inputmode="numeric" class="mono" placeholder="Ej. 75842369"></label>
<label>RUC con guiones <span class="nota">La CSS lo trae como ${h(empresa.ruc)}. Escríbelo separado por guiones como va a la DGI; se usa en el Informe 03 y la Planilla 03.</span>
<input name="rucDGI" value="${h(empresa.rucDGI || empresa.ruc)}" class="mono" autocomplete="off"></label>
<label>Nombre en los talonarios <span class="nota">Va arriba de cada talonario de pago. Si lo dejas vacío se usa ${h(empresa.nombreComercial || empresa.razonSocial || 'el nombre de la CSS')}.</span>
<input name="nombreTalonario" value="${h(empresa.nombreTalonario || '')}" autocomplete="off"></label>
<button class="boton secundario">Guardar</button></form>
</section>
${panelMarca(empresa)}
${anios.map((a) => `<section class="anio">
<div class="titulo-seccion"><h2>${a}</h2><span class="contador">${plural(periodos.filter((p) => anioDe(p) === a).length, 'mes', 'meses')}</span>
<a class="boton secundario" href="${base}/planilla03/${a}">Planilla 03 ${a}</a></div>
${tiraMeses(a, periodos, (p) => `${base}/informe03/${p}`, { grande: true })}
</section>`).join('') || '<p class="vacio">Sin meses cargados. Sube el detalle de planilla abajo.</p>'}
${detalles.length ? `<h2>Meses cargados</h2>
<div class="scroll"><table><thead><tr><th>Mes</th><th class="n">Empleados</th><th class="n">Salario</th><th>Archivo</th><th></th></tr></thead><tbody>
${detalles.map((d) => `<tr><td>${h(nombreMes(d.periodo))}</td><td class="n">${d.empleados.length}</td><td class="n">${fmt(d.totales.SALARIO)}</td>
<td class="mono suave">${h(d.archivo || '')}</td><td class="acciones"><a href="${base}/informe03/${d.periodo}">Informe 03</a>
<a href="${base}/talonarios/${d.periodo}">Talonarios</a>
<a href="/carga/${enc(empresa.ruc)}/${d.periodo}">Revisar</a>
<form method="post" action="${base}/borrar/${d.periodo}" onsubmit="return confirm('¿Borrar ${h(nombreMes(d.periodo))}? Se quita también de la Planilla 03.')"><button class="enlace peligro">Borrar</button></form></td></tr>`).join('')}
</tbody></table></div>` : ''}
<h2>Subir más meses</h2>
${formSubir({ compacto: true })}`, { usuario, aviso, seccion: 'empresas' });
}

// Logo y colores de la empresa para los talonarios. El navegador le quita el fondo blanco al logo.
function panelMarca(empresa) {
  const base = `/empresa/${enc(empresa.ruc)}`;
  const { principal, secundario } = coloresTalonario(empresa);
  return `<section class="panel marca-empresa" id="marca">
<div class="titulo-seccion"><h2>Logo y colores de los talonarios</h2></div>
<div class="marca-rejilla">
<div class="marca-actual">${empresa.logo ? `<div class="logo-vista"><img src="${base}/logo.png?v=${h(empresa.logo)}" alt="Logo de ${h(empresa.razonSocial || '')}"></div>
<form method="post" action="${base}/logo/borrar" onsubmit="return confirm('¿Quitar el logo de los talonarios?')"><button class="enlace peligro">Quitar logo</button></form>`
    : '<div class="logo-vista vacia">Sin logo</div>'}
<p class="muestras"><span style="background:${h(principal)}"></span><span style="background:${h(secundario)}"></span></p></div>
<form method="post" action="${base}/logo" class="marca-form" enctype="multipart/form-data" data-logo>
<label>${empresa.logo ? 'Cambiar logo' : 'Subir logo'} <span class="nota">JPG, JPEG o PNG. Se le quita el fondo blanco y se toman sus colores.</span>
<input type="file" name="archivo" accept="image/*,.jpg,.jpeg,.jfif,.jpe,.png" aria-label="Archivo del logo"></label>
<input type="hidden" name="coloresManual" value="">
<div class="logo-vista nueva" data-logo-vista hidden></div>
<div class="colores"><label>Color principal <input type="color" name="principal" value="${h(principal)}"></label>
<label>Color de acento <input type="color" name="secundario" value="${h(secundario)}"></label></div>
<button class="boton secundario">Guardar</button></form>
</div></section>`;
}

// Grupos de columnas del Informe 03 (en el orden de la DGI) para la fila de arriba del encabezado.
const GRUPOS_INFORME = [['Identificación', 6], ['Ingresos', 12], ['Deducciones', 6], ['Renta e impuesto', 9]];

function informe03Pagina({ empresa, detalle, filas, avisos, cuadres: cs, totales, usuario }) {
  const base = `/empresa/${enc(empresa.ruc)}`;
  const numericas = new Set(COLUMNAS.slice(6));
  const faltan = avisos.filter((a) => a.cedula).length;
  const celda = (c, v) => {
    if (!numericas.has(c)) return `<td${c === 'NUMERO_DOCUMENTO' ? ' class="mono"' : ''}>${h(v)}</td>`;
    return `<td class="n${Number(v) ? '' : ' cero'}">${fmt(v)}</td>`;
  };
  return layout(`Informe 03 ${detalle.periodo}`, `
<p class="migas"><a href="/">Empresas</a> / <a href="${base}">${h(empresa.razonSocial)}</a></p>
<section class="cabecera-informe">
<div><p class="ceja">Informe 03 · DGI</p><h1>${h(nombreMes(detalle.periodo))}</h1>
<p class="subtitulo">${h(empresa.razonSocial)} · ${plural(filas.length, 'empleado', 'empleados')}</p>
<div class="botones"><a class="boton" href="${base}/informe03/${detalle.periodo}/excel">Descargar Excel para la DGI</a>
<a class="boton secundario" href="${base}/planilla03/${anioDe(detalle.periodo)}">Planilla 03 ${anioDe(detalle.periodo)}</a>
<a class="boton secundario" href="${base}/talonarios/${detalle.periodo}">Talonarios</a></div></div>
${sello(cs, { compacto: true })}
</section>
${cuadres(cs)}
${faltan ? `<p class="aviso-error">Hay ${faltan} dato(s) de empleados sin completar (nombre completo o DV). <a href="/carga/${enc(empresa.ruc)}/${detalle.periodo}">Completar ahora</a></p>` : ''}
${listaAvisos(avisos.filter((a) => !a.cedula))}
<div class="titulo-seccion"><h2>Filas del informe</h2>
<input type="search" class="filtro" placeholder="Filtrar por cédula o nombre" data-filtro="#tabla-informe" aria-label="Filtrar filas"></div>
<p class="nota">Mismo orden y columnas que la plantilla de la DGI. Los ceros se ven tenues para que resalten los montos.</p>
<div class="scroll alto"><table class="dgi" id="tabla-informe"><thead>
<tr class="grupos">${GRUPOS_INFORME.map(([g, n]) => `<th colspan="${n}">${g}</th>`).join('')}</tr>
<tr>${COLUMNAS.map((c) => `<th${numericas.has(c) ? ' class="n"' : ''}>${h(c)}</th>`).join('')}</tr></thead><tbody>
${filas.map((f) => `<tr>${COLUMNAS.map((c) => celda(c, f[c])).join('')}</tr>`).join('')}
</tbody><tfoot><tr>${COLUMNAS.map((c, i) => `<td class="n">${i === 5 ? 'Totales' : numericas.has(c) ? fmt(totales[c]) : ''}</td>`).join('')}</tr></tfoot></table></div>`, { usuario, seccion: 'empresas' });
}

function planilla03Pagina({ empresa, planilla, usuario }) {
  const base = `/empresa/${enc(empresa.ruc)}`;
  const idx = planilla.mesesCargados.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  const res = planilla.resumen;
  const filaRes = (titulo, k, clase = '') => `<tr class="${clase}"><td>${h(titulo)}</td>${idx.map((i) => `<td class="n">${fmt(res[i][k])}</td>`).join('')}</tr>`;
  const filaDif = `<tr class="diferencia"><td>Diferencia</td>${idx.map((i) => {
    const d = res[i].diferencia;
    return `<td class="n"><span class="chip ${Math.abs(d) < 0.005 ? 'verde' : 'rojo'}">${fmt(d)}</span></td>`;
  }).join('')}</tr>`;
  const periodos = idx.map((i) => `${planilla.anio}${String(i + 1).padStart(2, '0')}`);
  return layout(`Planilla 03 ${planilla.anio}`, `
<p class="migas"><a href="/">Empresas</a> / <a href="${base}">${h(empresa.razonSocial)}</a></p>
<section class="cabecera-informe">
<div><p class="ceja">Planilla 03 · acumulado anual</p><h1>${h(planilla.anio)}</h1>
<p class="subtitulo">${h(empresa.razonSocial)} · ${plural(planilla.filas.length, 'empleado', 'empleados')} · cada mes se llena al subir su detalle</p>
<div class="botones"><a class="boton" href="${base}/planilla03/${planilla.anio}/excel">Descargar Excel</a></div></div>
${tiraMeses(planilla.anio, periodos, (p) => `${base}/informe03/${p}`, { grande: true })}
</section>
<div class="titulo-seccion"><h2>Empleados</h2>
<input type="search" class="filtro" placeholder="Filtrar por cédula o nombre" data-filtro="#tabla-planilla" aria-label="Filtrar empleados"></div>
<div class="scroll alto"><table class="planilla" id="tabla-planilla"><thead>
<tr><th rowspan="2" class="fija">Nombre</th><th rowspan="2">Identificación</th><th rowspan="2">DV</th>
${idx.map((i) => `<th colspan="4" class="mes-grupo">${MESES_MAYUS[i]}</th>`).join('')}<th rowspan="2" class="n">Totales</th><th rowspan="2" class="n">ISR anual est.</th><th rowspan="2" class="n">ISR retenido</th><th rowspan="2" class="n">Pend x desc</th></tr>
<tr>${idx.map(() => '<th class="n mes-grupo">Salario</th><th class="n">PP</th><th class="n">PP SS</th><th class="n">XIII</th>').join('')}</tr></thead><tbody>
${planilla.filas.map((f) => `<tr><td class="fija">${h(f.nombre)}${f.enMaestro ? '' : ' <span class="chip ambar" title="No está en el maestro de empleados">sin maestro</span>'}</td><td class="mono">${h(f.cedula)}</td><td>${h(f.dv)}</td>
${idx.map((i) => { const v = f.meses[i]; return v ? [v.mes, v.pp, v.ppSS, v.xiii].map((x, j) => `<td class="n${x ? '' : ' cero'}${j === 0 ? ' mes-grupo' : ''}">${fmt(x)}</td>`).join('') : '<td class="mes-grupo"></td><td></td><td></td><td></td>'; }).join('')}
<td class="n fuerte">${fmt(f.total)}</td><td class="n">${fmt(f.isrEstimado)}</td><td class="n">${fmt(f.isrRetenido)}</td><td class="n${f.pendiente ? ' alerta' : ' cero'}">${fmt(f.pendiente)}</td></tr>`).join('')}
</tbody></table></div>
<h2>Cuotas a la CSS por mes</h2>
<p class="nota">Cada cuota se calcula por empleado y se redondea como lo hace la CSS. La última fila compara contra el total del detalle.</p>
<div class="scroll ajustado"><table class="cuotas"><thead><tr><th>Concepto</th>${idx.map((i) => `<th class="n">${MESES_MAYUS[i]}</th>`).join('')}</tr></thead><tbody>
${filaRes('Salarios', 'salarios')}${filaRes('XIII mes', 'xiii')}
<tr class="grupo"><td colspan="${idx.length + 1}">Patronal</td></tr>
${filaRes('SS patronal', 'ssPatronal')}${filaRes('SS XIII mes patronal', 'ssXiiiPatronal')}${filaRes('SE patronal', 'sePatronal')}${filaRes('Riesgo profesional', 'riesgo')}
${filaRes('Subtotal patronal', 'subtotalPatronal', 'sub')}
<tr class="grupo"><td colspan="${idx.length + 1}">Empleado</td></tr>
${filaRes('SS empleado', 'ssEmpleado')}${filaRes('SS XIII mes empleado', 'ssXiiiEmpleado')}${filaRes('SE empleado', 'seEmpleado')}${filaRes('ISR empleado', 'isr')}
${filaRes('Subtotal empleado', 'subtotalEmpleado', 'sub')}
${filaRes('Total calculado', 'total', 'tot')}${filaRes('Total según detalle CSS', 'totalCSS', 'tot')}${filaDif}
</tbody></table></div>`, { usuario, seccion: 'empresas' });
}

// Talonarios de pago de un mes: uno por empleado, como el modelo en Excel, con sus descuentos
// y adicionales fijos editables en el mismo talonario.
function talonariosPagina({ empresa, detalle, resultado, usuario, aviso, error }) {
  const base = `/empresa/${enc(empresa.ruc)}`;
  const url = `${base}/talonarios/${detalle.periodo}`;
  const { modo, talonarios: ts } = resultado;
  const totalNeto = ts.reduce((s, t) => s + t.neto, 0);
  const linea = (concepto, monto, { clase = '', col = 'd' } = {}) => `<li class="${col}${clase ? ` ${clase}` : ''}"><span>${h(concepto)}</span><span class="mono">${monto ? fmt(monto) : ''}</span></li>`;
  const { principal, secundario } = coloresTalonario(empresa);
  const logo = empresa.logo ? `<img class="t-logo" src="${base}/logo.png?v=${h(empresa.logo)}" alt="">` : '';
  const tarjeta = (t) => {
    const filas = [...t.conceptos, { tipo: 'descuento', nombre: '', monto: '' }, { tipo: 'adicional', nombre: '', monto: '' }];
    return `<article class="talonario" id="t-${h(t.cedula)}">
<header>${logo}<p class="t-empresa">${h(nombreEmpresaTalonario(empresa))}</p><p class="t-titulo">Talonario de pago</p>
<h3>${h(t.nombre)}</h3>${t.correo ? `<p class="t-correo">${h(t.correo)}</p>` : ''}<p class="mono t-ced">CED. ${h(t.cedula)}</p></header>
<ul class="t-lineas">
${t.ingresos.map((i) => linea(i.concepto, i.monto)).join('')}
${linea(modo === 'mes' ? 'Sub-total mes' : 'Sub-total quincena', t.subtotal, { col: 'e', clase: 'sub' })}
${linea('Más: XIII mes', t.xiii, { col: 'e' })}
${t.gr ? linea('Más: gasto de representación', t.gr, { col: 'e' }) : ''}
<li class="t-grupo">Menos:</li>
${t.deducciones.map((d) => linea(d.concepto, d.monto, { clase: 'ded' })).join('')}
${linea('Total deducciones', t.totalDeducciones, { clase: 'sub' })}
${t.adicionales.map((a) => linea(`Más: ${a.concepto}`, a.monto)).join('')}
</ul>
<p class="t-neto"><span>${h(resultado.etiquetaNeto.toLowerCase())}</span><strong class="mono">B/. ${fmt(t.neto)}</strong></p>
<p class="t-pdf"><a href="${url}/pdf?modo=${modo}&amp;cedula=${enc(t.cedula)}&amp;ver=1" target="_blank" rel="noopener">Ver PDF</a> · <a href="${url}/pdf?modo=${modo}&amp;cedula=${enc(t.cedula)}">Descargar PDF</a></p>
<details class="t-editar"><summary>Descuentos, adicionales y correo</summary>
<form method="post" action="${url}/ajuste">
<input type="hidden" name="cedula" value="${h(t.cedula)}"><input type="hidden" name="modo" value="${h(modo)}"><input type="hidden" name="filas" value="${filas.length}">
<p class="nota">Montos por quincena. Se repiten en cada talonario hasta que los cambies; para quitar uno, borra su monto.</p>
<div class="t-conceptos">${filas.map((c, i) => `<div class="t-concepto">
<select name="tipo_${i}" aria-label="Tipo"><option value="descuento"${c.tipo === 'descuento' ? ' selected' : ''}>Menos</option><option value="adicional"${c.tipo === 'adicional' ? ' selected' : ''}>Más</option></select>
<input name="nombre_${i}" value="${h(c.nombre)}" placeholder="${c.tipo === 'adicional' ? 'Ej. Transporte' : 'Ej. Préstamo Banco General'}" aria-label="Concepto">
<input name="monto_${i}" value="${c.monto === '' ? '' : h(Number(c.monto).toFixed(2))}" inputmode="decimal" class="mono monto" placeholder="0.00" aria-label="Monto"></div>`).join('')}</div>
<label>Correo <input name="correo" type="email" value="${h(t.correo)}" placeholder="nombre@empresa.com" autocomplete="off"></label>
<button class="boton secundario pequeno">Guardar</button></form></details>
</article>`;
  };
  return layout(`Talonarios ${detalle.periodo}`, `
<p class="migas"><a href="/">Empresas</a> / <a href="${base}">${h(empresa.razonSocial)}</a></p>
<section class="cabecera-informe">
<div><p class="ceja">Talonarios de pago</p><h1>${h(resultado.titulo)}</h1>
<p class="subtitulo">${h(empresa.razonSocial)} · ${plural(ts.length, 'empleado', 'empleados')} · neto a pagar B/. ${fmt(totalNeto)}</p>
<nav class="pestanas" aria-label="Periodo del talonario">${Object.entries(MODOS).map(([k, m]) => `<a href="${url}?modo=${k}"${k === modo ? ' aria-current="page"' : ''}>${h(m.corto)}</a>`).join('')}</nav>
<div class="botones"><a class="boton" href="${url}/pdf?modo=${modo}&amp;ver=1" target="_blank" rel="noopener">Ver PDF</a>
<a class="boton secundario" href="${url}/pdf?modo=${modo}">Descargar PDF</a>
<a class="boton secundario" href="${url}/zip?modo=${modo}">Descargar un PDF por empleado (ZIP)</a>
<a class="boton secundario" href="${url}/excel?modo=${modo}">Descargar Excel</a></div>
${empresa.logo ? '' : `<p class="nota">Sin logo. <a href="${base}#marca">Súbelo en la página de la empresa</a> para que salga en el PDF y el Excel.</p>`}</div>
</section>
<p class="nota">Salen del detalle de la CSS de ${h(nombreMes(detalle.periodo))}. ${modo === 'mes' ? 'Montos del mes completo; los fijos por quincena van por dos.' : 'El mes se reparte en dos quincenas iguales (la 2da lleva los centavos que sobran) y el XIII mes va completo en la 1ra quincena.'} El SS y SE, el SS del XIII y el ISR suman lo mismo que reportó la CSS.</p>
<div class="titulo-seccion"><h2>Talonarios</h2><span class="contador">${ts.length}</span>
<input type="search" class="filtro" placeholder="Filtrar por cédula o nombre" data-filtro-tarjetas=".talonarios" aria-label="Filtrar talonarios"></div>
<div class="talonarios" style="--t-principal:${h(principal)};--t-acento:${h(secundario)}">${ts.map(tarjeta).join('')}</div>`, { usuario, aviso, error, seccion: 'empresas' });
}

function empleadosPagina({ empleados, usuario, aviso, error, q }) {
  return layout('Empleados', `
<section class="cabecera-empresa">
<div><p class="ceja">Maestro</p><h1>Empleados</h1>
<p class="subtitulo">Nombre completo y DV de cada cédula. La CSS no los trae completos, así que se guardan aquí y se usan en todos los informes.</p></div>
</section>
<div class="dos-columnas">
<section class="panel"><h2>Importar desde un informe anterior</h2>
<p class="nota">Un Informe 03 o una Planilla 03 en Excel (.xlsx). Toma la cédula, el nombre completo y el DV.</p>
<form method="post" action="/empleados/importar" enctype="multipart/form-data" class="fila">
<input type="file" name="archivo" accept=".xlsx" required aria-label="Archivo a importar"><button class="boton">Importar</button></form></section>
<section class="panel"><h2>Agregar empleado</h2>
<form method="post" action="/empleados/guardar" class="rejilla-form">
<label>Cédula <input name="cedula" required class="mono"></label>
<label class="ancho">Nombre completo <input name="nombreCompleto" required></label>
<label>DV <input name="dv" maxlength="2" inputmode="numeric" class="dv"></label>
<label class="ancho">Otras identificaciones <input name="otrasIds" placeholder="Pasaporte u otra cédula, separadas por coma"></label>
<button class="boton">Agregar</button></form></section>
</div>
<div class="titulo-seccion"><h2>En el maestro</h2><span class="contador">${empleados.length}</span>
<form method="get" class="buscar"><input type="search" name="q" value="${h(q || '')}" class="filtro" placeholder="Filtrar por cédula o nombre" data-filtro="#tabla-maestro" aria-label="Filtrar empleados"></form></div>
${empleados.length ? `<div class="scroll alto"><table id="tabla-maestro"><thead><tr><th>Cédula</th><th>Nombre completo</th><th>DV</th><th>Otras identificaciones</th><th></th></tr></thead><tbody>
${empleados.map((e, i) => `<tr><td class="mono">${h(e.cedula)}</td>
<td><input form="emp_${i}" name="nombreCompleto" value="${h(e.nombreCompleto)}" aria-label="Nombre completo de ${h(e.cedula)}"></td><td><input form="emp_${i}" name="dv" value="${h(e.dv)}" maxlength="2" class="dv" aria-label="DV de ${h(e.cedula)}"></td>
<td><input form="emp_${i}" name="otrasIds" value="${h((e.otrasIds || []).join(', '))}" aria-label="Otras identificaciones de ${h(e.cedula)}"></td>
<td><form id="emp_${i}" method="post" action="/empleados/guardar"><input type="hidden" name="cedula" value="${h(e.cedula)}"><button class="boton secundario pequeno">Guardar</button></form></td></tr>`).join('')}
</tbody></table></div>` : `<p class="vacio">${q ? 'Ningún empleado coincide con la búsqueda.' : 'El maestro está vacío. Importa un Informe 03 anterior para llenarlo de una vez.'}</p>`}`, { usuario, aviso, error, seccion: 'empleados' });
}

function errorPagina(mensaje, usuario) {
  return layout('Error', `<section class="panel"><h1>No se pudo completar</h1><p class="aviso-error">${h(mensaje)}</p><p><a class="boton secundario" href="/">Volver a empresas</a></p></section>`, { usuario });
}

module.exports = { login, inicio, resultadoCarga, resultadoLote, empresaPagina, informe03Pagina, planilla03Pagina, talonariosPagina, empleadosPagina, errorPagina };
