// Aislamiento de los espacios «General» y «Biomédico» en el servidor, contra las
// migraciones reales y la sesión real (cookie firmada): un usuario de un espacio no
// recibe filas del otro en ninguna lista, API, búsqueda, exportación, calendario ni
// notificación; el interruptor no deja forzar un espacio no permitido; el middleware
// muestra el aviso o responde 403; y con 150 equipos por espacio ninguna consulta pasa
// de 100 parámetros ni de 100 columnas (límites de D1). Sin red ni base remota.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
const es = (a, b, m) => { n++; assert.deepEqual(a, b, m); };
const si = (v, m) => { n++; assert.ok(v, m); };

const f = await setupConjuntos({ modules: {
  tickets: 'pages/api/tickets/index', planes: 'pages/api/planes/index', planesCsv: 'pages/api/planes/exportar',
  buscar: 'pages/api/search', notif: 'pages/api/notificaciones/index', reportes: 'pages/api/reportes/[tipo]',
  tablero: 'pages/api/dashboard', calendario: 'pages/api/calendar/[token]', encuestas: 'pages/api/encuestas/export',
  espacio: 'pages/api/espacio', E: 'lib/espacio', planesLote: 'pages/api/planes/bulk',
} });
const { app, sqlite, ctx, close, faults } = f;
const one = (q, ...a) => sqlite.prepare(q).get(...a);
const run = (q, ...a) => sqlite.prepare(q).run(...a);

// Usuarios del fixture: admin=1, jefe=2, tecnico=3, visualizador=4, solicitante=5.
const JEFE = 2;
const como = (especialidad) => run('UPDATE usuarios SET especialidad=? WHERE id=?', especialidad, JEFE);

// Respuesta JSON o texto de una ruta, con la cookie de sesión del rol.
async function pedir(route, url, { rol = 'jefe', method = 'GET', data, params } = {}) {
  const c = ctx(url, { rol, method, data });
  if (params) c.params = params;
  const res = await route(c);
  const texto = await res.text();
  let body; try { body = JSON.parse(texto); } catch { body = texto; }
  return { status: res.status, body, texto, headers: res.headers };
}

try {
  // ── Datos de las cuatro áreas (y los casos viejos sin rubro) ──────────────
  sqlite.exec(`
    INSERT INTO sucursales(id,nombre,activa) VALUES(1,'Sede prueba',1);
    INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo,activa) VALUES(1,1,'Sala','area',1);
    INSERT INTO activos(id,codigo,nombre,rubro,tipo,ubicacion_id) VALUES
      (101,'ESP-AIRES','Espaciotest aire','aires','general',1),
      (102,'ESP-INFRA','Espaciotest techo','infraestructura','general',1),
      (103,'ESP-EQG','Espaciotest bomba','equipo_general','general',1),
      (104,'ESP-BIO','Espaciotest monitor','biomedico','biomedico',1),
      (105,'ESP-LEGBIO','Espaciotest desfibrilador viejo',NULL,'biomedico',1);
    INSERT INTO ordenes(id,creado_por,titulo,rubro,tipo,estado,activo_id,asignado_a) VALUES
      (201,1,'Espaciotest OT aire','aires','correctivo','abierta',101,${JEFE}),
      (202,1,'Espaciotest OT techo','infraestructura','correctivo','abierta',102,${JEFE}),
      (203,1,'Espaciotest OT bomba','equipo_general','correctivo','abierta',103,${JEFE}),
      (204,1,'Espaciotest OT monitor','biomedico','correctivo','abierta',104,${JEFE}),
      (205,1,'Espaciotest OT vieja sin rubro de un biomédico',NULL,'correctivo','abierta',105,${JEFE}),
      (206,1,'Espaciotest OT vieja sin rubro ni equipo',NULL,'correctivo','abierta',NULL,${JEFE});
    INSERT INTO tickets(id,tracking_token,solicitante_nombre,solicitante_email,asunto,descripcion,rubro,activo_id,asignado_a) VALUES
      (301,'tk-aires','Persona','p@example.invalid','Espaciotest falla aire','x','aires',101,${JEFE}),
      (302,'tk-infra','Persona','p@example.invalid','Espaciotest falla techo','x','infraestructura',102,${JEFE}),
      (303,'tk-eqg','Persona','p@example.invalid','Espaciotest falla bomba','x','equipo_general',103,${JEFE}),
      (304,'tk-bio','Persona','p@example.invalid','Espaciotest falla monitor','x','biomedico',104,${JEFE});
    INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha,asignado_a) VALUES
      (401,101,'Espaciotest plan aire','mensual','2026-12-01',${JEFE}),
      (402,102,'Espaciotest plan techo','anual','2026-12-02',${JEFE}),
      (403,103,'Espaciotest plan bomba','semestral','2026-12-03',${JEFE}),
      (404,104,'Espaciotest plan monitor','semestral','2026-12-04',${JEFE}),
      (405,105,'Espaciotest plan desfibrilador','anual','2026-12-05',${JEFE});
    INSERT INTO comentarios(id,orden_id,usuario_id,texto) VALUES(501,201,1,'Espaciotest comentario aire'),(502,204,1,'Espaciotest comentario monitor');
    INSERT INTO encuestas_satisfaccion(id,orden_id,token,destinatario_email,calificacion,respondida_en) VALUES
      (601,201,'enc-aire','p@example.invalid',5,'2026-11-01T12:00:00Z'),(602,204,'enc-bio','p@example.invalid',4,'2026-11-01T12:00:00Z');
    INSERT INTO notificaciones(usuario_id,tipo,titulo,link) VALUES
      (${JEFE},'ot','OT aire','/ordenes/201'),(${JEFE},'ot','OT monitor','/ordenes/204'),
      (${JEFE},'ot','OT vieja biomédica','/ordenes/205?area=biomedico'),(${JEFE},'ot','OT vieja sin equipo','/ordenes/206'),
      (${JEFE},'tk','Solicitud aire','/tickets/301'),(${JEFE},'tk','Solicitud monitor','/tickets/304#x'),
      (${JEFE},'eq','Equipo viejo','/activos/105'),(${JEFE},'eq','Equipo bomba','/activos/103?area=equipo_general'),
      (${JEFE},'cal','Calibración vencida','/calibraciones?area=biomedico'),(${JEFE},'ronda','Ronda pendiente','/ronda'),
      (${JEFE},'proy','Proyecto','/proyectos/1'),(${JEFE},'sin','Aviso general sin enlace',NULL);
    UPDATE usuarios SET calendar_token='tok-jefe' WHERE id=${JEFE};
  `);
  const GENERAL = { ordenes: [201, 202, 203, 206], tickets: [301, 302, 303], activos: [101, 102, 103], planes: [401, 402, 403] };
  const BIO = { ordenes: [204, 205], tickets: [304], activos: [104, 105], planes: [404, 405] };
  const ESPERADO = { general: GENERAL, biomedico: BIO };
  const ids = (filas) => filas.map((r) => r.id).sort((a, b) => a - b);
  const NOTIF = {
    general: ['/ordenes/201', '/ordenes/206', '/tickets/301', '/activos/103?area=equipo_general', '/ronda', '/proyectos/1', null],
    biomedico: ['/ordenes/204', '/ordenes/205?area=biomedico', '/tickets/304#x', '/activos/105', '/calibraciones?area=biomedico', '/proyectos/1', null],
  };
  const orden = (xs) => [...xs].sort((a, b) => String(a).localeCompare(String(b)));

  // Lo que un usuario ve en todas las listas de su espacio. extra = parámetros de la URL.
  async function todoLoQueVe(extra = '') {
    const q = extra ? `?${extra}` : '';
    const y = extra ? `&${extra}` : '';
    const o = await pedir(app.orders.GET, `/api/ordenes${q}`);
    const t = await pedir(app.tickets.GET, `/api/tickets${q}`);
    const a = await pedir(app.assetCreate.GET, `/api/activos${q}`);
    const p = await pedir(app.planes.GET, `/api/planes${q}`);
    const b = await pedir(app.buscar.GET, `/api/search?q=Espaciotest${y}`);
    const nt = await pedir(app.notif.GET, `/api/notificaciones${q}`);
    const csvOrdenes = await pedir(app.reportes.GET, `/api/reportes/ordenes${q}`, { params: { tipo: 'ordenes' } });
    const csvEquipos = await pedir(app.reportes.GET, `/api/reportes/equipos${q}`, { params: { tipo: 'equipos' } });
    const csvEncuestas = await pedir(app.reportes.GET, `/api/reportes/encuestas${q}`, { params: { tipo: 'encuestas' } });
    const csvPlan = await pedir(app.planesCsv.GET, `/api/planes/exportar${q}`);
    const enc = await pedir(app.encuestas.GET, `/api/encuestas/export${q}`);
    const dash = await pedir(app.tablero.GET, `/api/dashboard${q}`);
    for (const r of [o, t, a, p, b, nt, csvOrdenes, csvEquipos, csvEncuestas, csvPlan, enc, dash]) assert.equal(r.status, 200, r.texto.slice(0, 300));
    return { o, t, a, p, b, nt, csvOrdenes, csvEquipos, csvEncuestas, csvPlan, enc, dash };
  }
  const codigosEn = (texto, codigos) => codigos.filter((c) => texto.includes(c));

  for (const [especialidad, espacio] of [['biomedico', 'biomedico'], ['general', 'general'], ['ambos', 'general'], [null, 'general']]) {
    como(especialidad);
    const v = await todoLoQueVe();
    const E = ESPERADO[espacio], otro = ESPERADO[espacio === 'general' ? 'biomedico' : 'general'];
    const quien = `jefe ${especialidad ?? 'sin especialidad'} (${espacio})`;
    es(ids(v.o.body.ordenes), E.ordenes, `${quien}: órdenes`);
    es(ids(v.t.body.tickets), E.tickets, `${quien}: solicitudes`);
    es(ids(v.a.body.activos), E.activos, `${quien}: equipos`);
    es(ids(v.p.body.planes), E.planes, `${quien}: preventivos`);
    const R = v.b.body.resultados;
    es(ids(R.ordenes), E.ordenes, `${quien}: búsqueda de órdenes`);
    es(ids(R.equipos), E.activos, `${quien}: búsqueda de equipos`);
    es(ids(R.tickets), E.tickets, `${quien}: búsqueda de solicitudes`);
    es(R.comentarios.map((c) => c.ordenId), espacio === 'general' ? [201] : [204], `${quien}: búsqueda de comentarios`);
    es(orden(v.nt.body.notificaciones.map((x) => x.link)), orden(NOTIF[espacio]), `${quien}: campana`);
    es(v.nt.body.noLeidas, NOTIF[espacio].length, `${quien}: el número de la campana cuenta solo las suyas`);
    const codOrd = (id) => one('SELECT codigo FROM ordenes WHERE id=?', id).codigo;
    es(codigosEn(v.csvOrdenes.texto, [...E.ordenes, ...otro.ordenes].map(codOrd)).sort(), E.ordenes.map(codOrd).sort(), `${quien}: CSV de órdenes`);
    const codAct = (id) => one('SELECT codigo FROM activos WHERE id=?', id).codigo;
    es(codigosEn(v.csvEquipos.texto, ['ESP-AIRES', 'ESP-INFRA', 'ESP-EQG', 'ESP-BIO', 'ESP-LEGBIO']).sort(), E.activos.map(codAct).sort(), `${quien}: CSV de equipos`);
    es(codigosEn(v.csvPlan.texto, ['ESP-AIRES', 'ESP-INFRA', 'ESP-EQG', 'ESP-BIO', 'ESP-LEGBIO']).sort(), E.activos.map(codAct).sort(), `${quien}: CSV del plan anual`);
    es(codigosEn(v.csvEncuestas.texto, [codOrd(201), codOrd(204)]), [espacio === 'general' ? codOrd(201) : codOrd(204)], `${quien}: CSV de encuestas`);
    es(codigosEn(v.enc.texto, [codOrd(201), codOrd(204)]), [espacio === 'general' ? codOrd(201) : codOrd(204)], `${quien}: exportación de satisfacción`);
    es(v.dash.body.espacio, espacio, `${quien}: el tablero dice su espacio`);
    es(v.dash.body.ordenesPorEstado.reduce((s, r) => s + Number(r.n), 0), E.ordenes.length, `${quien}: cifras del tablero`);
  }

  // ── Quien está atado a un espacio no puede pedir el otro, ni por ?espacio= ni por ?area= ──
  como('biomedico');
  {
    const v = await todoLoQueVe('espacio=general');
    es(ids(v.o.body.ordenes), BIO.ordenes, '?espacio=general no saca al biomédico de su espacio');
    es(ids(v.a.body.activos), BIO.activos, 'ni en equipos');
    for (const [route, url, params] of [
      [app.orders.GET, '/api/ordenes?area=aires'], [app.tickets.GET, '/api/tickets?area=infraestructura'],
      [app.assetCreate.GET, '/api/activos?area=equipo_general'], [app.planes.GET, '/api/planes?area=aires'],
      [app.buscar.GET, '/api/search?q=Espaciotest&area=aires'], [app.planesCsv.GET, '/api/planes/exportar?area=aires'],
      [app.reportes.GET, '/api/reportes/equipos?area=aires', { tipo: 'equipos' }], [app.reportes.GET, '/api/reportes/ordenes?area=aires', { tipo: 'ordenes' }],
    ]) {
      const r = await pedir(route, url, { params });
      es([r.status, r.body.error], [403, 'Este registro es del espacio General.'], `403 JSON: ${url}`);
    }
    // Ni crear en el otro espacio.
    const ot = await pedir(app.orders.POST, '/api/ordenes', { method: 'POST', data: { titulo: 'Intento cruzado', tipo: 'correctivo', rubro: 'aires', sucursalId: 1, ubicacionId: 1 } });
    es(ot.status, 403, 'el biomédico no abre una OT de aires');
    const eq = await pedir(app.assetCreate.POST, '/api/activos', { method: 'POST', data: { codigo: 'CRUCE-1', nombre: 'Intento', rubro: 'aires' } });
    es(eq.status, 403, 'ni registra un aire');
    es(one("SELECT count(*) n FROM activos WHERE codigo='CRUCE-1'").n, 0, 'nada se guardó');
    // Ni tocar en lote preventivos del otro espacio.
    const lote = await pedir(app.planesLote.POST, '/api/planes/bulk', { method: 'POST', data: { accion: 'desactivar', ids: [404, 401], motivo: 'Prueba de un lote cruzado de espacios' } });
    es(lote.status, 400, 'el lote con un plan de General se rechaza');
    es(one('SELECT activo FROM planes_mantenimiento WHERE id=401').activo, 1, 'el plan de aire sigue activo');
    es((await pedir(app.planesLote.POST, '/api/planes/bulk?area=aires', { method: 'POST', data: { accion: 'activar', ids: [401] } })).status, 403, 'ni pidiéndolo por área');
    // Ni pasar uno suyo al otro espacio.
    const mover = await pedir(app.assets.PATCH, '/api/activos/104', { method: 'PATCH', data: { rubro: 'equipo_general' }, params: { id: '104' } });
    es(mover.status, 403, 'ni pasa su monitor a General');
    es(one('SELECT rubro FROM activos WHERE id=104').rubro, 'biomedico', 'el monitor sigue en Biomédico');
  }
  como('general');
  {
    const r = await pedir(app.orders.GET, '/api/ordenes?area=biomedico');
    es([r.status, r.body.error], [403, 'Este registro es del espacio Biomédico.'], 'el de General tampoco pide Biomédico');
  }
  // Con los dos espacios, ?area= del otro sí responde (lo permitido), y ?espacio= cambia la lista.
  como('ambos');
  {
    es(ids((await pedir(app.orders.GET, '/api/ordenes?area=biomedico')).body.ordenes), [204], 'ambos: el área biomédica');
    const v = await todoLoQueVe('espacio=biomedico');
    es([ids(v.o.body.ordenes), ids(v.a.body.activos), ids(v.p.body.planes)], [BIO.ordenes, BIO.activos, BIO.planes], 'ambos en Biomédico: solo lo biomédico');
    es(orden(v.nt.body.notificaciones.map((x) => x.link)), orden(NOTIF.biomedico), 'ambos en Biomédico: su campana');
  }

  // «Marcar todas» marca solo las del espacio en el que estás.
  como('biomedico');
  es((await pedir(app.notif.POST, '/api/notificaciones', { method: 'POST', data: { action: 'marcar_todas_leidas' } })).status, 200, 'marcar todas');
  es(one('SELECT count(*) n FROM notificaciones WHERE usuario_id=? AND leida=1', JEFE).n, NOTIF.biomedico.length, 'solo se marcaron las de Biomédico');
  como('general');
  es((await pedir(app.notif.GET, '/api/notificaciones')).body.noLeidas, NOTIF.general.length - 2, 'las de General siguen sin leer, salvo las comunes');

  // ── Calendario .ics ───────────────────────────────────────────────────────
  const ics = async (q = '') => pedir(app.calendario.GET, `/api/calendar/tok-jefe.ics${q}`, { rol: null, params: { token: 'tok-jefe.ics' } });
  const titulosIcs = (texto) => ['plan aire', 'plan techo', 'plan bomba', 'plan monitor', 'plan desfibrilador', 'OT aire', 'OT monitor'].filter((t) => texto.includes(`Espaciotest ${t}`));
  como('biomedico');
  es(titulosIcs((await ics()).texto), ['plan monitor', 'plan desfibrilador', 'OT monitor'], 'calendario de un biomédico: solo lo biomédico');
  es((await ics('?espacio=general')).status, 403, 'el biomédico no pide el calendario de General');
  como('ambos');
  es(titulosIcs((await ics('?espacio=general')).texto), ['plan aire', 'plan techo', 'plan bomba', 'OT aire'], 'ambos: calendario de General');
  es(titulosIcs((await ics('?espacio=biomedico')).texto), ['plan monitor', 'plan desfibrilador', 'OT monitor'], 'ambos: calendario de Biomédico');
  es(titulosIcs((await ics()).texto).length, 7, 'ambos sin espacio: la suscripción de antes sigue con todo');

  // ── Interruptor: POST /api/espacio ────────────────────────────────────────
  async function cambiar(rol, cuerpo, { json = false } = {}) {
    const puestas = [];
    const c = ctx('/api/espacio', { rol, method: 'POST' });
    const body = json ? JSON.stringify(cuerpo) : new URLSearchParams(cuerpo).toString();
    c.request = new Request('https://test.invalid/api/espacio', { method: 'POST', headers: { cookie: c.request.headers.get('cookie') ?? '', 'content-type': json ? 'application/json' : 'application/x-www-form-urlencoded' }, body });
    c.cookies = { set: (k, v, o) => puestas.push([k, v, o]), get: () => undefined };
    c.redirect = (to, status) => new Response(null, { status, headers: { location: to } });
    const res = await app.espacio.POST(c);
    return { status: res.status, location: res.headers.get('location'), body: await res.json().catch(() => null), puestas };
  }
  como('ambos');
  {
    let r = await cambiar('jefe', { espacio: 'biomedico', volver: '/ordenes?estado=abierta' });
    es([r.status, r.location, r.puestas.map(([k, v]) => [k, v]), r.puestas[0][2].httpOnly], [303, '/ordenes', [['espacio', 'biomedico']], true], 'ambos cambia a Biomédico y vuelve a la lista');
    r = await cambiar('jefe', { espacio: 'general', volver: '/calibraciones' });
    es([r.status, r.location], [303, '/'], 'desde una pantalla de Biomédico, al panel de General');
    r = await cambiar('jefe', { espacio: 'general', volver: '/ordenes/204' });
    es(r.location, '/', 'desde un registro, al panel');
    r = await cambiar('jefe', { espacio: 'general', volver: '//sitio-ajeno.example/x' });
    es(r.location, '/', 'nunca a otro sitio');
    r = await cambiar('jefe', { espacio: 'biomedico', volver: '/indicadores' }, { json: true });
    es([r.status, r.body], [200, { ok: true, espacio: 'biomedico', destino: '/indicadores' }], 'también con JSON');
    r = await cambiar('jefe', { espacio: 'otro' });
    es([r.status, r.puestas], [400, []], 'un espacio que no existe: 400 y sin cookie');
  }
  como('biomedico');
  {
    const r = await cambiar('jefe', { espacio: 'general', volver: '/' });
    es([r.status, r.puestas, typeof r.body.error], [403, [], 'string'], 'el biomédico no puede forzar General: 403 y la cookie no se toca');
  }
  como('general');
  es((await cambiar('jefe', { espacio: 'biomedico' })).status, 403, 'ni el de General a Biomédico');
  for (const rol of ['admin', 'visualizador']) es((await cambiar(rol, { espacio: 'biomedico' })).status, 303, `${rol} cambia de espacio`);
  es((await cambiar(null, { espacio: 'general' })).status, 401, 'sin sesión: 401');

  // ── Middleware: aviso en páginas, 403 en la API ───────────────────────────
  const salida = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'mantenimiento-espacios-mw-')), 'mw.mjs');
  await build({ entryPoints: [path.join(raiz, 'src/middleware.ts')], outfile: salida, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'astro-virtual', setup(b) {
      b.onResolve({ filter: /^astro:middleware$/ }, () => ({ path: 'astro:middleware', namespace: 'virtual' }));
      b.onLoad({ filter: /.*/, namespace: 'virtual' }, () => ({ contents: 'export const defineMiddleware = (fn) => fn;', loader: 'js' }));
    } }] });
  const { onRequest } = await import(pathToFileURL(salida).href);
  await fs.rm(path.dirname(salida), { recursive: true, force: true });
  async function abrir(url, { rol = 'jefe', cookie = null, method = 'GET' } = {}) {
    const c = ctx(url, { rol, method });
    c.cookies = { get: (k) => (k === 'espacio' && cookie ? { value: cookie } : undefined), set: () => {} };
    c.redirect = (to) => new Response(null, { status: 302, headers: { location: to } });
    let reescrita = 'sin-llamar';
    const res = await onRequest(c, async (destino) => { reescrita = destino ?? null; return new Response('pagina'); });
    return { status: res.status, location: res.headers.get('location'), reescrita, aviso: c.locals.avisoEspacio ?? null, body: res.status === 403 ? await res.json() : null };
  }
  como('biomedico');
  {
    let r = await abrir('/ordenes/201');
    es([r.reescrita, r.aviso], ['/otro-espacio', { espacio: 'general', puedeCambiar: false, volver: '/ordenes/201' }], 'el biomédico abre una OT de aire: aviso, sin poder cambiar');
    r = await abrir('/activos/103/historial');
    es(r.aviso?.espacio, 'general', 'también en las subpáginas del equipo');
    r = await abrir('/ordenes/205');
    es([r.reescrita, r.aviso], [null, null], 'la OT vieja sin rubro de un biomédico es suya');
    r = await abrir('/ordenes/206');
    es(r.aviso?.espacio, 'general', 'la vieja sin rubro ni equipo es de General');
    for (const p of ['/ronda', '/aop', '/eop', '/electrico', '/actividades', '/catalogo-aires', '/areas/aires', '/ordenes?area=aires', '/activos/nuevo?area=infraestructura']) {
      r = await abrir(p);
      es([r.reescrita, r.aviso?.espacio, r.aviso?.puedeCambiar], ['/otro-espacio', 'general', false], `biomédico en ${p}: aviso`);
    }
    for (const p of ['/api/ordenes/201', '/api/ordenes/201/comentarios', '/api/activos/101', '/api/tickets/301', '/api/planes/401', '/api/firmas/201/tecnico', '/api/aop/eventos', '/api/ronda-turno/puntos', '/api/catalogo-aires']) {
      r = await abrir(p);
      es([r.status, r.body?.error], [403, 'Este registro es del espacio General.'], `biomédico en ${p}: 403 JSON`);
    }
    r = await abrir('/api/planes/404', { method: 'PATCH' });
    es(r.reescrita, null, 'su propio plan pasa');
    for (const p of ['/calibraciones', '/ordenes/204', '/activos/105', '/inventario', '/usuarios', '/proveedores', '/requisiciones', '/ubicaciones', '/administracion']) {
      r = await abrir(p);
      es([r.reescrita, r.aviso], [null, null], `biomédico en ${p}: entra`);
    }
  }
  como('general');
  {
    for (const p of ['/calibraciones', '/seguridad-electrica', '/expedientes', '/licencias', '/capacitaciones', '/alertas', '/incidentes', '/cumplimiento', '/configuracion/plantillas', '/centros-costo', '/areas/biomedico', '/activos/104', '/tickets/304']) {
      const r = await abrir(p);
      es([r.reescrita, r.aviso?.espacio, r.aviso?.puedeCambiar], ['/otro-espacio', 'biomedico', false], `general en ${p}: aviso`);
    }
    for (const p of ['/api/calibraciones/equipo/104', '/api/licencias', '/api/alertas', '/api/activos/104/expediente', '/api/ordenes/204']) {
      const r = await abrir(p);
      es(r.status, 403, `general en ${p}: 403`);
    }
  }
  como('ambos');
  {
    let r = await abrir('/activos/104');
    es([r.reescrita, r.aviso], ['/otro-espacio', { espacio: 'biomedico', puedeCambiar: true, volver: '/activos/104' }], 'ambos en General abre un biomédico: aviso con botón');
    r = await abrir('/activos/104', { cookie: 'biomedico' });
    es([r.reescrita, r.aviso], [null, null], 'ambos en Biomédico: la ficha');
    r = await abrir('/activos/104?espacio=biomedico');
    es([r.reescrita, r.aviso], [null, null], 'el botón «Cambiar a Biomédico» abre la ficha');
    r = await abrir('/ronda', { cookie: 'biomedico' });
    es([r.reescrita, r.aviso?.espacio, r.aviso?.puedeCambiar], ['/otro-espacio', 'general', true], 'ambos en Biomédico abre la ronda: aviso con botón');
    r = await abrir('/api/ordenes/204');
    es([r.status, r.reescrita], [200, null], 'ambos: la API del otro espacio responde (la pantalla decide)');
  }
  // El técnico sigue yendo a /campo, antes que cualquier aviso.
  run("UPDATE usuarios SET especialidad='biomedico' WHERE id=3");
  run('UPDATE ordenes SET asignado_a=3 WHERE id=201');
  es((await abrir('/', { rol: 'tecnico' })).location, '/campo', 'el técnico entra a /campo');
  es((await abrir('/ordenes/204', { rol: 'tecnico' })).location, null, 'la OT biomédica no asignada a él (asignada a otro): ficha');
  es((await abrir('/ordenes/201', { rol: 'tecnico' })).location, '/campo#orden-201', 'su OT abierta lo lleva al celular, como antes (/campo no cambia)');

  // ── 150 equipos por espacio: ninguna consulta pasa de 100 parámetros ni columnas ──
  const filas = [];
  for (let i = 0; i < 150; i++) {
    for (const [base, rubro, tipo] of [[1000, 'aires', 'general'], [2000, 'biomedico', 'biomedico']]) {
      const id = base + i;
      filas.push(`(${id},'MASA-${id}','Masivo ${rubro} ${i}','${rubro}','${tipo}',1)`);
    }
  }
  sqlite.exec(`INSERT INTO activos(id,codigo,nombre,rubro,tipo,ubicacion_id) VALUES ${filas.join(',')};`);
  sqlite.exec(`INSERT INTO ordenes(creado_por,titulo,rubro,tipo,estado,activo_id,asignado_a) SELECT 1,'Masivo '||codigo,rubro,'preventivo','abierta',id,${JEFE} FROM activos WHERE codigo LIKE 'MASA-%';`);
  sqlite.exec(`INSERT INTO planes_mantenimiento(activo_id,titulo,frecuencia,proxima_fecha,asignado_a) SELECT id,'Masivo '||codigo,'mensual','2026-12-10',${JEFE} FROM activos WHERE codigo LIKE 'MASA-%';`);
  sqlite.exec(`INSERT INTO tickets(tracking_token,solicitante_nombre,solicitante_email,asunto,descripcion,rubro,activo_id) SELECT 'tk-'||id,'P','p@example.invalid','Masivo '||codigo,'x',rubro,id FROM activos WHERE codigo LIKE 'MASA-%';`);
  sqlite.exec(`INSERT INTO notificaciones(usuario_id,tipo,titulo,link) SELECT ${JEFE},'ot','Masivo','/ordenes/'||id FROM ordenes WHERE titulo LIKE 'Masivo %';`);
  faults.enforceParameterLimit = true;
  faults.enforceColumnLimit = true;
  try {
    for (const [especialidad, espacio] of [['biomedico', 'biomedico'], ['general', 'general']]) {
      como(especialidad);
      const v = await todoLoQueVe();
      const E = ESPERADO[espacio];
      es(v.a.body.activos.length, E.activos.length + 150, `150 equipos de ${espacio} (más los de prueba)`);
      es(v.o.body.ordenes.length, E.ordenes.length + 150, `150 órdenes de ${espacio}`);
      es(v.p.body.planes.length, E.planes.length + 150, `150 preventivos de ${espacio}`);
      es(v.t.body.tickets.length, E.tickets.length + 150, `150 solicitudes de ${espacio}`);
      si(v.a.body.activos.every((x) => app.E.espacioDeActivo(x) === espacio), `${espacio}: ningún equipo del otro espacio entre 150`);
      si(v.o.body.ordenes.every((x) => !x.titulo.startsWith('Masivo') || x.rubro === (espacio === 'biomedico' ? 'biomedico' : 'aires')), `${espacio}: ninguna orden del otro`);
      si(v.nt.body.notificaciones.length === 50, `${espacio}: la campana trae sus 50 más recientes`);
    }
  } finally { faults.enforceParameterLimit = false; faults.enforceColumnLimit = false; }
  console.log(`PASS test-espacios-aislamiento: ${n} verificaciones; las cuatro áreas y los casos viejos, listas, búsqueda, CSV, calendario, campana, interruptor, aviso y 403 del middleware, 150 equipos por espacio sin pasar de 100 parámetros. Migraciones reales, sin red.`);
} finally { await close(); }
