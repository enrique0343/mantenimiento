// Fase 59 · WP-A: filtros del inventario (src/lib/inventario-filtros.ts), sin base de
// datos. Los usan igual la lista, la impresión y la descarga (contrato K-A2), además
// de los ayudantes de código y serie de src/lib/registro-activos.ts. Al final, los
// scripts del navegador de las pantallas del inventario, con jsdom y sin servidor.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const cargar = async (archivo) => {
  const out = await build({ entryPoints: [archivo], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
};
const F = await cargar('src/lib/inventario-filtros.ts');
const R = await cargar('src/lib/registro-activos.ts');

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
const p = (q) => new URLSearchParams(q);

// ── leerFiltrosInventario ───────────────────────────────────────────────────
const vacios = { area: null, sucursal: null, ubicacion: null, criticidad: null, categoria: null, tipo: null, clase: null, centro: null, registro: null, q: null };
es(F.leerFiltrosInventario(p(''), { estadoPorDefecto: 'vigentes' }), { ...vacios, estado: 'vigentes' }, 'por defecto vigentes (lista)');
es(F.leerFiltrosInventario(p(''), { estadoPorDefecto: 'todos' }), { ...vacios, estado: 'todos' }, 'por defecto todos (descarga)');
es(F.leerFiltrosInventario(p('area=biomedico&estado=baja&clase=III&centro=4&registro=vencido&sucursal=2&ubicacion=9&criticidad=alta&categoria=Desfibriladores&tipo=biomedico&q=sn%20123'), { estadoPorDefecto: 'vigentes' }),
  { area: 'biomedico', estado: 'baja', clase: 'III', centro: 4, registro: 'vencido', sucursal: 2, ubicacion: 9, criticidad: 'alta', categoria: 'Desfibriladores', tipo: 'biomedico', q: 'sn 123' },
  'todos los filtros');
es(F.leerFiltrosInventario(p('area=otra&estado=roto&clase=IV&centro=-1&registro=x&sucursal=abc&criticidad=urgente&tipo=x'), { estadoPorDefecto: 'vigentes' }),
  { ...vacios, estado: 'vigentes' }, 'valores desconocidos: como si no vinieran');
es(F.leerFiltrosInventario(p('clase=sin&centro=sin'), { estadoPorDefecto: 'todos' }).clase, 'sin', 'clase=sin');
es(F.leerFiltrosInventario(p('clase=sin&centro=sin'), { estadoPorDefecto: 'todos' }).centro, 'sin', 'centro=sin');
es(F.leerFiltrosInventario(p('estado=todos'), { estadoPorDefecto: 'vigentes' }).estado, 'todos', 'estado=todos explícito');

// ── filtrosAQuery: ida y vuelta ─────────────────────────────────────────────
const ida = F.leerFiltrosInventario(p('q=monitor&area=biomedico&clase=sin&centro=3&registro=sin_registro&sucursal=1'), { estadoPorDefecto: 'vigentes' });
const query = F.filtrosAQuery(ida);
es(query, 'area=biomedico&estado=vigentes&clase=sin&centro=3&registro=sin_registro&sucursal=1&q=monitor', 'sin «?», con estado y sin vacíos');
es(F.leerFiltrosInventario(p(query), { estadoPorDefecto: 'todos' }), ida, 'ida y vuelta');
es(F.filtrosAQuery(F.leerFiltrosInventario(p(''), { estadoPorDefecto: 'todos' })), 'estado=todos', 'siempre incluye el estado');

// ── pasaFiltros ─────────────────────────────────────────────────────────────
const hoy = '2026-11-12';
const fila = (a, extra = {}) => F.aFilaInventario({
  a: { id: 1, codigo: 'BIO-1', nombre: 'MONITOR', tipo: 'biomedico', rubro: 'biomedico', estado: 'operativo', claseRiesgo: 'III', centroCostoId: 5,
    serial: 'SN-123', numeroActivo: 'AF-77', registroSanitario: 'DNM-1', registroSanitarioVencimiento: '2026-11-11', criticidadOperacional: 'alta', ...a },
  ub: { id: 9, nombre: 'UCI' }, suc: { id: 2, nombre: 'Sede Norte' }, cc: { id: 5, codigo: 'CC-05', nombre: 'Intensivos' }, ...extra,
});
const filtros = (q, defecto = 'vigentes') => F.leerFiltrosInventario(p(q), { estadoPorDefecto: defecto });
const pasa = (f, q, defecto) => F.pasaFiltros(f, filtros(q, defecto), hoy);
const viva = fila({});
const baja = fila({ estado: 'baja' });
es([pasa(viva, ''), pasa(baja, '')], [true, false], 'vigentes deja fuera la baja');
es([pasa(viva, 'estado=baja'), pasa(baja, 'estado=baja')], [false, true], 'solo las bajas');
es([pasa(viva, '', 'todos'), pasa(baja, '', 'todos')], [true, true], 'todos');
es(pasa(viva, 'estado=averiado'), false, 'otro estado');
const sinClase = fila({ claseRiesgo: null });
const generalSinClase = fila({ claseRiesgo: null, tipo: 'general', rubro: 'equipo_general' });
es([pasa(sinClase, 'clase=sin'), pasa(viva, 'clase=sin'), pasa(generalSinClase, 'clase=sin')], [true, false, false], 'clase=sin = biomédico sin clase');
es([pasa(viva, 'clase=III'), pasa(viva, 'clase=I')], [true, false], 'clase exacta');
const sinCentro = fila({ centroCostoId: null }, { cc: null });
es([pasa(sinCentro, 'centro=sin'), pasa(viva, 'centro=sin'), pasa(viva, 'centro=5'), pasa(viva, 'centro=6')], [true, false, true, false], 'centro');
es(pasa(viva, 'registro=vencido'), true, 'registro vencido (venció ayer)');
es(pasa(fila({ registroSanitarioVencimiento: '2026-11-12' }), 'registro=por_vencer'), true, 'vence hoy: por vencer');
es(pasa(fila({ registroSanitario: null }), 'registro=sin_registro'), true, 'sin registro');
es(pasa(fila({ registroSanitarioNoRequiere: 1 }), 'registro=no_requiere'), true, 'no requiere');
es(pasa(fila({ tipo: 'general', rubro: 'equipo_general', registroSanitario: null }), 'registro=sin_registro'), false, 'el registro solo filtra biomédicos');
es([pasa(viva, 'q=sn 123'), pasa(viva, 'q=SN-123'), pasa(viva, 'q=af-77'), pasa(viva, 'q=intensivos'), pasa(viva, 'q=sede norte'), pasa(viva, 'q=bomba')],
  [false, true, true, true, true, false], 'q busca serie, número de activo, centro y sede');
es(pasa(fila({ nombre: 'MÓDULO DE CÁMARA' }), 'q=modulo de camara'), true, 'q sin tildes');
es([pasa(viva, 'area=biomedico'), pasa(viva, 'area=aires')], [true, false], 'área');
es(pasa(fila({ rubro: null, tipo: 'biomedico' }), 'area=biomedico'), true, 'área de un registro sin clasificar (por tipo)');
es([pasa(viva, 'sucursal=2'), pasa(viva, 'sucursal=3'), pasa(viva, 'ubicacion=9'), pasa(viva, 'ubicacion=8')], [true, false, true, false], 'sede y ubicación');
es([pasa(viva, 'criticidad=alta'), pasa(viva, 'criticidad=baja')], [true, false], 'criticidad');
es(pasa(fila({ categoria: 'Monitores de signos vitales' }), 'categoria=Monitores de signos vitales'), true, 'categoría normalizada');

// ── textoBusqueda y describirFiltros ────────────────────────────────────────
es(F.textoBusqueda(viva), 'bio-1 monitor sn-123 af-77 sede norte uci cc-05 intensivos', 'texto de búsqueda');
es(F.describirFiltros(filtros('clase=III&centro=5&sucursal=2'), { centro: 'CC-05', sucursal: 'Sede Central' }), 'Vigentes (sin bajas) · Clase III · Centro CC-05 · Sede Sede Central', 'describir filtros');
es(F.describirFiltros(filtros('estado=baja&clase=sin&centro=sin&registro=vencido&q=x')), 'Dados de baja · Sin clase de riesgo · Sin centro de costo · Registro sanitario: vencido · Búsqueda «x»', 'describir sin valores');
es(F.describirFiltros(filtros('', 'todos')), 'Todos', 'describir todos');

// ── Ronda 2 · A4: inventario desglosado por centro de costo (requisito 1) ──────
es([F.leerAgrupacion(p('agrupar=centro')), F.leerAgrupacion(p('')), F.leerAgrupacion(p('agrupar=sede'))], ['centro', null, null], 'solo agrupar=centro agrupa');
const enCentro = (codigo, centroCostoId, cc = null) => ({ codigo, fila: F.aFilaInventario({
  a: { id: 1, codigo, nombre: 'X', tipo: 'biomedico', rubro: 'biomedico', estado: 'operativo', centroCostoId }, cc,
}) });
const cc = (id, codigo, nombre) => ({ id, codigo, nombre });
const porCentro = F.agruparPorCentro([
  enCentro('A-1', null), enCentro('A-2', 10, cc(10, 'CC-10', 'PEDIATRÍA')), enCentro('A-3', 2, cc(2, 'CC-2', 'UCI')),
  enCentro('A-4', 10, cc(10, 'CC-10', 'PEDIATRÍA')), enCentro('A-5', null), enCentro('A-6', 1, cc(1, 'CC-1', 'EMERGENCIA')),
]);
es(porCentro.map((g) => [g.centroId, g.etiqueta, g.filas.map((x) => x.codigo)]), [
  [1, 'CC-1 · EMERGENCIA', ['A-6']], [2, 'CC-2 · UCI', ['A-3']], [10, 'CC-10 · PEDIATRÍA', ['A-2', 'A-4']], [null, 'Sin centro de costo', ['A-1', 'A-5']],
], 'por código del centro (CC-2 antes que CC-10), «Sin centro de costo» al final y el orden de llegada en cada grupo');
es(porCentro.reduce((s, g) => s + g.filas.length, 0), 6, 'los subtotales suman el total');
es(F.agruparPorCentro([]), [], 'sin equipos, sin grupos');
es(F.agruparPorCentro([enCentro('A-1', null)]).map((g) => [g.etiqueta, g.filas.length]), [['Sin centro de costo', 1]], 'todos sin centro');

// ── Código y serie (registro-activos.ts) ────────────────────────────────────
es(R.errorCodigoActivo('BIO-001'), null, 'código válido');
es(R.errorCodigoActivo('X'.repeat(60)), null, '60 caracteres');
es(R.errorCodigoActivo('X'.repeat(61)), 'El código no puede tener más de 60 caracteres.', 'más de 60');
es(R.errorCodigoActivo('BIO\t001'), 'El código no puede tener tabuladores ni saltos de línea.', 'tabulador');
es(R.errorCodigoActivo('BIO\n001'), 'El código no puede tener tabuladores ni saltos de línea.', 'salto de línea');
es(R.mensajeCodigoDuplicado('BIO-1'), 'El código «BIO-1» ya está en uso en otro equipo.', 'mensaje de duplicado');
es(R.normalizarSerie(' sn-123 '), 'SN123', 'serie normalizada');
es(R.normalizarSerie('Ñandú-9á'), 'NANDU9A', 'sin acentos');
for (const s of ['', null, 'AB', '000', 'xxxx', 'S/N', 'N/A', 'sin serie', 'Sin número', 'no tiene', 'ilegible', 'PENDIENTE', 'desconocido', '0-0-0']) {
  es(R.normalizarSerie(s), null, `«${s}» no sirve para comparar`);
}

// ════ Pantallas: los scripts del navegador, con jsdom y sin servidor ════════════
// Cada prueba toma el <script> real de la página .astro, lo arma como el navegador y lo
// corre sobre un HTML mínimo con los mismos id. fetch, confirm y alert son simulados:
// así se prueba qué manda la pantalla y qué le muestra a la persona.
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');
const rechazos = [];
process.on('unhandledRejection', (e) => { rechazos.push(e); });
const esperar = async (veces = 10) => { for (let i = 0; i < veces; i++) await new Promise((r) => setTimeout(r, 0)); };
const respuesta = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** El script de una página: el de módulo (con import) o, con vars, el de define:vars. */
async function scriptDe(pagina, vars) {
  const fuente = await fs.readFile(pagina, 'utf8');
  const bloques = [...fuente.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => ({ attrs: m[1] ?? '', codigo: m[2] }));
  if (vars) {
    const b = bloques.find((x) => x.attrs.includes('define:vars'));
    return `(() => { const __encodedScriptVars = ${JSON.stringify(encodeURIComponent(JSON.stringify(vars)))};\n${b.codigo}\n})();`;
  }
  const b = bloques.find((x) => !x.attrs.includes('define:vars'));
  const out = await build({ stdin: { contents: b.codigo, resolveDir: process.cwd(), sourcefile: pagina, loader: 'ts' }, bundle: true,
    format: 'iife', platform: 'browser', write: false, logLevel: 'silent' });
  return out.outputFiles[0].text;
}

function montar(html, codigo, { fetch: pedir, confirm = () => true } = {}) {
  const errores = [];
  const consola = new VirtualConsole();
  consola.on('jsdomError', (e) => { if (!/Not implemented/i.test(e.message)) errores.push(e.message); });
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'https://test.invalid/', runScripts: 'outside-only', virtualConsole: consola });
  const w = dom.window;
  const alertas = [];
  const avisos = [];
  Object.assign(w, { fetch: pedir, confirm, alert: (m) => alertas.push(String(m)), showToast: (m, tono) => avisos.push([String(m), tono]), TextDecoder });
  w.eval(codigo);
  return { w, $: (id) => w.document.getElementById(id), errores, alertas, avisos };
}
const evento = (p, el, tipo) => el.dispatchEvent(new p.w.Event(tipo, { cancelable: true, bubbles: true }));

// ── Carga masiva: todas las tandas van con la opción simulada. Antes, cambiarla mientras
//    se grababa mandaba el resto del archivo en «Actualizar» (filas que nadie simuló). ──
{
  const html = `
    <input type="radio" name="modo" value="crear" checked><input type="radio" name="modo" value="actualizar">
    <input id="file" type="file" data-area="biomedico" data-tanda="200" data-inventario="/activos?area=biomedico">
    <p id="archivoInfo" class="hidden"></p><button id="simBtn" type="button" disabled></button><button id="goBtn" type="button" disabled></button>
    <p id="msg" class="hidden"></p><a id="verInventario" class="hidden" href="/activos"></a>
    <section id="resultado" class="hidden"><h2 id="resTitulo"></h2>
      <select id="resFiltro"><option value="problemas" selected></option><option value="todas"></option></select>
      <button id="resCsv" type="button"></button><div id="chips"></div><ul id="notas" class="hidden"></ul><p id="ignoradas" class="hidden"></p>
      <table><tbody id="resBody"></tbody></table><p id="resVacio" class="hidden"></p></section>`;
  const cuerpos = [];
  let soltar = null;
  let primera = true;
  const pedir = async (_url, init) => {
    const c = JSON.parse(init.body);
    cuerpos.push(c);
    if (!c.dryRun && primera) { primera = false; await new Promise((r) => { soltar = r; }); }
    const filas = c.dryRun ? 450 : c.hasta - c.desde;
    return respuesta(200, { filas: 450, aInsertar: filas, aActualizar: 0, sinCambios: 0, insertados: c.dryRun ? 0 : filas, actualizados: 0,
      errores: [], avisos: [], resultados: [], columnasIgnoradas: [], notas: [] });
  };
  const p = montar(html, await scriptDe('src/pages/activos/importar.astro'), { fetch: pedir });
  const archivo = (nombre, contenido) => {
    const b = Buffer.from(contenido);
    return { name: nombre, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  };
  const elegir = async (f) => {
    Object.defineProperty(p.$('file'), 'files', { configurable: true, get: () => [f] });
    evento(p, p.$('file'), 'change');
    await esperar();
  };
  await elegir(archivo('inventario.csv', 'codigo,nombre,clase_riesgo\n' + Array.from({ length: 450 }, (_, i) => `C-${i},EQUIPO ${i},I`).join('\n')));
  es(p.$('archivoInfo').textContent, 'Archivo «inventario.csv»: 450 filas.', 'cuenta las filas del archivo');
  p.$('simBtn').click(); await esperar();
  es([cuerpos.length, cuerpos[0].modo, cuerpos[0].dryRun, p.$('goBtn').textContent], [1, 'crear', true, 'Grabar 450 filas'], 'simula en «Agregar»');
  p.$('goBtn').click(); await esperar();
  const radios = [...p.w.document.querySelectorAll('input[name="modo"]')];
  es(radios.map((r) => r.disabled), [true, true], 'la opción queda bloqueada mientras graba');
  radios[1].checked = true; evento(p, radios[1], 'change'); // aun así, alguien la cambia
  soltar(); await esperar(40);
  es(cuerpos.filter((c) => !c.dryRun).map((c) => [c.modo, c.desde, c.hasta]), [['crear', 0, 200], ['crear', 200, 400], ['crear', 400, 450]],
    'todas las tandas van con la opción que se simuló');
  es([radios.map((r) => r.disabled), p.$('msg').textContent], [[false, false], 'Listo: 450 creados, 0 actualizados, 0 con error.'], 'al terminar se puede elegir otra vez');

  // Si se cambia la opción mientras se simula, «Grabar» no queda habilitado con la otra.
  radios[0].checked = true; evento(p, radios[0], 'change');
  primera = false; soltar = null;
  const pedirLento = pedir;
  p.w.fetch = async (url, init) => { const c = JSON.parse(init.body); if (c.dryRun) await new Promise((r) => { soltar = r; }); return pedirLento(url, init); };
  p.$('simBtn').disabled = false; p.$('simBtn').click(); await esperar();
  radios[1].checked = true; evento(p, radios[1], 'change'); // pasa a «Actualizar» con la simulación en curso
  soltar(); await esperar();
  es([cuerpos.at(-1).modo, p.$('goBtn').disabled, p.$('goBtn').textContent], ['crear', true, 'Grabar'], 'una simulación en «Agregar» no habilita grabar en «Actualizar»');
  p.w.fetch = pedir;

  // Un Excel o un archivo enorme se avisa al elegirlo y no se manda (antes: «Falta la columna «codigo»»).
  const enviados = cuerpos.length;
  await elegir({ name: 'inventario.xlsx', arrayBuffer: async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 6, 0]).buffer });
  n++; assert.match(p.$('msg').textContent, /^«inventario\.xlsx» es un archivo de Excel, no un CSV\. En Excel usa «Guardar como»/);
  es([p.$('simBtn').disabled, p.$('goBtn').disabled, cuerpos.length], [true, true, enviados], 'un Excel no se simula');
  await elegir({ name: 'viejo.xls', arrayBuffer: async () => new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).buffer });
  n++; assert.match(p.$('msg').textContent, /^«viejo\.xls» es un archivo de Excel/);
  await elegir(archivo('enorme.csv', 'codigo\n' + 'x'.repeat(5_000_001)));
  n++; assert.match(p.$('msg').textContent, /^«enorme\.csv» es demasiado grande para una sola carga/);
  es(p.$('simBtn').disabled, true, 'uno demasiado grande tampoco');
  es(p.errores, [], 'carga masiva sin errores del script');
}

// ── Editar: guardar otro dato no borra la ubicación del equipo, y no se guarda dos veces ──
{
  const html = `
    <form id="form">
      <select id="rubro"><option value="biomedico" selected>Equipos biomédicos</option><option value="equipo_general">Equipos generales</option></select>
      <input type="hidden" id="tipo" value="biomedico">
      <div id="aireFields" class="hidden"><input id="tipoUnidad"></div><div id="infraFields" class="hidden"><input id="sector"></div>
      <div id="servicioFields"><input id="servicio"></div><div id="tecnologiaFields" class="hidden"><input id="nombreRed"></div>
      <input id="categoria"><datalist id="categoriasList"></datalist>
      <input id="codigo" value="BIO-1" data-original="BIO-1"><input id="nombre" value="MONITOR">
      <select id="sucursalSel"><option value="">—</option><option value="1" selected>Sede Central</option><option value="2">Sede Norte</option></select>
      <select id="ubicacionSel"><option value="">—</option></select>
      <select id="centroCostoSel"><option value="">—</option></select>
      <select id="estado"><option value="operativo" selected>Operativo</option></select>
      <div id="bioFields">
        <select id="claseRiesgo"><option value="IIa" selected>Clase IIa</option></select>
        <select id="subcategoria"><option value="">—</option></select>
        <input type="checkbox" id="registroNoRequiere">
        <div class="registro-campo"><select id="registroEntidad"><option value="">—</option></select></div>
        <div class="registro-campo hidden" id="registroEntidadOtraBox"><input id="registroEntidadOtra"></div>
        <div class="registro-campo"><input id="registroSanitario"><input id="registroEmision"><input id="registroVencimiento"></div>
      </div>
      <select id="criticidadOperacional"><option value="media" selected>Media</option></select><p id="critDesc"></p>
      <input id="serial"><p id="serieAviso" class="hidden"></p><input type="checkbox" id="requiereCalibracion">
      <p id="err" class="hidden"></p><button id="saveBtn" type="submit">Guardar cambios</button>
    </form>`;
  const editar = (ubicaciones) => scriptDe('src/pages/activos/[id]/editar.astro', { id: 7, ubJson: JSON.stringify(ubicaciones), sucursalActualId: 1,
    ubicacionActualId: 10, categoriasPorArea: {}, critDescJson: {}, gestiona: true, deBaja: false, esPatron: false });
  const pedidos = [];
  let responder = async () => respuesta(200, { activo: { id: 7 } });
  const pedir = async (url, init) => { pedidos.push(JSON.parse(init.body)); return responder(); };
  const guardar = async (p) => { evento(p, p.$('form'), 'submit'); await esperar(); };
  const desactivada = { id: 10, nombre: 'BODEGA VIEJA', tipo: 'area', sucursalId: 1, activa: false };
  const uci = { id: 11, nombre: 'UCI', tipo: 'area', sucursalId: 1, activa: true };

  // La ubicación del equipo está desactivada y no viene en la lista (así la mandaba el servidor).
  let p = montar(html, await editar([uci]), { fetch: pedir });
  await guardar(p);
  es(pedidos.at(-1).ubicacionId, 10, 'guardar la clase u otro dato no borra la ubicación');
  // Ahora el servidor la manda marcada: se ve elegida.
  p = montar(html, await editar([desactivada, uci]), { fetch: pedir });
  es([p.$('ubicacionSel').value, p.$('ubicacionSel').selectedOptions[0].textContent], ['10', 'BODEGA VIEJA (area) · desactivada'], 'la ubicación actual se ve aunque esté desactivada');
  p.$('ubicacionSel').value = '11'; evento(p, p.$('ubicacionSel'), 'change');
  await guardar(p);
  es(pedidos.at(-1).ubicacionId, 11, 'si la cambia, se guarda la nueva');
  p.$('sucursalSel').value = '2'; evento(p, p.$('sucursalSel'), 'change');
  await guardar(p);
  es(pedidos.at(-1).ubicacionId, null, 'si cambia de sede y no elige ubicación, queda sin ubicación');

  // Doble clic: un solo PATCH. Sin conexión: aviso, lo escrito sigue y se puede reintentar.
  p = montar(html, await editar([uci]), { fetch: pedir });
  let soltar;
  responder = () => new Promise((r) => { soltar = () => r(respuesta(200, { activo: { id: 7 } })); });
  const antes = pedidos.length;
  evento(p, p.$('form'), 'submit'); evento(p, p.$('form'), 'submit');
  await esperar();
  es([pedidos.length - antes, p.$('saveBtn').disabled], [1, true], 'doble clic: un solo guardado');
  soltar(); await esperar();
  responder = async () => { throw new TypeError('Failed to fetch'); };
  p.$('nombre').value = 'MONITOR MULTIPARÁMETRO';
  await guardar(p);
  es([p.$('err').textContent, p.$('err').classList.contains('hidden'), p.$('saveBtn').disabled, p.$('nombre').value],
    ['Sin conexión: los cambios no se guardaron. Revisa la conexión y vuelve a guardar.', false, false, 'MONITOR MULTIPARÁMETRO'], 'sin conexión: aviso y reintento');
  es(p.errores, [], 'editar sin errores del script');
}

// ── Centros de costo: un doble clic no da de alta dos veces; sin conexión, aviso ──
{
  const html = `
    <div id="form"><h2 id="formTitle"></h2><input id="f_id" value=""><input id="f_codigo"><input id="f_nombre">
      <select id="f_sede"><option value="">Todas las sedes</option></select>
      <label id="f_activoBox" class="hidden"><input type="checkbox" id="f_activo"></label>
      <p id="formErr" class="hidden"></p><button id="saveBtn" type="button"></button><button id="cancelBtn" type="button"></button></div>
    <div id="lista" class="hidden"><textarea id="l_texto"></textarea><p id="listaMsg" class="hidden"></p><ul id="listaRes"></ul>
      <button id="listaGuardar" type="button"></button><button id="listaCerrar" type="button"></button></div>
    <button id="listaBtn" type="button"></button><button id="newBtn" type="button"></button>`;
  const pedidos = [];
  let soltar;
  let responder = () => new Promise((r) => { soltar = r; });
  const p = montar(html, await scriptDe('src/pages/centros-costo.astro'), { fetch: async (url) => { pedidos.push(url); return responder(); } });
  p.$('f_codigo').value = 'CC-01'; p.$('f_nombre').value = 'UCI ADULTOS';
  p.$('saveBtn').click(); p.$('saveBtn').click(); await esperar();
  es(pedidos, ['/api/centros-costo'], 'doble clic: una sola alta');
  soltar(respuesta(409, { error: 'El código «CC-01» ya existe.' })); await esperar();
  es([p.$('formErr').textContent, p.$('saveBtn').disabled], ['El código «CC-01» ya existe.', false], 'muestra el error del servidor y deja reintentar');
  responder = async () => { throw new TypeError('Failed to fetch'); };
  p.$('saveBtn').click(); await esperar();
  const SIN = 'Sin conexión: no se guardó. Revisa la conexión y vuelve a intentarlo.';
  es([p.$('formErr').textContent, p.$('saveBtn').disabled], [SIN, false], 'sin conexión al guardar');
  p.$('l_texto').value = 'CC-02,EMERGENCIA'; p.$('listaGuardar').click(); await esperar();
  es([p.$('listaMsg').textContent, p.$('listaGuardar').disabled], [SIN, false], 'sin conexión al pegar la lista');
  es(p.errores, [], 'centros sin errores del script');
}

// ── Lista: «+ Programar» sin conexión avisa y deja reintentar (antes quedaba trabado) ──
{
  const html = `
    <button type="button" class="prog-btn" data-activo-id="5" data-activo-label="BIO-5 · MONITOR" data-activo-lugar="">+ Programar</button>
    <div id="programarModal" class="hidden"><p id="progSubtitle"></p><p id="progLugar"></p><input id="progFecha" type="date">
      <select id="progFreq"><option value="mensual">Mensual</option></select><p id="progMsg" class="hidden"></p>
      <button id="progCancel" type="button"></button><button id="progSave" type="button"></button></div>`;
  const p = montar(html, await scriptDe('src/pages/activos/index.astro'), { fetch: async () => { throw new TypeError('Failed to fetch'); } });
  p.w.document.querySelector('.prog-btn').click();
  n++; assert.match(p.$('progFecha').value, /^\d{4}-\d{2}-\d{2}$/);
  p.$('progSave').click(); await esperar();
  es([p.$('progMsg').textContent, p.$('progSave').disabled], ['Sin conexión: el plan no se guardó. Vuelve a intentarlo.', false], 'sin conexión al programar');
  es(p.errores, [], 'lista sin errores del script');
}

// ── Clasificar: la clase de riesgo se guarda y se cuenta; sin conexión, el selector
//    vuelve a lo que tenía y avisa (antes quedaba deshabilitado y con un error sin atender) ──
{
  const html = `
    <span id="sinClaseBadge" class="badge"><span id="cSinClase">1</span> biomédicos sin clase de riesgo</span>
    <span id="completaBadge" class="badge hidden" data-otros-pendientes="0">✓ Clasificación completa</span>
    <span id="famOkBadge"></span><span id="cDecl"></span><span id="cInf"></span><span id="cSin"></span>
    <input id="buscar"><select id="fSede"><option value=""></option></select><select id="fFamilia"><option value=""></option></select>
    <select id="fDominio"><option value=""></option></select><select id="fCrit"><option value=""></option></select>
    <select id="fClase"><option value=""></option><option value="__sin__"></option><option value="III"></option></select>
    <button id="marcarVisible" type="button"></button><button id="aceptarSug" type="button"></button><input type="checkbox" id="selAll">
    <div id="bulkBar" class="hidden"><span id="bulkCount"></span><select id="bulkSistema"><option value=""></option></select>
      <button id="bulkAsignar" type="button"><span id="bulkCount2"></span></button><div id="bulkNota"></div></div>
    <span id="visibles"></span>
    <table><tbody>
      <tr class="fila" data-search="bio-1 monitor" data-sede="" data-dominio="biomedico" data-crit="media" data-clase="__sin__"
        data-fam="" data-fam-res="otro" data-fam-estado="sinresolver">
        <td><input type="checkbox" class="row-chk" data-id="1"></td>
        <td><select class="fam-sel" data-id="1" data-sugerido="otro"><option value=""></option><option value="electrico">Eléctrico</option></select>
          <span class="fam-nota"></span><button type="button" class="fam-ok hidden"></button></td>
        <td><select class="dominio-sel" data-id="1"><option value="biomedico" selected>Bio</option><option value="equipo_general">General</option><option value="aires">Aires</option></select></td>
        <td><select class="subcat-sel" data-id="1"><option value="">—</option><option value="diagnostico">Diagnóstico</option></select></td>
        <td><select class="clase-sel" data-id="1"><option value="" disabled selected>— Elegir —</option><option value="I">Clase I</option><option value="III">Clase III</option></select></td>
        <td><select class="crit-sel" data-id="1"><option value="media" selected>Media</option></select></td>
      </tr>
    </tbody></table>`;
  const pedidos = [];
  let responder = async () => respuesta(200, { activo: { id: 1 } });
  const p = montar(html, await scriptDe('src/pages/activos/clasificar.astro'), { fetch: async (url, init) => { pedidos.push([url, JSON.parse(init.body)]); return responder(); } });
  const fila = p.w.document.querySelector('.fila');
  const elegir = async (sel, valor) => { sel.value = valor; evento(p, sel, 'change'); await esperar(); };
  await elegir(fila.querySelector('.clase-sel'), 'III');
  es([pedidos.at(-1), fila.dataset.clase, p.$('cSinClase').textContent, p.$('sinClaseBadge').classList.contains('hidden'), p.$('completaBadge').classList.contains('hidden')],
    [['/api/activos/1', { claseRiesgo: 'III' }], 'III', '0', true, false], 'la clase se guarda y el aviso baja a 0');
  await elegir(fila.querySelector('.dominio-sel'), 'equipo_general');
  es(pedidos.slice(-2).map((x) => x[1]), [{ rubro: 'equipo_general' }, { claseRiesgo: null }], 'al dejar de ser biomédico se limpia la clase');
  es([fila.querySelector('.clase-sel').disabled, fila.dataset.clase], [true, ''], 'la clase queda deshabilitada');

  // Ronda 2 · A2: el servidor responde 400 a un biomédico sin clase. Pasar a biomédicos pide la
  // clase en la fila y manda área y clase en un solo guardado (antes mandaba {rubro} solo).
  const dominio = fila.querySelector('.dominio-sel');
  const clase = fila.querySelector('.clase-sel');
  const enviados = pedidos.length;
  await elegir(dominio, 'biomedico');
  es([pedidos.length - enviados, dominio.value, clase.disabled, fila.dataset.areaPendiente, p.avisos.at(-1)?.[1]], [0, 'biomedico', false, 'biomedico', 'warning'],
    'sin clase: no guarda todavía y pide la clase');
  n++; assert.match(fila.querySelector('.area-nota')?.textContent ?? '', /^Falta la clase de riesgo/);
  await elegir(dominio, 'equipo_general');
  es([pedidos.length - enviados, clase.disabled, fila.dataset.areaPendiente, fila.querySelector('.area-nota')], [0, true, undefined, null], 'volver al área guardada: nada que mandar');
  responder = async () => { throw new TypeError('Failed to fetch'); };
  await elegir(dominio, 'biomedico');
  await elegir(clase, 'I');
  es(pedidos.at(-1), ['/api/activos/1', { rubro: 'biomedico', claseRiesgo: 'I' }], 'área y clase en un solo guardado');
  es([dominio.value, dominio.disabled, clase.value, clase.disabled, fila.dataset.areaPendiente, p.avisos.at(-1)],
    ['equipo_general', false, '', true, undefined, ['Sin conexión: no se guardó. Vuelve a intentarlo.', 'error']], 'sin conexión: vuelve a lo guardado y avisa');
  responder = async () => respuesta(200, { activo: { id: 1 } });
  await elegir(dominio, 'biomedico');
  await elegir(clase, 'III');
  es(pedidos.at(-1)[1], { rubro: 'biomedico', claseRiesgo: 'III' }, 'con conexión: área y clase juntas');
  es([fila.dataset.dominio, fila.dataset.clase, clase.disabled, fila.querySelector('.subcat-sel').disabled, fila.dataset.areaPendiente, fila.querySelector('.area-nota'), p.$('cSinClase').textContent],
    ['biomedico', 'III', false, false, undefined, null, '0'], 'la fila queda biomédica con su clase');
  await elegir(clase, 'I');
  es(pedidos.at(-1)[1], { claseRiesgo: 'I' }, 'después, la clase sola');
  await elegir(dominio, 'equipo_general');
  responder = async () => { throw new TypeError('Failed to fetch'); };
  await elegir(dominio, 'aires');
  es([dominio.value, dominio.disabled, p.avisos.at(-1)], ['equipo_general', false, ['Sin conexión: no se guardó. Vuelve a intentarlo.', 'error']], 'otra área sin conexión: vuelve a lo guardado y avisa');
  const familia = fila.querySelector('.fam-sel');
  await elegir(familia, 'electrico');
  es([familia.value, familia.disabled, p.avisos.at(-1)], ['', false, ['Sin conexión: no se guardó. Vuelve a intentarlo.', 'error']], 'la familia tampoco queda trabada');
  es(p.errores, [], 'clasificar sin errores del script');
}

es(rechazos.map(String), [], 'ningún error sin atender en los scripts de las pantallas');
console.log(`PASS test-bio-inventario: ${n} casos`);
