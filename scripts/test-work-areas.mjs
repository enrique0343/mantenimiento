// Integration checks against an isolated SQLite database; no mail or external calls.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mantenimiento-work-areas-'));
try {
  const bundle = path.join(temporary, 'routes.mjs');
  await build({
    stdin: { contents: `
      export * as schema from './src/lib/schema';
      export { getTableConfig, SQLiteSyncDialect, SQLiteTable } from 'drizzle-orm/sqlite-core';
      export { is, getTableName } from 'drizzle-orm';
      export { validarAreaTrabajo, validarContextoArea } from './src/lib/ordenes';
      export { getDb } from './src/lib/db';
      export * as ticketCreate from './src/pages/api/tickets/publico';
      export * as ticketList from './src/pages/api/tickets/index';
      export * as ticketDetail from './src/pages/api/tickets/[id]/index';
      export * as ticketConvert from './src/pages/api/tickets/[id]/convertir';
      export * as orderCreate from './src/pages/api/ordenes/index';
      export * as orderDetail from './src/pages/api/ordenes/[id]/index';
      export * as projectConvert from './src/pages/api/proyectos/[id]/generar-ot';
    `, resolveDir: process.cwd(), loader: 'ts' },
    outfile: bundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'isolated-effects', setup(builder) {
      builder.onResolve({ filter: /(?:^|\/)(auth|email|smtp-worker|telegram|notificaciones|notif-app|audit|especialidad)$/ }, (args) => ({ path: args.path.split('/').at(-1), namespace: 'test-effects' }));
      builder.onLoad({ filter: /.*/, namespace: 'test-effects' }, ({ path: name }) => ({ contents: name === 'auth'
        ? `export async function requireUser(ctx, roles) { const user=ctx.locals.testUser; return !user ? {user:null,response:new Response('Unauthorized',{status:401})} : roles && !roles.includes(user.rol) ? {user:null,response:new Response('Forbidden',{status:403})} : {user,response:null}; }`
        : `export const sendMail=async()=>{}; export const emailLayout=()=>''; export const sendTelegram=async()=>{}; export const crearNotificacion=async()=>{}; export const logAudit=async()=>{}; export const jefesNotificar=async()=>[]; export const disparadorOT=async()=>{}; export const disparadorProyecto=async()=>{};` }));
    }}],
  });
  const app = await import(pathToFileURL(bundle).href);
  const sqlite = new DatabaseSync(':memory:');
  const dialect = new app.SQLiteSyncDialect();
  for (const table of Object.values(app.schema).filter((value) => app.is(value, app.SQLiteTable))) {
    const config = app.getTableConfig(table);
    const columns = config.columns.map((column) => {
      let definition = `"${column.name}" ${column.getSQLType()}`;
      if (column.primary) definition += ' PRIMARY KEY';
      if (column.notNull) definition += ' NOT NULL';
      if (column.default !== undefined) {
        const value = column.default;
        const literal = typeof value === 'string' ? `'${value.replaceAll("'", "''")}'` : typeof value === 'boolean' ? Number(value) : typeof value === 'number' ? value : dialect.sqlToQuery(value).sql;
        definition += ` DEFAULT ${literal}`;
      }
      return definition;
    });
    sqlite.exec(`CREATE TABLE "${config.name}" (${columns.join(', ')})`);
  }
  // Minimal D1 binding backed by SQLite, keeping Drizzle's real SQL filters.
  const DB = { prepare(query) {
    return { bind(...params) {
      const statement = sqlite.prepare(query);
      return {
        async all() { return { results: statement.all(...params), success: true }; },
        async raw() { statement.setReturnArrays(true); return statement.all(...params); },
        async run() { return { success: true, meta: statement.run(...params) }; },
        async first() { return statement.get(...params) ?? null; },
      };
    }};
  }};
  const user = { id: 1, nombre: 'Test', email: 'test@example.com', rol: 'admin' };
  const ctx = (url, body, id, method = 'POST') => ({
    request: new Request(`https://test.local${url}`, { method, ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}), headers: { 'content-type': 'application/json' } }) }),
    params: { id: String(id ?? '') },
    locals: { testUser: user, runtime: { env: { DB }, ctx: { waitUntil() {} } } },
  });
  sqlite.exec("INSERT INTO sucursales(id,nombre) VALUES(1,'Sede'),(2,'Otra'); INSERT INTO ubicaciones(id,nombre,sucursal_id) VALUES(1,'Sala',1),(2,'Sala otra',2);");
  sqlite.exec("INSERT INTO activos(id,codigo,nombre,rubro,ubicacion_id) VALUES(1,'AC-1','Aire','aires',1),(2,'INF-1','Instalación','infraestructura',1);");
  const request = { solicitanteNombre: 'Prueba', solicitanteEmail: 'prueba@example.com', asunto: 'Atención requerida', descripcion: 'Solicitud de prueba por ubicación.', sucursalId: 1, ubicacionId: 1, rubro: 'infraestructura' };
  let response = await app.ticketCreate.POST(ctx('/api/tickets/publico', request));
  assert.equal(response.status, 201, await response.clone().text());
  const ticketId = (await response.json()).ticket.id;
  assert.equal(sqlite.prepare('SELECT rubro FROM tickets WHERE id=?').get(ticketId).rubro, 'infraestructura');
  const invalidRequests = [
    { ...request, rubro: 'otro' }, { ...request, rubro: undefined },
    { ...request, activoId: 1 }, { ...request, activoId: 999 },
    { ...request, ubicacionId: 2 }, { ...request, sucursalId: 999 },
  ];
  for (const body of invalidRequests) assert.equal((await app.ticketCreate.POST(ctx('/api/tickets/publico', body))).status, 400);
  assert.equal((await app.ticketCreate.POST(ctx('/api/tickets/publico?area=aires', request))).status, 400);
  response = await app.ticketCreate.POST(ctx('/api/tickets/publico', { ...request, rubro: undefined, activoId: 1 }));
  assert.equal(response.status, 201);
  const airTicket = (await response.json()).ticket.id;
  assert.equal(sqlite.prepare('SELECT rubro FROM tickets WHERE id=?').get(airTicket).rubro, 'aires');
  response = await app.ticketList.GET(ctx('/api/tickets?area=infraestructura', null, null, 'GET'));
  assert.deepEqual((await response.json()).tickets.map((ticket) => ticket.id), [ticketId]);
  assert.equal((await app.ticketList.GET(ctx('/api/tickets?area=otro', null, null, 'GET'))).status, 400);
  response = await app.ticketConvert.POST(ctx(`/api/tickets/${ticketId}/convertir?area=infraestructura`, {}, ticketId));
  assert.equal(response.status, 201, await response.clone().text());
  const converted = (await response.json()).orden;
  assert.equal(converted.rubro, 'infraestructura'); assert.equal(converted.ubicacionId, 1); assert.equal(converted.sucursalId, 1); assert.equal(converted.activoId, null);
  assert.equal((await app.ticketConvert.POST(ctx(`/api/tickets/${airTicket}/convertir?area=infraestructura`, {}, airTicket))).status, 400);
  response = await app.orderCreate.POST(ctx('/api/ordenes', { titulo: 'Nueva orden', rubro: 'aires', activoId: 1, sucursalId: 1, ubicacionId: 1 }));
  assert.equal(response.status, 201, await response.clone().text());
  const order = (await response.json()).orden;
  assert.equal((await app.orderCreate.POST(ctx('/api/ordenes', { titulo: 'Conflicto', rubro: 'infraestructura', activoId: 1, sucursalId: 1 }))).status, 400);
  response = await app.orderCreate.GET(ctx('/api/ordenes?area=infraestructura', null, null, 'GET'));
  assert.deepEqual((await response.json()).ordenes.map((order) => order.id), [converted.id]);
  assert.equal((await app.orderDetail.PATCH(ctx(`/api/ordenes/${order.id}`, { activoId: 2 }, order.id, 'PATCH'))).status, 400);
  assert.equal((await app.orderDetail.PATCH(ctx(`/api/ordenes/${order.id}`, { rubro: 'biomedico' }, order.id, 'PATCH'))).status, 400);
  assert.equal((await app.ticketDetail.PATCH(ctx(`/api/tickets/${airTicket}`, { activoId: 2 }, airTicket, 'PATCH'))).status, 400);
  assert.equal((await app.ticketDetail.PATCH(ctx(`/api/tickets/${airTicket}`, { rubro: 'infraestructura' }, airTicket, 'PATCH'))).status, 400);
  response = await app.ticketDetail.PATCH(ctx(`/api/tickets/${airTicket}`, { prioridad: 'alta', asignadoA: 1 }, airTicket, 'PATCH'));
  assert.equal(response.status, 200, await response.clone().text());
  const automaticId = (await response.json()).otCreada;
  assert.ok(automaticId);
  const automatic = sqlite.prepare('SELECT * FROM ordenes WHERE id=?').get(automaticId);
  assert.equal(automatic.rubro, 'aires'); assert.equal(automatic.ubicacion_id, 1); assert.equal(automatic.prioridad, 'alta');
  sqlite.exec("INSERT INTO proyectos(id,codigo,titulo,estado,sucursal_id,ubicacion_id,creado_por) VALUES(1,'P-1','Proyecto sin activo','aprobado',1,1,1)");
  assert.equal((await app.projectConvert.POST(ctx('/api/proyectos/1/generar-ot', { titulo: 'Sin clasificar' }, 1))).status, 400);
  response = await app.projectConvert.POST(ctx('/api/proyectos/1/generar-ot', { titulo: 'Trabajo', rubro: 'infraestructura' }, 1));
  assert.equal(response.status, 201, await response.clone().text());
  assert.equal((await response.json()).orden.rubro, 'infraestructura');
  sqlite.exec("INSERT INTO proyectos(id,codigo,titulo,estado,sucursal_id,ubicacion_id,creado_por,activo_id) VALUES(2,'P-2','Proyecto aire','aprobado',1,1,1,1)");
  assert.equal((await app.projectConvert.POST(ctx('/api/proyectos/2/generar-ot', { titulo: 'Conflicto', rubro: 'infraestructura', activoId: 2 }, 2))).status, 400);
  assert.equal((await app.orderDetail.DELETE(ctx(`/api/ordenes/${order.id}?area=infraestructura`, {}, order.id, 'DELETE'))).status, 400);
  assert.equal((await app.ticketDetail.DELETE(ctx(`/api/tickets/${airTicket}?area=infraestructura`, {}, airTicket, 'DELETE'))).status, 400);
  console.log('PASS: solicitudes por ubicación, inferencia desde activo, filtros SQL, conflictos de área y ubicación, conversiones explícita/automática y generación desde proyecto.');
  sqlite.close();
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
