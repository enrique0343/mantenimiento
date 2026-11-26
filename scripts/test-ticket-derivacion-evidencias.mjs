// Una derivación no permite que una escritura autorizada antes alcance otra bandeja.
// Middleware y handlers reales; SQLite migrada, R2 en memoria y ningún dato remoto.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const f = await setupConjuntos({ modules: {
  derivar: 'pages/api/tickets/[id]/derivar', convertir: 'pages/api/tickets/[id]/convertir',
  ticketComentario: 'pages/api/tickets/[id]/comentario', ordenComentario: 'pages/api/ordenes/[id]/comentarios',
  adjunto: 'pages/api/ordenes/[id]/adjuntos', firma: 'pages/api/ordenes/[id]/firma', incidente: 'pages/api/ordenes/[id]/incidente',
} });
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mantenimiento-derivacion-evidencias-'));
const { sqlite: s, app, call, ctx, faults } = f;
let checks = 0, nextId = 100;
const check = (actual, expected, message) => { checks++; assert.deepEqual(actual, expected, message); };
const row = id => s.prepare('SELECT * FROM tickets WHERE id=?').get(id);
const order = id => s.prepare('SELECT * FROM ordenes WHERE id=?').get(id);
const cases = [
  { name: 'ticketComentario', method: 'POST', rol: 'tecnico', ticket: true, table: 'ticket_comentarios', data: { texto: 'NOTA PRUEBA' } },
  { name: 'ordenComentario', method: 'POST', rol: 'tecnico', table: 'comentarios', data: { texto: 'NOTA PRUEBA' } },
  { name: 'adjunto', method: 'POST', rol: 'tecnico', table: 'adjuntos', r2: true },
  { name: 'firma', method: 'POST', rol: 'tecnico', r2: true, data: { rol: 'tecnico', nombre: 'TECNICO PRUEBA', imagenDataUrl: 'data:image/png;base64,QUFBQUFBQUFBQUFBQUFBQQ==' } },
  { name: 'incidente', method: 'PUT', rol: 'jefe', table: 'orden_incidentes', data: { numeroReporte: 'PRUEBA-INCIDENTE', fechaNotificacion: '2026-01-01', nota: 'NOTA DE PRUEBA' } },
];
async function pair(withOrder) {
  const id = nextId++;
  s.prepare(`INSERT INTO tickets(id,rubro,tracking_token,solicitante_nombre,solicitante_email,solicitante_usuario_id,asunto,descripcion,
    sucursal_id,ubicacion_id,estado,updated_at) VALUES(?,'equipo_general',?,'PRUEBA','solicitante@example.invalid',5,'PRUEBA','PRUEBA',1,1,'nuevo','2026-01-01T10:00:00.000Z')`).run(id, `EVIDENCIA-PRUEBA-${id}`);
  const created = withOrder ? await call(app.convertir.POST, `/api/tickets/${id}/convertir`, { id, method: 'POST', data: { asignadoA: 3 } }) : null;
  if (created) check(created.status, 201, 'OT inicial de prueba');
  return { id, ot: created?.body.orden.id ?? null };
}
async function derive(p) {
  const r = await call(app.derivar.POST, `/api/tickets/${p.id}/derivar`, { id: p.id, method: 'POST', rol: 'jefe',
    data: { espacioDestino: 'tecnologia', motivo: 'REPORTE MAL CLASIFICADO', expectedUpdatedAt: row(p.id).updated_at } });
  check(r.status, 200, 'Derivación gana antes de escritura');
}
function context(c, p) {
  const id = c.ticket ? p.id : p.ot;
  const url = c.ticket ? `/api/tickets/${id}/comentario?espacio=general` : `/api/ordenes/${id}/${({ ordenComentario: 'comentarios', adjunto: 'adjuntos', firma: 'firma', incidente: 'incidente' })[c.name]}?espacio=general`;
  const request = ctx(url, { id, method: c.method, rol: c.rol, data: c.data });
  const objects = new Map([['existente', 'NO TOCAR']]);
  const deleted = [];
  request.locals.runtime.env.R2 = {
    async put(key, value) { objects.set(key, value); },
    async delete(key) { deleted.push(key); objects.delete(key); },
  };
  if (c.name === 'adjunto') {
    const form = new FormData();
    form.set('file', new File(['IMAGEN SINTETICA'], 'prueba.png', { type: 'image/png' }));
    form.set('categoria', 'antes');
    request.request = new Request(request.url, { method: 'POST', headers: { cookie: request.request.headers.get('cookie') }, body: form });
  }
  request.cookies = { get: () => undefined, set: () => {} };
  request.redirect = to => new Response(null, { status: 302, headers: { location: to } });
  return { request, objects, deleted };
}
function evidence(c, p) {
  if (!c.table) return order(p.ot).firma_tecnico_r2 ? 1 : 0;
  return s.prepare(`SELECT count(*) n FROM ${c.table} WHERE ${c.ticket ? 'ticket_id' : 'orden_id'}=?`).get(c.ticket ? p.id : p.ot).n;
}
try {
  const file = path.join(temp, 'middleware.mjs');
  await build({ entryPoints: [path.resolve('src/middleware.ts')], outfile: file, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'astro-middleware', setup(b) {
      b.onResolve({ filter: /^astro:middleware$/ }, () => ({ path: 'middleware', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const defineMiddleware=f=>f;', loader: 'js' }));
    } }] });
  const { onRequest } = await import(pathToFileURL(file).href);
  s.exec(`INSERT INTO sucursales(id,nombre) VALUES(1,'SEDE PRUEBA');
    INSERT INTO ubicaciones(id,sucursal_id,nombre) VALUES(1,1,'UBICACION PRUEBA');
    UPDATE usuarios SET especialidad='general' WHERE id IN(2,3);`);
  faults.enforceColumnLimit = true; faults.enforceParameterLimit = true;

  for (const c of cases) {
    // Sigue funcionando el envío autorizado normal, con el mismo contrato.
    let p = await pair(!c.ticket), h = context(c, p);
    let response = await app[c.name][c.method](h.request);
    check(response.status, c.name === 'firma' ? 200 : 201, `${c.name}: éxito`);
    check(evidence(c, p), 1, `${c.name}: una evidencia`);
    if (c.r2) { check(h.objects.size, 2, `${c.name}: objeto guardado`); check(h.deleted.length, 0, `${c.name}: no borra objeto confirmado`); }

    // El middleware había permitido General; el handler ya ve Tecnología y rechaza.
    p = await pair(!c.ticket); h = context(c, p);
    response = await onRequest(h.request, async () => { await derive(p); return app[c.name][c.method](h.request); });
    check(response.status, 403, `${c.name}: derivación entre middleware y handler`);
    check(evidence(c, p), 0, `${c.name}: ninguna evidencia ajena`);
    check(h.objects.size, 1, `${c.name}: no subió archivo sin autorización`);

    // Capturó el alcance correcto, pero la derivación gana justo antes del INSERT/UPDATE.
    p = await pair(!c.ticket); h = context(c, p);
    const pattern = c.name === 'firma' ? /^update "ordenes"/i : new RegExp(`^insert into "${c.table}"`, 'i');
    faults.beforeStatement = { matches: query => pattern.test(query), run: () => derive(p) };
    response = await app[c.name][c.method](h.request);
    check(response.status, 409, `${c.name}: derivación entre lectura y escritura`);
    check(faults.beforeStatement, null, `${c.name}: intercalación ejercida`);
    check(evidence(c, p), 0, `${c.name}: escritura tardía no aplicada`);
    check(row(p.id).rubro, 'tecnologia', `${c.name}: mantiene destino`);
    check(h.objects.size, 1, `${c.name}: sin archivo huérfano`);
    check(h.objects.get('existente'), 'NO TOCAR', `${c.name}: conserva archivo anterior`);
    if (c.r2) check(h.deleted.length, 1, `${c.name}: elimina solo archivo nuevo`);
  }

  // Quien reportó mantiene su comentario en su solicitud, aunque cambie de bandeja.
  const p = await pair(false); await derive(p);
  const own = await call(app.ticketComentario.POST, `/api/tickets/${p.id}/comentario`, { id: p.id, method: 'POST', rol: 'solicitante', data: { texto: 'INFORMACION DEL REPORTANTE' } });
  check(own.status, 201, 'El solicitante conserva acceso a su propia solicitud');
  s.prepare('UPDATE tickets SET solicitante_usuario_id=2 WHERE id=?').run(p.id);
  const other = await call(app.ticketComentario.POST, `/api/tickets/${p.id}/comentario`, { id: p.id, method: 'POST', rol: 'solicitante', data: { texto: 'NO DEBE ESCRIBIR' } });
  check(other.status, 403, 'No puede comentar solicitud ajena con correo coincidente');
  check(s.prepare('PRAGMA foreign_key_check').all(), [], 'Referencias intactas');
  console.log(`PASS Derivación/evidencias (${checks} verificaciones): middleware, autorización interna, escritura atómica, comentarios propios y limpieza R2.`);
} finally { await f.close(); await fs.rm(temp, { recursive: true, force: true }); }
