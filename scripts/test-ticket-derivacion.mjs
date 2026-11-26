// Derivaciones reales sobre todas las migraciones: permisos, CAS y rollback D1.
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';
const f = await setupConjuntos({ modules: {
  derivar: 'pages/api/tickets/[id]/derivar', ticket: 'pages/api/tickets/[id]/index',
  convert: 'pages/api/tickets/[id]/convertir', lista: 'pages/api/tickets/index',
} });
const { sqlite: s, app, call, faults } = f;
const one = (sql, ...args) => s.prepare(sql).get(...args);
const count = table => one(`SELECT count(*) n FROM ${table}`).n;
const row = id => one('SELECT * FROM tickets WHERE id=?', id);
let checks = 0, nextId = 100;
const expect = (r, status) => { checks++; assert.equal(r.status, status, JSON.stringify(r)); return r.body; };
function ticket(overrides = {}) {
  const id = nextId++;
  const values = { id, rubro: 'equipo_general', tracking_token: `PRUEBA-DERIVACION-${id}`,
    solicitante_nombre: 'PRUEBA', solicitante_email: 'test@example.invalid', solicitante_usuario_id: 5,
    asunto: 'PRUEBA DE SOLICITUD', descripcion: 'REPORTE ORIGINAL', sucursal_id: 1, ubicacion_id: 1,
    estado: 'nuevo', sla_horas: 8, vencimiento_sla: '2026-01-01T18:00:00.000Z', created_at: '2026-01-01T10:00:00.000Z',
    updated_at: '2026-01-01T10:00:00.000Z', ...overrides };
  s.prepare(`INSERT INTO tickets(${Object.keys(values).join(',')}) VALUES(${Object.keys(values).map(() => '?').join(',')})`).run(...Object.values(values));
  return id;
}
function body(id, overrides = {}) { return { espacioDestino: 'tecnologia', motivo: '  área reportada incorrectamente  ', expectedUpdatedAt: row(id).updated_at, ...overrides }; }
const move = (id, data = body(id), rol = 'admin', query = '') => call(app.derivar.POST, `/api/tickets/${id}/derivar${query}`, { id, method: 'POST', data, rol });
async function conOrden(overrides = {}, asignee = 3) {
  const id = ticket(overrides);
  const response = expect(await call(app.convert.POST, `/api/tickets/${id}/convertir`, { id, method: 'POST', data: { asignadoA: asignee } }), 201);
  return { id, ot: response.orden.id };
}
function set(table, id, values) { s.prepare(`UPDATE ${table} SET ${Object.keys(values).map(k => `${k}=?`).join(',')} WHERE id=?`).run(...Object.values(values), id); }
function unchanged(before, after, changed) {
  for (const k of Object.keys(before)) if (!changed.includes(k)) assert.deepEqual(after[k], before[k], `Debe conservar ${k}`);
}
try {
  faults.enforceColumnLimit = true; faults.enforceParameterLimit = true;
  s.exec(`INSERT INTO sucursales(id,nombre) VALUES(1,'SEDE PRUEBA'),(2,'OTRA SEDE');
    INSERT INTO ubicaciones(id,sucursal_id,nombre) VALUES(1,1,'UBICACION PRUEBA'),(2,2,'OTRA UBICACION');
    INSERT INTO activos(id,codigo,nombre,rubro,tipo,ubicacion_id) VALUES(1,'GEN-PRUEBA','EQUIPO GENERAL','equipo_general','general',1),
      (2,'BIO-PRUEBA','EQUIPO BIO','biomedico','biomedico',1),(3,'TI-PRUEBA','EQUIPO TI','tecnologia','general',1);
    UPDATE usuarios SET especialidad='general' WHERE id IN(2,3);
    INSERT INTO usuarios(id,nombre,email,password_hash,rol,especialidad) VALUES
      (8,'JEFE TI','ti@example.invalid','prueba','jefe','tecnologia'),
      (9,'JEFE BIO','bio@example.invalid','prueba','jefe','biomedico'),
      (10,'JEFE TI INACTIVO','inactivo@example.invalid','prueba','jefe','tecnologia');
    UPDATE usuarios SET activo=0 WHERE id=10;`);
  globalThis.__efectosPrueba = [];
  let id = ticket(), audit = count('audit_log');
  for (const role of [null, 'solicitante', 'visualizador', 'bodega', 'motorista']) expect(await move(id, body(id), role), role ? 403 : 401);
  for (const bad of [null, {}, body(id, { expectedUpdatedAt: undefined }), body(id, { motivo: '  ' }),
    body(id, { motivo: 'x'.repeat(2001) }), body(id, { espacioDestino: 'otra' }),
    body(id, { rubroDestino: 'biomedico' }), body(id, { asignadoA: 8 }), body(id, { desvincularEquipo: 'true' })]) expect(await move(id, bad), 400);
  expect(await move(id, body(id, { expectedUpdatedAt: 'DESACTUALIZADO' })), 409);
  expect(await move(id, body(id), 'jefe', '?espacio=biomedico'), 409);
  expect(await move(id, body(id), 'jefe', '?area=infraestructura'), 409);
  assert.equal(count('audit_log'), audit);
  for (const rubro of ['biomedico', 'tecnologia']) expect(await move(ticket({ rubro }), undefined, 'jefe'), 403);
  expect(await move(ticket({ asignado_a: 2 }), undefined, 'tecnico'), 403);
  expect(await move(ticket({ rubro: null, activo_id: 3 }), undefined, 'jefe'), 403, 'Legacy hereda espacio de activo');

  // Derivar no otorga acceso al destino, no reinicia plazos y conserva contenido.
  const original = row(id), users = s.prepare('SELECT * FROM usuarios ORDER BY id').all();
  const result = expect(await move(id, body(id), 'jefe', '?espacio=general&area=equipo_general'), 200);
  assert.deepEqual(Object.keys(result).sort(), ['id', 'espacioDestino', 'rubroDestino', 'mensaje'].sort());
  assert.equal(result.espacioDestino, 'tecnologia');
  unchanged(original, row(id), ['rubro', 'tipo_mantenimiento', 'estado', 'asignado_a', 'activo_id', 'updated_at']);
  assert.equal(row(id).estado, 'nuevo'); assert.equal(row(id).asignado_a, null);
  assert.deepEqual(s.prepare('SELECT * FROM usuarios ORDER BY id').all(), users);
  expect(await call(app.ticket.GET, `/api/tickets/${id}`, { id, rol: 'jefe' }), 403);
  assert.deepEqual(globalThis.__efectosPrueba.map(e => e.usuarioId), [8]);
  assert.equal(globalThis.__efectosPrueba[0].link, `/tickets/${id}?espacio=tecnologia&area=tecnologia`);
  const event = one("SELECT * FROM audit_log WHERE entidad='ticket' AND entidad_id=? AND accion='derivacion'", id);
  assert.equal(event.usuario_id, 2); assert.equal(event.created_at, row(id).updated_at);
  const change = JSON.parse(event.cambios);
  assert.equal(change.antes.espacio, 'general'); assert.equal(change.despues.espacio, 'tecnologia');
  assert.equal(change.motivo, 'ÁREA REPORTADA INCORRECTAMENTE'); assert.equal(change.fechasConservadas.createdAt, original.created_at);
  assert.equal(change.fechasConservadas.vencimientoSla, original.vencimiento_sla); assert.equal(change.fechasConservadas.slaHoras, 8);
  assert.equal(change.antes.otId, null); assert.equal(change.antes.activoId, null);
  audit = count('audit_log');
  expect(await move(id, body(id)), 409, 'Reintento no duplica derivación'); assert.equal(count('audit_log'), audit);
  s.exec("UPDATE usuarios SET especialidad='tecnologia' WHERE id=3");
  expect(await call(app.ticket.GET, `/api/tickets/${id}`, { id, rol: 'tecnico' }), 200);
  const tiList = expect(await call(app.lista.GET, '/api/tickets?espacio=tecnologia', { rol: 'tecnico' }), 200);
  assert(tiList.tickets.some(t => t.id === id));
  s.exec("UPDATE usuarios SET especialidad='general' WHERE id=3");
  for (const asignado_a of [null, 3]) expect(await move(ticket({ asignado_a }), undefined, 'tecnico'), 200);
  id = ticket({ rubro: 'tecnologia' });
  expect(await move(id, body(id, { espacioDestino: 'general', rubroDestino: 'aires' })), 200);
  assert.equal(row(id).rubro, 'aires'); assert.equal(row(id).tipo_mantenimiento, 'general');
  id = ticket(); expect(await move(id, body(id, { espacioDestino: 'biomedico' })), 200);
  assert.equal(row(id).tipo_mantenimiento, 'biomedico');

  // No reclasificar equipo: la autorización explícita deja los IDs anteriores en el evento.
  id = ticket({ activo_id: 1 }); const equipoOriginal = one('SELECT * FROM activos WHERE id=1');
  expect(await move(id), 409); assert.equal(row(id).activo_id, 1);
  expect(await move(id, body(id, { desvincularEquipo: true })), 200);
  assert.equal(row(id).activo_id, null); assert.deepEqual(one('SELECT * FROM activos WHERE id=1'), equipoOriginal);
  const unlink = JSON.parse(one("SELECT cambios FROM audit_log WHERE entidad='ticket' AND entidad_id=? AND accion='derivacion'", id).cambios);
  assert.equal(unlink.antes.activoId, 1); assert.equal(unlink.despues.activoId, null); assert.equal(unlink.desvincularEquipo, true);
  id = ticket({ activo_id: 3 }); expect(await move(id), 200); assert.equal(row(id).activo_id, 3, 'Equipo del destino puede conservarse');

  // La misma OT vacía cambia de bandeja conservando id, código y todas las fechas de trabajo.
  let pair = await conOrden({ activo_id: 1 }), otBefore = one('SELECT * FROM ordenes WHERE id=?', pair.ot), ticketBefore = row(pair.id);
  const orderCount = count('ordenes');
  expect(await move(pair.id, body(pair.id, { desvincularEquipo: true })), 200);
  const otAfter = one('SELECT * FROM ordenes WHERE id=?', pair.ot);
  assert.equal(count('ordenes'), orderCount); assert.equal(row(pair.id).ot_id, pair.ot);
  assert.equal(otAfter.rubro, 'tecnologia'); assert.equal(otAfter.activo_id, null); assert.equal(otAfter.asignado_a, null); assert.equal(otAfter.asignado_en, null);
  unchanged(otBefore, otAfter, ['rubro', 'activo_id', 'asignado_a', 'asignado_en']);
  unchanged(ticketBefore, row(pair.id), ['rubro', 'tipo_mantenimiento', 'estado', 'asignado_a', 'activo_id', 'updated_at']);
  assert.equal(one("SELECT count(*) n FROM audit_log WHERE entidad='orden' AND entidad_id=? AND accion='derivacion'", pair.ot).n, 1);
  const otTrace = JSON.parse(one("SELECT cambios FROM audit_log WHERE entidad='ticket' AND entidad_id=? AND accion='derivacion'", pair.id).cambios).orden;
  assert.equal(otTrace.codigo, otBefore.codigo); assert.equal(otTrace.antes.asignadoA, 3);
  assert.equal(otTrace.fechasConservadas.vencimiento, otBefore.vencimiento);

  for (const estado of ['resuelto', 'cerrado', 'descartado']) expect(await move(ticket({ estado })), 409);
  expect(await move(ticket({ resuelto_en: '2026-01-02T10:00:00Z' })), 409);
  s.exec("INSERT INTO proyectos(id,codigo,titulo,creado_por) VALUES(1,'PRY-PRUEBA','PROYECTO PRUEBA',1)");
  expect(await move(ticket({ proyecto_id: 1 })), 409);
  for (const changes of [
    { estado: 'en_proceso' }, { estado: 'completada' }, { estado: 'cerrada' }, { estado: 'cancelada' },
    { iniciada_en: '2026-01-02T10:00:00Z' }, { trabajos_realizados: 'INSPECCION' }, { horas_trabajadas: 0.5 },
    { tiempo_pausado_min: 1 }, { checklist_ejecucion: '[]' }, { firma_tecnico_nombre: 'TECNICO' },
    { hora_llegada: '2026-01-02T10:00:00Z' }, { proyecto_id: 1 }, { reversa_ejecutada: 1 },
  ]) {
    pair = await conOrden(); set('ordenes', pair.ot, changes); const before = row(pair.id), priorAudit = count('audit_log');
    expect(await move(pair.id), 409); assert.deepEqual(row(pair.id), before); assert.equal(count('audit_log'), priorAudit);
  }
  pair = await conOrden();
  s.prepare('INSERT INTO comentarios(orden_id,usuario_id,texto) VALUES(?,3,?)').run(pair.ot, 'NOTA DE TRABAJO');
  expect(await move(pair.id), 409);
  pair = await conOrden();
  s.prepare("INSERT INTO adjuntos(orden_id,usuario_id,nombre,content_type,tamano,r2_key,categoria) VALUES(?,3,'PRUEBA','image/png',1,'prueba/evidencia','antes')").run(pair.ot);
  expect(await move(pair.id), 409);
  pair = await conOrden(); s.prepare('INSERT INTO orden_verificacion(orden_id) VALUES(?)').run(pair.ot);
  expect(await move(pair.id), 409);
  pair = await conOrden(); ticket({ ot_id: pair.ot }); expect(await move(pair.id), 409, 'No mueve OT compartida por varios tickets');
  pair = await conOrden(); s.prepare("DELETE FROM audit_log WHERE entidad='orden' AND entidad_id=?").run(pair.ot);
  expect(await move(pair.id), 409, 'Sin prueba de origen no se asume que la OT fue generada por el ticket');
  pair = await conOrden(); set('ordenes', pair.ot, { activo_id: 1 }); expect(await move(pair.id), 409);
  pair = await conOrden({}, 2); expect(await move(pair.id, undefined, 'tecnico'), 403);

  // El CAS revalida tanto el usuario como las filas y las evidencias dentro del batch.
  for (const mutate of [
    () => s.exec("UPDATE usuarios SET especialidad='tecnologia' WHERE id=2"),
    () => s.exec("UPDATE usuarios SET activo=0 WHERE id=2"),
    () => s.exec("UPDATE usuarios SET rol='visualizador' WHERE id=2"),
  ]) {
    id = ticket(); const before = row(id), priorAudit = count('audit_log');
    faults.beforeBatch = mutate; expect(await move(id, undefined, 'jefe'), 409);
    assert.deepEqual(row(id), before); assert.equal(count('audit_log'), priorAudit);
    s.exec("UPDATE usuarios SET especialidad='general',rol='jefe',activo=1 WHERE id=2");
  }
  id = ticket(); faults.beforeBatch = () => set('tickets', id, { estado: 'cerrado' });
  expect(await move(id), 409); assert.equal(row(id).estado, 'cerrado');
  id = ticket(); faults.beforeBatch = () => set('tickets', id, { asignado_a: 2 });
  expect(await move(id, undefined, 'tecnico'), 409); assert.equal(row(id).asignado_a, 2);
  id = ticket(); faults.beforeBatch = () => set('tickets', id, { descripcion: 'CORRECCION CONCURRENTE' });
  expect(await move(id), 409); assert.equal(row(id).descripcion, 'CORRECCION CONCURRENTE');
  id = ticket({ activo_id: 1 }); faults.beforeBatch = () => set('activos', 1, { rubro: 'aires' });
  expect(await move(id, body(id, { desvincularEquipo: true })), 409); assert.equal(row(id).activo_id, 1); set('activos', 1, { rubro: 'equipo_general' });
  id = ticket(); faults.beforeBatch = () => set('ubicaciones', 1, { sucursal_id: 2 });
  expect(await move(id), 409); set('ubicaciones', 1, { sucursal_id: 1 });
  pair = await conOrden(); faults.beforeBatch = () => set('ordenes', pair.ot, { horas_trabajadas: 1 });
  expect(await move(pair.id), 409); assert.equal(row(pair.id).rubro, 'equipo_general');
  pair = await conOrden(); faults.beforeBatch = () => s.prepare('INSERT INTO comentarios(orden_id,usuario_id,texto) VALUES(?,3,?)').run(pair.ot, 'EVIDENCIA CONCURRENTE');
  expect(await move(pair.id), 409); assert.equal(row(pair.id).rubro, 'equipo_general');

  // Un solo ganador y un solo evento; una conversión compite por la misma fila.
  id = ticket(); const pending = body(id), beforeAudit = count('audit_log');
  let responses = await Promise.all([move(id, pending), move(id, pending)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]); assert.equal(count('audit_log'), beforeAudit + 1);
  id = ticket(); const beforeOrders = count('ordenes');
  responses = await Promise.all([move(id), call(app.convert.POST, `/api/tickets/${id}/convertir`, { id, method: 'POST', data: { asignadoA: 3 } })]);
  assert.equal(responses.filter(r => r.status === 200 || r.status === 201).length, 1); assert.equal(responses.filter(r => r.status === 409).length, 1);
  assert.equal(count('ordenes'), beforeOrders + (responses[1].status === 201 ? 1 : 0));

  // La escritura de ejecución leyó la OT en General, pero la derivación confirmó
  // antes de su batch. La versión inexistente/estado abierta no bastaban para
  // detectar el cambio de alcance: tampoco debe quedar un control vacío en TI.
  pair = await conOrden();
  let routed;
  faults.beforeBatch = async () => { routed = await move(pair.id, body(pair.id), 'jefe'); };
  expect(await call(app.order.PATCH, `/api/ordenes/${pair.ot}?area=equipo_general`, {
    id: pair.ot, method: 'PATCH', rol: 'tecnico', data: { estado: 'en_proceso' },
  }), 409);
  expect(routed, 200);
  assert.equal(one('SELECT estado FROM ordenes WHERE id=?', pair.ot).estado, 'abierta');
  assert.equal(one('SELECT rubro FROM ordenes WHERE id=?', pair.ot).rubro, 'tecnologia');
  assert.equal(row(pair.id).estado, 'nuevo');
  assert.equal(one('SELECT count(*) n FROM orden_verificacion WHERE orden_id=?', pair.ot).n, 0);
  assert.equal(one('SELECT count(*) n FROM orden_verificacion_eventos WHERE orden_id=?', pair.ot).n, 0);
  // Si el middleware autorizó antes y el manejador lee después, también rechaza
  // al técnico de origen aunque la URL no lleve un filtro de área.
  expect(await call(app.order.PATCH, `/api/ordenes/${pair.ot}`, {
    id: pair.ot, method: 'PATCH', rol: 'tecnico', data: { estado: 'en_proceso' },
  }), 403);
  assert.equal(one('SELECT count(*) n FROM orden_verificacion WHERE orden_id=?', pair.ot).n, 0);

  // En sentido inverso, un inicio ya confirmado impide la derivación pendiente.
  pair = await conOrden();
  let started;
  faults.beforeBatch = async () => {
    started = await call(app.order.PATCH, `/api/ordenes/${pair.ot}?area=equipo_general`, {
      id: pair.ot, method: 'PATCH', rol: 'tecnico', data: { estado: 'en_proceso' },
    });
  };
  expect(await move(pair.id), 409); expect(started, 200);
  assert.equal(one('SELECT estado FROM ordenes WHERE id=?', pair.ot).estado, 'en_proceso');
  assert.equal(row(pair.id).rubro, 'equipo_general');
  assert.equal(one("SELECT count(*) n FROM audit_log WHERE entidad='ticket' AND entidad_id=? AND accion='derivacion'", pair.id).n, 0);

  // El mismo guard protege una reasignación o cambio de referencia concurrente.
  for (const changes of [{ asignado_a: 2 }, { activo_id: 1 }, { sucursal_id: 2 }, { rubro: 'aires' }]) {
    pair = await conOrden();
    faults.beforeBatch = () => set('ordenes', pair.ot, changes);
    expect(await call(app.order.PATCH, `/api/ordenes/${pair.ot}`, { id: pair.ot, method: 'PATCH', rol: 'tecnico', data: { estado: 'en_proceso' } }), 409);
    assert.equal(one('SELECT estado FROM ordenes WHERE id=?', pair.ot).estado, 'abierta');
    assert.equal(one('SELECT count(*) n FROM orden_verificacion WHERE orden_id=?', pair.ot).n, 0);
    assert.equal(one('SELECT count(*) n FROM orden_verificacion_eventos WHERE orden_id=?', pair.ot).n, 0);
  }
  pair = await conOrden();
  faults.beforeBatch = () => s.exec("UPDATE usuarios SET especialidad='tecnologia' WHERE id=3");
  expect(await call(app.order.PATCH, `/api/ordenes/${pair.ot}`, { id: pair.ot, method: 'PATCH', rol: 'tecnico', data: { estado: 'en_proceso' } }), 409);
  assert.equal(one('SELECT count(*) n FROM orden_verificacion WHERE orden_id=?', pair.ot).n, 0);
  s.exec("UPDATE usuarios SET especialidad='general' WHERE id=3");

  for (const failAt of [1, 2, 3]) {
    pair = await conOrden(); const before = row(pair.id), ot = one('SELECT * FROM ordenes WHERE id=?', pair.ot), beforeAudit = count('audit_log');
    const previousRollbacks = faults.rollbackCount, effects = globalThis.__efectosPrueba.length;
    faults.statement = (_sql, index) => index === failAt;
    expect(await move(pair.id), 500);
    assert.deepEqual(row(pair.id), before); assert.deepEqual(one('SELECT * FROM ordenes WHERE id=?', pair.ot), ot);
    assert.equal(count('audit_log'), beforeAudit); assert.equal(faults.rollbackCount, previousRollbacks + 1);
    assert.equal(globalThis.__efectosPrueba.length, effects, 'Ningún aviso antes de confirmar la transacción');
  }
  assert.deepEqual(s.prepare('PRAGMA foreign_key_check').all(), []);
  console.log(`PASS Derivación de tickets (${checks} respuestas): permisos de origen, destino privado, fechas/SLA inalterados, misma OT vacía, bloqueo de trabajo, desvinculación explícita, trazabilidad, CAS, duplicados, rollback y avisos posteriores.`);
} finally { await f.close(); }
