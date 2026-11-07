// Recorrido real de la pantalla del técnico (src/campo/app.ts en jsdom) contra las rutas
// reales y SQLite, con un reloj fijo: la emergencia completa sin señal y luego con señal,
// con sus horas guardadas en el servidor y ninguna a la vista; la intervención con su
// permiso, una lectura fuera de rango, la reversa y el envío; lo escrito en una hoja y la
// foto ya tomada sobreviven a recargar la página; lo que el servidor aceptó no reaparece
// como pendiente al recargar sin señal; y ninguna pantalla muestra tiempos de medición.
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
const enSV = (hhmm) => RealDate.parse(`${svHoy}T${hhmm}:00-06:00`);
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
async function rutaReal(url, init = {}) {
  if (!enLinea) throw new TypeError('Failed to fetch');
  const u = new URL(url, 'https://test.invalid');
  if (u.pathname === '/api/campo/hoy') return hoyFalla ? new Response('', { status: 503 }) : app.hoy.GET(ctx(u.pathname + u.search, { rol: 'tecnico' }));
  if (u.pathname === '/api/campo/sync') return app.sync.POST(ctx(u.pathname, { method: 'POST', data: JSON.parse(init.body), rol: 'tecnico' }));
  if (u.pathname === '/api/campo/ordenes') { ordenesPedidas++; return app.ordenes.GET(ctx(u.pathname + u.search, { rol: 'tecnico' })); }
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
async function abrir(url) {
  if (w) { w.close(); await espera(30); }
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
const PLAZOS = [/Ronda de las \d{2}:\d{2}/g, /turno (de las )?\d{2}:\d{2}/g, /antes de (las )?\d{2}:\d{2}/g];
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
  const primera = doc.querySelector('.resto .fila.sub');
  ok(primera?.dataset.h === '#orden-601' && /En pausa: Todavía no vuelve a la normalidad/.test(primera.textContent), 'La emergencia en pausa encabeza la lista: ' + texto().slice(0, 300));
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
  ok(/Falta\. Es obligatorio\./.test(texto()) && /Opcional/.test(texto()));
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
  ok(doc.querySelector('[data-a="empezar"]') && /PT-0457/.test(texto()) && /Lo saltaste/.test(texto()), 'Con los obligatorios cumplidos, aparece Empezar');
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

  // ══ Ninguna pantalla mostró tiempos de medición ni mandó a la ficha ══
  const horasDeInicio = [horaSV(enSV('09:02')), horaSV(llegue), horaSV(enSV('10:35'))];
  for (const v of vistas) {
    ok(!PROHIBIDO.test(v.t), `${v.donde}: «${v.t.match(PROHIBIDO)?.[0]}» en ${v.t.slice(0, 200)}`);
    let resto = v.t; for (const re of PLAZOS) resto = resto.replace(re, '');
    ok(!/\b\d{1,2}:\d{2}\b/.test(resto), `${v.donde}: una hora a la vista: ${resto.match(/.{0,50}\b\d{1,2}:\d{2}\b.{0,20}/)?.[0]}`);
    ok(horasDeInicio.every((h) => !v.t.includes(h)), `${v.donde}: una hora de inicio a la vista`);
    ok(v.fichas.every((h) => h.includes('?completa=1')), `${v.donde}: un enlace a la ficha completa: ${v.fichas}`);
  }
  console.log(`PASS e2e-campo-emergencia: ${checks} verificaciones; emergencia sin señal y luego con señal, intervención con permiso, lectura fuera de rango y reversa, borrador que sobrevive a recargar, ${vistas.length} pantallas sin tiempos.`);
} finally { if (w) w.close(); await close(); globalThis.Date = RealDate; }
process.exit(0);
