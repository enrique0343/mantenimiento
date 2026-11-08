// Recorrido real de la pantalla del técnico (src/campo/app.ts en jsdom) contra las rutas
// reales y SQLite, con un reloj fijo: la emergencia completa sin señal y luego con señal,
// con sus horas guardadas en el servidor y ninguna a la vista; la intervención con su
// permiso, una lectura fuera de rango, la reversa y el envío; lo escrito en una hoja y la
// foto ya tomada sobreviven a recargar la página; lo que el servidor aceptó no reaparece
// como pendiente al recargar sin señal; y ninguna pantalla muestra tiempos de medición.
// Además: la intervención real MOP-MSP-01 (siete permisos largos, uno a la vista; la lectura
// con rango pide su número y «1,200» no se adivina; el cierre resume las lecturas); varias
// emergencias en «Ahora» (la que se atiende, si no la más antigua sin atender, si no la
// pausada; las demás con su línea y su grupo abierto); la emergencia sin documento que abre al
// instante y se pide por detrás, con señal lenta, sin saltos y con su límite de 4 s; «acciones»
// en orden.iniciar; un envío rechazado que devuelve el texto a la orden; la foto de una hoja
// cancelada que no se envía y la de un problema ya anotado que sí; una orden reasignada que
// «Ver por qué» nombra igual; el valor de una desviación que no se adivina; la orden libre que
// pasa a ser del técnico en la copia del día; el cambio de turnos («turnosProximos») sin señal,
// el turno que no se abre («omite») y la sede que deja de hacer ronda («noHaceRondaDesde»).
// Tercera ronda: el orden de «Ahora» con varias emergencias (decisión 9) y sus grupos abiertos; la
// foto que todavía se reduce cuando se anota, se cancela o se envía la orden; un número guardado que
// vuelve al campo sin leerse de dos formas (K7); un paso con rango que pide su número (K8); «Ver por
// qué» con la orden cancelada o ya cerrada; la hoja de la desviación con su documento en su caja; y
// las guardas de la segunda ronda (lo que llega por detrás, «Abriendo la orden…», #ronda sin ronda,
// el valor 0, la liberación «14,5 A»).
// Cuarta ronda: la hora con su artículo («Ronda de la 01:00», «antes de la 01:30», K15); un rango con tres decimales en
// la hoja («máximo 1.1250»); la emergencia de fecha sola, que vence al final del día; la lectura que falta antes de
// enviar (K8), con la frase de siempre; un texto en un paso sin rango; «Sin asignar» abierto con una emergencia; la
// orden en curso que el día ya no trae, que «Ver por qué» ofrece abrir; y «Ahora» lleno, compacto en una pantalla baja.
// Quinta ronda: la marca sin señal de un paso que la jefatura cambió en la ficha no lo pisa (K17), «Ver por qué» lo dice
// y «Abrir la orden» trae el paso del servidor; el paso con «Hay un problema» que recibe su lectura sigue con su problema;
// «Hecho» en una acción con lectura lleva el número; la desviación de otro día dice su fecha; la orden que se canceló
// después de «Ver por qué» ya no se ofrece; el paso con lectura que no aplica no la pide; y «Te la devolvieron» en
// «Ahora» lleno, en un solo párrafo.
// Sexta ronda: el envío en la cola detrás de una marca que no entró porque el paso cambió en la ficha tampoco sale (K19);
// «Ver por qué» ofrece abrirla y la abre en el paso que cambió, como quedó, con lo que el técnico escribió de vuelta en su
// hoja y su campo; un paso ya marcado dice su estado y su nota sin «Anotaste»; dos marcas sin señal en el mismo paso; la
// orden que «Ver por qué» dejó en el celular, renovada o abierta; la desviación de las 20:00 que en UTC ya es mañana; la
// lectura en rango que corrige una desviación con lectura; y la pausa devuelta con su punto.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';
const require = createRequire(process.env.E2E_MODULOS ?? import.meta.url);
const { JSDOM } = require('jsdom');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');

// Reloj único de la prueba, para servidor y celular.
const RealDate = Date; let ahora = 0;
class Reloj extends RealDate { constructor(...a) { if (a.length) super(...a); else super(ahora); } static now() { return ahora; } }
globalThis.Date = Reloj;
const svHoy = new RealDate(RealDate.now() - 6 * 3600000).toISOString().slice(0, 10);
const enSV = (hhmm, dia = svHoy) => RealDate.parse(`${dia}T${hhmm}:00-06:00`);
const iso = (ms) => new RealDate(ms).toISOString();
ahora = enSV('09:00');

const beforeMigration = (db, n) => { if (n.startsWith('0049_fase49')) db.exec("INSERT OR IGNORE INTO usuarios(id,nombre,email,password_hash,rol) VALUES(1000,'Administración','siembra@example.invalid','x','admin')"); };
const f = await setupConjuntos({ beforeMigration, modules: { hoy: 'pages/api/campo/hoy', sync: 'pages/api/campo/sync', ordenes: 'pages/api/campo/ordenes', foto: 'pages/api/campo/foto', equipo: 'pages/api/campo/equipo/[id]', reglas: 'lib/ordenes' } });
const { app, sqlite, ctx, close } = f;
const one = (q, ...a) => sqlite.prepare(q).get(...a), all = (q, ...a) => sqlite.prepare(q).all(...a);
const eop = one("SELECT p.id, p.titulo, f.accion_1 a1, f.accion_2 a2, f.accion_3 a3, f.etiqueta_hora_mitigacion e FROM procedimientos p JOIN eop_ficha f ON f.procedimiento_id=p.id WHERE p.codigo_corto='EOP-ELE-01'");
// Una sede sin ronda: aquí se prueba la orden, no el turno.
sqlite.exec(`
  INSERT INTO sucursales(id,nombre,activa,hace_ronda) VALUES(8,'Sede 8',1,0);
  UPDATE usuarios SET sucursal_id=8 WHERE id=3;
  INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo,activa) VALUES(81,8,'Cuarto de máquinas','area',1),(82,8,'Quirófano 2','area',1),(83,8,'Azotea','area',1);
  INSERT INTO activos(id,codigo,nombre,tipo,rubro,ubicacion_id,estado) VALUES(81,'PE-01','Planta eléctrica de emergencia','general','infraestructura',81,'operativo'),(82,'AC-82','Minisplit quirófano 2','general','aires',82,'operativo'),(83,'CH-83','Chiller del edificio','general','aires',83,'operativo');
`);
const CHECKLIST = JSON.stringify([
  { texto: 'Apagar y bloquear', bloqueante: true, minutos: 5, estado: 'pendiente' },
  { texto: 'Limpiar filtros', minutos: 10, estado: 'pendiente' },
  { texto: 'Medir corriente', minutos: 5, requiereValor: true, unidad: 'A', esperadoMin: 8, esperadoMax: 12, estado: 'pendiente' },
]);
const orden = (id, tipo, titulo, activo, rubro, checklist) => sqlite.prepare('INSERT INTO ordenes(id,creado_por,titulo,rubro,tipo,activo_id,estado,asignado_a,checklist_ejecucion,sucursal_id,ubicacion_id) VALUES(?,1,?,?,?,?,?,3,?,8,?)')
  .run(id, titulo, rubro, tipo, activo, 'abierta', checklist, activo);
orden(501, 'preventivo', '[Preventivo] Trimestral - AC-82', 82, 'aires', CHECKLIST);
orden(601, 'emergencia', '[Emergencia] Falla de energía - PE-01', 81, 'infraestructura', null);
sqlite.prepare("UPDATE ordenes SET procedimiento_id=?, hora_alarma=?, clase_prioridad='P1', prioridad='urgente', descripcion='Se fue la luz y la planta no arrancó' WHERE id=601").run(eop.id, iso(enSV('08:50')));
orden(701, 'intervencion', '[Intervención] Cambio de compresor - CH-83', 83, 'aires', null);
sqlite.prepare("UPDATE ordenes SET plan_reversa='Si el compresor nuevo no arranca, reinstalar el original.' WHERE id=701").run();
sqlite.prepare("INSERT INTO orden_prerrequisitos(orden_id,texto,tipo,obligatorio,orden) VALUES(701,'Permiso de trabajo firmado','permiso_trabajo',1,1),(701,'Aviso a enfermería','notificacion',0,2)").run();
sqlite.prepare("INSERT INTO orden_liberaciones(orden_id,etiqueta,unidad,valor_esperado,min_aceptable,max_aceptable,obligatoria,orden) VALUES(701,'Corriente de arranque','A','8 a 12 A',8,12,1,1),(701,'Fugas en uniones',NULL,'Sin fugas',NULL,NULL,1,2)").run();

const bundle = (await build({ entryPoints: ['src/campo/app.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent' })).outputFiles[0].text;
const HTML = '<!doctype html><html><body data-uid="3" data-nombre="Prueba tecnico" data-rol="tecnico"><section id="movil"><main id="pantalla"></main><nav id="tabs"></nav><div id="hoja" hidden></div><div id="aviso" role="status" hidden></div></section></body></html>';
const idb = new IDBFactory(); // El mismo almacenamiento del celular entre una carga y otra de la página.
let enLinea = true, hoyFalla = false, ordenesPedidas = 0;
const r2 = [];
const enviados = []; // Cada operación que el celular mandó al servidor, tal como salió.
const pedidasDe = {}; // Cuántas veces se pidió cada orden suelta.
let enVuelo = 0; // Pedidos sin respuesta: una página no se recarga a medio enviar.
// Señal lenta: la orden que se pide queda sin respuesta hasta que la prueba la suelta.
const retener = new Set(), retenidas = new Map();
const sinRespuesta = new Set(); // Órdenes cuyo próximo pedido se pierde en el camino.
const soltar = (id) => { retener.delete(id); for (const r of retenidas.get(id) ?? []) r(); retenidas.delete(id); };
let demoraSync = 0; // Con señal lenta, la respuesta del envío llega después que el día.
// Con señal lenta, el día puede llegar después que lo demás: frenarHoy() lo detiene hasta que la prueba lo suelta.
let frenoHoy = null;
const frenarHoy = () => { let suelta; frenoHoy = new Promise((r) => { suelta = r; }); return () => { frenoHoy = null; suelta(); }; };
const sinEop = new Set(); // Emergencias que el paquete del día trae sin su documento.
async function rutaReal(url, init = {}) {
  enVuelo++;
  try { return await atender(url, init); } finally { enVuelo--; }
}
async function atender(url, init) {
  if (!enLinea) throw new TypeError('Failed to fetch');
  const u = new URL(url, 'https://test.invalid');
  if (u.pathname === '/api/campo/hoy') {
    if (frenoHoy) await frenoHoy;
    if (hoyFalla) return new Response('', { status: 503 });
    const res = await app.hoy.GET(ctx(u.pathname + u.search, { rol: 'tecnico' }));
    if (!sinEop.size) return res;
    // Como lo deja el paquete cuando el EOP no alcanza a resolverse: sin código y sin acciones.
    const j = await res.json();
    j.ordenes = j.ordenes.map((o) => (sinEop.has(o.id) ? { ...o, eop: { ...o.eop, codigo: null, titulo: null }, pasos: [] } : o));
    return Response.json(j);
  }
  if (u.pathname === '/api/campo/sync') {
    const data = JSON.parse(init.body);
    enviados.push(...data.ops);
    if (demoraSync) await espera(demoraSync);
    return app.sync.POST(ctx(u.pathname, { method: 'POST', data, rol: 'tecnico' }));
  }
  if (u.pathname === '/api/campo/ordenes') {
    ordenesPedidas++;
    const id = u.searchParams.get('id');
    pedidasDe[id] = (pedidasDe[id] ?? 0) + 1;
    if (sinRespuesta.delete(id)) throw new TypeError('Failed to fetch');
    if (retener.has(id)) await new Promise((r) => retenidas.set(id, [...(retenidas.get(id) ?? []), r]));
    return app.ordenes.GET(ctx(u.pathname + u.search, { rol: 'tecnico' }));
  }
  const equipo = /^\/api\/campo\/equipo\/(\d+)$/.exec(u.pathname);
  if (equipo) return app.equipo.GET(ctx(u.pathname, { id: equipo[1], rol: 'tecnico' }));
  if (u.pathname === '/api/campo/foto') {
    const c = ctx(u.pathname, { method: 'POST', rol: 'tecnico' });
    c.request = new Request(c.url, { method: 'POST', headers: { cookie: c.request.headers.get('cookie') }, body: init.body });
    c.locals.runtime.env.R2 = { async put(key) { r2.push(key); }, async delete() {} };
    return app.foto.POST(c);
  }
  assert.fail('Ruta inesperada: ' + u.pathname);
}
let w, doc;
let altoVentana = 768; // El alto de la pantalla del teléfono: con menos de 700 px, los grupos de Hoy empiezan cerrados.
// Con el teléfono lento, la foto tarda en reducirse: frenarFoto() la detiene hasta que la prueba la suelta.
let frenoFoto = null;
const frenarFoto = () => { let suelta; frenoFoto = new Promise((r) => { suelta = r; }); return () => { frenoFoto = null; suelta(); }; };
/** Cierra la página cuando ya no tiene nada en vuelo: una página cerrada no sigue enviando. */
async function cerrarPagina() {
  if (!w) return;
  for (let i = 0; i < 300 && (enVuelo || /Enviando/.test(pill())); i++) await espera(10);
  await espera(20);
  w.close(); await espera(30);
}
/** Abre (o recarga) la página del técnico con lo que el celular tenga guardado. */
async function abrir(url) {
  await cerrarPagina();
  const dom = new JSDOM(HTML, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  w = dom.window; doc = w.document;
  Object.defineProperty(w.navigator, 'onLine', { get: () => enLinea });
  Object.defineProperty(w, 'innerHeight', { configurable: true, get: () => altoVentana });
  w.indexedDB = idb; w.IDBKeyRange = IDBKeyRange; w.crypto = globalThis.crypto;
  // La foto: el lienzo se simula y los archivos son los de Node, como los guarda un navegador en IndexedDB.
  w.File = File; w.FormData = FormData;
  w.URL.createObjectURL = () => 'blob:foto-de-prueba';
  w.createImageBitmap = async () => { if (frenoFoto) await frenoFoto; return { width: 3000, height: 2000 }; };
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new Blob([new Uint8Array(4096)], { type: 'image/jpeg' })); };
  w.__ahora = () => ahora;
  w.eval('const RD=Date; window.Date=class extends RD{constructor(...a){if(a.length)super(...a);else super(window.__ahora())} static now(){return window.__ahora()}};');
  w.fetch = rutaReal;
  w.eval(bundle);
}
const espera = (ms = 25) => new Promise((r) => setTimeout(r, ms));
const texto = () => doc.querySelector('#pantalla').textContent;
const hoja = () => (doc.querySelector('#hoja').hidden ? '' : doc.querySelector('#hoja').textContent);
const hasta = async (fn, msg) => { for (let i = 0; i < 400; i++) { if (fn()) return; await espera(10); } assert.fail('No llegó: ' + msg + ' · pantalla: ' + texto().slice(0, 300) + ' · hoja: ' + hoja().slice(0, 200)); };
let checks = 0; const ok = (...x) => { assert.ok(...x); checks++; }, igual = (...x) => { assert.equal(...x); checks++; };

// Ningún tiempo de medición a la vista: ni reloj, ni estimados, ni horas de inicio. Sí los plazos y el turno.
const vistas = [];
const PROHIBIDO = /cron[oó]metro|min estimado|h estimado|minutos estimados|tiempo de trabajo|Quién y cuánto|Quién y cuándo|Tiempo registrado|En pausa desde|≈/i;
// Con su artículo: «Ronda de la 01:00», «antes de la 01:30». En un reloj de la hoja, la etiqueta y la hora van juntas.
const PLAZOS = [/[Rr]onda de las? \d{2}:\d{2}/g, /turno (de las? )?\d{2}:\d{2}/g, /antes de ?(las? )?\d{2}:\d{2}/g, /Venc(e|ió) (hoy|\d{2}\/\d{2}\/\d{4}) \d{2}:\d{2}/g];
const anotar = (donde) => vistas.push({ donde, t: `${texto()} | ${hoja()} | ${doc.querySelector('#aviso').hidden ? '' : doc.querySelector('#aviso').textContent}`, fichas: [...doc.querySelectorAll('#movil a[href^="/ordenes/"]')].map((a) => a.getAttribute('href')) });
const clic = async (accion, extra = '') => {
  const b = doc.querySelector(`#movil [data-a="${accion}"]${extra}`);
  assert.ok(b, `No hay botón ${accion}${extra}: ${texto().slice(0, 200)} | ${hoja().slice(0, 200)}`);
  b.click();
  await espera();
  anotar(accion);
};
const escribir = (sel, valor) => { const el = doc.querySelector(sel); assert.ok(el, 'No hay campo ' + sel); el.value = valor; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
const tomarFoto = (sel) => {
  const input = doc.querySelector(sel);
  assert.ok(input, 'No hay campo de foto ' + sel);
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([new Uint8Array(60000)], 'IMG_0001.jpg', { type: 'image/jpeg' })] });
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
};
const fotoEn = async (sel) => {
  tomarFoto(sel);
  await hasta(() => /1 foto lista/.test(texto() + hoja()), 'la foto queda lista');
};
const horaSV = (ms) => iso(ms - 6 * 3600000).slice(11, 16);
/** Cambia lo que el celular tiene guardado, como si lo hubiera dejado la versión anterior. */
const cambiarGuardado = async (clave, cambiar) => {
  const db = await new Promise((res, rej) => { const r = idb.open('avante-campo', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const valor = await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(clave); q.onsuccess = () => res(q.result); });
  await new Promise((res) => { const q = db.transaction('kv', 'readwrite').objectStore('kv').put(cambiar(valor), clave); q.onsuccess = res; });
  db.close();
};
/** Lo que el celular tiene guardado, sin pasar por la página. */
const leerGuardado = async (clave) => {
  const db = await new Promise((res, rej) => { const r = idb.open('avante-campo', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const valor = await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(clave); q.onsuccess = () => res(q.result); });
  db.close();
  return valor;
};
const pill = () => doc.querySelector('#senal')?.textContent ?? '';
/** Lo que el celular tiene guardado para enviar, sin pasar por la página. */
const enCola = async () => {
  const db = await new Promise((res, rej) => { const r = idb.open('avante-campo', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const ops = await new Promise((res) => { const q = db.transaction('ops').objectStore('ops').getAll(); q.onsuccess = () => res(q.result); });
  db.close();
  return ops;
};

try {
  // ══ Con señal: Hoy pone la emergencia primero, y empieza un preventivo ══
  await abrir('https://test.invalid/campo');
  await hasta(() => /Atender la emergencia/.test(texto()), 'la emergencia va primero');
  anotar('hoy');
  ok(texto().includes(eop.titulo) && /EOP-ELE-01 · Cuarto de máquinas/.test(texto()), 'La emergencia se ve por su documento y su lugar: ' + texto().slice(0, 200));
  igual(doc.querySelector('.ahora [data-a="ir"]').dataset.h, '#orden-601', 'Se atiende en el celular, no en la ficha');
  doc.querySelector('#movil [data-h="#orden-501"]').click(); await espera(); anotar('preventivo');
  ok(/3 pasos/.test(texto()) && !/estimado/.test(texto()), 'El preventivo dice sus pasos, no cuánto se estima: ' + texto().slice(0, 200));
  ahora = enSV('09:02');
  await clic('empezar');
  ok(/Paso 1 de 3/.test(texto()), texto().slice(0, 120));
  ok(!doc.querySelector('#reloj') && !/≈|\d+ min/.test(doc.querySelector('.paso').textContent), 'El paso no lleva reloj ni minutos estimados');
  ahora += 60000; await clic('hecho');
  ok(/Paso 2 de 3/.test(texto()));
  await clic('salir');
  await hasta(() => one('SELECT estado FROM ordenes WHERE id=501').estado === 'en_proceso' && one("SELECT COUNT(*) n FROM orden_paso_marcas WHERE orden_id=501").n === 1, 'el preventivo llega al servidor');

  // ══ Sin señal: la emergencia completa ══
  enLinea = false; w.dispatchEvent(new w.Event('offline'));
  await clic('ir', '[data-h="#orden-601"]');
  ok(/Emergencia/.test(texto()) && /EOP-ELE-01/.test(texto()) && texto().includes(eop.titulo), 'Inicio: etiqueta, código y título del EOP');
  ok(/Cuarto de máquinas · Sede 8/.test(texto()) && /PE-01/.test(texto()), 'y su lugar');
  ok(doc.querySelector('[data-a="llegue"]').textContent.includes('Ya estoy en el sitio'));
  const llegue = ahora = enSV('09:10');
  await clic('llegue');
  ok(/Trimestral|Minisplit quirófano 2/.test(doc.querySelector('#aviso').textContent) && /quedó en pausa/.test(doc.querySelector('#aviso').textContent), 'Lo que tenía entre manos queda en pausa');
  ok(/Acción 1 de 3/.test(texto()) && texto().includes(eop.a1.slice(0, 40)), 'Las acciones del EOP, una por pantalla: ' + texto().slice(0, 160));
  ok(!doc.querySelector('[data-a="na"]') && !doc.querySelector('.critico') && doc.querySelector('[data-a="nopudo"]'), '«Hecho» o «No se pudo»; no son pasos críticos');
  ahora += 2 * 60000; await clic('hecho');
  ok(/Acción 2 de 3/.test(texto()));
  await clic('nopudo');
  ok(/¿Por qué no se pudo\?/.test(hoja()));
  await clic('nopudoSeguir');
  ok(!doc.querySelector('#err-nopudo').hidden, 'Pide una nota corta');
  const motivo = 'Sin combustible en el tanque de la planta';
  escribir('#nota-nopudo', motivo);
  await espera(500); // Se guarda en el celular mientras se escribe.

  // Recarga sin señal, sin aviso a la página: la misma pantalla, la misma hoja, el mismo texto.
  await abrir(w.location.href);
  await hasta(() => /¿Por qué no se pudo\?/.test(hoja()) && doc.querySelector('#nota-nopudo')?.value === motivo, 'la hoja vuelve con su texto');
  anotar('recarga');
  ok(/Acción 2 de 3/.test(texto()), 'En la misma acción: ' + texto().slice(0, 100));
  await clic('nopudoSeguir');
  ok(/Acción 3 de 3/.test(texto()));
  ahora += 60000; await clic('hecho');
  ok(/¿Ya está controlado\?/.test(texto()), texto().slice(0, 120));
  igual(doc.querySelector('[data-a="controlado"]').textContent, `Sí: ${eop.e}`, 'El botón dice el rótulo del EOP');
  await clic('todaviaNoControlado');
  await hasta(() => /Seguir/.test(doc.querySelector('.ahora')?.textContent ?? ''), 'vuelve a Hoy');
  ok(doc.querySelector('.ahora').textContent.includes(eop.titulo) && /Falta confirmar que está controlado/.test(doc.querySelector('.ahora').textContent), 'La emergencia sigue ahí, primera');
  ok(/En pausa: Atiende una emergencia/.test(texto()), 'El preventivo, en pausa con su motivo');
  await clic('ir', '[data-h="#orden-601"]');
  ok(/¿Ya está controlado\?/.test(texto()), 'Seguir lleva a lo que falta');
  const controlado = ahora = enSV('09:25');
  await clic('controlado');
  ok(/¿Volvió a la normalidad\?/.test(texto()));
  await clic('todaviaNoNormal');
  ok(/¿Por qué se detiene\?/.test(hoja()) && doc.querySelector('.chip[aria-pressed="true"]')?.textContent === 'Todavía no vuelve a la normalidad', 'Todavía no: la hoja de pausa con su motivo');
  await clic('cerrarHoja');
  ok(!hoja() && /¿Volvió a la normalidad\?/.test(texto()), 'Cancelar deja la pregunta como estaba');
  await clic('todaviaNoNormal');
  ahora = enSV('09:30');
  await clic('confirmarPausa');
  await hasta(() => /Hola/.test(texto()), 'vuelve a Hoy');
  // Sola y en pausa, la emergencia sigue en «Ahora», con su motivo: si no hay otra, va la pausada.
  const enAhora601 = doc.querySelector('.ahora .b1[data-h="#orden-601"]');
  ok(enAhora601 && /Seguir/.test(enAhora601.textContent) && /En pausa: Todavía no vuelve a la normalidad/.test(doc.querySelector('.ahora').textContent), 'La emergencia en pausa ocupa «Ahora»: ' + texto().slice(0, 300));
  ok(!doc.querySelector('.resto [data-h="#orden-601"]'), 'Y no se repite en la lista');
  enAhora601.click(); await espera(); anotar('emergencia en pausa');
  ok(/En pausa/.test(texto()) && /Todavía no vuelve a la normalidad/.test(texto()), texto().slice(0, 160));
  ahora = enSV('09:35');
  await clic('reanudar');
  ok(/¿Volvió a la normalidad\?/.test(texto()), 'Al reanudar, la misma pregunta');
  const restablecido = ahora = enSV('09:40');
  await clic('restablecido');
  ok(/¿Qué encontraste y qué hiciste\?/.test(texto()), texto().slice(0, 120));
  ok(/La causa raíz la escribe tu jefatura\./.test(texto()) && !doc.querySelector('#causa-fin') && !/Causa raíz \(/i.test(texto()), 'Sin campo de causa raíz');
  await clic('enviar');
  ok(/10 letras/.test(doc.querySelector('#err-fin').textContent) && !doc.querySelector('#err-fin').hidden, 'Pide qué encontró (10 letras o más)');
  const nota = 'Encontré la planta sin combustible; la cargué, arrancó en manual y pasó la carga.';
  escribir('#nota-fin', nota);
  await fotoEn('#foto-final');
  anotar('foto');
  w.dispatchEvent(new w.Event('pagehide'));
  await espera(60);

  // La app se cierra y se abre desde su ícono, sin dirección: vuelve a la misma pantalla, con el texto y la foto.
  await abrir('https://test.invalid/campo');
  await hasta(() => doc.querySelector('#nota-fin')?.value === nota, 'el texto final vuelve');
  anotar('recarga final');
  igual(w.location.hash, '#orden-601', 'Abierta desde el ícono, vuelve a la orden');
  ok(/1 foto lista/.test(texto()) && /Otra foto/.test(texto()), 'La foto tomada se ve tomada, no pendiente');
  const fin = ahora = enSV('09:45');
  await clic('enviar');
  ok(/Guardado en tu celular/.test(texto()), texto().slice(0, 120));
  igual(one('SELECT COUNT(*) n FROM campo_operaciones WHERE orden_id=601').n, 0, 'Nada llegó al servidor todavía');

  // Vuelve la señal, pero el paquete del día no se puede traer: lo aceptado queda en la copia guardada.
  ahora = enSV('09:50');
  hoyFalla = true; enLinea = true; w.dispatchEvent(new w.Event('online'));
  await hasta(() => one('SELECT estado FROM ordenes WHERE id=601').estado === 'completada' && one('SELECT COUNT(*) n FROM adjuntos WHERE orden_id=601').n === 1, 'la emergencia se sincroniza');
  igual(one("SELECT COUNT(*) n FROM campo_operaciones WHERE resultado='rechazada'").n, 0, 'Sin rechazos: ' + JSON.stringify(all("SELECT tipo, detalle FROM campo_operaciones WHERE resultado='rechazada'")));
  const e = one('SELECT * FROM ordenes WHERE id=601');
  igual(e.hora_llegada, iso(llegue), 'La llegada, con la hora del toque');
  igual(e.iniciada_en, iso(llegue));
  igual(e.hora_mitigacion, iso(controlado), 'Controlado, con la hora del toque');
  igual(e.hora_restablecimiento, iso(restablecido), 'Restablecido, con la hora del toque');
  igual(e.completada_en, iso(fin));
  igual(e.causa_raiz, null, 'La causa raíz la escribe la jefatura');
  igual(e.tiempo_pausado_min, 5, 'La pausa se registra aunque el técnico no la vea');
  ok(e.trabajos_realizados.includes(nota), e.trabajos_realizados);
  const pasos = JSON.parse(e.checklist_ejecucion);
  igual(pasos.map((x) => x.texto).join('|'), [eop.a1, eop.a2, eop.a3].join('|'), 'Las acciones del EOP quedaron como pasos de la orden');
  igual(pasos.map((x) => x.estado).join(), 'ok,desviacion,ok');
  igual(pasos[1].notas, `No se pudo: ${motivo}`);
  ok(all('SELECT sin_senal s FROM orden_paso_marcas WHERE orden_id=601').length === 3 && all('SELECT sin_senal s FROM orden_paso_marcas WHERE orden_id=601').every((m) => m.s === 1), 'Cada acción dice que se capturó sin señal');
  igual(one('SELECT categoria c FROM adjuntos WHERE orden_id=601').c, 'despues');
  const pm = one('SELECT * FROM ordenes WHERE id=501');
  igual(pm.estado, 'en_espera'); igual(pm.pausada_en, iso(llegue), 'El preventivo se pausó al llegar a la emergencia');
  igual(one("SELECT motivo FROM orden_verificacion_eventos WHERE orden_id=501 AND accion='bloqueo'").motivo, 'Atiende una emergencia');
  await espera(80);
  enLinea = false; w.dispatchEvent(new w.Event('offline'));
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => /Hola/.test(texto()), 'Hoy, sin señal');
  anotar('hoy sin señal');
  ok(!doc.querySelector('[data-h="#orden-601"]') && !/por enviar/.test(texto()), 'Lo aceptado no reaparece como pendiente: ' + texto().slice(0, 300));
  ok(/1/.test(doc.querySelector('[data-g="hechas"]')?.textContent ?? ''), 'La emergencia, entre las terminadas de hoy');
  hoyFalla = false;

  // ══ Con señal: el preventivo se retoma donde quedó ══
  enLinea = true; w.dispatchEvent(new w.Event('online'));
  ahora = enSV('10:00');
  await clic('ir', '[data-h="#orden-501"]');
  ok(/En pausa/.test(texto()) && /Atiende una emergencia/.test(texto()), texto().slice(0, 160));
  ok(!/Tiempo de trabajo|En pausa desde/.test(texto()), 'La pausa no muestra tiempos');
  await clic('reanudar');
  ok(/Paso 2 de 3/.test(texto()), texto().slice(0, 100));
  await clic('hecho');
  // K8 · Un paso con rango (8 a 12 A) pide el número del instrumento: «14,5 A» u «ok» no se guardan ni salen.
  // La frase, junto al campo, es la misma que devuelve el servidor.
  const pasos501 = () => enviados.filter((op) => op.tipo === 'orden.paso' && op.ordenId === 501 && op.idx === 2);
  const lectEstado = () => doc.querySelector('#lect-estado')?.textContent ?? '';
  ok(/Este paso tiene rango/.test(app.reglas.MENSAJE_PASO_SIN_NUMERO), 'La frase del servidor: ' + app.reglas.MENSAJE_PASO_SIN_NUMERO);
  for (const escrito of ['14,5 A', 'ok']) {
    escribir('#lectura', escrito);
    await clic('lectura');
    igual(lectEstado(), app.reglas.MENSAJE_PASO_SIN_NUMERO, `«${escrito}»: la frase del servidor, junto al campo`);
    ok(/Paso 3 de 3/.test(texto()) && !hoja(), `«${escrito}»: no avanza: ` + texto().slice(0, 120));
  }
  await espera(60);
  igual(pasos501().length, 0, 'Y no sale nada');
  // K7 · «9,8750» se guarda 9.875. De vuelta en el paso, el campo dice «9.8750», que se lee igual: se guarda otra
  // vez sin aviso. Primero sin señal (lo que anotó el celular) y después con el paquete del servidor.
  enLinea = false; w.dispatchEvent(new w.Event('offline'));
  escribir('#lectura', '9,8750');
  await clic('lectura');
  ok(/3 de 3 pasos anotados/.test(texto()), texto().slice(0, 120));
  for (const desde of ['el celular', 'el servidor']) {
    if (desde === 'el servidor') {
      enLinea = true; w.dispatchEvent(new w.Event('online'));
      await hasta(() => one('SELECT COUNT(*) n FROM orden_paso_marcas WHERE orden_id=501 AND paso_idx=2').n === 2 && !enVuelo, 'lo anotado llega al servidor');
      await espera(60); // y vuelve el paquete del día
    }
    await clic('anterior');
    igual(doc.querySelector('#lectura').value, '9.8750', `Con lo que guardó ${desde}, el campo trae el número escrito para leerse igual`);
    igual(lectEstado(), 'Dentro de rango', `Con lo que guardó ${desde}, sin aviso de número que se lee de dos formas`);
    await clic('lectura');
    ok(/3 de 3 pasos anotados/.test(texto()), `Con lo que guardó ${desde}, se guarda otra vez sin aviso: ` + texto().slice(0, 120));
  }
  await hasta(() => pasos501().length === 3, 'las tres lecturas salen');
  ok(pasos501().every((op) => op.valor === 9.875), 'Cada vez, como el número 9.875: ' + JSON.stringify(pasos501().map((op) => op.valor)));
  await clic('enviar');
  ok(/Enviado a verificación|Guardado en tu celular/.test(texto()) && !/Tiempo registrado/.test(texto()), texto().slice(0, 200));
  await hasta(() => one('SELECT estado FROM ordenes WHERE id=501').estado === 'completada', 'el preventivo se envía');

  // ══ La intervención: permisos, una lectura fuera de rango, la reversa y el envío ══
  // La copia del día la dejó la versión anterior: la intervención decía «ficha» y no traía sus permisos.
  ahora = enSV('10:20');
  await espera(50);
  await cambiarGuardado('hoy:3', (p) => ({ ...p, ordenes: p.ordenes.map(({ prerrequisitos, liberaciones, reversa, ...o }) => ({ ...o, modo: o.tipo === 'intervencion' ? 'ficha' : o.modo })) }));
  const pedidasAntes = ordenesPedidas;
  await abrir('https://test.invalid/campo#orden-701');
  await hasta(() => /Antes de empezar, los permisos/.test(texto()), 'la intervención empieza por los permisos');
  anotar('intervención');
  igual(ordenesPedidas, pedidasAntes + 1, 'La orden que la copia vieja tenía como «ficha» se pide de nuevo, una vez');
  ok(/0 de 2 permisos cumplidos/.test(texto()) && /Permiso de trabajo firmado/.test(texto()) && /Sigue este\. Es obligatorio\./.test(texto()), 'El inicio dice cuántos van y cuál sigue: ' + texto().slice(0, 300));
  ok(!/Aviso a enfermería/.test(texto()) && doc.querySelectorAll('.permisos .perm').length === 1, 'Un solo permiso a la vista');
  ok(!doc.querySelector('[data-a="empezar"]'), 'Sin los obligatorios, Empezar no aparece');
  await clic('verPermiso', '.b1');
  ok(/1 de 2/.test(texto()) && /Obligatorio/.test(texto()) && /Permiso de trabajo firmado/.test(texto()) && /N\.º de permiso y quién lo emitió/.test(texto()), texto().slice(0, 200));
  ok(!doc.querySelector('[data-a="saltar"]'), 'Uno obligatorio no se salta');
  escribir('#referencia', 'x');
  await clic('cumplido');
  ok(!doc.querySelector('#err-ref').hidden, 'La referencia pide 2 caracteres o más');
  escribir('#referencia', 'PT-0457, lo emitió J. Pérez');
  const permiso = ahora = enSV('10:30');
  await clic('cumplido');
  ok(/2 de 2/.test(texto()) && /Aviso a enfermería/.test(texto()) && doc.querySelector('[data-a="saltar"]'), 'El opcional se puede saltar');
  await clic('saltar');
  ok(doc.querySelector('.paso-pie [data-a="empezar"]') && /1 de 2 permisos cumplidos · 1 opcional saltado/.test(texto()) && /Revisar los permisos/.test(texto()), 'Con los obligatorios cumplidos, Empezar en el pie: ' + texto().slice(0, 300));
  ahora = enSV('10:35');
  await clic('empezar');
  ok(/Lectura de liberación 1 de 2/.test(texto()) && /Corriente de arranque/.test(texto()) && /Normal: 8 a 12 A/.test(texto()), texto().slice(0, 200));
  // Con la unidad al lado, «14,5 A» se lee con numeroAlInicio: 14,5, fuera de rango.
  escribir('#lectura', '14,5 A');
  await clic('lecturaLib');
  ok(/No libera/.test(hoja()) && /Lectura 14,5 A · normal 8 a 12 A/.test(hoja()) && doc.querySelector('[data-a="repetirLectura"]') && doc.querySelector('[data-a="reversaPaso"]') && doc.querySelector('[data-a="dejarEnEspera"]'), 'Fuera de rango: la hoja No libera: ' + hoja().slice(0, 160));
  await clic('repetirLectura');
  ok(!hoja() && doc.querySelector('#lectura').value === '' && /Anotaste: 14,5 A, fuera de rango/.test(texto()), 'Repetir: el campo vacío y lo anotado a la vista: ' + texto().slice(0, 300));
  escribir('#lectura', '15');
  await clic('lecturaLib');
  await clic('dejarEnEspera');
  ok(doc.querySelector('.chip[aria-pressed="true"]')?.textContent === 'No libera: Corriente de arranque: 15 A', 'Dejar en espera trae su motivo: ' + hoja().slice(0, 160));
  await clic('cerrarHoja');
  ok(/No libera/.test(hoja()), 'Cancelar la pausa vuelve a No libera');
  await clic('reversaPaso');
  ok(/reinstalar el original/.test(hoja()), 'Se ve el plan de reversa');
  escribir('#nota-reversa', 'corto');
  await clic('confirmarReversa');
  ok(!doc.querySelector('#err-reversa').hidden, 'Las notas de la reversa piden 10 letras o más');
  const notasReversa = 'Reinstalé el compresor original; el equipo quedó como estaba.';
  escribir('#nota-reversa', notasReversa);
  ahora = enSV('10:50');
  await clic('confirmarReversa');
  ok(/¿Qué encontraste y qué hiciste\?/.test(texto()) && /Ejecutado: no hace falta liberar el sistema/.test(texto()), 'Con la reversa, al cierre: ' + texto().slice(0, 200));
  ok(/1 lectura anotada · 1 fuera de rango · 1 sin anotar/.test(texto()), 'El cierre resume las lecturas: ' + texto().slice(0, 300));
  ok(!/La causa raíz/.test(texto()), 'La intervención no habla de causa raíz');
  escribir('#nota-fin', 'El compresor nuevo arrancó con 15 A; lo revertí y reporto a compras.');
  await clic('enviar');
  await hasta(() => one('SELECT estado FROM ordenes WHERE id=701').estado === 'completada', 'la intervención se envía');
  const pre = all('SELECT * FROM orden_prerrequisitos WHERE orden_id=701 ORDER BY orden');
  igual(pre[0].cumplido, 1); igual(pre[0].referencia, 'PT-0457, lo emitió J. Pérez'); igual(pre[0].cumplido_por, 3);
  igual(pre[0].cumplido_en, iso(permiso), 'El permiso, con la hora del toque');
  igual(pre[1].cumplido, 0, 'El opcional saltado no se marca');
  const lib = one("SELECT * FROM orden_liberaciones WHERE orden_id=701 AND etiqueta='Corriente de arranque'");
  igual(lib.valor_medido, 15, 'La lectura repetida reemplaza la anterior'); igual(lib.conforme, 0); igual(lib.medido_por, 3);
  const mop = one('SELECT * FROM ordenes WHERE id=701');
  igual(mop.reversa_ejecutada, 1); igual(mop.reversa_notas, notasReversa);
  ok(mop.trabajos_realizados.includes('Reversa ejecutada') && mop.trabajos_realizados.includes('El compresor nuevo arrancó'), mop.trabajos_realizados);
  igual(one("SELECT COUNT(*) n FROM campo_operaciones WHERE resultado='rechazada'").n, 0, 'Sin rechazos: ' + JSON.stringify(all("SELECT tipo, detalle FROM campo_operaciones WHERE resultado='rechazada'")));

  // ══ La intervención real MOP-MSP-01: siete permisos, algunos de casi 200 letras, y seis lecturas ══
  // El inicio no lista los permisos: dice cuántos van y muestra solo el que sigue, con su texto.
  ahora = enSV('11:00');
  const msp = one("SELECT p.id proc, cp.id plantilla FROM procedimientos p JOIN checklist_plantillas cp ON cp.procedimiento_id=p.id WHERE p.codigo_corto='MOP-MSP-01'");
  sqlite.exec(`
    INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo,activa) VALUES(84,8,'UCI Adultos','area',1);
    INSERT INTO activos(id,codigo,nombre,tipo,rubro,ubicacion_id,estado) VALUES(84,'AC-UCI-03','Minisplit 18,000 BTU UCI Adultos','general','aires',84,'operativo');
  `);
  orden(702, 'intervencion', '[Intervención] Reemplazo del compresor - AC-UCI-03', 84, 'aires', null);
  sqlite.prepare("UPDATE ordenes SET procedimiento_id=?, plan_reversa='Si el compresor nuevo no enfría, reinstalar el original y dejar la unidad como estaba.' WHERE id=702").run(msp.proc);
  sqlite.prepare('INSERT INTO orden_prerrequisitos(orden_id,texto,tipo,obligatorio,orden) SELECT 702,texto,tipo,obligatorio,orden FROM plantilla_prerrequisitos WHERE plantilla_id=? ORDER BY orden').run(msp.plantilla);
  sqlite.prepare('INSERT INTO orden_liberaciones(orden_id,etiqueta,unidad,valor_esperado,min_aceptable,max_aceptable,obligatoria,orden) SELECT 702,etiqueta,unidad,valor_esperado,min_aceptable,max_aceptable,obligatoria,orden FROM plantilla_liberaciones WHERE plantilla_id=? ORDER BY orden').run(msp.plantilla);
  const permisos702 = all('SELECT texto, obligatorio FROM orden_prerrequisitos WHERE orden_id=702 ORDER BY orden');
  igual(permisos702.length, 7, 'MOP-MSP-01 trae siete permisos');
  ok(permisos702.filter((p) => p.texto.length > 180).length >= 2, 'Dos de más de 180 letras');
  await abrir('https://test.invalid/campo#orden-702');
  await hasta(() => /Antes de empezar, los permisos/.test(texto()), 'el inicio de la intervención real');
  anotar('MOP-MSP-01 inicio');
  const unPermiso = (i, msg) => {
    const filas = doc.querySelectorAll('.permisos .perm');
    igual(filas.length, 1, `${msg}: un solo permiso a la vista`);
    ok(filas[0].textContent.includes(permisos702[i].texto), `${msg}: el que sigue, con su texto completo en su caja`);
    ok(permisos702.every((p, j) => j === i || !texto().includes(p.texto)), `${msg}: los demás no se listan`);
    ok(doc.querySelector('.marco > .paso-pie .b1'), `${msg}: el botón principal, en el pie fijo`);
    ok(filas[0].querySelector('strong.recorte'), `${msg}: el texto largo se recorta en su caja`);
  };
  ok(/0 de 7 permisos cumplidos/.test(texto()), texto().slice(0, 300));
  unPermiso(0, 'Al abrir');
  igual(doc.querySelector('.paso-pie .b1').textContent, 'Registrar los permisos');
  await clic('verPermiso', '.b1');
  ok(/1 de 7/.test(texto()) && texto().includes(permisos702[0].texto), texto().slice(0, 160));
  escribir('#referencia', 'Con Enfermería, Lic. Rivas; habitación 12');
  await clic('cumplido');
  escribir('#referencia', 'PT-0458, lo emitió J. Pérez');
  await clic('cumplido');
  ok(/3 de 7/.test(texto()) && /Opcional/.test(texto()), 'El tercero es opcional: ' + texto().slice(0, 160));
  await clic('salir');
  await clic('ir', '[data-h="#orden-702"]');
  ok(/2 de 7 permisos cumplidos/.test(texto()), 'Al volver, cuántos van: ' + texto().slice(0, 300));
  unPermiso(2, 'Al volver');
  ok(/Sigue este\. Es opcional\./.test(texto()));
  igual(doc.querySelector('.paso-pie .b1').textContent, 'Seguir con los permisos');
  await clic('verPermiso', '.b1');
  await clic('saltar');
  for (let i = 3; i < 7; i++) {
    ok(new RegExp(`${i + 1} de 7`).test(texto()) && texto().includes(permisos702[i].texto), `Permiso ${i + 1}, entero en su pantalla: ` + texto().slice(0, 120));
    escribir('#referencia', `REF-${i + 1}, Carlos`);
    await clic('cumplido');
  }
  ok(/6 de 7 permisos cumplidos · 1 opcional saltado/.test(texto()) && doc.querySelector('.paso-pie [data-a="empezar"]') && /Revisar los permisos/.test(texto()), 'Listos: Empezar en el pie: ' + texto().slice(0, 300));
  igual(doc.querySelectorAll('.permisos .perm').length, 0, 'Ningún permiso pendiente a la vista');
  anotar('MOP-MSP-01 listo');
  ahora = enSV('11:05');
  await clic('empezar');
  ok(/Lectura de liberación 1 de 6/.test(texto()), texto().slice(0, 120));
  escribir('#lectura', 'Sin caída de presión en 30 min');
  await clic('lecturaLib');
  ok(/Lectura de liberación 2 de 6/.test(texto()) && /Vacío alcanzado/.test(texto()), texto().slice(0, 160));
  igual(doc.querySelector('#lectura').getAttribute('inputmode'), 'decimal', 'Con rango, el teclado de números');
  // K4: con mínimo o máximo, sin número no se guarda: sin señal quedaría una lectura que el servidor rechaza.
  escribir('#lectura', 'bajo');
  await clic('lecturaLib');
  ok(/Esta lectura tiene rango: anota el número que marcó el instrumento \(por ejemplo 14,5\)\./.test(doc.querySelector('#lect-estado').textContent), 'Pide el número: ' + doc.querySelector('#lect-estado').textContent);
  ok(/Lectura de liberación 2 de 6/.test(texto()) && !hoja(), 'Y no avanza');
  // K6: «1,200» puede ser mil doscientos o uno coma dos. Leído como 1,2 pasaría el rango (0 a 500): se pide sin separador.
  const enviadosAntes = enviados.length;
  escribir('#lectura', '1,200');
  const estadoLect = () => doc.querySelector('#lect-estado').textContent;
  igual(estadoLect(), '¿1200 o 1,2? Escribe el número sin separador de miles.', 'Mientras lo escribe, ya lo dice y no dice «Dentro de rango»');
  await clic('lecturaLib');
  ok(estadoLect() === '¿1200 o 1,2? Escribe el número sin separador de miles.' && /lect-estado falta/.test(doc.querySelector('#lect-estado').className), 'Al guardar, el mensaje donde se pide el número: ' + estadoLect());
  ok(/Lectura de liberación 2 de 6/.test(texto()) && !hoja(), 'No avanza');
  await espera(60);
  igual(enviados.length, enviadosAntes, 'Y no sale nada');
  // «1200» sí es un número: 1200 micrones, fuera de rango.
  escribir('#lectura', '1200');
  await clic('lecturaLib');
  ok(/No libera/.test(hoja()) && /Lectura 1200 micrones/.test(hoja()), '1200 se lee mil doscientos: ' + hoja().slice(0, 160));
  await clic('repetirLectura');
  ok(/Anotaste: 1200 micrones, fuera de rango/.test(texto()), 'Quedó anotada como 1200: ' + texto().slice(0, 300));
  // Con tres decimales, lo anotado se escribe para leerse igual: «600.1250», no «600.125».
  escribir('#lectura', '600,1250');
  await clic('lecturaLib');
  await clic('repetirLectura');
  ok(/Anotaste: 600\.1250 micrones, fuera de rango/.test(texto()), 'Quedó anotada como 600.1250: ' + texto().slice(0, 300));
  escribir('#lectura', '450');
  await clic('lecturaLib');
  escribir('#lectura', '1,2 kg');
  await clic('lecturaLib');
  escribir('#lectura', '8,5');
  await clic('lecturaLib');
  ok(/Lectura de liberación 5 de 6/.test(texto()) && /Diferencia de temperatura/.test(texto()), texto().slice(0, 160));
  escribir('#lectura', '16,5');
  await clic('lecturaLib');
  ok(/No libera/.test(hoja()), 'Fuera de rango, no libera');
  await clic('reversaPaso');
  escribir('#nota-reversa', 'Reinstalé el compresor original; la unidad quedó como estaba.');
  ahora = enSV('11:15');
  await clic('confirmarReversa');
  ok(/¿Qué encontraste y qué hiciste\?/.test(texto()) && /5 lecturas anotadas · 1 fuera de rango · 1 sin anotar/.test(texto()), 'El cierre resume las lecturas en una línea: ' + texto().slice(0, 300));
  ok(!texto().includes('Prueba de hermeticidad') && !texto().includes('Vacío alcanzado'), 'Sin la lista de cada lectura');
  ok(doc.querySelector('.marco > .paso-pie [data-a="enviar"]'), 'Enviar, en el pie fijo');
  anotar('MOP-MSP-01 cierre');
  escribir('#nota-fin', 'El compresor nuevo no bajó la temperatura; lo revertí y reporto a compras.');
  await clic('enviar');
  await hasta(() => one('SELECT estado FROM ordenes WHERE id=702').estado === 'completada', 'la intervención real se envía');
  const vacio = one("SELECT valor_medido v, conforme c FROM orden_liberaciones WHERE orden_id=702 AND etiqueta LIKE 'Vacío%'");
  igual(vacio.v, 450, 'La lectura con rango llegó con su número'); igual(vacio.c, 1);
  ok(!enviados.some((op) => op.tipo === 'mop.liberacion' && op.valor === 'bajo'), 'La lectura sin número nunca salió del celular');
  ok(!enviados.some((op) => op.tipo === 'mop.liberacion' && op.valor === '1,200') && enviados.some((op) => op.tipo === 'mop.liberacion' && op.valor === '1200'), 'La ambigua nunca salió; 1200 sí');
  igual(one("SELECT COUNT(*) n FROM orden_prerrequisitos WHERE orden_id=702 AND cumplido=1").n, 6);
  igual(one("SELECT COUNT(*) n FROM campo_operaciones WHERE resultado='rechazada'").n, 0, 'Sin rechazos: ' + JSON.stringify(all("SELECT tipo, detalle FROM campo_operaciones WHERE resultado='rechazada'")));

  // ══ Varias emergencias (decisión 9): arriba la que el técnico atiende; si no atiende ninguna, la que vence
  // primero entre las que nadie atiende; si todas están en pausa, la pausada que vence primero. En cada grupo,
  // la que vence antes (sin vencimiento, primero) y después la más antigua. Las otras, con su línea en «Ahora»
  // y su acción; cada una dice cuándo vence ══
  ahora = enSV('11:30');
  const agu = one("SELECT id, titulo FROM procedimientos WHERE codigo_corto='EOP-AGU-01'");
  const manana = new RealDate(RealDate.parse(`${svHoy}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const fechaManana = `${manana.slice(8, 10)}/${manana.slice(5, 7)}/${manana.slice(0, 4)}`;
  // La más antigua vence mañana; la más nueva, hoy.
  orden(604, 'emergencia', '[Emergencia] Falla de energía - PE-01', 81, 'infraestructura', null);
  sqlite.prepare('UPDATE ordenes SET procedimiento_id=?, vencimiento=? WHERE id=604').run(eop.id, iso(enSV('13:00', manana)));
  orden(605, 'emergencia', '[Emergencia] Sin agua en el edificio', null, 'infraestructura', null);
  sqlite.prepare('UPDATE ordenes SET procedimiento_id=?, ubicacion_id=81, vencimiento=? WHERE id=605').run(agu.id, iso(enSV('12:00')));
  await abrir('https://test.invalid/campo#hoy');
  const bloque = () => doc.querySelector('.ahora')?.textContent ?? '';
  await hasta(() => /Atender la emergencia/.test(bloque()) && doc.querySelector('[data-h="#orden-604"]'), 'Hoy con dos emergencias');
  anotar('dos emergencias');
  const linea = (id) => doc.querySelector(`.ahora a.otra[data-h="#orden-${id}"]`)?.textContent ?? '';
  const principal = () => doc.querySelector('.ahora .b1')?.dataset.h;
  ok(doc.querySelector('.ahora h2').textContent === agu.titulo && /Emergencia · Vence hoy 12:00/.test(bloque()) && principal() === '#orden-605', 'Sin atender ninguna, arriba la que vence primero, aunque sea la más nueva, con su plazo: ' + bloque());
  ok(/^Otra emergencia sin atender: .+ · Atender$/.test(linea(604)) && linea(604).includes(eop.titulo.slice(0, 30)), 'La otra, con su línea en «Ahora»: ' + bloque());
  ok(!doc.querySelector('.resto [data-h="#orden-604"]'), 'Y no se repite en la lista');
  await clic('ir', '[data-h="#orden-604"]');
  ok(texto().includes(`Emergencia · Vence ${fechaManana} 13:00`), 'El inicio de la emergencia dice cuándo vence: ' + texto().slice(0, 200));
  anotar('inicio con plazo');
  await clic('llegue');
  ok(/Acción 1 de 3/.test(texto()), texto().slice(0, 120));
  await hasta(() => enviados.some((op) => op.tipo === 'orden.iniciar' && op.ordenId === 604), 'orden.iniciar sale');
  igual(JSON.stringify(enviados.find((op) => op.tipo === 'orden.iniciar' && op.ordenId === 604).acciones), JSON.stringify([eop.a1, eop.a2, eop.a3].map((t) => t.trim())), 'orden.iniciar lleva las acciones que el celular muestra');
  await clic('hecho'); await clic('hecho'); await clic('hecho');
  ok(/¿Ya está controlado\?/.test(texto()));
  await clic('todaviaNoControlado');
  await hasta(() => /Hola/.test(texto()), 'vuelve a Hoy');
  anotar('la empezada arriba');
  ok(/Está primera en Hoy/.test(doc.querySelector('#aviso').textContent));
  // Una que se atiende y una nueva que vence antes: arriba la que atiende; la nueva, con su línea «Atender».
  ok(principal() === '#orden-604' && /Seguir/.test(doc.querySelector('.ahora .b1').textContent) && doc.querySelector('.ahora h2').textContent !== agu.titulo, 'Arriba queda la que el técnico atiende, aunque la otra venza antes: ' + bloque());
  ok(bloque().includes(`Vence ${fechaManana} 13:00`), 'Con su plazo');
  ok(/^Otra emergencia sin atender: .+ · Atender$/.test(linea(605)) && linea(605).includes(agu.titulo.slice(0, 30)), 'La que nadie empezó no queda escondida: ' + bloque());
  ok(!doc.querySelector('.resto [data-h="#orden-605"]'), 'Ni se repite en la lista');
  await hasta(() => one('SELECT COUNT(*) n FROM orden_paso_marcas WHERE orden_id=604').n === 3, 'las acciones llegan');
  ok(enviados.filter((op) => op.tipo === 'orden.paso' && op.ordenId === 604).every((op) => op.acciones?.length === 3), 'orden.paso también las lleva');
  // Una en pausa y una nueva: la pausa no tapa a la que nadie empezó; la pausada tiene su línea «Seguir».
  await clic('ir', '[data-h="#orden-604"]');
  await clic('pausar');
  await clic('motivoPausa', '[data-m="Me pasaron a otra urgencia"]');
  await clic('confirmarPausa');
  await hasta(() => /Hola/.test(texto()) && principal() === '#orden-605', 'la que nadie empezó, arriba');
  anotar('una en pausa y una nueva');
  ok(/Atender la emergencia/.test(doc.querySelector('.ahora .b1').textContent) && doc.querySelector('.ahora h2').textContent === agu.titulo, 'Arriba, la que nadie empezó: ' + bloque());
  ok(/^Emergencia en pausa: .+ · Seguir$/.test(linea(604)) && linea(604).includes(eop.titulo.slice(0, 30)), 'La pausada, con su línea: ' + bloque());
  ok(!doc.querySelector('.resto [data-h="#orden-604"]'), 'Y no se repite en la lista');
  await clic('ir', '.otra[data-h="#orden-604"]');
  ok(/En pausa/.test(texto()) && /Me pasaron a otra urgencia/.test(texto()) && doc.querySelector('[data-a="reanudar"]'), 'Su línea lleva a seguirla: ' + texto().slice(0, 160));
  // Las dos en pausa: arriba la pausada que vence primero, aunque sea la más nueva.
  await clic('ir', '[data-h="#hoy"]');
  await clic('ir', '.b1[data-h="#orden-605"]');
  await clic('llegue');
  await clic('pausar');
  await clic('motivoPausa', '[data-m="Falta repuesto"]');
  await clic('confirmarPausa');
  await hasta(() => /Hola/.test(texto()) && /En pausa: Falta repuesto/.test(bloque()), 'las dos en pausa');
  anotar('las dos en pausa');
  ok(principal() === '#orden-605' && /Vence hoy 12:00/.test(bloque()) && /^Emergencia en pausa: .+ · Seguir$/.test(linea(604)), 'Todas en pausa: arriba la pausada que vence primero, aunque sea la más nueva: ' + bloque());
  sqlite.exec("UPDATE ordenes SET estado='cancelada' WHERE id IN (604,605)");

  // ══ Cinco emergencias sin atender, cada una en su lugar, y una en pausa que vence antes que todas, en una
  // pantalla baja: «Ahora» lleva una y dos líneas («y 3 más en Hoy»); la lista sigue el mismo orden y todo grupo
  // con una sin atender aparece abierto; el de la pausada, también, como antes. El técnico puede cerrar uno; si
  // llega otra emergencia ahí, se abre ══
  sqlite.exec("INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo,activa) VALUES(85,8,'Cisterna','area',1)");
  const emergencia = (id, titulo, ubicacion, vence) => sqlite.prepare("INSERT INTO ordenes(id,creado_por,titulo,rubro,tipo,estado,asignado_a,sucursal_id,ubicacion_id,vencimiento) VALUES(?,1,?,'infraestructura','emergencia','abierta',3,8,?,?)").run(id, titulo, ubicacion, vence);
  emergencia(621, '[Emergencia] Humo en el cuarto de máquinas', 81, iso(enSV('12:40')));
  emergencia(622, '[Emergencia] Olor a gas en el quirófano', 82, null);
  emergencia(623, '[Emergencia] Filtración en la azotea', 83, iso(enSV('12:10')));
  emergencia(624, '[Emergencia] Alarma de oxígeno en la UCI', 84, null);
  emergencia(625, '[Emergencia] Cisterna sin nivel', 85, iso(enSV('12:20')));
  emergencia(620, '[Emergencia] Bomba de la azotea detenida', 83, iso(enSV('11:50')));
  sqlite.prepare("UPDATE ordenes SET estado='en_espera', iniciada_en=?, hora_llegada=?, pausada_en=? WHERE id=620").run(iso(enSV('11:00')), iso(enSV('11:00')), iso(enSV('11:10')));
  altoVentana = 640;
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => /Hola/.test(texto()) && doc.querySelector('.ahora .otra[data-h="#orden-623"]'), 'Hoy con seis emergencias');
  anotar('seis emergencias');
  const lineas = () => [...doc.querySelectorAll('.ahora a.otra')].map((a) => a.dataset.h).join();
  ok(principal() === '#orden-622' && lineas() === '#orden-624,#orden-623', 'Arriba y en sus líneas, las que nadie atiende: primero las que no tienen vencimiento, después la que vence antes: ' + bloque());
  ok(/y 3 más en Hoy/.test(bloque()), 'Y cuántas más: ' + bloque());
  const enLista = () => [...doc.querySelectorAll('.resto a.fila[data-h^="#orden-62"]')].map((a) => a.dataset.h).join();
  igual(enLista(), '#orden-625,#orden-621,#orden-620', 'La lista sigue el mismo orden: las sin atender antes que la pausada, aunque esta venza antes');
  const grupoDe = (g) => doc.querySelector(`[data-a="grupo"][data-g="${g}"]`)?.getAttribute('aria-expanded');
  ok(grupoDe('Cisterna') === 'true' && grupoDe('Cuarto de máquinas') === 'true', 'Los dos grupos con una sin atender, abiertos también en una pantalla baja: ' + texto().slice(0, 500));
  ok(grupoDe('Azotea') === 'true', 'Y el de la pausada: ' + texto().slice(0, 500));
  // En una pantalla baja (360×640, medida en Chrome; 390×844 en Chrome y WebKit), «Ahora» lleno cabe sin desplazar,
  // con «Seguir» y la ronda a la vista: menos aire, la misma letra. Aquí, con su hoja de estilos.
  const estiloAhora = doc.createElement('style');
  estiloAhora.textContent = await fs.readFile('src/campo/campo.css', 'utf8');
  doc.head.append(estiloAhora);
  const reglasBajas = [...estiloAhora.sheet.cssRules].filter((r) => /max-height:\s*700px/.test(r.conditionText ?? r.media?.mediaText ?? '')).flatMap((r) => [...r.cssRules]);
  const enBaja = (sel, prop) => reglasBajas.find((r) => r.selectorText === sel)?.style.getPropertyValue(prop);
  ok(enBaja('.hoy-cab', 'padding-top') === '8px' && enBaja('.ahora', 'gap') === '6px' && enBaja('.ahora', 'padding-top') === '12px' && enBaja('.ahora', 'padding-bottom') === '12px'
    && enBaja('.ahora .otra', 'padding-top') === '8px' && enBaja('.ahora .otra', 'padding-bottom') === '8px' && enBaja('.ahora .otra+.otra', 'margin-top') === '-6px', '«Ahora» se compacta en una pantalla baja');
  ok(!reglasBajas.some((r) => /^\.(ahora|hoy-cab)/.test(r.selectorText) && r.style.getPropertyValue('font-size')), 'Sin achicar la letra');
  estiloAhora.remove();
  await clic('grupo', '[data-g="Cisterna"]');
  ok(grupoDe('Cisterna') === 'false' && !doc.querySelector('.resto [data-h="#orden-625"]') && grupoDe('Cuarto de máquinas') === 'true', 'El técnico cierra uno; el otro sigue abierto');
  await clic('grupo', '[data-g="hechas"]');
  ok(grupoDe('hechas') === 'true' && grupoDe('Cuarto de máquinas') === 'true', 'Abrir otro grupo no cierra el de la emergencia');
  ok(grupoDe('Azotea') === 'false', 'El de la pausada sí: estaba abierto como antes, no porque nadie la atienda');
  emergencia(626, '[Emergencia] Tablero de la cisterna sin energía', 85, iso(enSV('12:30')));
  w.dispatchEvent(new w.Event('online'));
  await hasta(() => doc.querySelector('.resto [data-h="#orden-626"]'), 'llega otra emergencia a la cisterna');
  ok(grupoDe('Cisterna') === 'true' && doc.querySelector('.resto [data-h="#orden-625"]'), 'Con otra emergencia sin atender, el grupo cerrado se abre otra vez');
  altoVentana = 768;
  sqlite.exec("UPDATE ordenes SET estado='cancelada' WHERE id BETWEEN 620 AND 626");

  // ══ Una emergencia que vence en una fecha sola vence al final de ese día: entre dos que nadie atiende, arriba va la
  // que vence hoy a una hora ══
  emergencia(627, '[Emergencia] Fuga en la cisterna', 85, svHoy);
  emergencia(628, '[Emergencia] Tablero de la azotea caliente', 83, iso(enSV('20:00')));
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => /Hola/.test(texto()) && doc.querySelector('.ahora .otra[data-h="#orden-627"]'), 'Hoy con la de fecha sola y la de hora');
  anotar('fecha sola y hora del mismo día');
  ok(principal() === '#orden-628' && /^Emergencia · Vence hoy 20:00$/.test(doc.querySelector('.ahora .etq').textContent) && lineas() === '#orden-627', 'Arriba la que vence hoy a las 20:00; la de fecha sola vence al final del día: ' + bloque());
  sqlite.exec("UPDATE ordenes SET estado='cancelada' WHERE id IN (627,628)");

  // ══ Una emergencia que llegó sin su documento ni sus acciones se pide de nuevo, una vez ══
  ahora = enSV('11:40');
  orden(606, 'emergencia', '[Emergencia] Falla de energía - PE-01', 81, 'infraestructura', null);
  sqlite.prepare('UPDATE ordenes SET procedimiento_id=? WHERE id=606').run(eop.id);
  orden(607, 'emergencia', '[Emergencia] Olor a quemado en el pasillo', null, 'infraestructura', null);
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => doc.querySelector('[data-h="#orden-606"]') && doc.querySelector('[data-h="#orden-607"]'), 'las dos en Hoy');
  await espera(50);
  // Como la dejaba el paquete cuando el EOP no alcanzaba a resolverse: sin código y sin acciones.
  await cambiarGuardado('hoy:3', (p) => ({ ...p, ordenes: p.ordenes.map((o) => (o.id === 606 ? { ...o, eop: { ...o.eop, codigo: null, titulo: null }, pasos: [] } : o)) }));
  const antes606 = pedidasDe['606'] ?? 0;
  await abrir('https://test.invalid/campo#orden-606');
  await hasta(() => /Ya estoy en el sitio/.test(texto()) && /EOP-ELE-01/.test(texto()), 'la emergencia se pide de nuevo y llega con su documento');
  anotar('emergencia pedida de nuevo');
  igual((pedidasDe['606'] ?? 0) - antes606, 1, 'Se pidió una vez');
  await clic('llegue');
  ok(/Acción 1 de 3/.test(texto()) && texto().includes(eop.a1.slice(0, 40)), 'Con sus acciones: ' + texto().slice(0, 160));
  await hasta(() => enviados.some((op) => op.tipo === 'orden.iniciar' && op.ordenId === 606), 'orden.iniciar de la 606');
  igual(enviados.find((op) => op.tipo === 'orden.iniciar' && op.ordenId === 606).acciones.length, 3, 'Con las tres acciones que se ven');
  await clic('salir');
  // Sin documento de verdad (sin equipo ni EOP): se pide una vez, llega igual y no se vuelve a pedir.
  sqlite.exec("UPDATE ordenes SET estado='cancelada' WHERE id=606");
  const antes607 = pedidasDe['607'] ?? 0;
  await clic('ir', '[data-h="#orden-607"]');
  await hasta(() => /Ya estoy en el sitio/.test(texto()), 'la 607 abre');
  igual((pedidasDe['607'] ?? 0) - antes607, 1, 'Se pide una vez');
  ok(!doc.querySelector('.cod'), 'Sin código de documento');
  await clic('ir', '[data-h="#hoy"]');
  await clic('ir', '[data-h="#orden-607"]');
  igual((pedidasDe['607'] ?? 0) - antes607, 1, 'La segunda vez no se vuelve a pedir');
  // Sin señal, sin acciones a la vista: orden.iniciar dice que no hay ninguna y el servidor no siembra otras.
  enLinea = false; w.dispatchEvent(new w.Event('offline'));
  ahora = enSV('11:45');
  await clic('llegue');
  ok(/¿Ya está controlado\?/.test(texto()), 'Sin acciones: directo a la pregunta');
  await clic('controlado');
  await clic('restablecido');
  escribir('#nota-fin', 'Era un balastro quemado; lo desconecté y ya no hay olor.');
  await clic('enviar');
  ok(/Guardado en tu celular/.test(texto()));
  enLinea = true; w.dispatchEvent(new w.Event('online'));
  await hasta(() => one('SELECT estado FROM ordenes WHERE id=607').estado === 'completada', 'la 607 se envía y entra');
  const iniciar607 = enviados.find((op) => op.tipo === 'orden.iniciar' && op.ordenId === 607);
  ok(Array.isArray(iniciar607?.acciones) && iniciar607.acciones.length === 0, '«acciones» va vacía: ' + JSON.stringify(iniciar607));
  ok(['', '[]', null].includes(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=607').c), 'El servidor no le siembra pasos que el técnico no vio');

  // ══ El servidor no acepta el envío: lo escrito vuelve a la orden para corregir y reenviar ══
  ahora = enSV('11:50');
  orden(603, 'emergencia', '[Emergencia] Falla de energía - PE-01', 81, 'infraestructura', null);
  sqlite.prepare('UPDATE ordenes SET procedimiento_id=? WHERE id=603').run(eop.id);
  await abrir('https://test.invalid/campo#orden-603');
  await hasta(() => /Ya estoy en el sitio/.test(texto()), 'la 603 abre');
  enLinea = false; w.dispatchEvent(new w.Event('offline'));
  await clic('llegue'); await clic('hecho'); await clic('hecho'); await clic('hecho');
  await clic('controlado'); await clic('restablecido');
  const nota603 = 'La transferencia quedó trabada; la liberé a mano y la planta tomó la carga.';
  escribir('#nota-fin', nota603);
  ahora = enSV('11:55');
  await clic('enviar');
  ok(/Guardado en tu celular/.test(texto()));
  // Mientras tanto, la jefatura le agregó a la orden un paso que el técnico no ha visto.
  sqlite.prepare('UPDATE ordenes SET checklist_ejecucion=? WHERE id=603').run(JSON.stringify([eop.a1, eop.a2, eop.a3, 'Avisar a la supervisión de Enfermería'].map((t) => ({ texto: t.trim(), estado: 'pendiente' }))));
  ahora = enSV('12:00');
  enLinea = true; w.dispatchEvent(new w.Event('online'));
  await hasta(() => one("SELECT COUNT(*) n FROM campo_operaciones WHERE orden_id=603 AND tipo='orden.terminar' AND resultado='rechazada'").n === 1, 'el servidor no acepta el envío');
  await clic('ir', '[data-h="#hoy"]');
  await hasta(() => /1 registro sin aceptar/.test(texto()) && doc.querySelector('.ahora [data-h="#orden-603"]'), 'Hoy avisa y la orden vuelve');
  await clic('verRechazos');
  anotar('rechazos');
  const cod603 = one('SELECT codigo FROM ordenes WHERE id=603').codigo;
  ok(cod603 && hoja().includes(`${cod603} · ${eop.titulo}`), 'Dice de qué orden es: ' + hoja().slice(0, 300));
  ok(/Enviar a verificación: .*pendiente/.test(hoja()), 'Qué se intentó y por qué no entró: ' + hoja().slice(0, 300));
  ok(hoja().includes(`Lo que escribiste: «${nota603}»`) && /volvió a su orden/.test(hoja()), 'Y que lo escrito volvió a la orden');
  await clic('ir', '[data-h="#orden-603"]');
  ok(/Acción 4 de 4/.test(texto()) && /Avisar a la supervisión de Enfermería/.test(texto()), 'Primero lo que falta: ' + texto().slice(0, 200));
  await clic('hecho');
  igual(doc.querySelector('#nota-fin')?.value, nota603, 'El texto volvió al borrador de la orden');
  await clic('enviar');
  await hasta(() => one('SELECT estado FROM ordenes WHERE id=603').estado === 'completada', 'se reenvía y entra');
  ok(one('SELECT trabajos_realizados t FROM ordenes WHERE id=603').t.includes(nota603), 'Con lo que escribió el técnico');
  await clic('ir', '[data-h="#hoy"]');
  await clic('verRechazos');
  await clic('limpiarRechazos');

  // ══ Foto tomada en «Hay un problema» y luego «Cancelar»: sale de la cola y la hoja lo dice ══
  ahora = enSV('12:10');
  orden(502, 'preventivo', '[Preventivo] Mensual - AC-82', 82, 'aires', CHECKLIST);
  const pedido502 = 'Revisar el drenaje con la sala desocupada; la jefatura de Enfermería confirmó la ventana por escrito y pidió dejar la sala lista antes de las cirugías de la tarde, con el filtro nuevo y sin goteo en el cielo falso.';
  sqlite.prepare('UPDATE ordenes SET descripcion=? WHERE id=502').run(pedido502);
  await abrir('https://test.invalid/campo#orden-502');
  await hasta(() => /3 pasos/.test(texto()), 'el preventivo 502');
  // Un pedido largo se recorta en su caja; al tocarlo se ve entero, sin mover el botón.
  const pedido = [...doc.querySelectorAll('.dato')].find((d) => /Lo que pidieron/.test(d.textContent))?.querySelector('b.recorte');
  ok(pedido && pedido.textContent === pedido502 && !pedido.classList.contains('entero'), 'El pedido largo, recortado');
  pedido.click(); await espera();
  ok(pedido.classList.contains('entero') && doc.querySelector('.marco > .paso-pie [data-a="empezar"]'), 'Al tocarlo se ve entero; Empezar sigue en el pie');
  enLinea = false; w.dispatchEvent(new w.Event('offline'));
  await clic('empezar');
  ok(/Paso 1 de 3/.test(texto()));
  await clic('problema');
  await fotoEn('#foto-problema');
  ok(/Sin señal · 2 por enviar/.test(pill()), 'La foto, en la cola: ' + pill());
  await clic('cerrarHoja');
  ok(!hoja(), 'Cancelar cierra la hoja');
  ok(/Sin señal · 1 por enviar/.test(pill()), 'Cancelar saca la foto de la cola: ' + pill());
  await clic('problema');
  ok(/Tomar foto/.test(hoja()) && !/foto lista/.test(hoja()), 'La hoja dice lo que de verdad se envía: ' + hoja().slice(0, 200));
  await clic('cerrarHoja');
  await abrir(w.location.href);
  await hasta(() => /Paso 1 de 3/.test(texto()), 'recargada sin señal');
  ok(/1 por enviar/.test(pill()), 'Recargar no la trae de vuelta: ' + pill());
  const subidas = r2.length;
  enLinea = true; w.dispatchEvent(new w.Event('online'));
  await hasta(() => one('SELECT estado FROM ordenes WHERE id=502').estado === 'en_proceso' && !/por enviar/.test(pill()), 'el preventivo empieza en el servidor');
  await espera(60);
  igual(r2.length, subidas, 'Ninguna foto subió');
  igual(one('SELECT COUNT(*) n FROM adjuntos WHERE orden_id=502').n, 0, 'La orden no tiene una foto sin su nota');
  sqlite.exec("UPDATE ordenes SET estado='cancelada' WHERE id=502");

  // ══ Una orden libre pasa a ser del técnico con el primer permiso o al llegar, también en la copia del día ══
  ahora = enSV('12:20');
  sqlite.exec(`INSERT INTO ordenes(id,creado_por,titulo,rubro,tipo,activo_id,estado,asignado_a,sucursal_id,ubicacion_id) VALUES
    (703,1,'[Intervención] Cambio de tarjeta - CH-83','aires','intervencion',83,'abierta',NULL,8,83),
    (608,1,'[Emergencia] Falla de energía - PE-01','infraestructura','emergencia',81,'abierta',NULL,8,81);
    INSERT INTO orden_prerrequisitos(orden_id,texto,tipo,obligatorio,orden) VALUES(703,'Permiso de trabajo firmado','permiso_trabajo',1,1);`);
  sqlite.prepare('UPDATE ordenes SET procedimiento_id=? WHERE id=608').run(eop.id);
  altoVentana = 640;
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => /Sin asignar en esta sede/.test(texto()), 'las libres en Hoy');
  // Con una emergencia que nadie atiende, «Sin asignar en esta sede» aparece abierto, también en una pantalla baja.
  ok(doc.querySelector('[data-g="libres"]')?.getAttribute('aria-expanded') === 'true' && doc.querySelector('.resto [data-h="#orden-608"]') && doc.querySelector('.resto [data-h="#orden-703"]'), 'Con la emergencia libre, el grupo aparece abierto: ' + texto().slice(0, 300));
  altoVentana = 768;
  enLinea = false; w.dispatchEvent(new w.Event('offline'));
  const abrirLibres = async () => { if (doc.querySelector('[data-g="libres"]')?.getAttribute('aria-expanded') !== 'true') await clic('grupo', '[data-g="libres"]'); };
  await abrirLibres();
  ok(/2 para tomar/.test(doc.querySelector('[data-g="libres"]').textContent) && doc.querySelector('.resto [data-h="#orden-703"]'), 'Las dos, libres');
  await clic('ir', '[data-h="#orden-703"]');
  ok(/0 de 1 permiso cumplido/.test(texto()), texto().slice(0, 200));
  await clic('verPermiso', '.b1');
  escribir('#referencia', 'PT-0460, J. Pérez');
  await clic('cumplido');
  ok(/1 de 1 permiso cumplido/.test(texto()) && doc.querySelector('.paso-pie [data-a="empezar"]'), 'Con su permiso, Empezar');
  await clic('ir', '[data-h="#hoy"]');
  await abrirLibres();
  ok(/1 para tomar/.test(doc.querySelector('[data-g="libres"]').textContent) && !doc.querySelector('.resto [data-h="#orden-703"]'), 'La intervención ya no está entre las libres: ' + texto().slice(0, 300));
  ok(doc.querySelector('.ahora')?.textContent.includes('Chiller del edificio'), 'Es la siguiente del técnico: ' + bloque());
  await clic('ir', '[data-h="#orden-608"]');
  await clic('llegue');
  ok(/Acción 1 de 3/.test(texto()));
  await clic('salir');
  ok(doc.querySelector('.ahora [data-h="#orden-608"]') && !doc.querySelector('[data-g="libres"]'), 'Al llegar, la emergencia libre es suya: ' + texto().slice(0, 300));
  // Vuelve la señal, pero el paquete del día no se puede traer: la copia guardada ya las tiene como suyas.
  hoyFalla = true; enLinea = true; w.dispatchEvent(new w.Event('online'));
  await hasta(() => one('SELECT asignado_a a FROM ordenes WHERE id=703').a === 3 && one('SELECT asignado_a a FROM ordenes WHERE id=608').a === 3 && one('SELECT estado FROM ordenes WHERE id=608').estado === 'en_proceso', 'el servidor se las asigna');
  await espera(80);
  const copia = await leerGuardado('hoy:3');
  ok(copia.ordenes.some((o) => o.id === 703) && !copia.libres.some((o) => o.id === 703), 'En la copia del día, la intervención es del técnico');
  ok(copia.ordenes.some((o) => o.id === 608) && !copia.libres.some((o) => o.id === 608), 'Y la emergencia también');
  hoyFalla = false;
  enLinea = false; w.dispatchEvent(new w.Event('offline'));
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => /Hola/.test(texto()), 'Hoy sin señal');
  ok(!doc.querySelector('[data-g="libres"]') && doc.querySelector('.ahora [data-h="#orden-608"]'), 'Recargada sin señal, siguen siendo suyas');
  enLinea = true;
  sqlite.exec("UPDATE ordenes SET estado='cancelada' WHERE id IN (608,703)");
  ok(enviados.every((op) => !('borrador' in op)), 'Lo que vuelve al borrador no viaja al servidor');

  // ══ Un problema ya anotado con su foto, y la hoja abierta otra vez en ese paso: «Cancelar» no se lleva
  // esa foto. Con «Hay un problema» y con la hoja de una lectura fuera de rango, también recargada ══
  ahora = enSV('12:21');
  orden(503, 'preventivo', '[Preventivo] Semestral - AC-82', 82, 'aires', CHECKLIST);
  await abrir('https://test.invalid/campo#orden-503');
  await hasta(() => /3 pasos/.test(texto()), 'el preventivo 503');
  enLinea = false; w.dispatchEvent(new w.Event('offline'));
  await clic('empezar');
  await clic('hecho');
  ok(/Paso 2 de 3/.test(texto()), texto().slice(0, 120));
  await clic('problema');
  escribir('#nota-problema', 'Filtro roto, hay que cambiarlo');
  await fotoEn('#foto-problema');
  await clic('problemaSeguir');
  ok(/Paso 3 de 3/.test(texto()) && /Sin señal · 4 por enviar/.test(pill()), 'Anotado, con su foto en la cola: ' + pill());
  escribir('#lectura', '15');
  await clic('lectura');
  ok(/¿Qué encontraste\?/.test(hoja()) && /Lectura 15 A/.test(hoja()), 'La hoja de la lectura fuera de rango: ' + hoja().slice(0, 120));
  escribir('#nota-problema', 'Corriente alta en el compresor');
  await fotoEn('#foto-problema');
  await clic('problemaSeguir');
  ok(/3 de 3 pasos anotados/.test(texto()), texto().slice(0, 120));
  await espera(60);
  const fotos503 = (await enCola()).filter((op) => op.tipo === 'foto' && op.ordenId === 503);
  ok(fotos503.length === 2 && fotos503.every((op) => !op.clave), 'Las dos fotos, en la cola guardada, ya sin la clave de su hoja: ' + JSON.stringify(fotos503.map((op) => op.clave ?? null)));
  w.dispatchEvent(new w.Event('pagehide')); await espera(60);
  await abrir(w.location.href);
  await hasta(() => /3 de 3 pasos anotados/.test(texto()), 'recargada sin señal');
  await clic('anterior');
  ok(/Paso 3 de 3/.test(texto()), texto().slice(0, 120));
  await clic('problema');
  ok(/Tomar foto/.test(hoja()) && !/foto lista/.test(hoja()), 'La hoja otra vez, sin fotos suyas: ' + hoja().slice(0, 200));
  await clic('cerrarHoja');
  ok(!hoja() && /Sin señal · 6 por enviar/.test(pill()), 'Cancelar no se lleva la foto de la lectura ya anotada: ' + pill());
  await clic('anterior');
  // Un paso ya marcado dice cómo está guardado, con su estado y su nota, sin «Anotaste».
  ok(/Paso 2 de 3/.test(texto()) && texto().includes('Ya está marcado: Hay un problema. Nota: Filtro roto') && !/Anotaste/.test(texto()), texto().slice(0, 160));
  await clic('problema');
  await fotoEn('#foto-problema');
  ok(/Sin señal · 7 por enviar/.test(pill()), 'Una foto nueva en esta hoja: ' + pill());
  await clic('cerrarHoja');
  ok(/Sin señal · 6 por enviar/.test(pill()), 'Cancelar saca solo la foto de esta hoja, no la del problema ya anotado: ' + pill());
  const subidas503 = r2.length;
  enLinea = true; w.dispatchEvent(new w.Event('online'));
  await hasta(() => one('SELECT COUNT(*) n FROM adjuntos WHERE orden_id=503').n === 2 && !/por enviar|Enviando/.test(pill()), 'al volver la señal, las dos fotos suben');
  igual(r2.length, subidas503 + 2, 'Dos fotos, las de lo anotado');
  igual(one("SELECT COUNT(*) n FROM campo_operaciones WHERE orden_id=503 AND resultado='rechazada'").n, 0, 'Sin rechazos: ' + JSON.stringify(all("SELECT tipo, detalle FROM campo_operaciones WHERE orden_id=503 AND resultado='rechazada'")));
  sqlite.exec("UPDATE ordenes SET estado='cancelada' WHERE id=503");

  // ══ Teléfono lento: la foto todavía se reduce cuando el técnico anota y sigue. Es de lo anotado: ninguna hoja
  // posterior la muestra como suya ni la cancela. La de una hoja cancelada mientras se reducía no se envía. Y la
  // foto final que se reduce mientras se envía la orden sale antes que el envío ══
  ahora = enSV('12:22');
  orden(506, 'preventivo', '[Preventivo] Anual - AC-82', 82, 'aires', CHECKLIST);
  await abrir('https://test.invalid/campo#orden-506');
  await hasta(() => /3 pasos/.test(texto()), 'el preventivo 506');
  enLinea = false; w.dispatchEvent(new w.Event('offline'));
  await clic('empezar');
  await clic('hecho');
  await clic('problema');
  escribir('#nota-problema', 'Filtro roto, hay que cambiarlo');
  let soltarFoto = frenarFoto();
  tomarFoto('#foto-problema');
  await espera();
  ok(/Reduciendo la foto…/.test(hoja()), 'La foto se está reduciendo: ' + hoja().slice(0, 200));
  await clic('problemaSeguir');
  ok(/Paso 3 de 3/.test(texto()), 'Anota y sigue sin esperar la foto: ' + texto().slice(0, 120));
  soltarFoto(); await espera(60);
  const fotos506 = async () => (await enCola()).filter((op) => op.tipo === 'foto' && op.ordenId === 506);
  let cola506 = await fotos506();
  ok(cola506.length === 1 && !cola506[0].clave, 'La foto entra a la cola como de lo anotado, sin la clave de la hoja: ' + JSON.stringify(cola506.map((op) => op.clave ?? null)));
  await clic('anterior');
  await clic('problema');
  ok(/Tomar foto/.test(hoja()) && !/foto lista/.test(hoja()), 'La hoja abierta otra vez no la muestra como suya: ' + hoja().slice(0, 200));
  await clic('cerrarHoja');
  ok(doc.querySelector('#aviso').hidden || !/ya se había enviado/.test(doc.querySelector('#aviso').textContent), 'Ni dice que una foto suya ya salió');
  igual((await fotos506()).length, 1, 'Cancelar esa hoja no se lleva la foto de lo anotado');
  // Se cancela la hoja mientras la foto se reduce: la foto no se envía.
  await clic('problema');
  soltarFoto = frenarFoto();
  tomarFoto('#foto-problema');
  await espera();
  await clic('cerrarHoja');
  soltarFoto(); await espera(60);
  igual((await fotos506()).length, 1, 'La foto de la hoja cancelada no entra a la cola');
  await clic('salir');
  await clic('ir', '[data-h="#orden-506"]');
  ok(/Paso 3 de 3/.test(texto()), texto().slice(0, 120));
  escribir('#lectura', '10');
  await clic('lectura');
  ok(/3 de 3 pasos anotados/.test(texto()), texto().slice(0, 120));
  enLinea = true; w.dispatchEvent(new w.Event('online'));
  await hasta(() => one('SELECT COUNT(*) n FROM adjuntos WHERE orden_id=506').n === 1 && one("SELECT COUNT(*) n FROM orden_paso_marcas WHERE orden_id=506").n === 3 && !enVuelo, 'lo anotado llega con su foto');
  // Con señal, la foto final se reduce mientras el técnico envía la orden: el envío la espera.
  soltarFoto = frenarFoto();
  tomarFoto('#foto-final');
  await espera();
  await clic('enviar');
  await espera(120);
  igual(one('SELECT estado FROM ordenes WHERE id=506').estado, 'en_proceso', 'El envío espera a la foto que se reduce');
  soltarFoto();
  await hasta(() => one('SELECT estado FROM ordenes WHERE id=506').estado === 'completada' && one('SELECT COUNT(*) n FROM adjuntos WHERE orden_id=506').n === 2, 'la foto final y la orden llegan');
  igual(one("SELECT categoria c FROM adjuntos WHERE orden_id=506 ORDER BY id DESC LIMIT 1").c, 'despues', 'La final, como foto de después');
  igual(one("SELECT COUNT(*) n FROM campo_operaciones WHERE orden_id=506 AND resultado='rechazada'").n, 0, 'Sin rechazos: ' + JSON.stringify(all("SELECT tipo, detalle FROM campo_operaciones WHERE orden_id=506 AND resultado='rechazada'")));
  await espera(60);
  ok(!Object.keys((await leerGuardado('borrador:3'))?.fotos ?? {}).some((k) => /:506(:|$)/.test(k)), 'Ninguna hoja de esa orden se queda con la foto como suya');
  sqlite.exec("UPDATE ordenes SET estado='cancelada' WHERE id=506");

  // ══ Señal lenta: la emergencia sin documento abre al instante con lo que hay y se pide por detrás, una
  // vez. Lo que llega mientras el técnico está en otra orden no lo hace saltar; pasado el límite de 4 s,
  // lo que llega ya no repinta ══
  ahora = enSV('12:23');
  orden(609, 'emergencia', '[Emergencia] Falla de energía - PE-01', 81, 'infraestructura', null);
  orden(610, 'emergencia', '[Emergencia] Falla de energía - PE-01', 81, 'infraestructura', null);
  sqlite.prepare('UPDATE ordenes SET procedimiento_id=? WHERE id IN (609,610)').run(eop.id);
  orden(505, 'preventivo', '[Preventivo] Bimestral - AC-82', 82, 'aires', CHECKLIST);
  orden(611, 'emergencia', '[Emergencia] Falla de energía - PE-01', 81, 'infraestructura', null);
  sqlite.prepare('UPDATE ordenes SET procedimiento_id=? WHERE id=611').run(eop.id);
  sinEop.add(609); sinEop.add(610); sinEop.add(611);
  retener.add('609'); retener.add('610'); retener.add('611');
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => principal() === '#orden-609' && doc.querySelector('.ahora .otra[data-h="#orden-610"]') && doc.querySelector('[data-h="#orden-505"]'), 'Hoy, con las emergencias sin su documento');
  await clic('ir', '[data-h="#orden-610"]');
  ok(/Ya estoy en el sitio/.test(texto()) && !/EOP-ELE-01/.test(texto()), 'La emergencia abre al instante, con lo que hay: ' + texto().slice(0, 160));
  igual(pedidasDe['610'], 1, 'Y se pide por detrás');
  await espera(4300);
  soltar('610'); await espera(80);
  ok(w.location.hash === '#orden-610' && /Ya estoy en el sitio/.test(texto()) && !/EOP-ELE-01/.test(texto()), 'Pasado el límite, lo que llega tarde no repinta: ' + texto().slice(0, 160));
  await clic('ir', '[data-h="#hoy"]');
  await clic('ir', '.b1[data-h="#orden-609"]');
  ok(/Ya estoy en el sitio/.test(texto()) && !/EOP-ELE-01/.test(texto()) && pedidasDe['609'] === 1, 'La otra también abre al instante: ' + texto().slice(0, 160));
  await clic('ir', '[data-h="#hoy"]');
  await clic('ir', '[data-h="#orden-505"]');
  await clic('empezar');
  ok(/Paso 1 de 3/.test(texto()), texto().slice(0, 120));
  soltar('609'); await espera(80);
  ok(w.location.hash === '#orden-505' && /Paso 1 de 3/.test(texto()), 'La respuesta que llega después no lo hace saltar: ' + w.location.hash + ' · ' + texto().slice(0, 120));
  await clic('salir');
  await clic('ir', '.b1[data-h="#orden-609"]');
  ok(/EOP-ELE-01/.test(texto()) && pedidasDe['609'] === 1 && pedidasDe['610'] === 1, 'Lo que llegó a tiempo quedó en el celular, sin pedirla otra vez: ' + texto().slice(0, 160));
  // La que el técnico ya empezó se queda como la empezó: lo que llega por detrás, a tiempo, no la repinta ni le
  // agrega acciones que no vio.
  await clic('ir', '[data-h="#hoy"]');
  await clic('ir', '.otra[data-h="#orden-611"]');
  ok(/Ya estoy en el sitio/.test(texto()) && !/EOP-ELE-01/.test(texto()) && pedidasDe['611'] === 1, 'La 611 abre al instante y se pide por detrás: ' + texto().slice(0, 160));
  await clic('llegue');
  ok(/¿Ya está controlado\?/.test(texto()), 'Sin acciones a la vista, a la pregunta: ' + texto().slice(0, 120));
  await hasta(() => one('SELECT hora_llegada h FROM ordenes WHERE id=611').h && !/por enviar|Enviando/.test(pill()), 'la llegada entra');
  await espera(80); // y vuelve el día
  soltar('611'); await espera(80);
  ok(/¿Ya está controlado\?/.test(texto()), 'Lo que llega a tiempo no repinta la emergencia ya empezada: ' + texto().slice(0, 120));
  await clic('salir');
  ok(principal() === '#orden-611' && /Falta confirmar que está controlado/.test(bloque()) && !/Acción \d/.test(bloque()), 'Ni le agrega acciones que no vio: ' + bloque());
  sinEop.clear();
  sqlite.exec("UPDATE ordenes SET estado='cancelada' WHERE id IN (609,610,611,505)");

  // ══ Una orden que no está en el celular se pide al servidor. Mientras llega, el técnico puede irse a otra
  // orden: lo que llega después no lo hace saltar. Si la espera, se abre y «Abriendo la orden…» no se queda encima ══
  ahora = enSV('12:24');
  orden(512, 'preventivo', '[Preventivo] Mensual - AC-82', 82, 'aires', CHECKLIST);
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => doc.querySelector('.ahora [data-a="empezar"][data-id="512"]'), 'Hoy con el 512');
  // Una orden que la jefatura asignó después de que llegó el día.
  orden(514, 'preventivo', '[Preventivo] Trimestral - CH-83', 83, 'aires', CHECKLIST);
  const irA = (hash) => { w.history.pushState({}, '', hash); w.dispatchEvent(new w.Event('popstate')); };
  const avisoVisible = () => (doc.querySelector('#aviso').hidden ? '' : doc.querySelector('#aviso').textContent);
  retener.add('514');
  irA('#orden-514');
  await espera();
  ok(avisoVisible() === 'Abriendo la orden…' && pedidasDe['514'] === 1, 'La pide y lo dice: ' + avisoVisible());
  await clic('empezar', '[data-id="512"]');
  ok(/Paso 1 de 3/.test(texto()) && texto().includes('Minisplit quirófano 2'), 'Mientras llega, empieza otra orden: ' + texto().slice(0, 160));
  soltar('514'); await espera(80);
  ok(w.location.hash === '#orden-512' && /Paso 1 de 3/.test(texto()) && !texto().includes('Chiller del edificio'), 'La que llega después no lo hace saltar: ' + w.location.hash + ' · ' + texto().slice(0, 160));
  await clic('salir');
  await hasta(() => !enVuelo, 'el día vuelve');
  orden(515, 'preventivo', '[Preventivo] Semestral - PE-01', 81, 'infraestructura', CHECKLIST);
  retener.add('515');
  irA('#orden-515');
  await espera();
  ok(avisoVisible() === 'Abriendo la orden…', 'Mientras llega, lo dice: ' + avisoVisible());
  soltar('515');
  await hasta(() => texto().includes('Planta eléctrica de emergencia') && /3 pasos/.test(texto()), 'la orden llega y se abre');
  ok(!avisoVisible(), '«Abriendo la orden…» no se queda encima de la orden abierta: ' + avisoVisible());
  sqlite.exec("UPDATE ordenes SET estado='cancelada' WHERE id IN (512,514,515)");

  // ══ Un 0 también es una lectura: viaja en la novedad de un paso fuera de rango y en la de un punto crítico
  // que deja la orden en espera ══
  ahora = enSV('12:25');
  const CK_CRITICO = JSON.stringify([
    { texto: 'Medir aislamiento', bloqueante: true, requiereValor: true, unidad: 'MΩ', esperadoMin: 1.125, estado: 'pendiente' },
    { texto: 'Limpiar el tablero', estado: 'pendiente' },
  ]);
  orden(510, 'preventivo', '[Preventivo] Mensual - PE-01', 81, 'infraestructura', CHECKLIST);
  orden(511, 'preventivo', '[Preventivo] Anual - PE-01', 81, 'infraestructura', CK_CRITICO);
  await abrir('https://test.invalid/campo#orden-510');
  await hasta(() => /3 pasos/.test(texto()), 'el 510');
  await clic('empezar'); await clic('hecho'); await clic('hecho');
  escribir('#lectura', '0');
  await clic('lectura');
  ok(/Lectura 0 A · normal 8 a 12 A/.test(hoja()), 'El 0, fuera de rango: ' + hoja().slice(0, 160));
  escribir('#nota-problema', 'El compresor no arranca y no marca corriente');
  await clic('problemaSeguir');
  await hasta(() => enviados.some((op) => op.tipo === 'orden.paso' && op.ordenId === 510 && op.idx === 2), 'sale el paso');
  igual(enviados.find((op) => op.tipo === 'orden.paso' && op.ordenId === 510 && op.idx === 2).valor, 0, 'La novedad del paso lleva su 0');
  sqlite.exec("UPDATE ordenes SET estado='cancelada' WHERE id=510");
  await abrir('https://test.invalid/campo#orden-511');
  await hasta(() => /2 pasos/.test(texto()), 'el 511');
  await clic('empezar');
  escribir('#lectura', '0');
  await clic('lectura');
  ok(/Lectura 0 MΩ · normal mínimo 1\.1250 MΩ/.test(hoja()) && doc.querySelector('[data-a="problemaDetener"]'), 'El punto crítico en 0, con su mínimo escrito para leerse igual: ' + hoja().slice(0, 160));
  escribir('#nota-problema', 'Aislamiento en cero: el tablero tiene una fuga a tierra');
  await clic('problemaDetener');
  await hasta(() => enviados.some((op) => op.tipo === 'orden.pausar' && op.ordenId === 511), 'la orden queda en espera');
  igual(enviados.find((op) => op.tipo === 'orden.paso' && op.ordenId === 511 && op.idx === 0)?.valor, 0, 'La novedad del punto crítico lleva su 0');
  await hasta(() => one('SELECT estado FROM ordenes WHERE id=511').estado === 'en_espera', 'en espera en el servidor');
  igual(JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=511').c)[0].valorMedido, 0, 'Y el servidor guardó el 0');
  sqlite.exec("UPDATE ordenes SET estado='cancelada' WHERE id=511");

  // ══ K7 · Un rango con tres decimales se escribe para leerse igual: solo el máximo, «máximo 1.1250»; mínimo y
  // máximo, «1.1250 a 2.25». En el paso y en la hoja de la lectura fuera de rango ══
  orden(516, 'preventivo', '[Preventivo] Mensual - PE-01', 81, 'infraestructura', JSON.stringify([
    { texto: 'Medir el juego del eje', requiereValor: true, unidad: 'mm', esperadoMax: 1.125, estado: 'pendiente' },
    { texto: 'Medir la holgura de la banda', requiereValor: true, unidad: 'mm', esperadoMin: 1.125, esperadoMax: 2.25, estado: 'pendiente' },
  ]));
  await abrir('https://test.invalid/campo#orden-516');
  await hasta(() => /2 pasos/.test(texto()), 'el 516');
  await clic('empezar');
  ok(/Paso 1 de 2/.test(texto()) && /Normal: máximo 1\.1250 mm/.test(texto()), 'El paso dice su máximo escrito para leerse igual: ' + texto().slice(0, 200));
  escribir('#lectura', '3');
  await clic('lectura');
  ok(/Lectura 3 mm · normal máximo 1\.1250 mm/.test(hoja()), 'Fuera de rango, la hoja dice «máximo 1.1250»: ' + hoja().slice(0, 160));
  await clic('problemaSeguir');
  ok(/Paso 2 de 2/.test(texto()) && /Normal: 1\.1250 a 2\.25 mm/.test(texto()), 'El segundo paso dice su rango: ' + texto().slice(0, 200));
  escribir('#lectura', '3');
  await clic('lectura');
  ok(/Lectura 3 mm · normal 1\.1250 a 2\.25 mm/.test(hoja()), 'Y la hoja dice «1.1250 a 2.25»: ' + hoja().slice(0, 160));
  await clic('cerrarHoja');
  sqlite.exec("UPDATE ordenes SET estado='cancelada' WHERE id=516");

  // ══ K8 · Antes de enviar a verificación, cada paso que pide lectura la tiene. Si falta, el celular lo dice con la
  // frase de siempre y lleva a ese paso, sin enviar: el servidor no lo aceptaría. Un texto en un paso sin rango sí se acepta ══
  orden(517, 'preventivo', '[Preventivo] Bimestral - PE-01', 81, 'infraestructura', JSON.stringify([
    { texto: 'Medir corriente', requiereValor: true, unidad: 'A', esperadoMin: 8, esperadoMax: 12, estado: 'pendiente' },
    { texto: 'Anotar la placa del motor', requiereValor: true, estado: 'pendiente' },
  ]));
  await abrir('https://test.invalid/campo#orden-517');
  await hasta(() => /2 pasos/.test(texto()), 'el 517');
  await clic('empezar');
  // «Hay un problema» sin anotar la lectura: los dos pasos quedan sin ella.
  for (const [i, nota] of [[1, 'El amperímetro no enciende'], [2, 'La placa del motor está ilegible']]) {
    ok(new RegExp(`Paso ${i} de 2`).test(texto()), texto().slice(0, 120));
    await clic('problema');
    escribir('#nota-problema', nota);
    await clic('problemaSeguir');
  }
  ok(/2 de 2 pasos anotados/.test(texto()), texto().slice(0, 120));
  const terminadas = (id) => enviados.filter((op) => op.tipo === 'orden.terminar' && op.ordenId === id).length;
  const avisoAhora = () => (doc.querySelector('#aviso').hidden ? '' : doc.querySelector('#aviso').textContent);
  await clic('enviar');
  anotar('falta la lectura antes de enviar');
  ok(/Paso 1 de 2/.test(texto()) && doc.querySelector('#lectura') && avisoAhora() === 'Escribe la lectura para seguir.', 'Sin la lectura del paso con rango, lo dice y lleva a ese paso: ' + texto().slice(0, 160) + ' · ' + avisoAhora());
  await espera(60);
  igual(terminadas(517), 0, 'Y no envía');
  escribir('#lectura', '10');
  await clic('lectura');
  ok(/2 de 2 pasos anotados/.test(texto()), texto().slice(0, 120));
  // P16 · El paso que ya quedó con «Hay un problema» recibe su lectura y sigue con su problema y su nota.
  ok(/2 de 2 puntos realizados, 2 con novedad/.test(texto()) && !/sin novedad/.test(texto()), 'Con su lectura, el paso sigue con su problema: ' + texto().slice(0, 300));
  await clic('enviar');
  ok(/Paso 2 de 2/.test(texto()) && avisoAhora() === 'Escribe la lectura para seguir.', 'El paso sin rango y sin nada escrito, también: ' + texto().slice(0, 160));
  // Un texto en un paso sin rango se acepta: no se juzga contra un rango.
  escribir('#lectura', 'Placa WEG 14,5 A');
  igual(doc.querySelector('#lect-estado').textContent, '', 'Mientras lo escribe, sin aviso');
  await clic('lectura');
  ok(/2 de 2 pasos anotados/.test(texto()), 'El texto se guarda y sigue: ' + texto().slice(0, 120));
  await hasta(() => enviados.some((op) => op.tipo === 'orden.paso' && op.ordenId === 517 && op.idx === 1 && op.valor === 'Placa WEG 14,5 A'), 'sale como texto');
  igual(terminadas(517), 0, 'Todavía no envía');
  await clic('enviar');
  await hasta(() => one('SELECT estado FROM ordenes WHERE id=517').estado === 'completada', 'con sus lecturas, se envía');
  const o517 = one('SELECT checklist_ejecucion c, trabajos_realizados t FROM ordenes WHERE id=517');
  const p517 = JSON.parse(o517.c);
  ok(p517[0].estado === 'desviacion' && p517[0].notas === 'El amperímetro no enciende' && p517[0].valorMedido === 10, 'En el servidor, el paso sigue con su problema, su nota y su lectura: ' + JSON.stringify(p517[0]));
  ok(p517[1].estado === 'desviacion' && p517[1].notas === 'La placa del motor está ilegible' && p517[1].valorMedido === 'Placa WEG 14,5 A', 'El paso sin rango, también: ' + JSON.stringify(p517[1]));
  ok(o517.t.includes('2 con novedad') && o517.t.includes('Novedad en «Medir corriente»: El amperímetro no enciende') && !o517.t.includes('sin novedad'), 'Y los trabajos lo dicen: ' + o517.t);
  igual(one("SELECT COUNT(*) n FROM campo_operaciones WHERE orden_id=517 AND resultado='rechazada'").n, 0, 'Sin rechazos: ' + JSON.stringify(all("SELECT tipo, detalle FROM campo_operaciones WHERE orden_id=517 AND resultado='rechazada'")));
  // Un paso con rango que ya tenía guardado un texto (de antes de esta versión): la frase del número. Con «1,200»,
  // la de un número que se lee de dos formas.
  orden(518, 'preventivo', '[Preventivo] Trimestral - PE-01', 81, 'infraestructura', JSON.stringify([
    { texto: 'Medir corriente', requiereValor: true, unidad: 'A', esperadoMin: 8, esperadoMax: 12, estado: 'ok', valorMedido: 'ok' },
    { texto: 'Medir voltaje', requiereValor: true, unidad: 'V', esperadoMin: 100, esperadoMax: 130, estado: 'ok', valorMedido: '1,200' },
  ]));
  sqlite.prepare("UPDATE ordenes SET estado='en_proceso', iniciada_en=? WHERE id=518").run(iso(enSV('12:25')));
  await abrir('https://test.invalid/campo#orden-518');
  await hasta(() => /2 de 2 pasos anotados/.test(texto()), 'el 518, con sus pasos anotados');
  await clic('enviar');
  ok(/Paso 1 de 2/.test(texto()) && doc.querySelector('#lect-estado').textContent === app.reglas.MENSAJE_PASO_SIN_NUMERO, 'Con un texto en el paso con rango, la frase del servidor, junto al campo: ' + texto().slice(0, 200));
  escribir('#lectura', '10');
  await clic('lectura');
  await clic('enviar');
  ok(/Paso 2 de 2/.test(texto()) && doc.querySelector('#lect-estado').textContent === '¿1200 o 1,2? Escribe el número sin separador de miles.', 'Con «1,200», la frase del número que se lee de dos formas: ' + texto().slice(0, 200));
  await espera(60);
  igual(terminadas(518), 0, 'Y no envía');
  escribir('#lectura', '120');
  await clic('lectura');
  await clic('enviar');
  await hasta(() => one('SELECT estado FROM ordenes WHERE id=518').estado === 'completada', 'con sus números, se envía');

  // ══ La jefatura reasigna la orden mientras el técnico la trabaja sin señal: «Ver por qué» la nombra igual
  // en cada registro, aunque el día llegue antes que la respuesta, y no pide abrir una orden que ya no es suya ══
  ahora = enSV('12:26');
  orden(504, 'preventivo', '[Preventivo] Mensual - CH-83', 83, 'aires', CHECKLIST);
  const cod504 = one('SELECT codigo FROM ordenes WHERE id=504').codigo;
  await abrir('https://test.invalid/campo#orden-504');
  await hasta(() => /3 pasos/.test(texto()), 'el preventivo 504');
  await clic('empezar');
  await hasta(() => one('SELECT estado FROM ordenes WHERE id=504').estado === 'en_proceso' && !/por enviar|Enviando/.test(pill()), 'empieza en el servidor');
  enLinea = false; w.dispatchEvent(new w.Event('offline'));
  await clic('hecho');
  await clic('problema');
  const problema504 = 'El filtro está roto y hay que cambiarlo';
  escribir('#nota-problema', problema504);
  await clic('problemaSeguir');
  // Una lectura fuera de rango con tres decimales: viaja como número. Reescrita como texto, «12.345» se leería de
  // dos formas: la hoja (y la nota que se arma con ella) la escribe «12.3450».
  escribir('#lectura', '12,3450');
  await clic('lectura');
  ok(/¿Qué encontraste\?/.test(hoja()) && /Lectura 12\.3450 A · normal 8 a 12 A/.test(hoja()), 'La hoja de la lectura fuera de rango: ' + hoja().slice(0, 120));
  escribir('#nota-problema', 'Corriente alta en el compresor');
  await clic('problemaSeguir');
  await clic('verNota');
  const fin504 = 'Limpié el chiller y medí la corriente.';
  escribir('#nota-fin', fin504);
  await clic('enviar');
  ok(/Guardado en tu celular/.test(texto()), texto().slice(0, 120));
  sqlite.exec('UPDATE ordenes SET asignado_a=1 WHERE id=504');
  demoraSync = 300;
  // La primera vez que pregunta por qué, la respuesta se pierde: vuelve a preguntar al abrir «Ver por qué».
  sinRespuesta.add('504');
  enLinea = true; w.dispatchEvent(new w.Event('online'));
  await hasta(() => one("SELECT COUNT(*) n FROM campo_operaciones WHERE orden_id=504 AND resultado='rechazada'").n === 4, 'el servidor no acepta lo de una orden que ya no es suya');
  demoraSync = 0;
  await clic('ir', '[data-h="#hoy"]');
  await hasta(() => /4 registros sin aceptar/.test(texto()), 'Hoy avisa');
  await clic('verRechazos');
  anotar('rechazos de una orden reasignada');
  const filas504 = [...doc.querySelectorAll('#hoja .fila strong')].map((s) => s.textContent);
  ok(filas504.length === 4 && filas504.every((t) => t === `${cod504} · Chiller del edificio`), 'Cada registro nombra la orden igual, con su código y su nombre: ' + JSON.stringify(filas504));
  ok(!doc.querySelector('#hoja [data-a="ir"][data-h^="#orden-"]'), 'No ofrece abrir una orden que ya no es suya');
  await hasta(() => /Esta orden ya no está a tu nombre: lo que escribiste queda aquí para tu jefatura\./.test(hoja()), 'dice que ya no está a su nombre');
  ok(!/ábrela|se canceló/.test(hoja()), 'Y no pide abrirla: ' + hoja().slice(0, 300));
  ok(hoja().includes(`«${problema504}»`) && hoja().includes(`«${fin504}»`), 'Con lo que escribió');
  ok(enviados.every((op) => !('rotulo' in op)), 'El rótulo no viaja al servidor');
  const lectura504 = enviados.find((op) => op.tipo === 'orden.paso' && op.ordenId === 504 && op.idx === 2);
  ok(lectura504?.valor === 12.345, 'La lectura salió como número, no como texto: ' + JSON.stringify(lectura504?.valor));
  await clic('limpiarRechazos');
  sqlite.exec("UPDATE ordenes SET estado='cancelada' WHERE id=504");

  // ══ La jefatura cancela la orden mientras el técnico la trabaja sin señal: sigue a su nombre, y «Ver por qué»
  // dice que se canceló. Si la envía desde la ficha, que ya no se puede trabajar en el celular ══
  const casos = [
    [508, "estado='cancelada'", 'Esta orden se canceló: lo que escribiste queda aquí para tu jefatura.'],
    [509, `estado='completada', completada_en='${iso(enSV('12:27'))}'`, 'Esta orden ya no se puede trabajar en tu celular: lo que escribiste queda aquí para tu jefatura.'],
  ];
  for (const [id, cambio, frase] of casos) {
    ahora = enSV('12:27');
    orden(id, 'preventivo', '[Preventivo] Mensual - CH-83', 83, 'aires', CHECKLIST);
    await abrir(`https://test.invalid/campo#orden-${id}`);
    await hasta(() => /3 pasos/.test(texto()), `el preventivo ${id}`);
    await clic('empezar');
    await hasta(() => one('SELECT estado FROM ordenes WHERE id=?', id).estado === 'en_proceso' && !/por enviar|Enviando/.test(pill()), 'empieza en el servidor');
    enLinea = false; w.dispatchEvent(new w.Event('offline'));
    await clic('hecho');
    await clic('problema');
    escribir('#nota-problema', 'El filtro está roto y hay que cambiarlo');
    await clic('problemaSeguir');
    sqlite.exec(`UPDATE ordenes SET ${cambio} WHERE id=${id}`);
    // El día no se puede traer: en el celular la orden sigue como estaba, y aun así no se ofrece abrirla.
    hoyFalla = true;
    enLinea = true; w.dispatchEvent(new w.Event('online'));
    await hasta(() => one("SELECT COUNT(*) n FROM campo_operaciones WHERE orden_id=? AND resultado='rechazada'", id).n === 2, 'el servidor no acepta lo anotado');
    await clic('salir');
    await hasta(() => /2 registros sin aceptar/.test(texto()), 'Hoy avisa');
    await clic('verRechazos');
    await hasta(() => hoja().includes(frase), `«Ver por qué» dice por qué: ` + hoja().slice(0, 300));
    anotar(`rechazos de la orden ${id}`);
    igual(one('SELECT asignado_a a FROM ordenes WHERE id=?', id).a, 3, 'Sigue a su nombre');
    ok(!doc.querySelector('#hoja [data-a="ir"][data-h^="#orden-"]') && !/ábrela|ya no está a tu nombre/.test(hoja()), 'No se ofrece abrirla ni se dice que se reasignó: ' + hoja().slice(0, 300));
    await clic('limpiarRechazos');
    hoyFalla = false;
    sqlite.exec(`UPDATE ordenes SET estado='cancelada' WHERE id=${id}`);
  }

  // ══ La jefatura deja sin asignar una orden en curso mientras el técnico la trabaja sin señal: el paquete del día
  // ya no la trae, pero sigue en curso. «Ver por qué» la deja en el celular y ofrece abrirla, llegue antes el día
  // (519) o la respuesta de por qué (520) ══
  const copiaTrae = async (id) => { const c = await leerGuardado('hoy:3'); return [...c.ordenes, ...c.libres].some((o) => o.id === id); };
  for (const [id, primero] of [[519, 'el día'], [520, 'por qué']]) {
    ahora = enSV('12:27');
    orden(id, 'preventivo', '[Preventivo] Semestral - CH-83', 83, 'aires', CHECKLIST);
    await abrir(`https://test.invalid/campo#orden-${id}`);
    await hasta(() => /3 pasos/.test(texto()), `el preventivo ${id}`);
    await clic('empezar');
    await hasta(() => one('SELECT estado FROM ordenes WHERE id=?', id).estado === 'en_proceso' && !/por enviar|Enviando/.test(pill()), 'empieza en el servidor');
    enLinea = false; w.dispatchEvent(new w.Event('offline'));
    await clic('hecho');
    sqlite.exec(`UPDATE ordenes SET asignado_a=NULL WHERE id=${id}`);
    // Lo que llega primero se decide aquí: la respuesta de por qué espera al día, o el día a ella.
    let soltarHoy = null;
    if (primero === 'el día') retener.add(String(id)); else soltarHoy = frenarHoy();
    const pedidas = pedidasDe[String(id)] ?? 0;
    enLinea = true; w.dispatchEvent(new w.Event('online'));
    await hasta(() => one("SELECT COUNT(*) n FROM campo_operaciones WHERE orden_id=? AND resultado='rechazada'", id).n === 1 && pedidasDe[String(id)] === pedidas + 1, 'el servidor no acepta lo anotado y el celular pregunta por qué');
    if (primero === 'el día') {
      await hasta(() => enVuelo === 1, 'el día llega');
      ok(!(await copiaTrae(id)), `(${id}) El día llegó primero y ya no la trae`);
      soltar(String(id));
    } else {
      await espera(60);
      ok(await copiaTrae(id), `(${id}) La respuesta de por qué llegó primero`);
      soltarHoy();
    }
    await hasta(() => !enVuelo && !/Enviando/.test(pill()), 'todo llega');
    await espera(60);
    const delDia = await (await app.hoy.GET(ctx('/api/campo/hoy?sede=8', { rol: 'tecnico' }))).json();
    ok(![...delDia.ordenes, ...delDia.libres].some((o) => o.id === id), `(${id}) El paquete del día ya no la trae`);
    ok(await copiaTrae(id), `(${id}) Pero sigue en la copia del celular`);
    await clic('salir');
    await hasta(() => /1 registro sin aceptar/.test(texto()), 'Hoy avisa');
    await clic('verRechazos');
    ok(doc.querySelector(`#hoja [data-a="ir"][data-h="#orden-${id}"]`) && /Abrir la orden/.test(hoja()), `(${id}) «Ver por qué» ofrece abrir la orden que sigue en curso: ` + hoja().slice(0, 300));
    anotar(`rechazo de una orden en curso que el día no trae (${id})`);
    doc.querySelector(`#hoja [data-a="ir"][data-h="#orden-${id}"]`).click(); await espera();
    ok(/Paso 1 de 3/.test(texto()) && texto().includes('Chiller del edificio'), `(${id}) Se abre en el celular: ` + texto().slice(0, 160));
    await clic('salir');
    await clic('verRechazos');
    await clic('limpiarRechazos');
    sqlite.exec(`UPDATE ordenes SET estado='cancelada' WHERE id=${id}`);
  }

  // ══ P10 · La orden que «Ver por qué» dejó en el celular por seguir en curso se cancela después: al bajar el día se
  // pide otra vez, la copia sale del celular y ya no se ofrece abrirla ══
  ahora = enSV('12:27');
  orden(521, 'preventivo', '[Preventivo] Semestral - CH-83', 83, 'aires', CHECKLIST);
  await abrir('https://test.invalid/campo#orden-521');
  await hasta(() => /3 pasos/.test(texto()), 'el preventivo 521');
  await clic('empezar');
  await hasta(() => one('SELECT estado FROM ordenes WHERE id=521').estado === 'en_proceso' && !/por enviar|Enviando/.test(pill()), 'empieza en el servidor');
  enLinea = false; w.dispatchEvent(new w.Event('offline'));
  await clic('hecho');
  await clic('problema');
  escribir('#nota-problema', 'El filtro está roto y hay que cambiarlo');
  await clic('problemaSeguir');
  sqlite.exec('UPDATE ordenes SET asignado_a=NULL WHERE id=521');
  enLinea = true; w.dispatchEvent(new w.Event('online'));
  await hasta(() => one("SELECT COUNT(*) n FROM campo_operaciones WHERE orden_id=521 AND resultado='rechazada'").n === 2 && pedidasDe['521'] >= 1, 'el servidor no acepta lo anotado y el celular pregunta por qué');
  await hasta(() => !enVuelo && !/Enviando/.test(pill()), 'todo llega');
  ok(await copiaTrae(521), 'Sigue en curso: queda en el celular');
  sqlite.exec("UPDATE ordenes SET estado='cancelada' WHERE id=521");
  const pedidas521 = pedidasDe['521'];
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => pedidasDe['521'] > pedidas521, 'al bajar el día, la pide otra vez');
  await hasta(() => !enVuelo, 'llega la respuesta');
  await espera(60);
  ok(!(await copiaTrae(521)), 'Cancelada, la copia sale del celular');
  await clic('verRechazos');
  anotar('rechazos de una orden en curso que después se canceló');
  ok(!doc.querySelector('#hoja [data-a="ir"][data-h="#orden-521"]'), 'Ya no se ofrece abrirla: ' + hoja().slice(0, 300));
  ok(hoja().includes('Esta orden se canceló: lo que escribiste queda aquí para tu jefatura.'), 'Y dice que se canceló: ' + hoja().slice(0, 300));
  await clic('limpiarRechazos');

  // ══ K17 · Sin señal, el técnico marca un paso; mientras tanto la jefatura lo cambia en la ficha. Al volver la señal
  // la marca no pisa ese cambio: «Ver por qué» dice la frase y «Abrir la orden» trae el paso como lo tiene el servidor.
  // Desde ahí lo revisa y lo marca otra vez, con el paso como se ve ahora ══
  ahora = enSV('12:27');
  orden(530, 'preventivo', '[Preventivo] Mensual - CH-83', 83, 'aires', CHECKLIST);
  await abrir('https://test.invalid/campo#orden-530');
  await hasta(() => /3 pasos/.test(texto()), 'el preventivo 530');
  await clic('empezar');
  await hasta(() => one('SELECT estado FROM ordenes WHERE id=530').estado === 'en_proceso' && !/por enviar|Enviando/.test(pill()), 'empieza en el servidor');
  enLinea = false; w.dispatchEvent(new w.Event('offline'));
  await clic('hecho');
  const base530 = one('SELECT checklist_ejecucion c FROM ordenes WHERE id=530').c;
  const NOTA_JEFA = 'No se bloqueó: falta el candado del tablero.';
  const enFicha = await app.order.PATCH(ctx('/api/ordenes/530', { method: 'PATCH', id: 530, rol: 'jefe', data: { checklistEjecucion: JSON.stringify(JSON.parse(base530).map((x, i) => (i === 0 ? { ...x, estado: 'desviacion', notas: NOTA_JEFA } : x))), checklistBase: base530, soloCambios: true } }));
  igual(enFicha.status, 200, 'La jefatura marca la desviación en la ficha');
  enLinea = true; w.dispatchEvent(new w.Event('online'));
  await hasta(() => one("SELECT COUNT(*) n FROM campo_operaciones WHERE orden_id=530 AND resultado='rechazada'").n === 1, 'el servidor no acepta la marca');
  igual(JSON.stringify(enviados.find((op) => op.tipo === 'orden.paso' && op.ordenId === 530)?.antes), JSON.stringify({ estado: 'pendiente', valor: null, nota: null }), 'La marca salió con el paso como se veía antes');
  const paso530 = () => JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=530').c)[0];
  ok(paso530().estado === 'desviacion' && paso530().notas === NOTA_JEFA && one('SELECT COUNT(*) n FROM orden_paso_marcas WHERE orden_id=530').n === 0, 'El paso queda como lo dejó la jefatura: ' + JSON.stringify(paso530()));
  await hasta(() => !enVuelo && !/Enviando/.test(pill()), 'todo llega');
  await clic('salir');
  await hasta(() => /1 registro sin aceptar/.test(texto()), 'Hoy avisa');
  await clic('verRechazos');
  anotar('rechazo de un paso que cambió en la ficha');
  await hasta(() => hoja().includes('El paso 1 cambió en la ficha mientras tanto: revísalo y márcalo otra vez.') && doc.querySelector('#hoja [data-a="ir"][data-h="#orden-530"]'), '«Ver por qué» dice la frase y ofrece abrir la orden');
  doc.querySelector('#hoja [data-a="ir"][data-h="#orden-530"]').click(); await espera();
  anotar('el paso como lo tiene el servidor');
  // K19 · No en lo que falta (el paso 2): en el paso que cambió, como lo tiene el servidor, sin «Anotaste».
  ok(/Paso 1 de 3/.test(texto()) && texto().includes(`Ya está marcado: Hay un problema. Nota: ${NOTA_JEFA}`) && !/Anotaste/.test(texto()), 'La orden se abre en el paso que cambió, como lo tiene el servidor: ' + texto().slice(0, 200));
  // Lo revisa y deja la orden en espera: la marca sale con el paso como se ve ahora y se aplica.
  await clic('problema');
  escribir('#nota-problema', 'Falta el candado: no se puede bloquear el tablero');
  await clic('problemaDetener');
  await hasta(() => one('SELECT estado FROM ordenes WHERE id=530').estado === 'en_espera', 'la orden queda en espera en el servidor');
  const detenida530 = enviados.filter((op) => op.tipo === 'orden.paso' && op.ordenId === 530).at(-1);
  igual(JSON.stringify(detenida530?.antes), JSON.stringify({ estado: 'desviacion', valor: null, nota: NOTA_JEFA }), 'La marca que deja la orden en espera también lleva el paso como se veía antes');
  ok(paso530().notas === 'Falta el candado: no se puede bloquear el tablero' && one("SELECT COUNT(*) n FROM campo_operaciones WHERE orden_id=530 AND resultado='rechazada'").n === 1, 'Y se aplica: ' + JSON.stringify(paso530()));
  await clic('verRechazos');
  await clic('limpiarRechazos');
  sqlite.exec("UPDATE ordenes SET estado='cancelada' WHERE id=530");

  // ══ K19 · Sin señal, el técnico anota «Hay un problema» en el paso 2 y una lectura fuera de rango en el 3, y envía a
  // verificación; mientras tanto la jefatura marca «ok» el paso 2 en la ficha. Al volver la señal no entran ni la marca
  // ni el envío: la orden sigue en curso. «Ver por qué» lo dice y ofrece abrirla; abierta, va al paso que cambió, como
  // quedó en el servidor, y el técnico lo vuelve a marcar con lo que escribió y la envía ══
  ahora = enSV('12:27');
  orden(531, 'preventivo', '[Preventivo] Bimestral - CH-83', 83, 'aires', CHECKLIST);
  await abrir('https://test.invalid/campo#orden-531');
  await hasta(() => /3 pasos/.test(texto()), 'el preventivo 531');
  await clic('empezar');
  await hasta(() => one('SELECT estado FROM ordenes WHERE id=531').estado === 'en_proceso' && !/por enviar|Enviando/.test(pill()), 'empieza en el servidor');
  enLinea = false; w.dispatchEvent(new w.Event('offline'));
  await clic('hecho');
  await clic('problema');
  const PROBLEMA_531 = 'Los filtros están rotos: hay que cambiarlos';
  escribir('#nota-problema', PROBLEMA_531);
  await clic('problemaSeguir');
  escribir('#lectura', '15');
  await clic('lectura');
  escribir('#nota-problema', 'Corriente alta: el compresor calienta');
  await clic('problemaSeguir');
  await clic('verNota');
  const FIN_531 = 'Revisé el chiller y medí la corriente del compresor.';
  escribir('#nota-fin', FIN_531);
  await clic('enviar');
  ok(/Guardado en tu celular/.test(texto()), texto().slice(0, 120));
  const base531 = one('SELECT checklist_ejecucion c FROM ordenes WHERE id=531').c;
  const ficha531 = await app.order.PATCH(ctx('/api/ordenes/531', { method: 'PATCH', id: 531, rol: 'jefe', data: { checklistEjecucion: JSON.stringify(JSON.parse(base531).map((x, i) => (i === 1 ? { ...x, estado: 'ok' } : x))), checklistBase: base531, soloCambios: true } }));
  igual(ficha531.status, 200, 'La jefatura marca «ok» el paso 2 en la ficha');
  enLinea = true; w.dispatchEvent(new w.Event('online'));
  await hasta(() => one("SELECT COUNT(*) n FROM campo_operaciones WHERE orden_id=531 AND resultado='rechazada'").n === 2 && !enVuelo && !/Enviando/.test(pill()), 'el servidor no acepta la marca ni el envío');
  const paso531 = (i) => JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=531').c)[i];
  ok(one('SELECT estado FROM ordenes WHERE id=531').estado === 'en_proceso' && paso531(1).estado === 'ok' && paso531(2).estado === 'desviacion' && paso531(2).valorMedido === 15, 'La orden sigue en curso, con el paso 2 como lo dejó la jefatura: ' + JSON.stringify([paso531(1), paso531(2)]));
  igual(one("SELECT detalle d FROM campo_operaciones WHERE orden_id=531 AND tipo='orden.terminar'").d, 'La orden no se envió: el paso 2 cambió en la ficha mientras tanto. Revísalo, márcalo otra vez y vuelve a enviarla.', 'El envío dice qué paso revisar');
  await clic('ir', '[data-h="#hoy"]');
  await hasta(() => /2 registros sin aceptar/.test(texto()), 'Hoy avisa');
  await clic('verRechazos');
  await hasta(() => doc.querySelectorAll('#hoja [data-a="ir"][data-h="#orden-531"][data-paso="1"]').length === 2, '«Ver por qué» ofrece abrir la orden en el paso que cambió, en los dos registros');
  anotar('rechazos de un envío con un paso que cambió en la ficha');
  ok(hoja().includes('Enviar a verificación: La orden no se envió: el paso 2 cambió en la ficha mientras tanto. Revísalo, márcalo otra vez y vuelve a enviarla.') && hoja().includes('Paso 2: El paso 2 cambió en la ficha mientras tanto: revísalo y márcalo otra vez.'), 'Dice los dos rechazos: ' + hoja().slice(0, 400));
  ok(hoja().includes(`«${PROBLEMA_531}»`) && hoja().includes(`«${FIN_531}»`) && /Lo que escribiste volvió a su orden: ábrela, corrige y envíala otra vez\./.test(hoja()), 'Con lo que escribió, de vuelta en su orden: ' + hoja().slice(0, 400));
  ok(!/ya no se puede trabajar|ya no está a tu nombre|se canceló/.test(hoja()), 'Sin decir que la orden ya no se puede trabajar: ' + hoja().slice(0, 400));
  doc.querySelector('#hoja [data-a="ir"][data-h="#orden-531"][data-paso="1"]').click(); await espera();
  anotar('el paso que cambió, como quedó en el servidor');
  ok(/Paso 2 de 3/.test(texto()) && texto().includes('Ya está marcado: Hecho.') && !/Anotaste/.test(texto()), 'Abre en el paso que cambió, como quedó: ' + texto().slice(0, 200));
  // La línea se recorta a tres líneas; al tocarla se ve entera, dentro de su caja.
  await clic('verTodo', '.marcado');
  ok(doc.querySelector('.paso-cuerpo .marcado.recorte.entero') && (await fs.readFile('src/campo/campo.css', 'utf8')).includes('.paso-cuerpo .marcado.entero{display:block;-webkit-line-clamp:none'), 'Al tocarla, la línea se ve entera');
  await clic('problema');
  igual(doc.querySelector('#nota-problema')?.value, PROBLEMA_531, 'Lo que escribió vuelve a su hoja');
  await clic('problemaSeguir');
  ok(/3 de 3 pasos anotados/.test(texto()) && doc.querySelector('#nota-fin')?.value === FIN_531, 'Sigue al cierre, con su nota: ' + texto().slice(0, 160));
  await clic('enviar');
  await hasta(() => one('SELECT estado FROM ordenes WHERE id=531').estado === 'completada', 'marcado otra vez, la orden se envía');
  igual(JSON.stringify(enviados.filter((op) => op.tipo === 'orden.paso' && op.ordenId === 531 && op.idx === 1).at(-1)?.antes), JSON.stringify({ estado: 'ok', valor: null, nota: null }), 'La marca sale con el paso como lo dejó la ficha');
  const trabajos531 = one('SELECT trabajos_realizados t FROM ordenes WHERE id=531').t;
  ok(paso531(1).estado === 'desviacion' && paso531(1).notas === PROBLEMA_531 && trabajos531.includes('2 con novedad') && trabajos531.includes(`Novedad en «Limpiar filtros»: ${PROBLEMA_531}.`) && trabajos531.includes('Medir corriente: 15 A') && trabajos531.includes(FIN_531), 'Con el problema y la lectura del técnico: ' + trabajos531);
  await clic('ir', '[data-h="#hoy"]');
  await clic('verRechazos');
  await clic('limpiarRechazos');

  // ══ K19 · La lectura fuera de rango de una marca que no entró vuelve a su campo, y el paso dice la que quedó guardada ══
  ahora = enSV('12:27');
  orden(536, 'preventivo', '[Preventivo] Cuatrimestral - CH-83', 83, 'aires', CHECKLIST);
  await abrir('https://test.invalid/campo#orden-536');
  await hasta(() => /3 pasos/.test(texto()), 'el preventivo 536');
  await clic('empezar');
  await hasta(() => one('SELECT estado FROM ordenes WHERE id=536').estado === 'en_proceso' && !/por enviar|Enviando/.test(pill()), 'empieza en el servidor');
  enLinea = false; w.dispatchEvent(new w.Event('offline'));
  await clic('hecho'); await clic('hecho');
  escribir('#lectura', '15');
  await clic('lectura');
  escribir('#nota-problema', 'Corriente alta: el compresor calienta');
  await clic('problemaSeguir');
  const paso536 = (i) => JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=536').c)[i];
  const base536 = one('SELECT checklist_ejecucion c FROM ordenes WHERE id=536').c;
  igual((await app.order.PATCH(ctx('/api/ordenes/536', { method: 'PATCH', id: 536, rol: 'jefe', data: { checklistEjecucion: JSON.stringify(JSON.parse(base536).map((x, i) => (i === 2 ? { ...x, estado: 'ok', valorMedido: 10 } : x))), checklistBase: base536, soloCambios: true } }))).status, 200, 'La jefatura anota 10 A en la ficha');
  enLinea = true; w.dispatchEvent(new w.Event('online'));
  await hasta(() => one("SELECT COUNT(*) n FROM campo_operaciones WHERE orden_id=536 AND resultado='rechazada'").n === 1 && !enVuelo && !/Enviando/.test(pill()), 'la lectura no entra');
  // Mientras tanto la jefatura la deja en espera: abierta desde «Ver por qué», primero la pausa; al reanudar, el paso que cambió.
  igual((await app.order.PATCH(ctx('/api/ordenes/536', { method: 'PATCH', id: 536, rol: 'jefe', data: { estado: 'en_espera', motivo: 'Esperando el repuesto' } }))).status, 200, 'La jefatura la deja en espera');
  w.dispatchEvent(new w.Event('online'));
  for (let i = 0; i < 100 && (await leerGuardado('hoy:3'))?.ordenes?.find((o) => o.id === 536)?.estado !== 'en_espera'; i++) await espera(20);
  await espera(60);
  await clic('ir', '[data-h="#hoy"]');
  await clic('verRechazos');
  await hasta(() => doc.querySelector('#hoja [data-a="ir"][data-h="#orden-536"][data-paso="2"]'), 'ofrece abrirla en el paso 3');
  doc.querySelector('#hoja [data-a="ir"][data-h="#orden-536"][data-paso="2"]').click(); await espera();
  ok(/En pausa/.test(texto()) && doc.querySelector('[data-a="reanudar"]'), 'En espera: primero la pausa: ' + texto().slice(0, 160));
  await clic('reanudar');
  anotar('la lectura que no entró, de vuelta en su campo');
  ok(/Paso 3 de 3/.test(texto()) && doc.querySelector('#lectura')?.value === '15' && texto().includes('Ya está marcado: Hecho, con 10 A.'), 'Su lectura en el campo y la guardada en la línea: ' + texto().slice(0, 240));
  await clic('lectura');
  igual(doc.querySelector('#nota-problema')?.value, 'Corriente alta: el compresor calienta', 'Y su nota, en la hoja');
  await clic('problemaSeguir');
  await hasta(() => paso536(2)?.estado === 'desviacion' && paso536(2).valorMedido === 15, 'su lectura entra con el paso como se ve ahora');
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => /1 registro sin aceptar/.test(texto()), 'Hoy');
  await clic('verRechazos');
  await clic('limpiarRechazos');
  sqlite.exec("UPDATE ordenes SET estado='cancelada' WHERE id IN (531, 536)");

  // ══ P24 · Dos marcas sin señal en el mismo paso: la segunda sale con el paso como lo dejó la primera, y entra ══
  orden(532, 'preventivo', '[Preventivo] Quincenal - CH-83', 83, 'aires', CHECKLIST);
  await abrir('https://test.invalid/campo#orden-532');
  await hasta(() => /3 pasos/.test(texto()), 'el preventivo 532');
  await clic('empezar');
  await hasta(() => one('SELECT estado FROM ordenes WHERE id=532').estado === 'en_proceso' && !/por enviar|Enviando/.test(pill()), 'empieza en el servidor');
  enLinea = false; w.dispatchEvent(new w.Event('offline'));
  await clic('hecho'); await clic('hecho');
  await clic('anterior');
  ok(/Paso 2 de 3/.test(texto()) && texto().includes('Ya está marcado: Hecho.'), 'De vuelta en el paso 2, dice cómo está: ' + texto().slice(0, 160));
  await clic('na');
  enLinea = true; w.dispatchEvent(new w.Event('online'));
  await hasta(() => one('SELECT COUNT(*) n FROM orden_paso_marcas WHERE orden_id=532 AND paso_idx=1').n === 2 && !enVuelo, 'las dos marcas llegan');
  // Lo que no cupo en una vuelta sale otra vez en la siguiente: cada operación, una vez.
  const dos532 = [...new Map(enviados.filter((op) => op.tipo === 'orden.paso' && op.ordenId === 532 && op.idx === 1).map((op) => [op.opId, op.antes])).values()];
  igual(JSON.stringify(dos532), JSON.stringify([{ estado: 'pendiente', valor: null, nota: null }, { estado: 'ok', valor: null, nota: null }]), 'La segunda lleva el paso como lo dejó la primera, que todavía no salía');
  ok(JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=532').c)[1].estado === 'na' && one("SELECT COUNT(*) n FROM campo_operaciones WHERE orden_id=532 AND resultado='rechazada'").n === 0, 'Y entra: el paso queda «No aplica», sin rechazos');
  sqlite.exec("UPDATE ordenes SET estado='cancelada' WHERE id=532");

  // ══ P16 · Un paso con «Hay un problema» y su lectura fuera de rango que recibe otra en rango vuelve a «ok» ══
  orden(533, 'preventivo', '[Preventivo] Semanal - CH-83', 83, 'aires', JSON.stringify([{ texto: 'Medir corriente', requiereValor: true, unidad: 'A', esperadoMin: 8, esperadoMax: 12, estado: 'pendiente' }]));
  await abrir('https://test.invalid/campo#orden-533');
  await hasta(() => /1 pasos/.test(texto()), 'el preventivo 533');
  await clic('empezar');
  escribir('#lectura', '15');
  await clic('lectura');
  escribir('#nota-problema', 'Corriente alta: el compresor calienta');
  await clic('problemaSeguir');
  ok(/1 de 1 pasos anotados/.test(texto()) && /1 con novedad/.test(texto()), texto().slice(0, 160));
  await clic('anterior');
  ok(texto().includes('Ya está marcado: Hay un problema. Nota: Corriente alta: el compresor calienta'), 'El paso dice cómo está: ' + texto().slice(0, 200));
  escribir('#lectura', '10');
  await clic('lectura');
  ok(/1 de 1 pasos anotados/.test(texto()) && /sin novedad/.test(texto()), 'Con la lectura en rango, vuelve a «ok»: ' + texto().slice(0, 200));
  await hasta(() => JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=533').c)[0].valorMedido === 10, 'llega al servidor');
  igual(JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=533').c)[0].estado, 'ok', 'En el servidor también');
  sqlite.exec("UPDATE ordenes SET estado='cancelada' WHERE id=533");

  // ══ P10 · La orden en curso que «Ver por qué» dejó en el celular: si cambia en el servidor, al bajar el día la copia se
  // renueva (535); si la jefatura la cancela mientras el técnico la tiene abierta, su copia se queda mientras la tenga
  // abierta (534) ══
  for (const id of [535, 534]) {
    ahora = enSV('12:27');
    orden(id, 'preventivo', '[Preventivo] Semestral - CH-83', 83, 'aires', CHECKLIST);
    await abrir(`https://test.invalid/campo#orden-${id}`);
    await hasta(() => /3 pasos/.test(texto()), `el preventivo ${id}`);
    await clic('empezar');
    await hasta(() => one('SELECT estado FROM ordenes WHERE id=?', id).estado === 'en_proceso' && !/por enviar|Enviando/.test(pill()), 'empieza en el servidor');
    enLinea = false; w.dispatchEvent(new w.Event('offline'));
    await clic('hecho');
    sqlite.exec(`UPDATE ordenes SET asignado_a=NULL WHERE id=${id}`);
    enLinea = true; w.dispatchEvent(new w.Event('online'));
    await hasta(() => one("SELECT COUNT(*) n FROM campo_operaciones WHERE orden_id=? AND resultado='rechazada'", id).n === 1 && pedidasDe[String(id)] >= 1, 'el servidor no acepta lo anotado y el celular pregunta por qué');
    await hasta(() => !enVuelo && !/Enviando/.test(pill()), 'todo llega');
    ok(await copiaTrae(id), `(${id}) Sigue en curso: queda en el celular`);
    const pedidas = pedidasDe[String(id)];
    if (id === 535) {
      const l = JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=535').c);
      l[1] = { ...l[1], estado: 'na', notas: 'No aplica: filtros nuevos.' };
      sqlite.prepare('UPDATE ordenes SET checklist_ejecucion=? WHERE id=535').run(JSON.stringify(l));
      await abrir('https://test.invalid/campo#hoy');
    } else {
      sqlite.exec("UPDATE ordenes SET estado='cancelada' WHERE id=534");
      await abrir('https://test.invalid/campo#orden-534');
    }
    await hasta(() => pedidasDe[String(id)] > pedidas, `(${id}) al bajar el día, la pide otra vez`);
    await hasta(() => !enVuelo, 'llega la respuesta');
    await espera(60);
    const copia = [...(await leerGuardado('hoy:3')).ordenes, ...(await leerGuardado('hoy:3')).libres].find((o) => o.id === id);
    if (id === 535) ok(copia?.pasos?.[1]?.estado === 'na' && copia.pasos[1].nota === 'No aplica: filtros nuevos.', '(535) La copia se renueva con lo que tiene el servidor: ' + JSON.stringify(copia?.pasos?.[1]));
    else ok(copia && /Paso 1 de 3/.test(texto()), '(534) La tiene abierta: su copia se queda y la orden sigue en pantalla: ' + texto().slice(0, 120));
    if (id === 534) await clic('salir');
    await clic('verRechazos');
    await clic('limpiarRechazos');
    sqlite.exec(`UPDATE ordenes SET estado='cancelada' WHERE id=${id}`);
  }

  // ══ P12 · Un paso con lectura que no aplica no la pide al enviar ══
  orden(522, 'preventivo', '[Preventivo] Mensual - PE-01', 81, 'infraestructura', JSON.stringify([
    { texto: 'Medir corriente', requiereValor: true, unidad: 'A', esperadoMin: 8, esperadoMax: 12, estado: 'pendiente' },
    { texto: 'Limpiar el tablero', estado: 'pendiente' },
  ]));
  await abrir('https://test.invalid/campo#orden-522');
  await hasta(() => /2 pasos/.test(texto()), 'el 522');
  await clic('empezar');
  await clic('na');
  await clic('hecho');
  ok(/2 de 2 pasos anotados/.test(texto()), texto().slice(0, 120));
  await clic('enviar');
  ok(/Enviado a verificación|Guardado en tu celular/.test(texto()), 'Se envía sin pedir la lectura del paso que no aplica: ' + texto().slice(0, 160));
  await hasta(() => one('SELECT estado FROM ordenes WHERE id=522').estado === 'completada', 'llega al servidor');

  // ══ P16 · Una acción del EOP que pide lectura: «Hecho» lleva el número escrito, igual que «Guardar lectura» ══
  orden(612, 'emergencia', '[Emergencia] Chiller detenido - CH-83', 83, 'aires', CHECKLIST);
  await abrir('https://test.invalid/campo#orden-612');
  await hasta(() => doc.querySelector('[data-a="llegue"]'), 'la emergencia 612');
  await clic('llegue');
  await clic('hecho');
  await clic('nopudo');
  escribir('#nota-nopudo', 'El chiller no tiene energía');
  await clic('nopudoSeguir');
  ok(/Acción 3 de 3/.test(texto()) && doc.querySelector('#lectura') && doc.querySelector('.paso-pie [data-a="hecho"]'), 'La acción que pide lectura, con «Hecho»: ' + texto().slice(0, 160));
  const pasos612 = () => enviados.filter((op) => op.tipo === 'orden.paso' && op.ordenId === 612 && op.idx === 2).length;
  await clic('hecho');
  ok(/Acción 3 de 3/.test(texto()) && doc.querySelector('#aviso').textContent === 'Escribe la lectura para seguir.', 'Sin el número no avanza: ' + texto().slice(0, 120));
  escribir('#lectura', '10,5');
  await clic('hecho');
  ok(/¿Ya está controlado\?/.test(texto()), 'Con el número, sigue: ' + texto().slice(0, 120));
  await hasta(() => pasos612() === 1, 'sale la acción');
  const accion612 = enviados.find((op) => op.tipo === 'orden.paso' && op.ordenId === 612 && op.idx === 2);
  ok(accion612.estado === 'ok' && accion612.valor === 10.5, '«Hecho» llevó el número escrito: ' + JSON.stringify(accion612));
  await hasta(() => JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=612').c)[2].valorMedido === 10.5, 'y el servidor lo guarda');
  // De vuelta en una acción ya marcada, dice cómo está: «No se pudo» y su motivo, sin «Anotaste».
  await clic('anterior'); await clic('anterior');
  anotar('una acción que no se pudo, al volver');
  ok(/Acción 2 de 3/.test(texto()) && texto().includes('Ya está marcada: No se pudo. Nota: El chiller no tiene energía') && !/Anotaste/.test(texto()), 'La acción dice cómo está: ' + texto().slice(0, 200));
  sqlite.exec("UPDATE ordenes SET estado='cancelada' WHERE id=612");

  // ══ El valor medido de una desviación es un número: «1,200» no sale (el servidor no abriría la
  // desviación); 1200 sí ══
  ahora = enSV('12:28');
  sqlite.exec("UPDATE activos SET sistema='electrico' WHERE id=81");
  await abrir('https://test.invalid/campo#falla/81');
  await hasta(() => doc.querySelector('[data-a="fueraDeRango"]'), 'la falla del equipo');
  await clic('fueraDeRango');
  ok(doc.querySelector('#valor-desv'), 'La hoja de la desviación pide el valor: ' + hoja().slice(0, 200));
  // En un teléfono de 360×640 la hoja cabe: lo que dice el documento va en su propia caja, que se desplaza;
  // los relojes, el campo, su aviso y los botones quedan fuera de ella, a la vista. Aquí, con su hoja de estilos.
  const estilo = doc.createElement('style');
  estilo.textContent = await fs.readFile('src/campo/campo.css', 'utf8');
  doc.head.append(estilo);
  const cajaDesv = doc.querySelector('#hoja .hoja-caja');
  const docDesv = cajaDesv?.querySelector(':scope > .hoja-doc');
  const estiloDe = (el) => w.getComputedStyle(el);
  ok(docDesv && docDesv.querySelector('ol.acc') && !docDesv.querySelector('input, textarea, button, .err, .relojes'), 'El documento, solo, en su caja: ' + (docDesv?.innerHTML ?? '').slice(0, 200));
  ok(cajaDesv.querySelector(':scope > .relojes') && cajaDesv.querySelector(':scope > .hoja-campos #err-desv') && cajaDesv.querySelector(':scope > .hoja-pie [data-a="abrirDesviacion"]') && cajaDesv.querySelector(':scope > .hoja-pie [data-a="cerrarHoja"]'), 'Los relojes, el campo con su aviso y los botones, fuera de esa caja');
  ok(estiloDe(cajaDesv).display === 'flex' && estiloDe(cajaDesv).flexDirection === 'column' && estiloDe(docDesv).overflowY === 'auto' && estiloDe(docDesv).flexShrink === '1' && ['.relojes', '.hoja-campos', '.hoja-pie'].every((s) => estiloDe(cajaDesv.querySelector(`:scope > ${s}`)).flexShrink === '0'), 'Solo la caja del documento se encoge y se desplaza');
  // En una pantalla baja (360×640 medido en Chrome y WebKit), la hoja se compacta para que quepa con el aviso.
  const bajas = [...estilo.sheet.cssRules].filter((r) => /max-height:\s*700px/.test(r.conditionText ?? r.media?.mediaText ?? '')).flatMap((r) => [...r.cssRules]);
  const regla = (sel, prop) => bajas.find((r) => r.selectorText === sel)?.style.getPropertyValue(prop);
  ok(regla('.hoja-caja.con-pie textarea', 'min-height') === '60px' && regla('.hoja-caja.con-pie .relojes b', 'font-size') === '20px' && regla('.hoja-caja.con-pie', 'gap') === '8px', 'Con la pantalla baja, la hoja de la desviación se compacta');
  estilo.remove();
  const antesDesv = enviados.length;
  escribir('#valor-desv', '1,200');
  escribir('#nota-desv', 'El tablero de transferencia está caliente');
  await clic('abrirDesviacion');
  const errDesv = doc.querySelector('#err-desv');
  ok(errDesv && !errDesv.hidden && errDesv.textContent === '¿1200 o 1,2? Escribe el número sin separador de miles.' && /Se rige por/.test(hoja()), 'Pide el número sin separador y la hoja sigue abierta: ' + hoja().slice(0, 300));
  await espera(60);
  igual(enviados.length, antesDesv, 'No sale nada');
  escribir('#valor-desv', '1200');
  await clic('abrirDesviacion');
  await hasta(() => one("SELECT COUNT(*) n FROM aop_eventos WHERE activo_id=81 AND valor_detectado=1200").n === 1, 'la desviación se abre con 1200');
  ok(enviados.some((op) => op.tipo === 'aop.abrir' && op.valor === '1200') && !enviados.some((op) => op.tipo === 'aop.abrir' && op.valor === '1,200'), 'Sale 1200, nunca «1,200»');

  // ══ Un cambio de turnos que todavía no entró: el celular lo aplica desde su «desde», sin señal ══
  sqlite.exec("INSERT INTO sucursales(id,nombre,activa,hace_ronda) VALUES(9,'Sede 9',1,1)");
  ahora = enSV('12:30');
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => /Hola/.test(texto()) && doc.querySelector('[data-a="sede"]'), 'Hoy');
  await clic('sede');
  await clic('elegirSede', '[data-id="9"]');
  await hasta(() => /Ronda de las 06:00/.test(texto()), 'la ronda de la sede 9');
  await espera(60);
  await cambiarGuardado('hoy:3', (p) => ({ ...p, ronda: { ...p.ronda, turnos: ['06:00', '14:00', '22:00'], turnosProximos: { desde: iso(enSV('15:00')), turnos: ['07:00', '15:00', '23:00'] } } }));
  enLinea = false;
  ahora = enSV('14:30');
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => /Ronda de las 14:00/.test(texto()), 'antes de «desde», rigen los turnos de siempre');
  anotar('turno antes del cambio');
  ahora = enSV('15:10');
  doc.dispatchEvent(new w.Event('visibilitychange'));
  await hasta(() => /Ronda de las 15:00/.test(texto()), 'desde «desde», la lista nueva');
  ok(/turno 15:00/.test(texto()), 'El turno arriba también');
  anotar('turno nuevo');
  await espera(60);
  const rondaGuardada = (await leerGuardado('hoy:3')).ronda;
  igual(rondaGuardada.turno, '15:00');
  igual(rondaGuardada.turnos.join(), '07:00,15:00,23:00', 'La lista nueva queda como la de siempre');
  igual(rondaGuardada.turnosProximos, null);
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => /Ronda de las 15:00/.test(texto()), 'recargada sin señal, sigue en el turno nuevo');
  ahora = enSV('22:10');
  doc.dispatchEvent(new w.Event('visibilitychange'));
  await espera(40);
  ok(/Ronda de las 15:00/.test(texto()), 'A las 22:10 la lista nueva no tiene turno de las 22:00: ' + texto().slice(0, 200));
  ahora = enSV('23:10');
  doc.dispatchEvent(new w.Event('visibilitychange'));
  await hasta(() => /Ronda de las 23:00/.test(texto()), 'el turno de las 23:00');
  anotar('turno de la noche');

  // ══ K5 · Un turno que no se abre («omite»): [06:00, 14:00, 22:00] → [06:30, 14:30, 22:30] guardado a las
  // 10:40. El de las 14:00 no se abre y la ronda de las 06:00 sigue, en su parada, sin señal y recargada;
  // a las 14:31, la de las 14:30 ══
  const diaMas = (n) => new RealDate(RealDate.parse(`${svHoy}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  sqlite.exec("INSERT INTO sucursales(id,nombre,activa,hace_ronda) VALUES(10,'Sede 10',1,1),(11,'Sede 11',1,1),(12,'Sede 12',1,1)");
  const elegirSede = async (id) => { await clic('sede'); await clic('elegirSede', `[data-id="${id}"]`); };
  const paqRonda = await (await app.hoy.GET(ctx('/api/campo/hoy?sede=10', { rol: 'tecnico' }))).json();
  const paradaBien = async () => {
    const titulo = doc.querySelector('.paso-cuerpo h1').textContent;
    const pt = paqRonda.ronda.puntos.find((p) => p.texto.replace(/ · /g, ': ') === titulo);
    assert.ok(pt, 'Parada desconocida: ' + titulo);
    if (pt.pideValor) { escribir('#lectura', String(pt.min ?? pt.max ?? 3)); await clic('lectura'); } else await clic('conforme');
  };
  /** Abre Hoy con señal en esa sede y se queda sin señal: la copia del día es la que trajo. */
  const enSedeSinSenal = async (sede) => {
    enLinea = true;
    await abrir('https://test.invalid/campo#hoy');
    await hasta(() => /Hola/.test(texto()) && doc.querySelector('[data-a="sede"]'), 'Hoy');
    await elegirSede(sede);
    await hasta(() => /Ronda de las 06:00/.test(bloque()) && (doc.querySelector('.hoy-cab .sede-btn')?.textContent ?? '').includes(`Sede ${sede}`), `la ronda de la sede ${sede}`);
    await espera(60);
    enLinea = false; w.dispatchEvent(new w.Event('offline'));
  };
  const d1 = diaMas(1);
  ahora = enSV('13:00', d1);
  await enSedeSinSenal(10);
  await clic('ronda');
  await paradaBien(); await paradaBien();
  ok(/Parada 3 de/.test(texto()), texto().slice(0, 120));
  const parada3 = doc.querySelector('.paso-cuerpo h1').textContent;
  w.dispatchEvent(new w.Event('pagehide')); await espera(60);
  // El cambio de turnos como lo trae el paquete: la lista nueva entra a las 14:30 y el turno de las 14:00 no se abre.
  await cambiarGuardado('hoy:3', (p) => ({ ...p, ronda: { ...p.ronda, turnos: ['06:00', '14:00', '22:00'], turnosProximos: { desde: iso(enSV('14:30', d1)), turnos: ['06:30', '14:30', '22:30'] }, omite: [{ fecha: d1, turno: '14:00' }] } }));
  ahora = enSV('14:05', d1);
  await abrir(w.location.href);
  await hasta(() => /Parada \d+ de/.test(texto()), 'recargada sin señal, en la ronda');
  anotar('omite: sigue la ronda de las 06:00');
  ok(/Ronda de las 06:00/.test(doc.querySelector('.paso-cab').textContent) && doc.querySelector('.paso-cuerpo h1').textContent === parada3, 'A las 14:05 sigue la ronda de las 06:00, en su parada: ' + texto().slice(0, 160));
  await clic('salir');
  await hasta(() => /Hola/.test(texto()), 'Hoy');
  ok(/turno 06:00/.test(texto()) && /Ronda de las 06:00/.test(bloque()) && /Seguir la ronda/.test(bloque()) && !/Ronda de las 14:00/.test(texto()), 'En Hoy también: el turno de las 14:00 no se abre: ' + bloque());
  ahora = enSV('14:31', d1);
  doc.dispatchEvent(new w.Event('visibilitychange'));
  await hasta(() => /Ronda de las 14:30/.test(bloque()), 'a las 14:31, la ronda de las 14:30');
  anotar('omite: la ronda de las 14:30');
  ok(/Lo primero del turno/.test(bloque()) && /turno 14:30/.test(texto()), 'La ronda nueva, lo primero del turno: ' + bloque());

  // ══ K5 · La sede deja de hacer ronda desde el turno de las 14:00 («noHaceRondaDesde»): sin señal, desde
  // esa hora no se ofrece ronda nueva y se dice; la que ya empezó sigue ══
  const d2 = diaMas(2);
  ahora = enSV('13:00', d2);
  await enSedeSinSenal(11);
  await cambiarGuardado('hoy:3', (p) => ({ ...p, ronda: { ...p.ronda, noHaceRondaDesde: iso(enSV('14:00', d2)) } }));
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => /Lo primero del turno/.test(bloque()) && /Ronda de las 06:00/.test(bloque()), 'antes de las 14:00, la ronda de siempre');
  ok(!/no hace ronda/.test(texto()), 'Antes de esa hora no se dice');
  ahora = enSV('14:05', d2);
  doc.dispatchEvent(new w.Event('visibilitychange'));
  await hasta(() => /Desde el turno de las 14:00 esta sede no hace ronda\./.test(bloque()), 'a las 14:05 se dice, sin señal');
  anotar('sin ronda desde las 14:00');
  ok(!/Ronda de las/.test(texto()) && !doc.querySelector('[data-a="ronda"]') && !/turno \d{2}:\d{2}/.test(doc.querySelector('.hoy-cab').textContent), 'No ofrece ronda nueva ni la de antes: ' + texto().slice(0, 300));
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => /Hola/.test(texto()), 'recargada sin señal');
  ok(/Desde el turno de las 14:00 esta sede no hace ronda\./.test(bloque()) && !doc.querySelector('[data-a="ronda"]'), 'Recargada sin señal, igual: ' + bloque());
  // Con la dirección de la ronda (recargada en #ronda o desde un acceso guardado): lo dice y vuelve a Hoy.
  await abrir('https://test.invalid/campo#ronda');
  await hasta(() => /Hola/.test(texto()), 'vuelve a Hoy');
  ok(w.location.hash === '#hoy' && !/Parada \d+ de/.test(texto()) && /Desde el turno de las 14:00 esta sede no hace ronda\./.test(doc.querySelector('#aviso').textContent), 'No abre una ronda que ya no se hace: ' + w.location.hash + ' · ' + texto().slice(0, 200));
  await espera(60);
  ok(!(await enCola()).some((op) => op.tipo === 'ronda.iniciar' && op.sucursalId === 11), 'Ni la empieza');
  const d3 = diaMas(3);
  ahora = enSV('13:00', d3);
  await enSedeSinSenal(12);
  await cambiarGuardado('hoy:3', (p) => ({ ...p, ronda: { ...p.ronda, noHaceRondaDesde: iso(enSV('14:00', d3)) } }));
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => /Lo primero del turno/.test(bloque()), 'Hoy sin señal');
  await clic('ronda');
  await paradaBien();
  ok(/Parada 2 de/.test(texto()), texto().slice(0, 120));
  const parada2 = doc.querySelector('.paso-cuerpo h1').textContent;
  w.dispatchEvent(new w.Event('pagehide')); await espera(60);
  ahora = enSV('14:05', d3);
  await abrir(w.location.href);
  await hasta(() => /Parada \d+ de/.test(texto()), 'recargada sin señal, en la ronda');
  ok(/Ronda de las 06:00/.test(doc.querySelector('.paso-cab').textContent) && doc.querySelector('.paso-cuerpo h1').textContent === parada2, 'La ronda de las 06:00 ya empezada sigue, en su parada: ' + texto().slice(0, 160));
  await clic('salir');
  await hasta(() => /Hola/.test(texto()), 'Hoy');
  anotar('sin ronda: sigue la empezada');
  ok(/Ronda de las 06:00/.test(bloque()) && /Seguir la ronda/.test(bloque()) && /Desde el turno de las 14:00 esta sede no hace ronda\./.test(bloque()), 'En Hoy, la que empezó, con la frase: ' + bloque());
  ok(!/Lo primero del turno|Ronda de las 14:00/.test(texto()), 'Sin ronda nueva');
  // La hora de un turno en una frase: «de la 01:00», no «de las 01:00».
  const d4 = diaMas(4), d5 = diaMas(5);
  sqlite.exec("INSERT INTO sucursales(id,nombre,activa,hace_ronda) VALUES(13,'Sede 13',1,1)");
  ahora = enSV('13:00', d4);
  await enSedeSinSenal(13);
  await cambiarGuardado('hoy:3', (p) => ({ ...p, ronda: { ...p.ronda, noHaceRondaDesde: iso(enSV('01:00', d5)) } }));
  ahora = enSV('01:10', d5);
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => /no hace ronda/.test(bloque()), 'la frase, sin señal');
  anotar('sin ronda desde la 01:00');
  ok(/Desde el turno de la 01:00 esta sede no hace ronda\./.test(bloque()), 'Con «la 01:00»: ' + bloque());

  // ══ K15 · Toda hora en una frase lleva su artículo: «Ronda de la 01:00», «También falta la ronda de la 01:00»,
  // «Escalar antes de la 01:30», los relojes «antes de la 01:30» y «(turno de la 01:00)». Sin señal, con la copia del día ══
  const d6 = diaMas(6), d7 = diaMas(7), d8 = diaMas(8);
  sqlite.exec("INSERT INTO sucursales(id,nombre,activa,hace_ronda) VALUES(14,'Sede 14',1,1)");
  ahora = enSV('13:00', d6);
  await enSedeSinSenal(14);
  const deLa = (r, extra = {}) => ({ ...r, turnos: ['01:00', '13:00'], turnosProximos: null, omite: [], fecha: d7, turno: '01:00', etiqueta: 'Turno 01:00 · mañana', estado: 'sin_iniciar', ejecucionId: null, iniciadaEn: null, lecturas: {}, entregaAnterior: null, ...extra });
  const emergencia690 = { id: 690, tipo: 'emergencia', modo: 'emergencia', estado: 'en_proceso', titulo: '[Emergencia] Falla de energía - PE-01', codigo: null, asignadoA: 3, iniciadaEn: iso(enSV('01:02', d7)), vencimiento: iso(enSV('01:30', d7)), hitos: { llegada: true, mitigacion: false, restablecimiento: false }, eop: { codigo: 'EOP-ELE-01', titulo: eop.titulo }, lugar: { sede: 'Sede 14', ubicacion: 'Cuarto de máquinas' }, pasos: [{ idx: 0, texto: 'Arrancar la planta', estado: 'pendiente' }] };
  await cambiarGuardado('hoy:3', (p) => ({
    ...p,
    // Dos paradas: la de la línea 1 y la temperatura, con su reloj de 20 y 50 minutos.
    ronda: deLa(p.ronda, { puntos: p.ronda.puntos.filter((pt) => pt.linea === 1 || /^Quirófanos · temperatura/.test(pt.texto)).map((pt) => (/temperatura/.test(pt.texto) ? { ...pt, actuarMin: 20, escalarMin: 50 } : pt)) }),
    // P13 · Una con plazo de 24 h: se escala antes de la 01:43 de mañana, y lo dice con su fecha.
    desviaciones: [
      { id: 9901, codigo: 'AOP-HVAC-01', titulo: 'Temperatura fuera de rango', estado: 'abierto', sala: 'Quirófano 2', escalarAntesDe: iso(enSV('01:30', d7)) },
      { id: 9902, codigo: 'AOP-GEN-01', titulo: 'Combustible bajo', estado: 'abierto', sala: 'Cuarto de máquinas', escalarAntesDe: iso(enSV('01:43', d8)) },
      // A las 20:00 de El Salvador ya es otro día en UTC: sigue siendo de hoy.
      { id: 9903, codigo: 'AOP-AGU-01', titulo: 'Presión de agua baja', estado: 'abierto', sala: 'Cisterna', escalarAntesDe: iso(enSV('20:00', d7)) },
    ],
    ordenes: [...p.ordenes, emergencia690],
  }));
  ahora = enSV('01:10', d7);
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => /Hola/.test(texto()) && doc.querySelector('.ahora .b2[data-a="ronda"]'), 'Hoy de la 01:00, con la emergencia');
  anotar('la ronda de la 01:00 con una emergencia');
  igual(doc.querySelector('.ahora .b2[data-a="ronda"]').textContent, 'También falta la ronda de la 01:00', 'Con la emergencia empezada: «También falta la ronda de la 01:00»');
  ok(/^Emergencia · Vence hoy 01:30$/.test(doc.querySelector('.ahora .etq').textContent), 'Con su plazo: ' + bloque());
  await clic('grupo', '[data-g="aop"]');
  ok(/Escalar antes de la 01:30(?! del)/.test(texto()), '«Escalar antes de la 01:30»: ' + texto().slice(0, 400));
  ok(texto().includes(`Escalar antes de la 01:43 del ${d8.slice(8, 10)}/${d8.slice(5, 7)}/${d8.slice(0, 4)}`), 'La de mañana, con su fecha: ' + texto().slice(0, 500));
  ok(/Escalar antes de las 20:00(?! del)/.test(texto()), 'La de hoy a las 20:00, sin fecha aunque en UTC ya sea mañana: ' + texto().slice(0, 600));
  anotar('desviaciones de la 01:10');
  // P17 · Con «Te la devolvieron» y otra emergencia debajo, dónde va y por qué se la devolvieron van en un solo párrafo
  // de dos líneas como máximo, sin «Sigues justo donde quedaste»: «Ahora» lleno cabe en 360×640 (medido en Chrome;
  // 390×844 en Chrome y WebKit), con «Seguir» y la ronda a la vista y la misma letra.
  const DEVUELTA = 'Falta la foto del tablero de transferencia.';
  await cambiarGuardado('hoy:3', (p) => ({ ...p, ordenes: [...p.ordenes.map((o) => (o.id === 690 ? { ...o, devuelta: DEVUELTA } : o)), { ...emergencia690, id: 692, estado: 'abierta', iniciadaEn: null, titulo: '[Emergencia] Minisplit detenido - AC-82', eop: { codigo: null, titulo: null }, hitos: { llegada: false, mitigacion: false, restablecimiento: false } }] }));
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => /Te la devolvieron/.test(bloque()) && doc.querySelector('.ahora .otra[data-h="#orden-692"]'), 'la emergencia devuelta en «Ahora», con otra debajo');
  anotar('emergencia devuelta con otra debajo');
  igual(doc.querySelector('.ahora .b1')?.dataset.h, '#orden-690', 'Arriba, la que atiende');
  igual(doc.querySelector('.ahora p.recorte.dos')?.textContent, `Acción 1 de 1. Te la devolvieron: ${DEVUELTA}`, 'Dónde va y por qué se la devolvieron, en un solo párrafo');
  ok(!/Sigues justo donde quedaste/.test(bloque()), 'Sin «Sigues justo donde quedaste»: ' + bloque());
  ok(/\.ahora \.recorte\.dos\{-webkit-line-clamp:2;line-clamp:2\}/.test(await fs.readFile('src/campo/campo.css', 'utf8')), 'En dos líneas como máximo');
  // P23 · «Ahora» lleno con el aviso de registros sin aceptar arriba también cabe en una pantalla baja sin desplazar, con
  // «Seguir» y la ronda a la vista (medido en Chrome 360×640; 390×844 en Chrome y WebKit): el aviso en una franja de 44 px,
  // los botones en 52 y 44 px y el saludo deja su lugar. La misma letra.
  ok(doc.querySelector('.ahora.lleno') && !doc.querySelector('.hoy-cab.compacta'), '«Ahora» lleno, sin aviso: el saludo se queda');
  await cambiarGuardado('rechazos:3', () => [{ que: 'OT-MG0001 · Chiller del edificio', accion: 'Paso 2', error: 'El paso 2 cambió en la ficha mientras tanto: revísalo y márcalo otra vez.', at: iso(ahora), ordenId: null }]);
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => /1 registro sin aceptar/.test(texto()) && doc.querySelector('.ahora.lleno'), 'el aviso arriba de «Ahora» lleno');
  anotar('«Ahora» lleno con el aviso arriba');
  ok(doc.querySelector('.hoy-cab.compacta') && doc.querySelector('.ahora .b1') && doc.querySelector('.ahora [data-a="ronda"]'), 'Con el aviso, el saludo deja su lugar; «Seguir» y la ronda siguen ahí');
  const cssBaja = (await fs.readFile('src/campo/campo.css', 'utf8')).split('@media(max-height:700px)')[1] ?? '';
  ok(['.avisito{padding-top:0;padding-bottom:0;min-height:44px}', '.ahora.lleno{gap:4px;padding-top:10px;padding-bottom:10px}', '.ahora.lleno .b1{min-height:52px;margin-top:2px}', '.ahora.lleno .b2{min-height:44px}', '.hoy-cab.compacta h1{display:none}', '.hoy-cab.compacta .etq{display:block}'].every((r) => cssBaja.includes(r)), 'En una pantalla baja, «Ahora» lleno se compacta');
  await cambiarGuardado('rechazos:3', () => []);
  // P22 · En pausa y devuelta: dónde va termina con su punto antes de «Te la devolvieron».
  await cambiarGuardado('hoy:3', (p) => ({ ...p, ordenes: p.ordenes.filter((o) => o.id !== 692).map((o) => (o.id === 690 ? { ...o, estado: 'en_espera', motivoPausa: 'Me pasaron a otra urgencia', devuelta: DEVUELTA } : o)) }));
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => /En pausa/.test(bloque()), 'la emergencia en pausa y devuelta');
  anotar('emergencia en pausa y devuelta');
  igual(doc.querySelector('.ahora p.recorte')?.textContent, `En pausa: Me pasaron a otra urgencia. Te la devolvieron: ${DEVUELTA}`, 'Con su punto antes de «Te la devolvieron»');
  await cambiarGuardado('hoy:3', (p) => ({ ...p, ordenes: p.ordenes.filter((o) => o.id !== 692).map((o) => (o.id === 690 ? { ...o, devuelta: null } : o)) }));
  // Una orden que el técnico empezó en este turno: la ronda también queda a la vista.
  await cambiarGuardado('hoy:3', (p) => ({ ...p, ordenes: [...p.ordenes.filter((o) => o.id !== 690), { id: 691, tipo: 'preventivo', modo: 'pasos', estado: 'en_proceso', titulo: '[Preventivo] Mensual - PE-01', asignadoA: 3, iniciadaEn: iso(enSV('01:05', d7)), activo: { id: 81, codigo: 'PE-01', nombre: 'Planta eléctrica de emergencia' }, lugar: { sede: 'Sede 14', ubicacion: 'Cuarto de máquinas' }, pasos: [{ idx: 0, texto: 'Revisar el nivel de aceite', estado: 'pendiente' }] }] }));
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => /Vas aquí/.test(bloque()) && doc.querySelector('.ahora .b2[data-a="ronda"]'), 'Hoy con la orden que empezó en este turno');
  igual(doc.querySelector('.ahora .b2[data-a="ronda"]').textContent, 'También falta la ronda de la 01:00', 'Con una orden empezada en este turno, también');
  // Sin la orden, la ronda es lo primero del turno.
  await cambiarGuardado('hoy:3', (p) => ({ ...p, ordenes: p.ordenes.filter((o) => o.id !== 691) }));
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => /Lo primero del turno/.test(bloque()), 'la ronda de la 01:00');
  igual(doc.querySelector('.ahora h2').textContent, 'Ronda de la 01:00', '«Ronda de la 01:00» en Hoy');
  await clic('ronda');
  igual(doc.querySelector('.paso-tit strong').textContent, 'Ronda de la 01:00', 'Y en la cabecera de la parada');
  await paradaBien();
  await clic('salir');
  await hasta(() => /Vas aquí/.test(bloque()), 'Hoy, con la ronda empezada');
  igual(doc.querySelector('.ahora h2').textContent, 'Ronda de la 01:00', 'Con la ronda empezada, también');
  await clic('ronda');
  ok(/Parada 2 de 2/.test(texto()), texto().slice(0, 120));
  escribir('#lectura', '30');
  await clic('lectura');
  await clic('novedadSeguir');
  anotar('relojes de la 01:10');
  igual([...doc.querySelectorAll('#hoja .relojes b')].map((b) => b.textContent).join(' | '), 'la 01:30 | las 02:00', 'Los relojes de la hoja: actuar antes de la 01:30, escalar antes de las 02:00');
  await clic('aopSeguir');
  igual(doc.querySelector('.final > .etq')?.textContent, 'Ronda de la 01:00', 'El cierre de la ronda: «Ronda de la 01:00»');
  anotar('cierre de la ronda de la 01:00');
  // El turno de las 13:00 recibe lo que dejó el de la 01:00.
  await cambiarGuardado('hoy:3', (p) => ({ ...p, ronda: deLa(p.ronda, { turno: '13:00', etiqueta: 'Turno 13:00 · tarde', entregaAnterior: { firma: 'Ana Pérez', turno: '01:00', notas: 'Sin novedades.' } }) }));
  ahora = enSV('13:10', d7);
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => /Ronda de las 13:00/.test(bloque()), 'la ronda de las 13:00');
  await clic('ronda');
  ok(/Dejó Ana Pérez \(turno de la 01:00\): Sin novedades\./.test(texto()), '«(turno de la 01:00)»: ' + texto().slice(0, 300));
  anotar('entrega del turno de la 01:00');

  // ══ Ninguna pantalla mostró tiempos de medición ni mandó a la ficha ══
  const horasDeInicio = [horaSV(enSV('09:02')), horaSV(llegue), horaSV(enSV('10:35'))];
  for (const v of vistas) {
    ok(!PROHIBIDO.test(v.t), `${v.donde}: «${v.t.match(PROHIBIDO)?.[0]}» en ${v.t.slice(0, 200)}`);
    let resto = v.t; for (const re of PLAZOS) resto = resto.replace(re, '');
    ok(!/\b\d{1,2}:\d{2}\b/.test(resto), `${v.donde}: una hora a la vista: ${resto.match(/.{0,50}\b\d{1,2}:\d{2}\b.{0,20}/)?.[0]}`);
    ok(horasDeInicio.every((h) => !v.t.includes(h)), `${v.donde}: una hora de inicio a la vista`);
    ok(v.fichas.every((h) => h.includes('?completa=1')), `${v.donde}: un enlace a la ficha completa: ${v.fichas}`);
  }
  console.log(`PASS e2e-campo-emergencia: ${checks} verificaciones; emergencia sin señal y luego con señal, intervención con permiso, lectura fuera de rango y reversa, borrador que sobrevive a recargar; MOP-MSP-01 real con un permiso a la vista, lectura con rango que pide su número y cierre resumido; emergencias en «Ahora» con sus líneas y su «Vence»; emergencia sin documento al instante y por detrás, sin saltos y con límite; «acciones» en orden.iniciar; envío rechazado que devuelve el texto; foto de hoja cancelada que no sale y la de lo anotado que sí; orden reasignada nombrada igual y la cancelada o cerrada dicha como tal; números que no se adivinan y que vuelven al campo sin leerse de dos formas; paso con rango que pide su número; varias emergencias en el orden de «Ahora», con sus grupos abiertos; foto que se reduce mientras se anota, se cancela o se envía; hoja de la desviación con su documento en su caja; lo que llega por detrás sin saltos; orden libre que pasa a ser del técnico; cambio de turnos, «omite» y «noHaceRondaDesde» sin señal; la hora con su artículo; rangos con tres decimales; la emergencia de fecha sola; lecturas que faltan antes de enviar; la orden en curso que el día ya no trae; la marca que no pisa un paso cambiado en la ficha y el envío que la espera; ${vistas.length} pantallas sin tiempos.`);
} finally { for (const id of [...retenidas.keys()]) soltar(id); await cerrarPagina().catch(() => {}); await close(); globalThis.Date = RealDate; }
process.exit(0);
