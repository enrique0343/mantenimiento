// Fase 59 · WP-G (revisión): los scripts de las pantallas del paquete, tal como
// están en los .astro, corridos en jsdom con lo mínimo del HTML y la red simulada.
// Cubre la marca de incidente en la ficha de la orden, el equipo del formulario
// público de soporte, el PDF aprobado de la ficha del documento y el alta de un
// protocolo en la biblioteca: validaciones del navegador, lo que se manda al
// servidor, j.error a la vista y qué pasa sin red (no se pierde lo escrito ni
// queda un botón trabado). Sin servidor, sin D1 ni R2.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse as parseAstro } from '@astrojs/compiler';
import { defineScriptVars } from '../node_modules/astro/dist/runtime/server/render/util.js';
import { encodeInlineScriptVars } from '../src/lib/inline-script-vars.ts';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
const pausa = (ms = 5) => new Promise((r) => setTimeout(r, ms));

/** El script con define:vars del .astro que contiene `marca`, como lo deja Astro en la página. */
async function scriptDe(archivo, marca) {
  const { ast } = await parseAstro(await fs.readFile(path.join(raiz, archivo), 'utf8'));
  const encontrados = [];
  (function recorrer(nodo) {
    if (nodo.name === 'script' && nodo.attributes?.some((a) => a.name === 'define:vars')) {
      encontrados.push((nodo.children ?? []).map((c) => c.value ?? '').join(''));
    }
    for (const hijo of nodo.children ?? []) recorrer(hijo);
  })(ast);
  const codigo = encontrados.find((s) => s.includes(marca));
  assert.ok(codigo, `${archivo}: no se encontró el script con «${marca}»`);
  return codigo;
}

/** Una página mínima: el HTML dado, la red simulada y el script corrido como lo corre el navegador. */
function pagina(html, codigo, vars, { url = 'https://local.test/', red } = {}) {
  const errores = [];
  const consola = new VirtualConsole();
  consola.on('jsdomError', (e) => { if (!/Not implemented/.test(e.message)) errores.push(e); });
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url, runScripts: 'outside-only', virtualConsole: consola });
  const w = dom.window;
  const llamadas = [];
  const toasts = [];
  w.fetch = (destino, opciones = {}) => { llamadas.push({ url: String(destino), opciones }); return red(String(destino), opciones, llamadas.length); };
  w.showToast = (mensaje, tipo) => toasts.push([mensaje, tipo]);
  w.confirmAction = async () => true;
  w.addEventListener('error', (e) => errores.push(e.error ?? e.message));
  w.eval(`(function(){${defineScriptVars({ __encodedScriptVars: encodeInlineScriptVars(vars) })}\n${codigo}\n})();`);
  const $ = (id) => w.document.getElementById(id);
  return { w, $, llamadas, toasts, errores };
}
const respuesta = (status, cuerpo) => ({ ok: status >= 200 && status < 300, status, json: async () => cuerpo });
const sinRed = async () => { throw new TypeError('Failed to fetch'); };
const cambiar = (p, id, valor) => { const el = p.$(id); el.value = valor; el.dispatchEvent(new p.w.Event('change', { bubbles: true })); };
// click() como la persona: un botón deshabilitado no recibe el clic.
const clic = (p, id) => p.$(id).click();
const oculto = (el) => el.classList.contains('hidden');

// ═══ Ficha de la orden: marca de incidente (jefatura) ═══════════════════════
{
  const codigo = await scriptDe('src/pages/ordenes/[id].astro', 'incGuardar');
  const html = `
    <button id="incMarcar">Marcar</button>
    <div id="incForm" class="hidden">
      <input id="incNumero" value=""><input id="incFecha" type="date" value=""><textarea id="incNota"></textarea>
      <p id="incMsg" class="hidden"></p><button id="incCancelar">Cancelar</button><button id="incGuardar">Guardar</button>
    </div>`;
  const vars = { otId: 901, hoy: '2026-11-12', minMotivo: 10 };
  let red = sinRed;
  const p = pagina(html, codigo, vars, { url: 'https://local.test/ordenes/901', red: (...a) => red(...a) });
  clic(p, 'incMarcar');
  es(oculto(p.$('incForm')), false, 'Marcar abre el formulario');
  clic(p, 'incGuardar');
  es([p.$('incMsg').textContent, p.llamadas.length], ['Escribe la fecha en que se avisó a Calidad.', 0], 'sin fecha no se manda');
  p.$('incFecha').value = '2026-11-13';
  clic(p, 'incGuardar');
  es([p.$('incMsg').textContent, p.llamadas.length], ['La fecha de aviso a Calidad no puede ser posterior a hoy.', 0], 'fecha futura no se manda');
  p.$('incFecha').value = '2026-11-10';
  p.$('incNumero').value = ' RC-2026-0148 ';
  p.$('incNota').value = 'Equipo retirado de uso';
  clic(p, 'incGuardar');
  await pausa();
  es(p.llamadas.length, 1, 'una llamada');
  es([p.llamadas[0].url, p.llamadas[0].opciones.method, JSON.parse(p.llamadas[0].opciones.body)],
    ['/api/ordenes/901/incidente', 'PUT', { numeroReporte: ' RC-2026-0148 ', fechaNotificacion: '2026-11-10', nota: 'Equipo retirado de uso' }], 'PUT con lo escrito');
  es([p.$('incMsg').textContent, p.$('incGuardar').disabled, p.$('incNota').value],
    ['Sin conexión: no se pudo guardar. Inténtalo de nuevo.', false, 'Equipo retirado de uso'], 'sin red: aviso, botón libre y lo escrito sigue');
  red = async () => respuesta(400, { error: 'La fecha de aviso a Calidad no es válida.' });
  clic(p, 'incGuardar');
  await pausa();
  es(p.$('incMsg').textContent, 'La fecha de aviso a Calidad no es válida.', 'muestra j.error del servidor');
  red = async () => respuesta(403, 'Sin permisos');
  clic(p, 'incGuardar');
  await pausa();
  es(p.$('incMsg').textContent, 'No se pudo guardar la marca.', 'un error que no es texto no se muestra crudo');
  let pendiente;
  red = () => new Promise((r) => { pendiente = r; });
  const antes = p.llamadas.length;
  clic(p, 'incGuardar'); clic(p, 'incGuardar');
  await pausa();
  es([p.llamadas.length - antes, p.$('incGuardar').disabled], [1, true], 'doble clic: una sola llamada mientras viaja');
  pendiente(respuesta(201, { ok: true, creada: true }));
  await pausa();
  es(p.toasts.at(-1), ['Marca de incidente guardada.', 'success'], 'guardada');
  es(p.errores, [], 'sin errores de JavaScript');
}
{
  const codigo = await scriptDe('src/pages/ordenes/[id].astro', 'incQuitarConfirmar');
  const html = `
    <button id="incEditar">Editar</button><button id="incQuitar">Quitar marca</button>
    <div id="incForm" class="hidden"><input id="incNumero" value="RC-9"><input id="incFecha" value="2026-11-01"><textarea id="incNota">Nota</textarea>
      <p id="incMsg" class="hidden"></p><button id="incCancelar">Cancelar</button><button id="incGuardar">Guardar</button></div>
    <div id="incQuitarBox" class="hidden"><textarea id="incMotivo"></textarea><p id="incQuitarMsg" class="hidden"></p>
      <button id="incQuitarCancelar">Cancelar</button><button id="incQuitarConfirmar">Quitar marca</button></div>`;
  let red = sinRed;
  const p = pagina(html, codigo, { otId: 7, hoy: '2026-11-12', minMotivo: 10 }, { red: (...a) => red(...a) });
  clic(p, 'incEditar');
  p.$('incNumero').value = 'otro';
  clic(p, 'incCancelar');
  es([oculto(p.$('incForm')), p.$('incNumero').value], [true, 'RC-9'], 'Cancelar devuelve lo guardado');
  clic(p, 'incQuitar');
  es([oculto(p.$('incQuitarBox')), oculto(p.$('incForm'))], [false, true], 'Quitar abre su caja');
  p.$('incMotivo').value = 'corto';
  clic(p, 'incQuitarConfirmar');
  es([p.$('incQuitarMsg').textContent, p.llamadas.length], ['Escribe por qué se quita la marca (mínimo 10 letras).', 0], 'motivo corto no se manda');
  p.$('incMotivo').value = 'Se marcó en la orden equivocada';
  clic(p, 'incQuitarConfirmar');
  await pausa();
  es([p.llamadas[0].opciones.method, JSON.parse(p.llamadas[0].opciones.body)], ['DELETE', { motivo: 'Se marcó en la orden equivocada' }], 'DELETE con el motivo');
  es([p.$('incQuitarMsg').textContent, p.$('incQuitarConfirmar').disabled], ['Sin conexión: no se pudo quitar la marca. Inténtalo de nuevo.', false], 'sin red al quitar');
  red = async () => respuesta(200, { ok: true });
  clic(p, 'incQuitarConfirmar');
  await pausa();
  es(p.toasts.at(-1), ['Marca quitada.', 'success'], 'quitada');
  es(p.errores, [], 'sin errores de JavaScript');
}

// ═══ Formulario público de soporte: equipo opcional ═════════════════════════
const htmlSoporte = (area = '') => `
  <div id="successBox" class="hidden"><div id="trackToken"></div><span id="slaInfo"></span></div>
  <div id="formBox"><form id="form">
    <input id="solicitanteNombre" value="Ana Pérez"><input id="solicitanteEmail" value="ana@example.invalid"><input id="solicitanteTelefono" value="">
    <select id="rubro" ${area ? 'disabled' : ''}><option value="">—</option><option value="aires">A</option><option value="infraestructura">I</option>
      <option value="equipo_general">G</option><option value="biomedico" ${area === 'biomedico' ? 'selected' : ''}>B</option></select>
    <select id="prioridad"><option value="media" selected>Media</option></select>
    <input id="asunto" value="Monitor sin imagen"><textarea id="descripcion">La pantalla quedó en negro</textarea>
    <select id="sucursalId"><option value="">—</option><option value="1">Sede</option></select>
    <select id="ubicacionId"><option value="">—</option></select>
    <div id="activoBox" class="hidden"><select id="activoId"><option value="">— No sé / no está en la lista —</option></select></div>
    <input id="ubicacion" value=""><input type="file" id="fotoFile"><input type="file" id="fotoCamara"><div id="fotosPreview"></div>
    <p id="err" class="hidden"></p><button id="btnSubmit" type="submit">Enviar solicitud</button>
  </form></div>`;
{
  const codigo = await scriptDe('src/pages/soporte/index.astro', 'activoId');
  const ubJson = JSON.stringify([{ id: 10, nombre: 'UCI', sucursalId: 1, tipo: 'area' }, { id: 11, nombre: 'Bodega', sucursalId: 1, tipo: 'area' }]);
  const EQUIPOS = { equipos: [{ id: 901, codigo: 'BIO-901', nombre: 'Monitor', area: 'biomedico' }, { id: 903, codigo: 'GEN-903', nombre: 'Refrigerador', area: 'equipo_general' }] };
  let alEnviar = sinRed;
  const red = async (url, opciones) => {
    if (url.startsWith('/api/tickets/publico/equipos')) {
      return url.includes('ubicacionId=10') ? respuesta(200, EQUIPOS) : url.includes('ubicacionId=11') ? respuesta(200, { equipos: [] }) : respuesta(404, { error: 'Ubicación no encontrada' });
    }
    return alEnviar(url, opciones);
  };
  const p = pagina(htmlSoporte(), codigo, { ubJson }, { url: 'https://local.test/soporte', red });
  cambiar(p, 'sucursalId', '1');
  es(oculto(p.$('activoBox')), true, 'sin ubicación no hay equipo');
  cambiar(p, 'ubicacionId', '10');
  await pausa();
  es(p.llamadas.at(-1).url, '/api/tickets/publico/equipos?ubicacionId=10', 'pide los equipos de la ubicación');
  es([oculto(p.$('activoBox')), [...p.$('activoId').options].map((o) => o.textContent)],
    [false, ['— No sé / no está en la lista —', 'BIO-901 · Monitor', 'GEN-903 · Refrigerador']], 'lista con código · nombre');
  cambiar(p, 'activoId', '903');
  es(p.$('rubro').value, 'equipo_general', 'un equipo de otra área ajusta el área');
  cambiar(p, 'rubro', 'biomedico');
  await pausa();
  es(p.llamadas.at(-1).url, '/api/tickets/publico/equipos?ubicacionId=10&area=biomedico', 'cambiar el área vuelve a pedir la lista con el área');
  cambiar(p, 'activoId', '901');
  cambiar(p, 'ubicacionId', '11');
  await pausa();
  es([oculto(p.$('activoBox')), p.$('activoId').value], [true, ''], 'ubicación sin equipos: el campo se oculta y se vacía');
  cambiar(p, 'ubicacionId', '10');
  await pausa();
  cambiar(p, 'activoId', '901');

  // Enviar sin red: el aviso sale, el botón vuelve y lo escrito (con el equipo) sigue.
  p.$('form').dispatchEvent(new p.w.Event('submit', { bubbles: true, cancelable: true }));
  await pausa();
  const envio = p.llamadas.find((l) => l.url === '/api/tickets/publico');
  es(JSON.parse(envio.opciones.body).activoId, 901, 'el ticket lleva el equipo');
  es([p.$('err').textContent, oculto(p.$('err')), p.$('btnSubmit').disabled, p.$('btnSubmit').textContent],
    ['No pudimos enviar tu solicitud: revisa tu conexión e inténtalo de nuevo. Lo que escribiste sigue aquí.', false, false, 'Enviar solicitud'], 'sin red: aviso y botón libre');
  es([p.$('descripcion').value, p.$('activoId').value], ['La pantalla quedó en negro', '901'], 'lo escrito sigue');
  alEnviar = async () => respuesta(400, { error: 'Ese equipo está dado de baja. Quita la selección y descríbelo en la descripción.' });
  p.$('form').dispatchEvent(new p.w.Event('submit', { bubbles: true, cancelable: true }));
  await pausa();
  es(p.$('err').textContent, 'Ese equipo está dado de baja. Quita la selección y descríbelo en la descripción.', 'muestra j.error');
  alEnviar = async () => respuesta(201, { ticket: { id: 1, trackingToken: 'TK-123' } });
  p.$('form').dispatchEvent(new p.w.Event('submit', { bubbles: true, cancelable: true }));
  await pausa();
  es([oculto(p.$('successBox')), p.$('trackToken').textContent], [false, 'TK-123'], 'ticket creado');
  es(p.errores, [], 'sin errores de JavaScript');
}
{
  // Con ?area= el área queda fija: elegir un equipo no la cambia; si la lista falla, el campo se oculta.
  const codigo = await scriptDe('src/pages/soporte/index.astro', 'activoId');
  let falla = false;
  const p = pagina(htmlSoporte('biomedico'), codigo, { ubJson: JSON.stringify([{ id: 10, nombre: 'UCI', sucursalId: 1, tipo: 'area' }]) }, {
    red: async (url) => (falla ? sinRed() : respuesta(200, { equipos: [{ id: 903, codigo: 'GEN-903', nombre: 'Refrigerador', area: 'equipo_general' }] })),
  });
  cambiar(p, 'sucursalId', '1');
  cambiar(p, 'ubicacionId', '10');
  await pausa();
  es(p.llamadas.at(-1).url, '/api/tickets/publico/equipos?ubicacionId=10&area=biomedico', 'con área fija la lista va filtrada');
  cambiar(p, 'activoId', '903');
  es(p.$('rubro').value, 'biomedico', 'el área fija no cambia');
  falla = true;
  cambiar(p, 'ubicacionId', '10');
  await pausa();
  es(oculto(p.$('activoBox')), true, 'si la lista falla, el campo se oculta');
  es(p.errores, [], 'sin errores de JavaScript');
}

// ═══ Ficha del documento: PDF aprobado ══════════════════════════════════════
{
  const codigo = await scriptDe('src/pages/procedimientos/[id].astro', 'pdfFile');
  const html = `<label><input type="file" id="pdfFile"></label><button id="pdfQuitar">Quitar PDF</button><p id="pdfMsg" class="hidden"></p>`;
  const vars = (tienePdf) => ({ procId: 5, esAdmin: true, veredictoJson: JSON.stringify({ ok: true, motivos: [] }), tienePdf, maxPdf: 15 * 1024 * 1024 });
  let red = sinRed;
  const p = pagina(html, codigo, vars(false), { url: 'https://local.test/procedimientos/5', red: (...a) => red(...a) });
  const elegir = (archivo) => {
    const input = p.$('pdfFile');
    Object.defineProperty(input, 'files', { configurable: true, get: () => [archivo] });
    input.dispatchEvent(new p.w.Event('change', { bubbles: true }));
  };
  const pdf = new p.w.File(['%PDF-1.4\n'], 'Protocolo.pdf', { type: 'application/pdf' });
  elegir(new p.w.File(['hola'], 'nota.txt', { type: 'text/plain' }));
  await pausa();
  es([p.$('pdfMsg').textContent, p.llamadas.length], ['Elige un archivo PDF.', 0], 'otro tipo no se manda');
  elegir(pdf);
  await pausa();
  es([p.llamadas.length, p.llamadas[0].url, p.llamadas[0].opciones.method], [1, '/api/procedimientos/5/pdf', 'POST'], 'sube el PDF');
  es([p.$('pdfMsg').textContent, p.$('pdfFile').disabled], ['Sin conexión: no se pudo subir el PDF. Inténtalo de nuevo.', false],
    'sin red: aviso claro (antes quedaba «Subiendo el PDF…») y el campo vuelve a estar libre');
  red = async () => respuesta(415, { error: 'El archivo no es un PDF.' });
  elegir(pdf);
  await pausa();
  es([p.toasts.at(-1), p.$('pdfMsg').textContent, p.$('pdfFile').disabled],
    [['El archivo no es un PDF.', 'error'], 'No se guardó el PDF. Revisa el aviso e inténtalo de nuevo.', false], 'j.error del servidor');
  let pendiente;
  red = () => new Promise((r) => { pendiente = r; });
  const antes = p.llamadas.length;
  elegir(pdf);
  await pausa();
  es([p.$('pdfFile').disabled, p.$('pdfMsg').textContent], [true, 'Subiendo el PDF…'], 'mientras sube, el campo queda deshabilitado');
  elegir(pdf);
  await pausa();
  es(p.llamadas.length - antes, 1, 'un segundo archivo no sale en paralelo');
  pendiente(respuesta(201, { pdf: { nombre: 'Protocolo.pdf' } }));
  await pausa();
  es(p.toasts.at(-1), ['PDF guardado.', 'success'], 'guardado');

  red = sinRed;
  clic(p, 'pdfQuitar');
  await pausa();
  es([p.llamadas.at(-1).opciones.method, p.$('pdfMsg').textContent, p.$('pdfQuitar').disabled],
    ['DELETE', 'Sin conexión: no se pudo quitar el PDF. Inténtalo de nuevo.', false], 'quitar sin red');
  es(p.errores, [], 'sin errores de JavaScript');
}

// ═══ Biblioteca: alta de un protocolo institucional ═════════════════════════
{
  const codigo = await scriptDe('src/pages/procedimientos.astro', 'n_save');
  const html = `
    <button id="nuevoBtn">+ Nuevo</button>
    <div id="nuevoModal" class="hidden">
      <input id="n_codigo" value=""><input id="n_inst" value=""><input id="n_titulo" value="">
      <select id="n_tipo">${['scp', 'sop', 'mop', 'eop', 'aop', 'protocolo'].map((t) => `<option value="${t}">${t}</option>`).join('')}</select>
      <p id="n_semanaTxt"></p><p id="n_sug" class="hidden"></p>
      <div id="n_sistemaBox"><select id="n_sistema"><option value="electrico">E</option><option value="hvac" selected>H</option><option value="otro">O</option></select></div>
      <select id="n_resp"><option value="2" selected>Jefe</option></select><input id="n_suplente" value="">
      <select id="n_sede"><option value="" selected>Modelo</option></select>
      <div id="n_riesgoBox"><select id="n_riesgo"><option value="">Sin</option><option value="alto" selected>Alto</option></select></div>
      <input id="n_norma" value=""><textarea id="n_proposito"></textarea>
      <div id="n_semanaBox"><select id="n_semana"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></div>
      <input id="n_fechaBase" type="date" value="2026-11-20">
      <div id="n_areas"></div><div id="n_campos"></div><button id="n_addArea">+ Área</button>
      <p id="n_err" class="hidden"></p><button id="n_cancel">Cancelar</button><button id="n_save">Guardar</button>
    </div>`;
  const MATRIZ = { 'SCP-ELE-01': { titulo: 'Configuración eléctrica', tipo: 'scp', sistema: 'electrico', nivelRiesgo: 'alto', areas: ['Mantenimiento General'], queConfirma: 'Valores', campos: ['Voltaje'] } };
  const PROTOS = {
    'PRT-LYD-01': { titulo: 'Limpieza y desinfección de equipo médico', areas: ['Control de Infecciones', 'Mantenimiento Biomédico', 'Enfermería', 'Calidad'], queConfirma: 'Productos, frecuencia y responsable por tipo de equipo' },
  };
  let red = sinRed;
  const p = pagina(html, codigo, { matrizJson: JSON.stringify(MATRIZ), semanasJson: JSON.stringify({ 1: { label: 'Semana 1', detalle: 'SCP' }, 2: { label: 'Semana 2', detalle: 'SOP' } }), protosJson: JSON.stringify(PROTOS), esAdmin: true },
    { url: 'https://local.test/procedimientos', red: (...a) => red(...a) });
  clic(p, 'nuevoBtn');
  cambiar(p, 'n_codigo', ' prt-lyd-01 ');
  es([p.$('n_codigo').value, p.$('n_tipo').value, p.$('n_titulo').value], ['PRT-LYD-01', 'protocolo', 'Limpieza y desinfección de equipo médico'], 'el código precarga tipo y título');
  es([...p.$('n_areas').querySelectorAll('.a-area')].map((i) => i.value), PROTOS['PRT-LYD-01'].areas, 'una fila por área validadora');
  es(['n_sistemaBox', 'n_riesgoBox', 'n_semanaBox'].map((id) => oculto(p.$(id))), [true, true, true], 'sin sistema, riesgo ni semana');
  es(p.$('n_semanaTxt').textContent, 'Protocolo institucional: lo aprueba Calidad; no sigue el calendario de cuatro semanas.', 'texto del protocolo');
  clic(p, 'n_save');
  await pausa();
  const cuerpo = JSON.parse(p.llamadas[0].opciones.body);
  es([cuerpo.tipo, cuerpo.sistema, cuerpo.nivelRiesgo, cuerpo.semanaValidacion, cuerpo.validaciones.length], ['protocolo', 'otro', null, null, 4], 'el protocolo va con sistema «otro», sin riesgo ni semana');
  es([p.$('n_err').textContent, p.$('n_save').disabled, p.$('n_titulo').value],
    ['Sin conexión: no se pudo crear el documento. Inténtalo de nuevo.', false, 'Limpieza y desinfección de equipo médico'],
    'sin red: aviso, botón libre (antes quedaba deshabilitado) y lo escrito sigue');
  red = async () => respuesta(409, { error: 'El código corto PRT-LYD-01 ya existe. El índice de equivalencia admite un solo documento por código (cap. 2.4).' });
  clic(p, 'n_save');
  await pausa();
  es(p.$('n_err').textContent, 'El código corto PRT-LYD-01 ya existe. El índice de equivalencia admite un solo documento por código (cap. 2.4).', 'muestra j.error');
  cambiar(p, 'n_tipo', 'sop');
  es(['n_sistemaBox', 'n_riesgoBox', 'n_semanaBox'].map((id) => oculto(p.$(id))), [false, false, false], 'otro tipo vuelve a pedir sistema, riesgo y semana');
  es(p.errores, [], 'sin errores de JavaScript');
}

// ═══ Impresión: cabecera, tabla y folio en la misma hoja apaisada ════════════
// Con «page: apaisada» solo en la tabla, el navegador corta la hoja antes y después
// de ella: la cabecera queda sola en una hoja vertical y el folio solo en otra
// (comprobado con Chrome: 3 hojas, vertical · apaisada · vertical). En la biblioteca,
// en vertical la tabla de 8 columnas no cabe y la columna «Validación» se cortaba.
for (const archivo of ['src/pages/incidentes.astro', 'src/pages/procedimientos.astro']) {
  const { ast } = await parseAstro(await fs.readFile(path.join(raiz, archivo), 'utf8'));
  const apaisadas = [];
  (function recorrer(nodo) {
    if (nodo.attributes?.some((a) => a.name === 'style' && /page:\s*apaisada/.test(a.value ?? ''))) apaisadas.push(nodo);
    for (const hijo of nodo.children ?? []) recorrer(hijo);
  })(ast);
  const contiene = (nodo, nombre) => nodo.name === nombre || (nodo.children ?? []).some((h) => contiene(h, nombre));
  es(apaisadas.length, 1, `${archivo}: una sola hoja apaisada`);
  es(['DocCabecera', 'table', 'DocFolio'].map((nombre) => contiene(apaisadas[0], nombre)), [true, true, true], `${archivo}: cabecera, tabla y folio dentro de la hoja apaisada`);
}

console.log(`PASS test-bio-incidentes-pantallas: ${n} casos`);
