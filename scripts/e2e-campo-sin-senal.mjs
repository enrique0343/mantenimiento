// Recorrido real de la pantalla del técnico (src/campo/app.ts en jsdom) contra las rutas
// reales y SQLite: la ronda completa sin señal, cambio de turno sin señal, cambio de turno
// a media ronda con señal y sincronización tardía. No prueba diseño: eso es en un teléfono.
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
ahora = enSV('06:40');

const beforeMigration = (db, n) => { if (n.startsWith('0049_fase49')) db.exec("INSERT OR IGNORE INTO usuarios(id,nombre,email,password_hash,rol) VALUES(1000,'Administración','siembra@example.invalid','x','admin')"); };
const f = await setupConjuntos({ beforeMigration, modules: { hoy: 'pages/api/campo/hoy', sync: 'pages/api/campo/sync' } });
const { app, sqlite, ctx, close } = f;
sqlite.exec("INSERT INTO sucursales(id,nombre,activa) VALUES(8,'Sede 8',1),(9,'Sede 9',1);");
const one = (q, ...a) => sqlite.prepare(q).get(...a), all = (q, ...a) => sqlite.prepare(q).all(...a);

const bundle = await build({ entryPoints: ['src/campo/app.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent' });
const dom = new JSDOM('<!doctype html><html><body data-uid="3" data-nombre="Prueba tecnico" data-rol="tecnico"><section id="movil"><main id="pantalla"></main><nav id="tabs"></nav><div id="hoja" hidden></div><div id="aviso" role="status" hidden></div></section></body></html>', { url: 'https://test.invalid/campo#hoy', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
let enLinea = true;
Object.defineProperty(w.navigator, 'onLine', { get: () => enLinea });
w.indexedDB = new IDBFactory(); w.IDBKeyRange = IDBKeyRange; w.crypto = globalThis.crypto; w.File = w.File ?? File;
w.__ahora = () => ahora;
w.eval('const RD=Date; window.Date=class extends RD{constructor(...a){if(a.length)super(...a);else super(window.__ahora())} static now(){return window.__ahora()}};');
w.fetch = async (url, init = {}) => {
  if (!enLinea) throw new TypeError('Failed to fetch');
  const u = new URL(url, 'https://test.invalid');
  const data = init.body ? JSON.parse(init.body) : undefined;
  const route = u.pathname === '/api/campo/hoy' ? app.hoy.GET : u.pathname === '/api/campo/sync' ? app.sync.POST : null;
  assert.ok(route, 'Ruta inesperada: ' + u.pathname);
  return route(ctx(u.pathname + u.search, { method: init.method ?? 'GET', data, rol: 'tecnico' }));
};
w.eval(bundle.outputFiles[0].text);
const doc = w.document;
const espera = async (ms = 25) => { await new Promise((r) => setTimeout(r, ms)); };
const texto = () => doc.querySelector('#pantalla').textContent;
const hoja = () => doc.querySelector('#hoja').textContent;
const hasta = async (fn, msg) => { for (let i = 0; i < 300; i++) { if (fn()) return; await espera(10); } assert.fail('No llegó: ' + msg + ' · pantalla: ' + texto().slice(0, 300) + ' · hoja: ' + hoja().slice(0, 200)); };
const clic = async (accion) => { const b = doc.querySelector(`#movil [data-a="${accion}"]`); assert.ok(b, `No hay botón ${accion}: ${texto().slice(0, 200)} | ${hoja().slice(0, 200)}`); b.click(); await espera(); };
let checks = 0; const ok = (...x) => { assert.ok(...x); checks++; }, igual = (...x) => { assert.equal(...x); checks++; };
const irAHoy = async () => { doc.dispatchEvent(new w.Event('visibilitychange')); await espera(); };

try {
  await hasta(() => /¿En qué sede estás hoy\?/.test(texto()), 'pide sede');
  await clic('sede');
  doc.querySelector('[data-a="elegirSede"][data-id="8"]').click();
  await hasta(() => /Lo primero del turno/.test(texto()), 'la ronda es lo primero');
  ok(/Ronda de las 06:00/.test(texto()));
  const paquete = await (await w.fetch('/api/campo/hoy?sede=8')).json();
  const n = paquete.ronda.puntos.length;
  const idDe = (re) => paquete.ronda.puntos.find((p) => re.test(p.texto)).id;
  const TEMP = idDe(/Quirófanos · temperatura/), PANEL = idDe(/Panel de alarma de gases/), CUARTOS = idDe(/Cuartos técnicos/), PRESION = idDe(/Oxígeno · presión/), AISLA = idDe(/aislamiento/), BITACORA = idDe(/Bitácora/);

  // Se va la señal antes de empezar. Nada cambia para el técnico.
  enLinea = false; w.dispatchEvent(new w.Event('offline'));
  await clic('ronda');
  ok(/Parada 1 de/.test(texto()), texto().slice(0, 100));
  ok(/llegan cuando vuelva/.test(texto()), 'Sin señal, la línea 1 no afirma que no hay entrega ni desviaciones');
  let vistas = 0, tempEn = 0;
  while (/Parada \d+ de/.test(texto()) && vistas < 40) {
    vistas++;
    const titulo = doc.querySelector('.paso-cuerpo h1').textContent;
    const pt = paquete.ronda.puntos.find((p) => p.texto.replace(/ · /g, ': ') === titulo);
    ok(pt, 'Parada desconocida: ' + titulo);
    ahora += 90000;
    if (pt.id === TEMP) { // número fuera de rango: primero dónde, luego el AOP con su reloj
      doc.querySelector('#lectura').value = '25';
      tempEn = ahora;
      await clic('lectura');
      ok(/Lectura 25/.test(hoja()) && /Sala o zona/.test(hoja()), hoja().slice(0, 120));
      doc.querySelector('#nota-novedad').value = 'Quirófano 2';
      ahora += 5000;
      await clic('novedadSeguir');
      ok(/AOP-HVAC-01/.test(hoja()), hoja().slice(0, 120));
      ok(/Actuar antes de/.test(hoja()));
      ok(/Tu jefatura la ve cuando vuelva la señal/.test(hoja()), 'Sin señal no promete lo que no pasó');
      await clic('aopSeguir');
    } else if (pt.id === PANEL) { // no conforme: primero qué viste
      await clic('noconf');
      ok(/¿Qué viste\?/.test(hoja()));
      await clic('novedadSeguir');
      ok(!doc.querySelector('#err-novedad').hidden, 'Sin nota no sigue');
      doc.querySelector('#nota-novedad').value = 'Alarma de presión baja en zona 2';
      await clic('novedadSeguir');
      ok(/AOP-GAS-01/.test(hoja()), hoja().slice(0, 120));
      await clic('aEop');
      ok(/Abrir orden de emergencia/.test(hoja()), hoja().slice(0, 120));
      await clic('abrirEmergencia');
    } else if (pt.id === CUARTOS) { // esta parada no abre AOP: pide orden
      await clic('noconf');
      doc.querySelector('#nota-novedad').value = 'Cajas contra el tablero';
      await clic('novedadSeguir');
      ok(/Esto pide una orden/.test(hoja()), hoja().slice(0, 120));
      await clic('correctivoDeParada');
    } else if (pt.id === AISLA) { // no se pudo
      await clic('noverif');
      await clic('noverifSeguir');
      ok(!doc.querySelector('#err-noverif').hidden);
      doc.querySelector('#nota-noverif').value = 'Cuarto ocupado por procedimiento';
      await clic('noverifSeguir');
    } else if (pt.pideValor) {
      doc.querySelector('#lectura').value = String(pt.min ?? pt.max ?? 3);
      await clic('lectura');
    } else {
      await clic('conforme');
    }
    await espera(5);
  }
  igual(vistas, n, 'Una parada por pantalla, todas');
  ok(/paradas verificadas/.test(texto()), texto().slice(0, 200));
  ok(/Sin verificar/.test(texto()));
  igual(one('SELECT COUNT(*) n FROM campo_operaciones').n, 0, 'Nada ha llegado al servidor');
  ok(/Quedan abiertas/.test(doc.querySelector('#entrega').value), 'La entrega ya viene escrita');
  doc.querySelector('#entrega').value = '';
  ahora += 60000;
  await clic('cerrarRonda');
  ok(!doc.querySelector('#err-entrega').hidden, 'Con novedades se escribe la entrega');
  doc.querySelector('#entrega').value = 'Queda abierta la temperatura del quirófano.';
  doc.querySelector('#entrega').dispatchEvent(new w.Event('input', { bubbles: true }));
  const firmaEn = ahora;
  await clic('cerrarRonda');
  await hasta(() => !/paradas verificadas/.test(texto()), 'vuelve a Hoy');

  // Sigue sin señal y cambia el turno: la ronda nueva se ofrece sola.
  ahora = enSV('14:20');
  await irAHoy();
  await hasta(() => /Ronda de las 14:00/.test(texto()), 'la ronda del turno nuevo, sin señal');
  ok(/Lo primero del turno/.test(texto()), texto().slice(0, 160));
  await clic('ronda');
  ok(/Parada 1 de/.test(texto()));
  await clic('conforme');
  await clic('salir'); await espera();

  // Vuelve la señal, tarde.
  ahora = enSV('15:05');
  enLinea = true; w.dispatchEvent(new w.Event('online'));
  await hasta(() => one("SELECT COUNT(*) n FROM ronda_ejecuciones WHERE turno='14:00'").n === 1 && one("SELECT COUNT(*) n FROM ronda_lecturas l JOIN ronda_ejecuciones e ON e.id=l.ejecucion_id WHERE e.turno='14:00'").n === 1, 'todo se sincroniza');
  const r6 = one("SELECT * FROM ronda_ejecuciones WHERE turno='06:00' AND sucursal_id=8");
  igual(r6.estado, 'completada'); igual(r6.completada_por, 3); igual(r6.completada_en, new RealDate(firmaEn).toISOString(), 'La firma con su hora real');
  igual(r6.firma_nombre, 'Prueba tecnico');
  ok(r6.recibida_en > r6.completada_en, 'Se ve que llegó después');
  igual(r6.notas, 'Queda abierta la temperatura del quirófano.');
  igual(all('SELECT id FROM ronda_lecturas WHERE ejecucion_id=?', r6.id).length, n);
  const lTemp = one('SELECT * FROM ronda_lecturas WHERE ejecucion_id=? AND punto_id=?', r6.id, TEMP);
  igual(lTemp.resultado, 'fuera'); igual(lTemp.valor, 25); igual(lTemp.nota, 'Quirófano 2');
  igual(lTemp.registrado_en, new RealDate(tempEn).toISOString(), 'La hora es la de la lectura, no la de la nota');
  igual(one('SELECT resultado r FROM ronda_lecturas WHERE ejecucion_id=? AND punto_id=?', r6.id, AISLA).r, 'no_verificado');
  ok(all('SELECT sin_senal s, recibido_en r, ocurrido_en o FROM ronda_marcas WHERE ejecucion_id=?', r6.id).every((m) => m.s === 1 && m.r > m.o), 'Cada lectura dice que se capturó sin señal');
  const ev = one('SELECT * FROM aop_eventos WHERE ronda_punto_id=? AND sucursal_id=8', TEMP);
  igual(ev.detectado_en, lTemp.registrado_en, 'El reloj del AOP corre desde la captura');
  ok(ev.actuar_antes_de < new RealDate(enSV('15:05')).toISOString(), 'Ya venció: la jefatura lo ve en rojo');
  const evPanel = one('SELECT * FROM aop_eventos WHERE ronda_punto_id=? AND sucursal_id=8', PANEL);
  igual(evPanel.estado, 'paso_a_eop', 'Ya falló: el episodio pasa a EOP');
  ok(evPanel.orden_id, 'Y queda ligado a su orden de emergencia');
  igual(one('SELECT orden_id o FROM ronda_lecturas WHERE ejecucion_id=? AND punto_id=?', r6.id, PANEL).o, evPanel.orden_id);
  ok(one('SELECT orden_id o FROM ronda_lecturas WHERE ejecucion_id=? AND punto_id=?', r6.id, CUARTOS).o, 'El correctivo queda ligado a su parada');
  const r14 = one("SELECT * FROM ronda_ejecuciones WHERE turno='14:00' AND sucursal_id=8");
  igual(r14.estado, 'en_curso'); igual(r14.iniciada_en, new RealDate(enSV('14:20')).toISOString());
  await hasta(() => /Emergencia abierta/.test(texto()), 'la emergencia pasa delante de la ronda');
  igual(one("SELECT COUNT(*) n FROM campo_operaciones WHERE resultado='rechazada'").n, 0, 'Sin rechazos');
  // Atendida la emergencia, Hoy vuelve a la ronda de este turno donde quedó.
  sqlite.exec("UPDATE ordenes SET estado='completada' WHERE tipo='emergencia'");
  w.dispatchEvent(new w.Event('online'));
  await hasta(() => /Ronda de las 14:00/.test(texto()) && /Sigues justo donde quedaste/.test(texto()), 'el paquete fresco sigue donde quedó');

  // Con señal, a media ronda, cambia el turno: la ronda se termina con su turno.
  ahora = enSV('21:50');
  await irAHoy();
  await hasta(() => /Ronda de las 14:00/.test(texto()), 'sigue la de las 14:00');
  await clic('ronda');
  await clic('conforme');
  await hasta(() => one("SELECT COUNT(*) n FROM ronda_lecturas l JOIN ronda_ejecuciones e ON e.id=l.ejecucion_id WHERE e.turno='14:00'").n === 2, 'sincroniza la segunda');
  ahora = enSV('22:05');
  const segundo = doc.querySelector('.paso-cuerpo h1').textContent;
  await w.dispatchEvent(new w.Event('online')); await espera(60);
  ok(/Ronda de las 14:00/.test(texto()), 'A media ronda el paquete no cambia el turno: ' + texto().slice(0, 80));
  igual(doc.querySelector('.paso-cuerpo h1').textContent, segundo, 'Sigue en la misma parada');
  const pt = paquete.ronda.puntos.find((p) => p.texto.replace(/ · /g, ': ') === segundo);
  if (pt.pideValor) { doc.querySelector('#lectura').value = String(pt.min ?? pt.max ?? 3); await clic('lectura'); } else await clic('conforme');
  await hasta(() => one("SELECT COUNT(*) n FROM ronda_lecturas l JOIN ronda_ejecuciones e ON e.id=l.ejecucion_id WHERE e.turno='14:00'").n === 3, 'la tercera cae en la ronda de las 14:00');
  igual(one("SELECT COUNT(*) n FROM ronda_ejecuciones WHERE turno='22:00'").n, 0, 'No abrió la ronda de las 22:00');
  await clic('salir'); await espera();
  await irAHoy();
  await hasta(() => /Ronda de las 22:00/.test(texto()), 'al salir de la ronda se ofrece la del turno nuevo');
  console.log(`PASS e2e-campo-sin-senal: ${checks} verificaciones; ${n} paradas sin señal, cambio de turno sin señal y a media ronda, sincronización tardía.`);
} finally { await close(); dom.window.close(); globalThis.Date = RealDate; }
process.exit(0);
