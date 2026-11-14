// Contrato de los espacios de trabajo «General» y «Biomédico» (src/lib/espacio.ts) y
// lo que el middleware deja en Astro.locals. Sin red ni base remota: SQLite en memoria.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
const si = (v, nota) => { n++; assert.equal(v, true, nota); };

const cargar = async (contents, plugins = []) => {
  const out = await build({
    stdin: { contents, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false,
    tsconfig: path.join(root, 'tsconfig.json'), logLevel: 'silent', plugins,
  });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
};

const E = await cargar(`
  export * from './src/lib/espacio';
  export { AREA_KEYS } from './src/lib/areas';
  export { rubroDeActivo } from './src/lib/rubros';
  export { tipoActivoFiltro } from './src/lib/especialidad';
  export { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
  export { sql } from 'drizzle-orm';
  export { activos, ordenes, notificaciones } from './src/lib/schema';
`, [{
  // especialidad.ts trae db.ts (Cloudflare); aquí solo se usa tipoActivoFiltro.
  name: 'sin-db', setup(b) { b.onResolve({ filter: /^\.\/db$/ }, () => ({ path: 'db', namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const getDb = () => { throw new Error("sin base"); };', loader: 'js' })); },
}]);

// ── ESPACIOS: etiqueta, rótulo, colores, tablero y áreas ─────────────────────
es(E.ESPACIO_KEYS, ['general', 'biomedico'], 'dos espacios, General primero');
es(E.COOKIE_ESPACIO, 'espacio', 'nombre de la cookie');
es(E.PARAM_ESPACIO, 'espacio', 'nombre del parámetro');
es([E.ESPACIOS.general.etiqueta, E.ESPACIOS.general.rotulo, E.ESPACIOS.general.colorBarra, E.ESPACIOS.general.colorFranja, E.ESPACIOS.general.tablero],
  ['General', 'Mantenimiento general', '#1E2142', null, 'Tablero de preventivos'], 'General: marino de hoy, sin franja');
es([E.ESPACIOS.biomedico.etiqueta, E.ESPACIOS.biomedico.rotulo, E.ESPACIOS.biomedico.colorBarra, E.ESPACIOS.biomedico.colorFranja, E.ESPACIOS.biomedico.tablero],
  ['Biomédico', 'Ingeniería biomédica', '#23417D', '#23417D', 'Tablero biomédico'], 'Biomédico: azul con franja');
es(E.areasDeEspacio('general'), ['aires', 'infraestructura', 'equipo_general'], 'áreas de General');
es(E.areasDeEspacio('biomedico'), ['biomedico'], 'áreas de Biomédico');
es([...E.areasDeEspacio('general'), ...E.areasDeEspacio('biomedico')].sort(), [...E.AREA_KEYS].sort(), 'cada área está en un solo espacio');
{
  const copia = E.areasDeEspacio('general');
  copia.push('biomedico');
  es(E.areasDeEspacio('general').length, 3, 'areasDeEspacio devuelve una copia');
}
for (const area of E.AREA_KEYS) es(E.espacioDeArea(area), E.ESPACIOS.biomedico.areas.includes(area) ? 'biomedico' : 'general', `espacioDeArea(${area})`);
es([E.espacioDeArea(null), E.espacioDeArea(undefined), E.espacioDeArea('otra')], ['general', 'general', 'general'], 'área vacía o desconocida: General');

// ── parseEspacio ─────────────────────────────────────────────────────────────
es(['general', 'biomedico', 'Biomedico', 'biomédico', '', null, undefined, 1].map(E.parseEspacio), ['general', 'biomedico', null, null, null, null, null, null], 'parseEspacio solo acepta las dos claves');

// ── espaciosPermitidos: rol × especialidad ───────────────────────────────────
const ROLES = ['admin', 'jefe', 'tecnico', 'proveedor', 'solicitante', 'visualizador', 'motorista'];
const ESPS = ['general', 'biomedico', 'ambos', null, undefined];
for (const rol of ROLES) for (const especialidad of ESPS) {
  const esperado = rol === 'admin' || rol === 'visualizador' ? ['general', 'biomedico']
    : especialidad === 'general' ? ['general'] : especialidad === 'biomedico' ? ['biomedico'] : ['general', 'biomedico'];
  es(E.espaciosPermitidos({ rol, especialidad }), esperado, `${rol} con especialidad ${especialidad}`);
  es(E.tieneInterruptor({ rol, especialidad }), esperado.length > 1, `${rol}/${especialidad}: interruptor`);
  for (const e of E.ESPACIO_KEYS) es(E.puedeEntrar({ rol, especialidad }, e), esperado.includes(e), `${rol}/${especialidad} entra a ${e}`);
}
es([E.espaciosPermitidos(null), E.espaciosPermitidos(undefined)], [[], []], 'sin usuario: ninguno');
es(E.tieneInterruptor(null), false, 'sin usuario: sin interruptor');
es(E.espaciosPermitidos({ rol: 'jefe', especialidad: 'otra' }), ['general', 'biomedico'], 'especialidad que la base no admite: como NULL');
{
  // La misma semántica que especialidad.ts: NULL y «ambos» no filtran; las otras sí.
  for (const especialidad of ['general', 'biomedico', 'ambos', null]) {
    const filtro = E.tipoActivoFiltro(especialidad);
    es(E.espaciosPermitidos({ rol: 'tecnico', especialidad }), filtro ? [filtro] : ['general', 'biomedico'], `igual que tipoActivoFiltro(${especialidad})`);
  }
  const a = E.espaciosPermitidos({ rol: 'admin' });
  a.pop();
  es(E.espaciosPermitidos({ rol: 'admin' }).length, 2, 'devuelve una lista nueva cada vez');
}

// ── resolverEspacio: URL, cookie, primero permitido ──────────────────────────
const ambos = { rol: 'jefe', especialidad: 'ambos' };
const bio = { rol: 'tecnico', especialidad: 'biomedico' };
const gen = { rol: 'jefe', especialidad: 'general' };
es(E.resolverEspacio(ambos, null), 'general', 'sin cookie ni URL: el primero (General)');
es(E.resolverEspacio(ambos, 'biomedico'), 'biomedico', 'recuerda el último (cookie)');
es(E.resolverEspacio(ambos, 'biomedico', 'general'), 'general', 'la URL manda sobre la cookie');
es(E.resolverEspacio(ambos, 'general', 'biomedico'), 'biomedico', 'la URL pide Biomédico');
es(E.resolverEspacio(ambos, 'basura', 'otra'), 'general', 'valores no válidos: el primero');
es(E.resolverEspacio(ambos, 'biomedico', 'otra'), 'biomedico', 'URL no válida: la cookie');
es(E.resolverEspacio(bio, null), 'biomedico', 'biomédico sin cookie');
es(E.resolverEspacio(bio, 'general', 'general'), 'biomedico', 'biomédico nunca cae en General');
es(E.resolverEspacio(gen, 'biomedico', 'biomedico'), 'general', 'general nunca cae en Biomédico');
es(E.resolverEspacio({ rol: 'visualizador', especialidad: 'general' }, null, 'biomedico'), 'biomedico', 'el visualizador entra a los dos');
es(E.resolverEspacio({ rol: 'admin', especialidad: 'biomedico' }, null), 'general', 'el admin no queda atado a su especialidad');
es(E.resolverEspacio(null, 'biomedico', 'biomedico'), 'general', 'sin usuario: General por omisión');
es(E.resolverEspacio(ambos, undefined, undefined), 'general', 'urlParam es opcional');

// ── espacioDeActivo: misma regla que rubroDeActivo ───────────────────────────
const filasActivo = [
  { rubro: 'biomedico', tipo: 'general' }, { rubro: 'aires', tipo: 'biomedico' }, { rubro: null, tipo: 'biomedico' },
  { rubro: null, tipo: 'general' }, { rubro: null, tipo: null }, { rubro: 'infraestructura', tipo: null },
  { rubro: 'equipo_general', tipo: 'biomedico' }, { rubro: 'otra', tipo: 'biomedico' }, { rubro: 'otra', tipo: 'general' }, {},
];
es(filasActivo.map(E.espacioDeActivo),
  ['biomedico', 'general', 'biomedico', 'general', 'general', 'general', 'general', 'biomedico', 'general', 'general'], 'espacioDeActivo');
for (const f of filasActivo) es(E.espacioDeActivo(f), E.espacioDeArea(E.rubroDeActivo(f.rubro, f.tipo)), `coincide con rubroDeActivo (${f.rubro}/${f.tipo})`);

// ── condicionActivoEspacio y condicionRubroEspacio en SQLite ─────────────────
{
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE activos (id INTEGER PRIMARY KEY, rubro TEXT, tipo TEXT)');
  db.exec('CREATE TABLE ordenes (id INTEGER PRIMARY KEY, rubro TEXT)');
  const ins = db.prepare('INSERT INTO activos (id, rubro, tipo) VALUES (?, ?, ?)');
  filasActivo.forEach((f, i) => ins.run(i + 1, f.rubro ?? null, f.tipo ?? null));
  const rubros = ['biomedico', 'aires', 'infraestructura', 'equipo_general', null, 'otra'];
  const insO = db.prepare('INSERT INTO ordenes (id, rubro) VALUES (?, ?)');
  rubros.forEach((r, i) => insO.run(i + 1, r));
  const dialecto = new E.SQLiteSyncDialect();
  const ids = (q) => { const { sql, params } = dialecto.sqlToQuery(q); return { ids: db.prepare(sql).all(...params).map((r) => r.id), params }; };
  for (const e of E.ESPACIO_KEYS) {
    const r = ids(E.sql`select ${E.activos.id} from ${E.activos} where ${E.condicionActivoEspacio(e)} order by ${E.activos.id}`);
    es(r.ids, filasActivo.map((f, i) => [i + 1, E.espacioDeActivo(f)]).filter(([, x]) => x === e).map(([id]) => id), `activos de ${e}: los mismos que espacioDeActivo`);
    es(r.params.length, 0, `condicionActivoEspacio(${e}) no usa parámetros (límite de 100 de D1)`);
    const o = ids(E.sql`select ${E.ordenes.id} from ${E.ordenes} where ${E.condicionRubroEspacio(E.ordenes.rubro, e)} order by ${E.ordenes.id}`);
    es(o.ids, rubros.map((r, i) => [i + 1, E.espacioDeArea(r)]).filter(([, x]) => x === e).map(([id]) => id), `órdenes de ${e} por rubro (NULL es General)`);
    es(o.params.length, 0, `condicionRubroEspacio(${e}) sin parámetros`);
  }
  const todos = ids(E.sql`select ${E.activos.id} from ${E.activos} where ${E.condicionActivoEspacio('general')} or ${E.condicionActivoEspacio('biomedico')}`);
  es(todos.ids.length, filasActivo.length, 'entre los dos espacios están todos los equipos, una vez');
}

// ── Textos ───────────────────────────────────────────────────────────────────
es([E.mensajeOtroEspacio('general'), E.mensajeOtroEspacio('biomedico')], ['Este registro es del espacio General.', 'Este registro es del espacio Biomédico.'], 'aviso del otro espacio');
es(E.opcionesCookieEspacio(true), { path: '/', httpOnly: true, sameSite: 'lax', secure: true, maxAge: 31536000 }, 'cookie de un año en HTTPS');
es(E.opcionesCookieEspacio(false).secure, false, 'cookie sin secure en local');

// ── Rutas de un solo espacio, registros y el destino del interruptor ────────
for (const p of ['/ronda', '/ronda/semana', '/rondas', '/aop/3', '/eop', '/electrico/2', '/actividades/9', '/catalogo-aires/nuevo', '/api/aop/eventos', '/api/ronda-turno/puntos', '/api/catalogo-aires', '/ronda/'])
  es(E.espacioDeRuta(p), 'general', `${p} es de General`);
for (const p of ['/calibraciones', '/calibraciones/patrones', '/seguridad-electrica/4', '/expedientes', '/licencias/nueva', '/capacitaciones', '/alertas', '/alertas/2', '/incidentes', '/cumplimiento', '/configuracion/plantillas', '/centros-costo', '/api/calibraciones/7', '/api/licencias', '/api/alertas/exportar', '/api/centros-costo/1'])
  es(E.espacioDeRuta(p), 'biomedico', `${p} es de Biomédico`);
for (const p of ['/', '/ordenes', '/activos', '/preventivos', '/configuracion', '/inventario', '/usuarios', '/proveedores', '/requisiciones', '/ubicaciones', '/rondas-x', '/aopx', '/calibracionesx', '/api/checklist-plantillas', '/api/espacio', '/campo'])
  es(E.espacioDeRuta(p), null, `${p} es común o depende de los datos`);
es(E.registroDeRuta('/activos/12'), { tipo: 'activos', id: 12, api: false }, 'ficha de equipo');
es(E.registroDeRuta('/ordenes/5/reporte'), { tipo: 'ordenes', id: 5, api: false }, 'subpágina de orden');
es(E.registroDeRuta('/api/planes/3'), { tipo: 'planes', id: 3, api: true }, 'API de un plan');
es(E.registroDeRuta('/api/firmas/8/tecnico'), { tipo: 'firmas', id: 8, api: true }, 'firma de una orden');
es([E.registroDeRuta('/planes/3'), E.registroDeRuta('/activos/nuevo'), E.registroDeRuta('/api/ordenes/bulk-delete'), E.registroDeRuta('/api/campo/equipo/4')], [null, null, null, null], 'no son registros');
es(['/ordenes?estado=abierta', '/indicadores', '/calibraciones', '/ordenes/4', '/areas/aires', '/otro-espacio', '//ajeno.example', 'https://ajeno.example/', '/api/ordenes', '', null, 7].map(E.destinoAlCambiar),
  ['/ordenes', '/indicadores', '/', '/', '/', '/', '/', '/', '/', '/', '/', '/'], 'el interruptor vuelve a la lista común o al panel');
es(E.hrefCambiarEspacio('/activos/4?area=biomedico#x', 'biomedico'), '/activos/4?area=biomedico&espacio=biomedico#x', 'botón «Cambiar a …»');
es(E.hrefCambiarEspacio('//ajeno.example/x', 'general'), '/?espacio=general', 'nunca a otro sitio');
es([E.areaEnEspacio('aires', 'general'), E.areaEnEspacio('biomedico', 'general'), E.areaEnEspacio('biomedico', 'biomedico'), E.areaEnEspacio(null, 'general')], [true, false, true, false], 'areaEnEspacio');
es(E.espacioDeTrabajo(null, { rubro: null, tipo: 'biomedico' }), 'biomedico', 'orden sin rubro de un equipo biomédico');
es([E.espacioDeTrabajo('aires', { tipo: 'biomedico' }), E.espacioDeTrabajo(null, null), E.espacioDeTrabajo('biomedico')], ['general', 'general', 'biomedico'], 'el rubro manda; sin nada, General');
{
  // espacioDelContexto: locals del middleware, o resolverEspacio sin él.
  const u = { rol: 'jefe', especialidad: 'ambos' };
  es(E.espacioDelContexto({ locals: { espacio: 'biomedico', user: u } }), 'biomedico', 'el del middleware');
  es(E.espacioDelContexto({ locals: { espacio: 'biomedico' } }, { rol: 'jefe', especialidad: 'general' }), 'general', 'nunca uno que el usuario no tiene');
  es(E.espacioDelContexto({ request: new Request('https://x.local/a?espacio=biomedico') }, u), 'biomedico', 'sin middleware: ?espacio=');
  es(E.espacioDelContexto({ cookies: { get: () => ({ value: 'biomedico' }) }, url: new URL('https://x.local/') }, u), 'biomedico', 'sin middleware: la cookie');
  es(E.espacioDelContexto({ cookies: { get: () => { throw new Error('x'); } } }, u), 'general', 'cookies que fallan: el primero');
  es(E.espacioDeLista({}, { rol: 'tecnico', especialidad: 'biomedico' }, 'aires'), { espacio: 'general', permitido: false }, 'un área del otro espacio no se permite');
  es(E.espacioDeLista({}, u, 'biomedico'), { espacio: 'biomedico', permitido: true }, 'con los dos, el área manda');
}
{
  // condicionTrabajoEspacio / condicionActivoIdEspacio / condicionLinkEspacio en SQLite, sin parámetros.
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE activos (id INTEGER PRIMARY KEY, rubro TEXT, tipo TEXT)');
  db.exec('CREATE TABLE ordenes (id INTEGER PRIMARY KEY, rubro TEXT, activo_id INTEGER)');
  db.exec('CREATE TABLE tickets (id INTEGER PRIMARY KEY, rubro TEXT, activo_id INTEGER)');
  db.exec('CREATE TABLE conjuntos (id INTEGER PRIMARY KEY, rubro TEXT)');
  db.exec('CREATE TABLE notificaciones (id INTEGER PRIMARY KEY, link TEXT)');
  db.exec("INSERT INTO activos VALUES (1,'biomedico','biomedico'),(2,'aires','general'),(3,NULL,'biomedico'),(4,NULL,NULL)");
  const filas = [[1, 'biomedico', 2], [2, 'aires', 1], [3, null, 1], [4, null, 3], [5, null, 2], [6, null, null], [7, 'otra', 1], [8, null, 99]];
  const ins = db.prepare('INSERT INTO ordenes VALUES (?,?,?)');
  filas.forEach((r) => ins.run(...r));
  db.exec('INSERT INTO tickets SELECT * FROM ordenes');
  db.exec("INSERT INTO conjuntos VALUES (1,'biomedico'),(2,'aires')");
  const dialecto = new E.SQLiteSyncDialect();
  const q = (cond, tabla = 'ordenes') => { const { sql, params } = dialecto.sqlToQuery(E.sql`select id from ${E.sql.raw(tabla)} where ${cond} order by id`); return { ids: db.prepare(sql).all(...params).map((r) => r.id), params }; };
  const bio = [1, 3, 4];
  for (const e of E.ESPACIO_KEYS) {
    const r = q(E.condicionOrdenEspacio(e));
    es(r.ids, e === 'biomedico' ? bio : [2, 5, 6, 7, 8], `órdenes de ${e}: rubro y, sin rubro, el equipo`);
    es(r.params.length, 0, `condicionOrdenEspacio(${e}) sin parámetros`);
    es(q(E.condicionTicketEspacio(e), 'tickets').ids, r.ids, `solicitudes de ${e}: la misma regla`);
    es(filas.filter(([id]) => r.ids.includes(id)).every(([, rubro, act]) => E.espacioDeTrabajo(rubro, act ? db.prepare('select rubro, tipo from activos where id=?').get(act) : null) === e), true, `espacioDeTrabajo coincide (${e})`);
    const p = q(E.condicionActivoIdEspacio(E.sql.raw('activo_id'), e));
    es(p.ids, e === 'biomedico' ? [2, 3, 4, 7] : [1, 5], `activo_id del espacio ${e} (sin equipo o inexistente: ninguno)`);
    es(p.params.length, 0, 'sin parámetros');
  }
  es([...q(E.condicionOrdenEspacio('general')).ids, ...q(E.condicionOrdenEspacio('biomedico')).ids].sort(), filas.map(([id]) => id).sort(), 'cada orden en un solo espacio');
  const links = ['/ordenes/1', '/ordenes/2?area=aires', '/ordenes/3', '/ordenes/4#x', '/ordenes/6', '/tickets/1', '/tickets/2', '/activos/1', '/activos/2/historial', '/activos/3', '/conjuntos/1', '/conjuntos/2',
    '/ronda', '/ronda/semana', '/aop?x=1', '/calibraciones', '/alertas/3', '/licencias#a', '/proyectos/1', '/preventivos', '/ordenes/999', null, '/rondax', '/calibracionesx'];
  const insL = db.prepare('INSERT INTO notificaciones (link) VALUES (?)');
  links.forEach((l) => insL.run(l));
  const ver = (e) => { const { sql, params } = dialecto.sqlToQuery(E.sql`select link from notificaciones where ${E.condicionLinkEspacio(E.notificaciones.link, e)} order by id`); es(params.length, 0, 'campana sin parámetros'); return db.prepare(sql).all(...params).map((r) => r.link); };
  const comunes = ['/proyectos/1', '/preventivos', '/ordenes/999', null, '/rondax', '/calibracionesx'];
  es(ver('biomedico'), ['/ordenes/1', '/ordenes/3', '/ordenes/4#x', '/tickets/1', '/activos/1', '/activos/3', '/conjuntos/1', '/calibraciones', '/alertas/3', '/licencias#a', ...comunes], 'campana de Biomédico');
  es(ver('general'), ['/ordenes/2?area=aires', '/ordenes/6', '/tickets/2', '/activos/2/historial', '/conjuntos/2', '/ronda', '/ronda/semana', '/aop?x=1', ...comunes], 'campana de General');
  es(E.respuestaOtroEspacio('general').status, 403, '403');
  es(await E.respuestaOtroEspacio('biomedico').json(), { error: 'Este registro es del espacio Biomédico.' }, '403 JSON { error }');
}

// ── Middleware: locals.espacio y locals.espaciosPermitidos ──────────────────
const M = await cargar(`export { onRequest } from './src/middleware';`, [{
  name: 'middleware-aislado', setup(b) {
    b.onResolve({ filter: /^astro:middleware$/ }, () => ({ path: 'astro-middleware', namespace: 'stub' }));
    b.onResolve({ filter: /^\.\/lib\/(auth|db)$|^\.\/lib\/sgo\/handler\.mjs$/ }, (a) => ({ path: a.path.split('/').at(-1), namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path: p }) => ({ loader: 'js', contents: {
      'astro-middleware': 'export const defineMiddleware = (f) => f;',
      auth: 'export async function getCurrentUser(ctx) { return ctx.testUser ?? null; }',
      db: 'export const getDb = () => { throw new Error("sin base en esta prueba"); };',
      'handler.mjs': 'export const handleSgoRequest = () => new Response("sgo"); export const handleSnapshotPublish = () => new Response("snap");',
    }[p] }));
  },
}]);
const pedir = async (ruta, { user = null, cookie = null } = {}) => {
  const puestas = [];
  const ctx = {
    request: new Request(`https://mantenimiento.local${ruta}`), testUser: user, locals: {},
    cookies: { get: (k) => (k === 'espacio' && cookie !== null ? { value: cookie } : undefined), set: (k, v, o) => puestas.push([k, v, o]) },
    redirect: (to) => new Response(null, { status: 302, headers: { location: to } }),
  };
  let siguio = false;
  const res = await M.onRequest(ctx, async () => { siguio = true; return new Response('ok'); });
  return { ctx, res, siguio, puestas };
};
{
  let r = await pedir('/planes', { user: { id: 1, rol: 'jefe', especialidad: 'ambos', nombre: 'J', email: 'j@x' } });
  es([r.siguio, r.ctx.locals.espacio, r.ctx.locals.espaciosPermitidos, r.puestas], [true, 'general', ['general', 'biomedico'], []], 'ambos sin cookie: General, con interruptor, sin tocar la cookie');
  r = await pedir('/planes', { user: { id: 1, rol: 'jefe', especialidad: 'ambos' }, cookie: 'biomedico' });
  es([r.ctx.locals.espacio, r.puestas], ['biomedico', []], 'recuerda Biomédico por la cookie');
  r = await pedir('/planes?espacio=biomedico', { user: { id: 1, rol: 'admin', especialidad: null }, cookie: 'general' });
  es([r.ctx.locals.espacio, r.puestas.map(([k, v]) => [k, v]), r.puestas[0]?.[2]?.secure], ['biomedico', [['espacio', 'biomedico']], true], '?espacio= cambia y se recuerda');
  r = await pedir('/planes?espacio=biomedico', { user: { id: 1, rol: 'admin' }, cookie: 'biomedico' });
  es(r.puestas, [], 'mismo espacio que la cookie: no la reescribe');
  r = await pedir('/planes?espacio=general', { user: { id: 2, rol: 'tecnico', especialidad: 'biomedico' }, cookie: 'general' });
  es([r.ctx.locals.espacio, r.ctx.locals.espaciosPermitidos, r.puestas.map(([k, v]) => [k, v])], ['biomedico', ['biomedico'], [['espacio', 'biomedico']]], 'biomédico que pide General: se queda en Biomédico y se corrige la cookie');
  r = await pedir('/planes', { user: { id: 3, rol: 'jefe', especialidad: 'general' }, cookie: 'biomedico' });
  es([r.ctx.locals.espacio, r.ctx.locals.espaciosPermitidos], ['general', ['general']], 'general con cookie vieja de Biomédico: General');
  r = await pedir('/api/planes');
  es([r.res.status, r.ctx.locals.espacio, r.ctx.locals.espaciosPermitidos], [401, undefined, undefined], 'sin sesión: 401 y sin espacio');
  r = await pedir('/login?espacio=biomedico');
  es([r.siguio, r.ctx.locals.espacio, r.puestas], [true, undefined, []], 'página pública sin sesión: sin espacio ni cookie');
  r = await pedir('/login', { user: { id: 1, rol: 'visualizador', especialidad: 'biomedico' } });
  es([r.ctx.locals.espacio, r.ctx.locals.espaciosPermitidos], ['general', ['general', 'biomedico']], 'con sesión también en páginas públicas');
  {
    // Un ctx sin cookies (como el de test-campo): resuelve igual, sin recordar nada.
    const ctx = { request: new Request('https://mantenimiento.local/planes?espacio=biomedico'), testUser: { id: 1, rol: 'jefe', especialidad: 'ambos' }, locals: {}, redirect: () => null };
    await M.onRequest(ctx, async () => new Response('ok'));
    es(ctx.locals.espacio, 'biomedico', 'sin objeto cookies: no se cae');
  }
  r = await pedir('/', { user: { id: 4, rol: 'tecnico', especialidad: 'biomedico' } });
  es([r.res.status, r.res.headers.get('location'), r.ctx.locals.espacio], [302, '/campo', 'biomedico'], 'el técnico sigue yendo a /campo; el espacio ya está puesto');
}

console.log(`PASS test-espacio: ${n} casos; contrato de los espacios General y Biomédico, filtros SQL sin parámetros y locals del middleware.`);
