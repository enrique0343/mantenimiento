// Recorrido real de la pantalla del técnico (src/campo/app.ts en jsdom) contra las rutas
// reales y SQLite, con un reloj fijo: la emergencia completa sin señal y luego con señal,
// con sus horas guardadas en el servidor y ninguna a la vista; la intervención con su
// permiso, una lectura fuera de rango, la reversa y el envío; lo escrito en una hoja y la
// foto ya tomada sobreviven a recargar la página; lo que el servidor aceptó no reaparece
// como pendiente al recargar sin señal; y ninguna pantalla muestra tiempos de medición.
// Además: la intervención real MOP-MSP-01 (siete permisos largos, uno a la vista; la lectura
// con rango pide su número; el cierre resume las lecturas), dos emergencias con la empezada
// arriba y su «Vence», la emergencia sin documento que se pide de nuevo, «acciones» en
// orden.iniciar, un envío rechazado que devuelve el texto a la orden, la foto de una hoja
// cancelada que no se envía, la orden libre que pasa a ser del técnico en la copia del día y
// el cambio de turnos («turnosProximos») sin señal.
import assert from 'node:assert/strict';
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
const f = await setupConjuntos({ beforeMigration, modules: { hoy: 'pages/api/campo/hoy', sync: 'pages/api/campo/sync', ordenes: 'pages/api/campo/ordenes', foto: 'pages/api/campo/foto' } });
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
async function rutaReal(url, init = {}) {
  enVuelo++;
  try { return await atender(url, init); } finally { enVuelo--; }
}
async function atender(url, init) {
  if (!enLinea) throw new TypeError('Failed to fetch');
  const u = new URL(url, 'https://test.invalid');
  if (u.pathname === '/api/campo/hoy') return hoyFalla ? new Response('', { status: 503 }) : app.hoy.GET(ctx(u.pathname + u.search, { rol: 'tecnico' }));
  if (u.pathname === '/api/campo/sync') { const data = JSON.parse(init.body); enviados.push(...data.ops); return app.sync.POST(ctx(u.pathname, { method: 'POST', data, rol: 'tecnico' })); }
  if (u.pathname === '/api/campo/ordenes') {
    ordenesPedidas++;
    const id = u.searchParams.get('id');
    pedidasDe[id] = (pedidasDe[id] ?? 0) + 1;
    return app.ordenes.GET(ctx(u.pathname + u.search, { rol: 'tecnico' }));
  }
  if (u.pathname === '/api/campo/foto') {
    const c = ctx(u.pathname, { method: 'POST', rol: 'tecnico' });
    c.request = new Request(c.url, { method: 'POST', headers: { cookie: c.request.headers.get('cookie') }, body: init.body });
    c.locals.runtime.env.R2 = { async put(key) { r2.push(key); }, async delete() {} };
    return app.foto.POST(c);
  }
  assert.fail('Ruta inesperada: ' + u.pathname);
}
let w, doc;
/** Abre (o recarga) la página del técnico con lo que el celular tenga guardado. */
/** Cierra la página cuando ya no tiene nada en vuelo: una página cerrada no sigue enviando. */
async function cerrarPagina() {
  if (!w) return;
  for (let i = 0; i < 300 && (enVuelo || /Enviando/.test(pill())); i++) await espera(10);
  await espera(20);
  w.close(); await espera(30);
}
async function abrir(url) {
  await cerrarPagina();
  const dom = new JSDOM(HTML, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  w = dom.window; doc = w.document;
  Object.defineProperty(w.navigator, 'onLine', { get: () => enLinea });
  w.indexedDB = idb; w.IDBKeyRange = IDBKeyRange; w.crypto = globalThis.crypto;
  // La foto: el lienzo se simula y los archivos son los de Node, como los guarda un navegador en IndexedDB.
  w.File = File; w.FormData = FormData;
  w.URL.createObjectURL = () => 'blob:foto-de-prueba';
  w.createImageBitmap = async () => ({ width: 3000, height: 2000 });
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
const PLAZOS = [/Ronda de las \d{2}:\d{2}/g, /turno (de las )?\d{2}:\d{2}/g, /antes de (las )?\d{2}:\d{2}/g, /Venc(e|ió) (hoy|\d{2}\/\d{2}\/\d{4}) \d{2}:\d{2}/g];
const anotar = (donde) => vistas.push({ donde, t: `${texto()} | ${hoja()} | ${doc.querySelector('#aviso').hidden ? '' : doc.querySelector('#aviso').textContent}`, fichas: [...doc.querySelectorAll('#movil a[href^="/ordenes/"]')].map((a) => a.getAttribute('href')) });
const clic = async (accion, extra = '') => {
  const b = doc.querySelector(`#movil [data-a="${accion}"]${extra}`);
  assert.ok(b, `No hay botón ${accion}${extra}: ${texto().slice(0, 200)} | ${hoja().slice(0, 200)}`);
  b.click();
  await espera();
  anotar(accion);
};
const escribir = (sel, valor) => { const el = doc.querySelector(sel); assert.ok(el, 'No hay campo ' + sel); el.value = valor; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
const fotoEn = async (sel) => {
  const input = doc.querySelector(sel);
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([new Uint8Array(60000)], 'IMG_0001.jpg', { type: 'image/jpeg' })] });
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
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
  // Sola y en pausa, la emergencia no tapa lo que sigue: encabeza la lista.
  const primera = doc.querySelector('.resto .fila.sub');
  ok(primera?.dataset.h === '#orden-601' && /En pausa: Todavía no vuelve a la normalidad/.test(primera.textContent), 'La emergencia en pausa encabeza la lista: ' + texto().slice(0, 300));
  ok(!doc.querySelector('.ahora [data-h="#orden-601"]'), 'Y no ocupa «Ahora»');
  primera.click(); await espera(); anotar('emergencia en pausa');
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
  escribir('#lectura', '10');
  await clic('lectura');
  ok(/3 de 3 pasos anotados/.test(texto()), texto().slice(0, 120));
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
  escribir('#lectura', '14,5');
  await clic('lecturaLib');
  ok(/No libera/.test(hoja()) && doc.querySelector('[data-a="repetirLectura"]') && doc.querySelector('[data-a="reversaPaso"]') && doc.querySelector('[data-a="dejarEnEspera"]'), 'Fuera de rango: la hoja No libera');
  await clic('repetirLectura');
  ok(!hoja() && doc.querySelector('#lectura').value === '' && /Anotaste: 14\.5 A, fuera de rango/.test(texto()), 'Repetir: el campo vacío y lo anotado a la vista');
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
  igual(one("SELECT COUNT(*) n FROM orden_prerrequisitos WHERE orden_id=702 AND cumplido=1").n, 6);
  igual(one("SELECT COUNT(*) n FROM campo_operaciones WHERE resultado='rechazada'").n, 0, 'Sin rechazos: ' + JSON.stringify(all("SELECT tipo, detalle FROM campo_operaciones WHERE resultado='rechazada'")));

  // ══ Dos emergencias: la que el técnico ya empezó queda arriba; cada una dice cuándo vence ══
  ahora = enSV('11:30');
  const agu = one("SELECT id, titulo FROM procedimientos WHERE codigo_corto='EOP-AGU-01'");
  const manana = new RealDate(RealDate.parse(`${svHoy}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const fechaManana = `${manana.slice(8, 10)}/${manana.slice(5, 7)}/${manana.slice(0, 4)}`;
  orden(604, 'emergencia', '[Emergencia] Sin agua en el edificio', null, 'infraestructura', null);
  sqlite.prepare('UPDATE ordenes SET procedimiento_id=?, ubicacion_id=81, vencimiento=? WHERE id=604').run(agu.id, iso(enSV('12:00')));
  orden(605, 'emergencia', '[Emergencia] Falla de energía - PE-01', 81, 'infraestructura', null);
  sqlite.prepare('UPDATE ordenes SET procedimiento_id=?, vencimiento=? WHERE id=605').run(eop.id, iso(enSV('13:00', manana)));
  await abrir('https://test.invalid/campo#hoy');
  const bloque = () => doc.querySelector('.ahora')?.textContent ?? '';
  await hasta(() => /Atender la emergencia/.test(bloque()) && doc.querySelector('[data-h="#orden-605"]'), 'Hoy con dos emergencias');
  anotar('dos emergencias');
  ok(bloque().includes(agu.titulo) && /Emergencia · Vence hoy 12:00/.test(bloque()), 'Sin empezar ninguna, arriba la que vence primero, con su plazo: ' + bloque());
  await clic('ir', '[data-h="#orden-605"]');
  ok(texto().includes(`Emergencia · Vence ${fechaManana} 13:00`), 'El inicio de la emergencia dice cuándo vence: ' + texto().slice(0, 200));
  anotar('inicio con plazo');
  await clic('llegue');
  ok(/Acción 1 de 3/.test(texto()), texto().slice(0, 120));
  await hasta(() => enviados.some((op) => op.tipo === 'orden.iniciar' && op.ordenId === 605), 'orden.iniciar sale');
  igual(JSON.stringify(enviados.find((op) => op.tipo === 'orden.iniciar' && op.ordenId === 605).acciones), JSON.stringify([eop.a1, eop.a2, eop.a3].map((t) => t.trim())), 'orden.iniciar lleva las acciones que el celular muestra');
  await clic('hecho'); await clic('hecho'); await clic('hecho');
  ok(/¿Ya está controlado\?/.test(texto()));
  await clic('todaviaNoControlado');
  await hasta(() => /Hola/.test(texto()), 'vuelve a Hoy');
  anotar('la empezada arriba');
  ok(/Está primera en Hoy/.test(doc.querySelector('#aviso').textContent));
  ok(doc.querySelector('.ahora [data-h="#orden-605"]') && /Seguir/.test(bloque()) && !bloque().includes(agu.titulo), 'Arriba queda la que el técnico empezó, no la que nadie empezó: ' + bloque());
  ok(bloque().includes(`Vence ${fechaManana} 13:00`), 'Con su plazo');
  ok(doc.querySelector('.resto [data-h="#orden-604"]'), 'La otra sigue en la lista');
  await hasta(() => one('SELECT COUNT(*) n FROM orden_paso_marcas WHERE orden_id=605').n === 3, 'las acciones llegan');
  ok(enviados.filter((op) => op.tipo === 'orden.paso' && op.ordenId === 605).every((op) => op.acciones?.length === 3), 'orden.paso también las lleva');
  // Empezada y luego en pausa, sigue arriba de la que nadie empezó.
  await clic('ir', '[data-h="#orden-605"]');
  await clic('pausar');
  await clic('motivoPausa', '[data-m="Me pasaron a otra urgencia"]');
  await clic('confirmarPausa');
  await hasta(() => /Hola/.test(texto()) && /En pausa: Me pasaron a otra urgencia/.test(bloque()), 'la empezada, en pausa, sigue arriba');
  ok(doc.querySelector('.ahora [data-h="#orden-605"]') && !bloque().includes(agu.titulo) && doc.querySelector('.resto [data-h="#orden-604"]'), 'En pausa, sigue arriba de la que nadie empezó: ' + bloque());
  anotar('la empezada en pausa arriba');
  sqlite.exec("UPDATE ordenes SET estado='cancelada' WHERE id IN (604,605)");

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
  await abrir('https://test.invalid/campo#hoy');
  await hasta(() => /Sin asignar en esta sede/.test(texto()), 'las libres en Hoy');
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

  // ══ Ninguna pantalla mostró tiempos de medición ni mandó a la ficha ══
  const horasDeInicio = [horaSV(enSV('09:02')), horaSV(llegue), horaSV(enSV('10:35'))];
  for (const v of vistas) {
    ok(!PROHIBIDO.test(v.t), `${v.donde}: «${v.t.match(PROHIBIDO)?.[0]}» en ${v.t.slice(0, 200)}`);
    let resto = v.t; for (const re of PLAZOS) resto = resto.replace(re, '');
    ok(!/\b\d{1,2}:\d{2}\b/.test(resto), `${v.donde}: una hora a la vista: ${resto.match(/.{0,50}\b\d{1,2}:\d{2}\b.{0,20}/)?.[0]}`);
    ok(horasDeInicio.every((h) => !v.t.includes(h)), `${v.donde}: una hora de inicio a la vista`);
    ok(v.fichas.every((h) => h.includes('?completa=1')), `${v.donde}: un enlace a la ficha completa: ${v.fichas}`);
  }
  console.log(`PASS e2e-campo-emergencia: ${checks} verificaciones; emergencia sin señal y luego con señal, intervención con permiso, lectura fuera de rango y reversa, borrador que sobrevive a recargar; MOP-MSP-01 real con un permiso a la vista, lectura con rango que pide su número y cierre resumido; dos emergencias con la empezada arriba y su «Vence»; emergencia sin documento pedida de nuevo; «acciones» en orden.iniciar; envío rechazado que devuelve el texto; foto de hoja cancelada que no sale; orden libre que pasa a ser del técnico; cambio de turnos sin señal; ${vistas.length} pantallas sin tiempos.`);
} finally { await cerrarPagina().catch(() => {}); await close(); globalThis.Date = RealDate; }
process.exit(0);
