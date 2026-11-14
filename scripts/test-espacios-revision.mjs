// Revisión de los espacios «General» y «Biomédico» (14/11/2026): cada caso que los
// dos revisores encontraron abierto, ahora cerrado. Contra las migraciones reales, la
// sesión real y el middleware real. Sin red ni base remota.
//  1. El middleware decide con la ruta decodificada (%xx): 403 y aviso igual que sin codificar.
//  2. Adjuntos, documentos y la ficha de /campo por id: 403 a quien está atado al otro espacio.
//  3. Proyectos: por el espacio de su equipo o su solicitud (lista, ficha, desde-ticket, alta, adjunto).
//  4. Lote de familia (bulk-sistema): todo o nada.
//  5. Asignar a quien no ve el espacio: ni en el tablero, ni en la ficha del plan, ni en la OT.
//  6. /campo: buscar, contar, abrir y crear solo del espacio; la ronda solo para General.
//  7. Jerarquía y respaldo del mismo espacio; alertas solo con equipos biomédicos.
//  8. El contrato (común) muestra los equipos del espacio; el panel SCP cuenta solo General.
//  9. El solicitante ve sus solicitudes de los dos espacios, sin interruptor ni aviso.
// 10. destinoAlCambiar no deja salir del sitio con «/\».
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
let n = 0;
const es = (a, b, m) => { n++; assert.deepEqual(a, b, m); };
const si = (v, m) => { n++; assert.ok(v, m); };

// La siembra de los documentos (0049) necesita un administrador, como en producción.
const beforeMigration = (db, nombre) => {
  if (nombre.startsWith('0049_fase49')) db.exec("INSERT OR IGNORE INTO usuarios(id,nombre,email,password_hash,rol) VALUES(1000,'Administración','siembra@example.invalid','x','admin')");
};
const f = await setupConjuntos({ beforeMigration, modules: {
  E: 'lib/espacio', ED: 'lib/espacio-db', ahora: 'lib/ahora', database: 'lib/db',
  adjunto: 'pages/api/adjuntos/[id]', ticketAdj: 'pages/api/tickets/adjunto/[id]', documento: 'pages/api/activos/documento/[id]',
  campoEquipo: 'pages/api/campo/equipo/[id]', campoBuscar: 'pages/api/campo/buscar', campoOrdenes: 'pages/api/campo/ordenes',
  campoHoy: 'pages/api/campo/hoy', campoSync: 'pages/api/campo/sync',
  proyectos: 'pages/api/proyectos/index', proyecto: 'pages/api/proyectos/[id]/index', desdeTicket: 'pages/api/proyectos/desde-ticket/[ticketId]',
  proyectoAdj: 'pages/api/proyectos/adjunto/[id]', bulkSistema: 'pages/api/activos/bulk-sistema',
  plan: 'pages/api/planes/[id]', asignar: 'pages/api/preventivos/asignar', respaldos: 'pages/api/activos/[id]/respaldos',
  alertas: 'pages/api/alertas/index', contrato: 'pages/api/contratos/[id]/index',
} });
const { app, sqlite, ctx, close } = f;
const one = (q, ...a) => sqlite.prepare(q).get(...a);
const run = (q, ...a) => sqlite.prepare(q).run(...a);
// Usuarios del fixture: admin=1, jefe=2, tecnico=3, visualizador=4, solicitante=5.
const esp = (id, e) => run('UPDATE usuarios SET especialidad=? WHERE id=?', e, id);
const HOY = new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);

// El middleware real, como en test-espacios-aislamiento.
const salida = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'mantenimiento-espacios-rev-')), 'mw.mjs');
await build({ entryPoints: [path.join(raiz, 'src/middleware.ts')], outfile: salida, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'astro-virtual', setup(b) {
    b.onResolve({ filter: /^astro:middleware$/ }, () => ({ path: 'astro:middleware', namespace: 'virtual' }));
    b.onLoad({ filter: /.*/, namespace: 'virtual' }, () => ({ contents: 'export const defineMiddleware = (fn) => fn;', loader: 'js' }));
  } }] });
const { onRequest } = await import(pathToFileURL(salida).href);
await fs.rm(path.dirname(salida), { recursive: true, force: true });

/** Un pedido por el middleware; si pasa, lo atiende la ruta (si la hay). */
async function pedir(url, { rol = 'jefe', method = 'GET', data, params = {}, ruta = null, cookie = null } = {}) {
  const c = ctx(url, { rol, method, data });
  c.params = params;
  c.cookies = { get: (k) => (k === 'espacio' && cookie ? { value: cookie } : undefined), set() {} };
  c.redirect = (to) => new Response(null, { status: 302, headers: { location: to } });
  c.locals.runtime.env.R2 = { get: async (k) => ({ body: `contenido de ${k}`, arrayBuffer: async () => new TextEncoder().encode(k).buffer }), put: async () => {}, delete: async () => {} };
  let reescrita = 'sin-llamar';
  const res = await onRequest(c, async (destino) => {
    reescrita = destino ?? null;
    if (destino || !ruta) return new Response('pagina');
    return ruta[method](c);
  });
  const texto = await res.text();
  let body; try { body = JSON.parse(texto); } catch { body = texto; }
  return { status: res.status, body, texto, reescrita, aviso: c.locals.avisoEspacio ?? null, espacio: c.locals.espacio };
}
const OTRO_BIO = 'Este registro es del espacio Biomédico.';
const OTRO_GEN = 'Este registro es del espacio General.';

try {
  sqlite.exec(`
    INSERT INTO sucursales(id,nombre,activa) VALUES(1,'Sede revisión',1);
    INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo,activa) VALUES(1,1,'Sala revisión','area',1);
    INSERT INTO proveedores(id,nombre,activo) VALUES(1,'Empresa revisión',1);
    INSERT INTO activos(id,codigo,nombre,rubro,tipo,ubicacion_id,ubicacion,estado,criticidad_operacional,padre_id) VALUES
      (101,'REV-AIRE','Aire revisión','aires','general',1,NULL,'operativo','alta',NULL),
      (102,'REV-AIRE2','Segundo aire revisión','aires','general',1,NULL,'operativo','media',NULL),
      (104,'REV-BIO','Monitor revisión','biomedico','biomedico',1,NULL,'operativo','alta',NULL),
      (105,'REV-BIO-PEND','Bomba sin ubicación','biomedico','biomedico',NULL,'Quirófano Azul','operativo','alta',NULL),
      (106,'REV-BIO-COMP','Pieza de la bomba','biomedico','biomedico',NULL,'Quirófano Azul','operativo','baja',105),
      (107,'REV-AIRE-PEND','Aire sin ubicación','aires','general',NULL,'Azotea','operativo','media',NULL);
    INSERT INTO ordenes(id,creado_por,titulo,rubro,tipo,estado,activo_id,asignado_a,codigo) VALUES
      (201,1,'OT aire revisión','aires','correctivo','abierta',101,NULL,'OT-MG8001'),
      (204,1,'OT monitor revisión','biomedico','correctivo','abierta',104,NULL,'OT-MB8001');
    INSERT INTO tickets(id,tracking_token,solicitante_nombre,solicitante_email,asunto,descripcion,rubro,activo_id,estado) VALUES
      (301,'tk-rev-a','Persona','p@example.invalid','Falla aire revisión','x','aires',101,'nuevo'),
      (304,'tk-rev-b','Persona','p@example.invalid','Falla monitor revisión','x','biomedico',104,'nuevo');
    INSERT INTO adjuntos(id,orden_id,usuario_id,nombre,content_type,tamano,r2_key) VALUES (701,204,1,'foto-bio.jpg','image/jpeg',3,'r2/bio'),(702,201,1,'foto-aire.jpg','image/jpeg',3,'r2/aire');
    INSERT INTO ticket_adjuntos(id,ticket_id,nombre,content_type,tamano,r2_key) VALUES (801,304,'tk-bio.jpg','image/jpeg',3,'r2/tk-bio'),(802,301,'tk-aire.jpg','image/jpeg',3,'r2/tk-aire');
    INSERT INTO activo_documentos(id,activo_id,nombre,content_type,tamano,r2_key,usuario_id) VALUES (901,104,'manual-bio.pdf','application/pdf',3,'r2/doc-bio',1),(902,101,'manual-aire.pdf','application/pdf',3,'r2/doc-aire',1);
    INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha) VALUES (401,101,'Plan aire revisión','mensual','${HOY}'),(404,104,'Plan monitor revisión','semestral','${HOY}');
    INSERT INTO proyectos(id,codigo,titulo,creado_por,activo_id,ticket_id) VALUES
      (1,'PRY-8001','Proyecto del monitor',1,104,NULL),(2,'PRY-8002','Proyecto del aire',1,101,NULL),
      (3,'PRY-8003','Proyecto de la solicitud biomédica',1,NULL,304),(4,'PRY-8004','Proyecto sin equipo',1,NULL,NULL);
    INSERT INTO proyecto_adjuntos(id,proyecto_id,nombre,content_type,tamano,r2_key,usuario_id) VALUES (951,1,'plano-bio.pdf','application/pdf',3,'r2/pry-bio',1);
    INSERT INTO contratos_mantenimiento(id,codigo,nombre,proveedor_id,fecha_inicio,fecha_fin,creado_por) VALUES (1,'C-REV','Contrato común',1,'2026-01-01','2027-01-01',1);
    INSERT INTO contrato_equipos(contrato_id,activo_id) VALUES (1,101),(1,104);
    INSERT INTO usuarios(id,nombre,email,password_hash,rol,especialidad,activo) VALUES (30,'Técnica de biomédico','tb@example.invalid','x','tecnico','biomedico',1),(31,'Técnico de general','tg@example.invalid','x','tecnico','general',1);
    UPDATE usuarios SET sucursal_id=1 WHERE id=3;
  `);
  // La migración 0055 fija vigente_desde con la fecha real; aquí, con la del reloj de prueba.
  run('UPDATE rondas SET vigente_desde=?', HOY);

  // ── 1. La ruta codificada no salta el control del espacio ─────────────────
  es(app.E.rutaDecodificada('/api/ordenes/%32%30%34'), '/api/ordenes/204', 'decodifica como Astro');
  es(app.E.rutaDecodificada('/%63alibraciones'), '/calibraciones', 'también las letras');
  es([app.E.rutaDecodificada('/api/ordenes/%2532'), app.E.rutaDecodificada('/x/%E0%A4%A')], [null, null], 'doble o inválida: null');
  es(app.E.rutaDecodificada('/ordenes'), '/ordenes', 'sin codificar no cambia');
  esp(2, 'general');
  for (const [url, ruta, params] of [
    ['/api/ordenes/%32%30%34', app.order, { id: '204' }], ['/api/activos/%31%30%34', app.assets, { id: '104' }],
    ['/api/tickets/%33%30%34', null, {}], ['/api/%6frdenes/204', app.order, { id: '204' }],
  ]) {
    const r = await pedir(url, { ruta, params });
    es([r.status, r.body?.error], [403, OTRO_BIO], `jefe de General en ${url}: 403 como sin codificar`);
  }
  {
    const r = await pedir('/api/ordenes/%32%30%34', { method: 'PATCH', ruta: app.order, params: { id: '204' }, data: { asignadoA: 31, motivo: 'Intento de reasignar por la ruta codificada' } });
    es(r.status, 403, 'tampoco escribe por la ruta codificada');
    es(one('SELECT asignado_a a FROM ordenes WHERE id=204').a, null, 'la OT biomédica sigue sin asignar');
    for (const url of ['/%63alibraciones', '/activos/%31%30%34', '/%61lertas']) {
      const p = await pedir(url);
      es([p.reescrita, p.aviso?.espacio], ['/otro-espacio', 'biomedico'], `página ${url}: el aviso`);
    }
    const d = await pedir('/api/ordenes/%2532%2530%2534', { ruta: app.order, params: { id: '204' } });
    es([d.status, d.reescrita], [400, 'sin-llamar'], 'codificación doble: 400 y no llega a la ruta');
    es((await pedir('/api/ordenes/%32%30%31', { ruta: app.order, params: { id: '201' } })).status, 200, 'la suya codificada sí responde');
  }

  // ── 2. Adjuntos, documentos y la ficha de /campo por id ───────────────────
  esp(3, 'general');
  for (const [nombre, url, ruta, params, propio] of [
    ['foto de la OT', '/api/adjuntos/701', app.adjunto, { id: '701' }, ['/api/adjuntos/702', { id: '702' }]],
    ['adjunto de la solicitud', '/api/tickets/adjunto/801', app.ticketAdj, { id: '801' }, ['/api/tickets/adjunto/802', { id: '802' }]],
    ['documento del equipo', '/api/activos/documento/901', app.documento, { id: '901' }, ['/api/activos/documento/902', { id: '902' }]],
    ['ficha de campo del equipo', '/api/campo/equipo/104', app.campoEquipo, { id: '104' }, ['/api/campo/equipo/101', { id: '101' }]],
  ]) {
    const r = await pedir(url, { rol: 'tecnico', ruta, params });
    es([r.status, r.body?.error], [403, OTRO_BIO], `técnico de General, ${nombre} biomédico: 403`);
    const p = await pedir(propio[0], { rol: 'tecnico', ruta, params: propio[1] });
    es(p.status, 200, `técnico de General, ${nombre} de General: 200`);
  }
  es((await pedir('/api/adjuntos/701', { rol: 'tecnico', method: 'DELETE', ruta: app.adjunto, params: { id: '701' } })).status, 403, 'ni lo borra');
  si(one('SELECT id FROM adjuntos WHERE id=701'), 'la foto sigue');
  esp(3, 'ambos');
  es((await pedir('/api/adjuntos/701', { rol: 'tecnico', ruta: app.adjunto, params: { id: '701' } })).status, 200, 'técnico con los dos espacios: la descarga');

  // ── 3. Proyectos por espacio ──────────────────────────────────────────────
  const codigos = (r) => r.body.proyectos.map((p) => p.codigo).sort();
  esp(2, 'general');
  es(codigos(await pedir('/api/proyectos', { ruta: app.proyectos })), ['PRY-8002', 'PRY-8004'], 'jefe de General: el del aire y el que no tiene equipo');
  esp(2, 'biomedico');
  es(codigos(await pedir('/api/proyectos', { ruta: app.proyectos })), ['PRY-8001', 'PRY-8003'], 'jefe de Biomédico: el del monitor y el de su solicitud');
  esp(2, 'ambos');
  es(codigos(await pedir('/api/proyectos?espacio=biomedico', { ruta: app.proyectos })), ['PRY-8001', 'PRY-8003'], 'jefe con los dos, en Biomédico');
  es((await pedir('/proyectos/1')).aviso, { espacio: 'biomedico', puedeCambiar: true, volver: '/proyectos/1' }, 'la ficha del proyecto biomédico en General: aviso con botón');
  esp(2, 'general');
  for (const [url, ruta, params] of [['/api/proyectos/1', app.proyecto, { id: '1' }], ['/api/proyectos/1/comentarios', null, {}], ['/api/proyectos/3', app.proyecto, { id: '3' }]]) {
    es((await pedir(url, { ruta, params })).status, 403, `jefe de General en ${url}: 403`);
  }
  es((await pedir('/api/proyectos/2', { ruta: app.proyecto, params: { id: '2' } })).status, 200, 'el suyo sí');
  es((await pedir('/api/proyectos/adjunto/951', { ruta: app.proyectoAdj, params: { id: '951' } })).status, 403, 'ni el adjunto del proyecto biomédico');
  {
    const antes = one('SELECT count(*) n FROM proyectos').n;
    const r = await pedir('/api/proyectos/desde-ticket/304', { method: 'POST', ruta: app.desdeTicket, params: { ticketId: '304' }, data: {} });
    es([r.status, r.body?.error], [403, OTRO_BIO], 'no convierte en proyecto una solicitud biomédica');
    const alta = await pedir('/api/proyectos', { method: 'POST', ruta: app.proyectos, data: { titulo: 'Intento cruzado', activoId: 104 } });
    es(alta.status, 403, 'ni da de alta un proyecto con un equipo biomédico');
    es(one('SELECT count(*) n FROM proyectos').n, antes, 'nada se creó');
    es(one('SELECT proyecto_id p FROM tickets WHERE id=304').p, null, 'la solicitud sigue sin proyecto');
  }

  // ── 4. Lote de familia: todo o nada ───────────────────────────────────────
  {
    const r = await pedir('/api/activos/bulk-sistema', { method: 'POST', ruta: app.bulkSistema, data: { ids: [101, 104], sistema: 'hvac' } });
    es([r.status, r.body?.error], [403, OTRO_BIO], 'jefe de General: el lote con un monitor se rechaza entero');
    es([one('SELECT sistema s FROM activos WHERE id=101').s, one('SELECT sistema s FROM activos WHERE id=104').s], [null, null], 'ninguno cambió');
    es((await pedir('/api/activos/bulk-sistema', { method: 'POST', ruta: app.bulkSistema, data: { ids: [101, 102], sistema: 'hvac' } })).status, 200, 'los suyos sí');
    esp(2, 'ambos');
    es((await pedir('/api/activos/bulk-sistema', { method: 'POST', ruta: app.bulkSistema, data: { ids: [102, 104], sistema: 'otro' } })).status, 200, 'con los dos espacios, como antes');
    run('UPDATE activos SET sistema=NULL WHERE id IN (101,102,104)');
  }

  // ── 5. A quien no ve el espacio no se le asigna ───────────────────────────
  esp(2, 'ambos');
  {
    const t = await pedir('/api/preventivos/asignar?espacio=biomedico', { method: 'POST', ruta: app.asignar, data: { planIds: [404], tecnicoId: 31 } });
    es(t.status, 400, 'tablero: el plan biomédico no va al técnico de General');
    si(/no ve los preventivos biomédicos\. Elige un técnico de biomédico\./.test(t.body.error), 'con el mensaje de siempre');
    const p = await pedir('/api/planes/404', { method: 'PATCH', ruta: app.plan, params: { id: '404' }, data: { asignadoA: 31 } });
    es(p.status, 400, 'ficha del plan: tampoco');
    si(p.body.error.includes('no ve los preventivos biomédicos'), `con su motivo (${p.body.error})`);
    es(one('SELECT asignado_a a FROM planes_mantenimiento WHERE id=404').a, null, 'el plan sigue sin técnico');
    const o = await pedir('/api/ordenes/204', { method: 'PATCH', ruta: app.order, params: { id: '204' }, data: { asignadoA: 31, motivo: 'Reasignar la OT a otra persona' } });
    es(o.status, 400, 'ficha de la OT: tampoco');
    si(o.body.error.includes('no ve las órdenes biomédicas'), `con su motivo (${o.body.error})`);
    es(one('SELECT asignado_a a FROM ordenes WHERE id=204').a, null, 'la OT sigue sin técnico');
    const nueva = await pedir('/api/ordenes', { method: 'POST', ruta: app.orders, data: { titulo: 'OT cruzada', tipo: 'correctivo', rubro: 'aires', activoId: 101, sucursalId: 1, ubicacionId: 1, asignadoA: 30 } });
    es(nueva.status, 400, 'ni nace una OT de aires asignada a la técnica de biomédico');
    si(nueva.body.error.includes('no ve las órdenes de mantenimiento general'), `con su motivo (${nueva.body.error})`);
    es(one("SELECT count(*) n FROM ordenes WHERE titulo='OT cruzada'").n, 0, 'nada se guardó');
    // Lo correcto sigue pasando.
    es((await pedir('/api/planes/404', { method: 'PATCH', ruta: app.plan, params: { id: '404' }, data: { asignadoA: 30 } })).status, 200, 'el plan biomédico a la técnica de biomédico');
    es((await pedir('/api/ordenes/201', { method: 'PATCH', ruta: app.order, params: { id: '201' }, data: { asignadoA: 31 } })).status, 200, 'la OT de aire al técnico de General');
    es((await pedir('/api/ordenes/201', { method: 'PATCH', ruta: app.order, params: { id: '201' }, data: { asignadoA: 3, motivo: 'Lo toma el técnico de los dos espacios' } })).status, 200, 'y a un técnico con los dos espacios');
    run('UPDATE ordenes SET asignado_a=NULL WHERE id=201');
    run('UPDATE planes_mantenimiento SET asignado_a=NULL WHERE id=404');
  }

  // ── 6. /campo: solo lo del espacio del técnico; la ronda es de General ────
  esp(3, 'general');
  {
    const ids = (r) => r.body.equipos.map((e) => e.codigo).sort();
    es(ids(await pedir('/api/campo/buscar?ubicacion=1', { rol: 'tecnico', ruta: app.campoBuscar })), ['REV-AIRE', 'REV-AIRE2'], 'técnico de General: los equipos de la sala sin el monitor');
    es(ids(await pedir('/api/campo/buscar?ubicacion=sin', { rol: 'tecnico', ruta: app.campoBuscar })), ['REV-AIRE-PEND'], 'y sin ubicación, solo el aire');
    const sede = await pedir('/api/campo/buscar?sede=1', { rol: 'tecnico', ruta: app.campoBuscar });
    es([sede.body.ubicaciones[0].equipos, sede.body.sinUbicacion], [2, 1], 'las cuentas también son de su espacio');
    const antes = one('SELECT count(*) n FROM ordenes').n;
    const c = await pedir('/api/campo/ordenes', { rol: 'tecnico', method: 'POST', ruta: app.campoOrdenes, data: { activoId: 104, tipo: 'correctivo' } });
    es([c.status, c.body?.error], [403, OTRO_BIO], 'no crea una OT del monitor desde el celular');
    es(one('SELECT count(*) n FROM ordenes').n, antes, 'ninguna OT nueva');
    es((await pedir('/api/campo/ordenes?id=204', { rol: 'tecnico', ruta: app.campoOrdenes })).status, 404, 'ni abre la OT biomédica libre por su id');
    es((await pedir('/api/campo/ordenes?id=201', { rol: 'tecnico', ruta: app.campoOrdenes })).status, 200, 'la de aire sí');
    const hoyG = await pedir('/api/campo/hoy?sede=1', { rol: 'tecnico', ruta: app.campoHoy });
    si(hoyG.body.ronda, 'el técnico de General recibe la ronda de su sede');
  }
  esp(3, 'biomedico');
  {
    const ids = (r) => r.body.equipos.map((e) => e.codigo).sort();
    es(ids(await pedir('/api/campo/buscar?ubicacion=sin', { rol: 'tecnico', ruta: app.campoBuscar })), ['REV-BIO-COMP', 'REV-BIO-PEND'], 'técnica de Biomédico: sus pendientes');
    es((await pedir('/api/campo/equipo/101', { rol: 'tecnico', ruta: app.campoEquipo, params: { id: '101' } })).status, 403, 'no abre la ficha del aire');
    const c = await pedir('/api/campo/ordenes', { rol: 'tecnico', method: 'POST', ruta: app.campoOrdenes, data: { activoId: 104, tipo: 'correctivo' } });
    es(c.status, 201, 'crea la OT de su monitor');
    es(one('SELECT rubro r FROM ordenes WHERE id=?', c.body.ordenId).r, 'biomedico', 'en su espacio');
    const hoyB = await pedir('/api/campo/hoy?sede=1', { rol: 'tecnico', ruta: app.campoHoy });
    es([hoyB.status, hoyB.body.ronda, hoyB.body.rondaError], [200, null, undefined], 'la técnica de Biomédico no recibe la ronda de General');
    const s = await pedir('/api/campo/sync', { rol: 'tecnico', method: 'POST', ruta: app.campoSync, data: { ops: [{ opId: 'rev-ronda-bio-1', tipo: 'ronda.iniciar', at: new Date().toISOString(), sucursalId: 1, fecha: HOY, turno: 'manana' }] } });
    es([s.status, s.body.resultados[0].ok, s.body.resultados[0].error], [200, false, OTRO_GEN], 'ni la registra por la cola del celular');
    es(one('SELECT count(*) n FROM ronda_ejecuciones').n, 0, 'no se abrió ninguna ronda');
    run('DELETE FROM ordenes WHERE id=?', c.body.ordenId);
  }
  esp(3, 'ambos');
  es(((await pedir('/api/campo/buscar?ubicacion=1', { rol: 'tecnico', ruta: app.campoBuscar })).body.equipos.length), 3, 'técnico con los dos espacios: todo, como antes');

  // ── 7. Jerarquía, respaldo y alertas ──────────────────────────────────────
  esp(2, 'ambos');
  {
    const r = await pedir('/api/activos/104', { method: 'PATCH', ruta: app.assets, params: { id: '104' }, cookie: 'biomedico', data: { padreId: 101 } });
    es(r.status, 400, 'el monitor no cuelga de un aire');
    si(r.body.error.includes('Elige un padre del mismo espacio'), r.body.error);
    es(one('SELECT padre_id p FROM activos WHERE id=104').p, null, 'sin padre');
    es((await pedir('/api/activos/106', { method: 'PATCH', ruta: app.assets, params: { id: '106' }, cookie: 'biomedico', data: { padreId: 104 } })).status, 200, 'una pieza biomédica sí cuelga del monitor');
    run('UPDATE activos SET padre_id=105 WHERE id=106');
    const resp = await pedir('/api/activos/104/respaldos', { method: 'POST', ruta: app.respaldos, params: { id: '104' }, cookie: 'biomedico', data: { respaldoId: 101 } });
    es(resp.status, 400, 'un aire no es respaldo del monitor');
    es(one('SELECT count(*) n FROM activo_respaldos').n, 0, 'sin respaldo guardado');
    const alerta = await pedir('/api/alertas', { method: 'POST', ruta: app.alertas, cookie: 'biomedico', data: { tipo: 'retiro', fuente: 'fabricante', titulo: 'Retiro cruzado', fechaAlerta: HOY, activoIds: [104, 101] } });
    es(alerta.status, 400, 'la alerta no lleva aires');
    si(alerta.body.error.includes('equipos biomédicos'), alerta.body.error);
    es((await pedir('/api/alertas', { method: 'POST', ruta: app.alertas, cookie: 'biomedico', data: { tipo: 'retiro', fuente: 'fabricante', titulo: 'Retiro del monitor', fechaAlerta: HOY, activoIds: [104] } })).status, 201, 'con el monitor sí');
  }

  // ── 8. Contrato común, equipos del espacio; el SCP del panel cuenta General ──
  {
    const codigosContrato = (r) => r.body.equipos.map((e) => e.codigo).sort();
    esp(2, 'general');
    es(codigosContrato(await pedir('/api/contratos/1', { ruta: app.contrato, params: { id: '1' } })), ['REV-AIRE'], 'jefe de General: el contrato muestra su aire');
    esp(2, 'biomedico');
    es(codigosContrato(await pedir('/api/contratos/1', { ruta: app.contrato, params: { id: '1' } })), ['REV-BIO'], 'jefe de Biomédico: su monitor');
    const scp = async () => (await app.ahora.estadoAhora(app.database.getDb(ctx('/')), { usuarioId: 1, rol: 'admin', incluirCobertura: true })).find((b) => b.doc === 'SCP');
    const antes = await scp();
    sqlite.exec("INSERT INTO activos(id,codigo,nombre,rubro,tipo,estado,criticidad_operacional) VALUES (190,'REV-BIO-MAS','Desfibrilador más','biomedico','biomedico','operativo','alta')");
    const despues = await scp();
    es([despues.numero, despues.etiquetaNumero, despues.tono], [antes.numero, antes.etiquetaNumero, antes.tono], 'un equipo biomédico crítico más no cambia el SCP de General');
    si(!/biom/i.test(despues.detalle) && despues.numero > 0, `cuenta solo los de General (${despues.detalle})`);
    run('DELETE FROM activos WHERE id=190');
  }

  // ── 9. El solicitante: sus solicitudes de los dos espacios, sin aviso ─────
  {
    es([app.E.tieneInterruptor({ rol: 'solicitante', especialidad: null }), app.E.gestionaEspacio({ rol: 'solicitante' })], [false, false], 'el solicitante no tiene interruptor');
    const r = await pedir('/tickets/304', { rol: 'solicitante' });
    es([r.reescrita, r.aviso, r.espacio], [null, null, 'biomedico'], 'abre su solicitud del monitor sin el aviso, en Biomédico');
    const g = await pedir('/tickets/301', { rol: 'solicitante', cookie: 'biomedico' });
    es([g.reescrita, g.aviso, g.espacio], [null, null, 'general'], 'y la del aire, en General');
    esp(2, 'general');
    es((await pedir('/tickets/304')).aviso?.espacio, 'biomedico', 'al jefe de General le sigue saliendo el aviso');
  }

  // ── 10. El interruptor no lleva a otro sitio ──────────────────────────────
  for (const v of ['/\\evil.example', '/\\/evil.example', '/ordenes\u0000', '/x\n/y']) es(app.E.destinoAlCambiar(v), '/', `destinoAlCambiar(${JSON.stringify(v)}) → /`);
  es(app.E.destinoAlCambiar('/ordenes?estado=abierta'), '/ordenes', 'una lista común sigue volviendo a sí misma');

  console.log(`PASS test-espacios-revision: ${n} verificaciones; ruta codificada, adjuntos y documentos por id, proyectos, lote de familia, asignaciones, /campo y la ronda, jerarquía, respaldo, alertas, contrato, SCP, solicitante e interruptor. Migraciones reales, sin red.`);
} finally { await close(); }
