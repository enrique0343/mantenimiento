// La costura entre los espacios (claude/bio-esp-a) y el tablero biomédico
// (claude/bio-esp-b), 14/11/2026: el tablero usa el mismo espacio que el resto de la
// app (locals del middleware, cookie, ?espacio=); en General no aparece nada del
// bloque biomédico (pendientes de ubicación ni calibraciones); la búsqueda del
// tablero queda dentro del espacio; el aviso «Te asignaron …» lleva al cronograma de
// su espacio y la campana lo muestra solo ahí; y el middleware muestra el aviso
// «Este registro es del espacio …» en la ficha de un equipo pendiente de ubicación.
// Rutas reales, migraciones reales, sin red. Personas @prueba.local.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';
import { fijarReloj } from './test-support/reloj.mjs';

fijarReloj();
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = await setupConjuntos({ modules: {
  tablero: 'pages/api/preventivos/index', asignar: 'pages/api/preventivos/asignar', ubicar: 'pages/api/activos/asignar-ubicacion',
  notif: 'pages/api/notificaciones/index', historial: 'pages/api/preventivos/[id]/historial', prev: 'lib/preventivos', E: 'lib/espacio',
} });
const { app, sqlite, ctx, call, close } = fixture;
const one = (q, ...a) => sqlite.prepare(q).get(...a);
const run = (q, ...a) => sqlite.prepare(q).run(...a);
let n = 0;
const igual = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };

// Usuarios del fixture: admin=1, jefe=2, tecnico=3, visualizador=4.
const JEFE = 2, TECNICO = 3;
const especialidad = (id, e) => run('UPDATE usuarios SET especialidad=? WHERE id=?', e, id);
const HOY = new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
const dia = (k) => new Date(Date.parse(`${HOY}T12:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
const filas = (t) => [...t.programados, ...t.atrasados.sinAsignar, ...t.atrasados.asignados];

try {
  run("INSERT INTO sucursales(id,nombre,activa) VALUES(1,'Sede costura',1)");
  run("INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo,activa) VALUES(1,1,'Sala costura','area',1)");
  sqlite.exec(`
    INSERT INTO activos(id,codigo,nombre,rubro,tipo,ubicacion_id,ubicacion,requiere_calibracion) VALUES
      (501,'COS-AIRE','Aire costura','aires','general',1,NULL,0),
      (502,'COS-AIRE-PEND','Aire sin ubicación','aires','general',NULL,'Azotea norte',1),
      (503,'COS-BIO','Monitor costura','biomedico','biomedico',1,NULL,1),
      (504,'COS-BIO-PEND','Bomba sin ubicación','biomedico','biomedico',NULL,'Quirófano Azul C. M.',0);
    INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha) VALUES
      (601,501,'Rutina costura aire','mensual','${dia(3)}'),
      (602,503,'Rutina costura monitor','semestral','${dia(4)}'),
      (603,504,'Rutina costura bomba','anual','${dia(-3)}');
    INSERT INTO calibraciones(activo_id,fecha_calibracion,proxima_calibracion,resultado,certificado_r2_key,usuario_id) VALUES
      (502,'${dia(-400)}','${dia(-5)}','conforme','cert/a.pdf',1),
      (503,'${dia(-400)}','${dia(-5)}','conforme','cert/b.pdf',1);
  `);

  // ── El espacio del tablero es el del resto de la app ─────────────────────────
  {
    const { espacioDelPedido } = app.prev;
    const { espacioDelContexto } = app.E;
    const url = new URL('https://test.invalid/preventivos');
    const casos = [
      ['admin con locals Biomédico', { locals: { espacio: 'biomedico' }, url }, { rol: 'admin', especialidad: null }],
      ['jefe General con locals Biomédico (no le corresponde)', { locals: { espacio: 'biomedico' }, url }, { rol: 'jefe', especialidad: 'general' }],
      ['jefe ambos con la cookie Biomédico', { cookies: { get: (k) => (k === 'espacio' ? { value: 'biomedico' } : undefined) }, url }, { rol: 'jefe', especialidad: 'ambos' }],
      ['jefe ambos con ?espacio=biomedico', { url: new URL('https://test.invalid/preventivos?espacio=biomedico') }, { rol: 'jefe', especialidad: 'ambos' }],
      ['jefe Biomédico sin nada', { url }, { rol: 'jefe', especialidad: 'biomedico' }],
    ];
    for (const [quien, c, user] of casos) igual(espacioDelPedido(c, user), espacioDelContexto(c, user), `${quien}: el tablero usa el mismo espacio que el resto`);
    igual(espacioDelPedido(casos[1][1], casos[1][2]), 'general', 'un locals.espacio que el usuario no tiene no abre el tablero del otro espacio');
  }

  // ── En General no sale nada del tablero biomédico ───────────────────────────
  especialidad(JEFE, 'general');
  {
    const t = (await call(app.tablero.GET, '/api/preventivos', { rol: 'jefe' })).body;
    igual([t.espacio, t.biomedico], ['general', null], 'General: sin bloque biomédico (ni pendientes de ubicación ni calibraciones)');
    igual(filas(t).map((f) => f.planId), [601], 'General: solo el preventivo del aire');
    const forzado = (await call(app.tablero.GET, '/api/preventivos?area=biomedico&espacio=biomedico', { rol: 'jefe' })).body;
    igual([forzado.espacio, forzado.biomedico, filas(forzado).map((f) => f.planId)], ['general', null, [601]], 'el jefe de General no fuerza Biomédico con ?espacio= ni ?area=');
    const busca = (await call(app.tablero.GET, '/api/preventivos?q=COS-BIO', { rol: 'jefe' })).body;
    igual(filas(busca).length, 0, 'la búsqueda del tablero de General no encuentra equipos biomédicos');
    const ubica = await call(app.ubicar.POST, '/api/activos/asignar-ubicacion', { method: 'POST', rol: 'jefe', data: { activoIds: [504], ubicacionId: 1 } });
    igual([ubica.status, ubica.body.error], [403, 'Este registro es del espacio Biomédico.'], 'el jefe de General no asigna la ubicación de un biomédico');
    igual(one('SELECT ubicacion_id u FROM activos WHERE id=504').u, null, 'y el equipo sigue pendiente');
  }
  especialidad(JEFE, 'biomedico');
  {
    const t = (await call(app.tablero.GET, '/api/preventivos', { rol: 'jefe' })).body;
    igual(t.espacio, 'biomedico', 'el jefe de Biomédico abre su tablero sin ?espacio=');
    igual(filas(t).map((f) => f.planId).sort(), [602, 603], 'Biomédico: solo sus preventivos');
    igual(t.biomedico.pendientes.map((p) => [p.codigo, p.texto]), [['COS-BIO-PEND', 'Pendiente de asignar · según inventario: Quirófano Azul C. M.']], 'pendientes: solo el biomédico, no el aire sin ubicación');
    igual(t.biomedico.calibraciones.vencidas.map((c) => c.codigo), ['COS-BIO'], 'calibraciones: solo la del biomédico');
    const fila = filas(t).find((f) => f.planId === 603);
    igual([fila.ubicacionPendiente, fila.ubicacionPendienteTexto], [true, 'Pendiente de asignar · según inventario: Quirófano Azul C. M.'], 'la fila dice lo mismo que la ficha');
    const busca = (await call(app.tablero.GET, '/api/preventivos?q=COS-AIRE', { rol: 'jefe' })).body;
    igual(filas(busca).length, 0, 'la búsqueda del tablero biomédico no encuentra aires');
  }

  // ── El aviso «Te asignaron …» lleva al cronograma de su espacio ─────────────
  {
    const { linkCronograma } = app.prev;
    igual(linkCronograma(['biomedico']), '/cronograma?area=biomedico&espacio=biomedico', 'enlace de Biomédico');
    igual(linkCronograma(['general', 'general']), '/cronograma?espacio=general', 'enlace de General');
    igual(linkCronograma(['general', 'biomedico']), '/cronograma', 'un lote mezclado: el cronograma común');
    especialidad(TECNICO, 'ambos');
    // La prueba no escribe avisos de verdad (no-external-effects): quedan anotados.
    const avisos = () => (globalThis.__efectosPrueba ?? []).filter((x) => x.canal === 'app' && x.tipo === 'preventivo_asignado' && x.usuarioId === TECNICO);
    const r = await call(app.asignar.POST, '/api/preventivos/asignar', { method: 'POST', rol: 'admin', data: { planIds: [602], tecnicoId: TECNICO } });
    igual(r.status, 200, 'el admin asigna el preventivo biomédico');
    igual(avisos().map((x) => x.link), ['/cronograma?area=biomedico&espacio=biomedico'], 'el aviso apunta al cronograma biomédico');
    const r2 = await call(app.asignar.POST, '/api/preventivos/asignar', { method: 'POST', rol: 'admin', data: { planIds: [601], tecnicoId: TECNICO } });
    igual(r2.status, 200, 'y el de General');
    igual(avisos().map((x) => x.link), ['/cronograma?area=biomedico&espacio=biomedico', '/cronograma?espacio=general'], 'el de General apunta a su cronograma');
    // Los mismos avisos en la campana real: cada uno solo en su espacio.
    for (const x of avisos()) run('INSERT INTO notificaciones(usuario_id,tipo,titulo,link) VALUES(?,?,?,?)', TECNICO, x.tipo, x.titulo, x.link);
    const campana = async (espacio) => (await call(app.notif.GET, `/api/notificaciones?espacio=${espacio}`, { rol: 'tecnico' })).body.notificaciones
      .filter((x) => x.tipo === 'preventivo_asignado').map((x) => x.link);
    igual(await campana('biomedico'), ['/cronograma?area=biomedico&espacio=biomedico'], 'la campana de Biomédico muestra solo el aviso biomédico');
    igual(await campana('general'), ['/cronograma?espacio=general'], 'la campana de General, solo el de General');
    // Los avisos viejos sin espacio siguen en los dos.
    run("INSERT INTO notificaciones(usuario_id,tipo,titulo,link) VALUES(?,'preventivo_asignado','Aviso viejo','/cronograma')", TECNICO);
    igual((await campana('general')).includes('/cronograma') && (await campana('biomedico')).includes('/cronograma'), true, 'un aviso viejo sin espacio se ve en los dos');
  }

  // ── El aviso del otro espacio en la ficha (middleware real) ─────────────────
  {
    const salida = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'mantenimiento-costura-mw-')), 'mw.mjs');
    await build({ entryPoints: [path.join(raiz, 'src/middleware.ts')], outfile: salida, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
      plugins: [{ name: 'astro-virtual', setup(b) {
        b.onResolve({ filter: /^astro:middleware$/ }, () => ({ path: 'astro:middleware', namespace: 'virtual' }));
        b.onLoad({ filter: /.*/, namespace: 'virtual' }, () => ({ contents: 'export const defineMiddleware = (fn) => fn;', loader: 'js' }));
      } }] });
    const { onRequest } = await import(pathToFileURL(salida).href);
    await fs.rm(path.dirname(salida), { recursive: true, force: true });
    const abrir = async (url, { rol = 'jefe', cookie = null } = {}) => {
      const c = ctx(url, { rol });
      const puestas = [];
      c.cookies = { get: (k) => (k === 'espacio' && cookie ? { value: cookie } : undefined), set: (k, v) => puestas.push([k, v]) };
      c.redirect = (to) => new Response(null, { status: 302, headers: { location: to } });
      let reescrita = 'sin-llamar';
      const res = await onRequest(c, async (destino) => { reescrita = destino ?? null; return new Response('pagina'); });
      return { status: res.status, reescrita, aviso: c.locals.avisoEspacio ?? null, espacio: c.locals.espacio, puestas, body: res.status === 403 ? await res.json() : null };
    };
    especialidad(JEFE, 'ambos');
    let r = await abrir('/activos/504?area=biomedico', { cookie: 'general' });
    igual([r.reescrita, r.aviso], ['/otro-espacio', { espacio: 'biomedico', puedeCambiar: true, volver: '/activos/504?area=biomedico' }], 'ambos en General abre el biomédico pendiente: aviso con botón');
    const boton = app.E.hrefCambiarEspacio(r.aviso.volver, 'biomedico');
    r = await abrir(boton, { cookie: 'general' });
    igual([r.reescrita, r.aviso, r.espacio, r.puestas], [null, null, 'biomedico', [['espacio', 'biomedico']]], 'el botón abre la ficha en Biomédico y lo recuerda');
    r = await abrir('/preventivos', { cookie: 'biomedico' });
    igual([r.reescrita, r.espacio], [null, 'biomedico'], '/preventivos con la cookie Biomédico: el tablero biomédico');
    r = await abrir('/preventivos?area=aires', { cookie: 'biomedico' });
    igual([r.reescrita, r.aviso?.espacio, r.aviso?.puedeCambiar], ['/otro-espacio', 'general', true], '/preventivos con un área de General estando en Biomédico: aviso');
    especialidad(JEFE, 'general');
    r = await abrir('/activos/504');
    igual([r.reescrita, r.aviso?.espacio, r.aviso?.puedeCambiar], ['/otro-espacio', 'biomedico', false], 'el jefe de General: aviso sin botón');
    r = await abrir('/api/preventivos/603/historial');
    igual(r.reescrita, null, 'el historial no pasa por el registro del middleware; lo cuida su API');
    const h = await call(app.historial.GET, '/api/preventivos/603/historial', { rol: 'jefe', id: 603 });
    igual(h.status, 403, 'y responde 403 al jefe de General');
    r = await abrir('/api/activos/asignar-ubicacion');
    igual(r.reescrita, null, 'asignar-ubicacion no se confunde con la ficha de un equipo');
  }

  console.log(`PASS test-espacios-costura: ${n} verificaciones; el tablero usa el espacio de la app, General sin pendientes ni calibraciones biomédicas, búsqueda del tablero dentro del espacio, aviso de asignación por espacio en la campana y aviso del otro espacio en la ficha. Migraciones reales, sin red.`);
} finally { await close(); }
