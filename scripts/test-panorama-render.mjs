// Render the actual built Astro page against isolated SQLite. No network or production data.
// Run after npm run build; this test deliberately does not rebuild or mock page components.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseHtml } from 'parse5';
import { experimental_AstroContainer } from 'astro/container';
import { setup, root } from './test-support/sqlite-app.mjs';

let checks = 0, networkCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { networkCalls++; throw new Error('Network forbidden in panorama render tests'); };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (v, m) => { assert.ok(v, m); checks++; };
const nodes = (n, p, o = []) => { if (p(n)) o.push(n); for (const c of n.childNodes ?? []) nodes(c, p, o); return o; };
const attr = (n, a) => n.attrs?.find((x) => x.name === a)?.value;
const hasClass = (n, c) => (attr(n, 'class') ?? '').split(/\s+/).includes(c);
const text = (n) => (n?.nodeName === '#text' ? n.value : (n?.childNodes ?? []).map(text).join(''));
const links = (n) => nodes(n, (x) => x.tagName === 'a').map((x) => attr(x, 'href')).filter(Boolean);
const limpio = (n) => text(n).replace(/\s+/g, ' ').trim();
const hostil = `Sede <img src=x onerror="window.__panoramaInjected=1">`;

const f = await setup({ modules: {} });
const { sqlite } = f;
sqlite.exec(`
  INSERT INTO usuarios(id,nombre,email,password_hash,rol) VALUES
    (2,'Técnico SSR','t-ssr@example.invalid','x','tecnico'),(3,'Jefe SSR','j-ssr@example.invalid','x','jefe'),(5,'Consulta SSR','v-ssr@example.invalid','x','visualizador'),(6,'Solicitante SSR','s-ssr@example.invalid','x','solicitante');
  INSERT INTO sucursales(id,nombre,activa) VALUES(2,'Sede B',1);
  INSERT INTO rondas(id,codigo,nombre,turnos,activa) VALUES(1,'RONDA-TURNO','Ronda','["06:00","14:00","22:00"]',1);
  INSERT INTO activos(id,codigo,nombre,rubro) VALUES(1,'SSR-LOCAL','Unidad SSR','aires');
`);
sqlite.prepare('INSERT INTO sucursales(id,nombre,activa) VALUES(1,?,1)').run(hostil);
let falla = false;
function statement(sql, args = []) {
  assert.match(sql, /^\s*(?:SELECT|WITH)\b/i, 'El Panorama solo lee');
  if (falla && /ronda_ejecuciones/.test(sql)) throw new Error('Injected isolated database failure');
  const q = sqlite.prepare(sql);
  return { bind(...p) { return statement(sql, p); }, async all() { return { results: q.all(...args), success: true }; }, async raw() { q.setReturnArrays(true); return q.all(...args); }, async first() { return q.get(...args) ?? null; } };
}
const DB = { prepare: (sql) => statement(sql), async batch(st) { const r = []; for (const s of st) r.push(await s.all()); return r; } };
const foto = () => JSON.stringify(sqlite.prepare('SELECT count(*) n FROM ronda_ejecuciones').get());

try {
  const { page } = await import(pathToFileURL(path.join(root, 'dist/_worker.js/pages/index.astro.mjs')).href);
  ok(typeof page().default === 'function', 'The real built Astro page must be importable');
  const container = await experimental_AstroContainer.create();
  const render = async (rol, id) => {
    const antes = foto();
    const html = await container.renderToString(page().default, { partial: false, request: new Request('https://local.test/'), locals: { user: { id, nombre: `Cuenta ${rol}`, rol }, runtime: { env: { DB } } } });
    eq(foto(), antes, 'Renderizar no escribe');
    const d = parseHtml(html);
    eq(limpio(nodes(d, (n) => n.tagName === 'h1')[0]), 'Panorama general');
    eq(nodes(d, (n) => hasClass(n, 'workspace-card')).map((n) => attr(n, 'href')), ['/areas/aires', '/areas/infraestructura', '/areas/equipo_general', '/areas/biomedico'], 'Las cuatro áreas siguen');
    return { d, t: limpio(d), a: links(d) };
  };
  for (const [rol, id] of [['admin', 1], ['jefe', 3]]) {
    const { t, a } = await render(rol, id);
    ok(t.includes('Ahora mismo'), `${rol} ve la cadena`);
    ok(t.includes('¿Se hizo la ronda de este turno?'), `${rol} ve la pregunta del SOP`);
    ok(t.includes('2 de 2 sedes no han iniciado'), `${rol}: sin ejecuciones, dos sedes sin iniciar`);
    ok(a.includes('/ronda'), `${rol} llega al tablero`);
    ok(a.includes('/aop'), `${rol} ve la cadena completa`);
    ok(!a.some((h) => h.startsWith('/rondas')), `${rol}: ningún enlace al motor retirado`);
    ok(!t.includes('Configura tu primera plantilla'), `${rol}: sin onboarding de plantillas`);
  }
  const v = await render('visualizador', 5);
  ok(v.t.includes('¿Se hizo la ronda de este turno?'), 'El visualizador ve si se hizo la ronda');
  ok(!v.a.includes('/aop'), 'Y nada más de la cadena');
  for (const [rol, id] of [['solicitante', 6]]) {
    const o = await render(rol, id);
    ok(!o.t.includes('Ahora mismo') && !o.a.some((h) => h.startsWith('/ronda')), `${rol} no ve rondas`);
  }
  // Una ronda con todo sin verificar nunca sale verde.
  const fechaHoy = new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
  const horas = new Date(Date.now() - 6 * 3600000).toISOString().slice(11, 13);
  const turno = horas < '06' ? '22:00' : horas < '14' ? '06:00' : horas < '22' ? '14:00' : '22:00';
  const fecha = horas < '06' ? new Date(Date.now() - 30 * 3600000).toISOString().slice(0, 10) : fechaHoy;
  for (const s of [1, 2]) sqlite.prepare("INSERT INTO ronda_ejecuciones(ronda_id,sucursal_id,fecha,turno,estado,puntos_total,puntos_no_verificados,completada_en) VALUES(1,?,?,?,'completada',21,21,'2026-01-01')").run(s, fecha, turno);
  const nv = await render('admin', 1);
  ok(nv.t.includes('sin verificar'), 'Lo no verificado se dice');
  ok(!nv.t.includes('sin novedades') && !nv.t.includes('Todo en orden'), 'Y no se presenta como todo en orden');
  ok(nv.t.includes(hostil), 'El nombre de sede se muestra como texto');
  eq(nodes(nv.d, (n) => n.tagName === 'img' && attr(n, 'onerror')).length, 0, 'Un texto guardado no crea elementos');
  // Una falla de base no se presenta como ceros.
  falla = true;
  const guardado = console.error; const errores = []; console.error = (...x) => errores.push(x.join(' '));
  let fallida; try { fallida = await render('admin', 1); } finally { console.error = guardado; falla = false; }
  ok(fallida.t.includes('No se pudo cargar el estado de la ronda'), 'La falla se dice en pantalla');
  ok(fallida.a.includes('/ronda'), 'Y deja el enlace al tablero');
  ok(!fallida.t.includes('Ahora mismo'), 'Sin cifras falsas');
  eq(errores, ['ahora_unavailable'], 'Solo registra su marca de diagnóstico');
  eq(networkCalls, 0, 'Sin red');
  console.log(`PASS panorama real SSR: ${checks} verificaciones; roles, ronda sin verificar, texto hostil, falla visible y áreas intactas.`);
} finally { globalThis.fetch = originalFetch; await f.close(); }
