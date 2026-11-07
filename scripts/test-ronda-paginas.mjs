// Las pantallas de jefatura de la ronda, construidas de verdad, contra migraciones reales. Correr después de npm run build.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { experimental_AstroContainer } from 'astro/container';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';
const beforeMigration = (db, n) => { if (n.startsWith('0049_fase49')) db.exec("INSERT OR IGNORE INTO usuarios(id,nombre,email,password_hash,rol) VALUES(1000,'Administración','siembra@example.invalid','x','admin')"); };
const f = await setupConjuntos({ beforeMigration, modules: { hoy: 'pages/api/campo/hoy', sync: 'pages/api/campo/sync' } });
const { app, sqlite, call, DB } = f;
const raiz = process.cwd();
const cargar = async (rel) => (await import(pathToFileURL(path.join(raiz, 'dist/_worker.js/pages', rel)).href)).page().default;
let checks = 0; const ok = (c, m) => { assert.ok(c, m); checks++; };
try {
  sqlite.exec("INSERT INTO sucursales(id,nombre,activa) VALUES(1,'Sede Uno',1),(2,'Sede Dos',1)");
  const r = (await call(app.hoy.GET, '/api/campo/hoy?sede=1', { rol: 'tecnico' })).body.ronda;
  const clave = { sucursalId: 1, fecha: r.fecha, turno: r.turno };
  const pts = r.puntos; let n = 0;
  const op = (tipo, extra) => ({ opId: `pag-${++n}-${tipo}`, tipo, at: new Date(Date.now() - (60 - n) * 60000).toISOString(), ...clave, ...extra });
  let resto = pts.map((p) => op('ronda.lectura', { puntoId: p.id, resultado: /^Quirófanos · temperatura/.test(p.texto) ? 'fuera' : 'ok', ...(p.pideValor ? { valor: /^Quirófanos · temperatura/.test(p.texto) ? 25 : p.min ?? p.max ?? 1 } : {}) }));
  while (resto.length) { const x = await call(app.sync.POST, '/api/campo/sync', { method: 'POST', data: { ops: resto.slice(0, 20) }, rol: 'tecnico' }); resto = resto.slice(x.body.resultados.length); }
  await call(app.sync.POST, '/api/campo/sync', { method: 'POST', data: { ops: [op('ronda.cerrar', { firma: true, notas: 'Queda abierta la temperatura.' })] }, rol: 'tecnico' });
  await call(app.sync.POST, '/api/campo/sync', { method: 'POST', data: { ops: [op('ronda.lectura', { sucursalId: 2, fecha: '2020-01-01', turno: '06:00', puntoId: pts[0].id, resultado: 'ok' })] }, rol: 'tecnico' });
  const id = sqlite.prepare('SELECT id FROM ronda_ejecuciones WHERE sucursal_id=1').get().id;
  const container = await experimental_AstroContainer.create();
  const render = async (rel, url, rol, uid, params) => {
    const res = await container.renderToResponse(await cargar(rel), { partial: false, request: new Request(`https://local.test${url}`), params, locals: { user: { id: uid, nombre: `Cuenta ${rol}`, rol }, runtime: { env: { DB } } } });
    return { status: res.status, location: res.headers.get('location'), html: res.status === 200 ? await res.text() : '' };
  };
  for (const [rol, uid] of [['admin', 1], ['jefe', 2], ['visualizador', 4]]) {
    const t = await render('ronda.astro.mjs', '/ronda', rol, uid);
    ok(t.status === 200 && /Por sede/.test(t.html) && /Sede Uno/.test(t.html), `${rol} ve el tablero`);
    ok(/Completa con novedades/.test(t.html), `${rol}: la ronda con novedades no sale verde`);
    ok(/Sin iniciar/.test(t.html), `${rol}: la otra sede sale sin iniciar`);
    ok(/0 de 21 paradas/.test(t.html), `${rol}: la sede sin iniciar dice cuántas paradas le tocan`);
    ok(/sin aceptar/.test(t.html), `${rol}: ve los registros que el servidor no aceptó`);
    const d = await render('ronda/_id_.astro.mjs', `/ronda/${id}`, rol, uid, { id: String(id) });
    ok(d.status === 200 && /Firmada/.test(d.html) && /Queda abierta la temperatura/.test(d.html), `${rol} ve la ronda firmada y la entrega`);
    ok(/capturada sin señal/.test(d.html), `${rol} ve que se capturó sin señal`);
    ok(!/<button/.test(d.html.split('<main')[1] ?? '') || !/Conforme/.test(d.html), `${rol}: el detalle es de solo lectura`);
    const s = await render('ronda/semana.astro.mjs', '/ronda/semana', rol, uid);
    ok(s.status === 200 && /Revisión de la semana/.test(s.html), `${rol} ve la semana`);
    ok(/Firmar la revisión/.test(s.html) === (rol !== 'visualizador'), `${rol}: firmar solo jefatura`);
  }
  for (const rel of ['ronda.astro.mjs', 'ronda/semana.astro.mjs']) {
    const t = await render(rel, '/ronda', 'tecnico', 3);
    ok(t.status === 302 && t.location === '/campo', 'El técnico vuelve a su pantalla');
  }
  const p = await render('ronda/puntos.astro.mjs', '/ronda/puntos', 'admin', 1);
  ok(p.status === 200 && /crear recorrido propio/.test(p.html) && /provisional/.test(p.html), 'La jefatura ve paradas, sedes y provisionales');
  ok(!/sin AOP asignado/.test(p.html), 'Bitácora y cuartos técnicos no se reportan como falta de AOP');
  const v = await render('ronda/puntos.astro.mjs', '/ronda/puntos', 'visualizador', 4);
  ok(v.status === 302, 'El visualizador no configura');
  const rd = await render('rondas.astro.mjs', '/rondas?execution=9', 'admin', 1);
  ok(rd.status === 301 && rd.location === '/ronda', 'Los enlaces viejos llegan al tablero');
  console.log(`PASS test-ronda-paginas: ${checks} verificaciones; pantallas construidas, migraciones reales.`);
} finally { await f.close(); }
