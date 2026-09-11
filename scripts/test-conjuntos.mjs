// Real migrations, authenticated local fixtures and transactional SQLite only.
// No live database, account, notification service or external network is used.
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const originalFetch = globalThis.fetch;
const originalError = console.error;
console.error = (...args) => {
  if (args.some((value) => value instanceof Error && value.message === 'Injected transactional statement failure')) return;
  originalError(...args);
};
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error('Network forbidden in conjuntos tests'); };
let fixture;
try {
  fixture = await setupConjuntos();
  const { app, sqlite, faults, effects, queries, call, ctx } = fixture;
  const one = (sql, ...args) => sqlite.prepare(sql).get(...args);
  const rows = (sql, ...args) => sqlite.prepare(sql).all(...args);
  const json = (value) => JSON.stringify(value);
  const responseLabel = (result) => json({ status: result.status, error: result.body?.error, conjunto: result.body?.conjunto?.id });
  const ok = (result, status = 200) => { assert.equal(result.status, status, responseLabel(result)); return result.body; };
  const fail = (result, status) => {
    assert.equal(result.status, status, responseLabel(result));
    assert.equal(typeof result.body.error, 'string', 'Errors must contain a human-readable string');
  };
  const detail = async (id, options = {}) => ok(await call(app.detail.GET, `/api/conjuntos/${id}`, { id, ...options }));
  const change = async (id, data, options = {}) => call(app.components.POST, `/api/conjuntos/${id}/componentes`, { method: 'POST', id, data, ...options });
  const edit = async (id, data, options = {}) => call(app.detail.PATCH, `/api/conjuntos/${id}`, { method: 'PATCH', id, data, ...options });
  const base = { codigo: 'CONJ-BIO-1', nombre: 'Torre de videolaparoscopía', rubro: 'biomedico', criticidad: 'alta', ubicacionId: 1, motivo: 'Registro inicial de conjunto' };
  const create = async (overrides = {}, options = {}) => call(app.list.POST, '/api/conjuntos', { method: 'POST', data: { ...base, ...overrides }, ...options });
  const snapshots = () => json(['conjuntos', 'conjunto_puestos', 'conjunto_componentes', 'conjunto_eventos', 'orden_conjuntos'].map((table) => rows(`SELECT * FROM ${table} ORDER BY 1`)));

  sqlite.exec(`
    INSERT INTO sucursales(id,nombre) VALUES(1,'Sede de prueba');
    INSERT INTO ubicaciones(id,nombre,sucursal_id) VALUES(1,'Quirófano de prueba',1);
    INSERT INTO activos(id,codigo,nombre,serial,rubro,tipo,estado,criticidad_operacional,ubicacion_id) VALUES
      (1,'CAM-ORIGINAL','Módulo de cámara original','CAM-SERIE-ORIGINAL','biomedico','biomedico','operativo','baja',1),
      (2,'CABEZAL','Cabezal de cámara','CABEZAL-SERIE','biomedico','biomedico','operativo','alta',1),
      (3,'LUZ','Fuente de luz','LUZ-SERIE','biomedico','biomedico','operativo','alta',1),
      (4,'CARRO','Carro de torre','CARRO-SERIE','equipo_general','general','averiado','baja',1),
      (5,'CAM-NUEVA','Módulo de cámara nuevo','CAM-SERIE-NUEVA','biomedico','biomedico','operativo','media',1),
      (6,'BAJA','Componente dado de baja','BAJA-SERIE','biomedico','biomedico','baja','alta',1),
      (7,'REPUESTO','Componente de reserva','RESERVA-SERIE','biomedico','biomedico','operativo','baja',1),
      (8,'OTRO','Otro equipo independiente','OTRO-SERIE','equipo_general','general','operativo','media',1);
    INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha,asignado_a) VALUES
      (1,1,'Plan individual cámara original','mensual','2030-02-01',3),
      (2,5,'Plan individual cámara nueva','trimestral','2030-03-01',2);
    INSERT INTO ordenes(id,titulo,activo_id,creado_por,rubro,sucursal_id) VALUES
      (100,'Orden anterior a la agrupación',1,1,'biomedico',1);
  `);
  const usersBefore = json(rows('SELECT * FROM usuarios ORDER BY id'));
  const plansBefore = json(rows('SELECT * FROM planes_mantenimiento ORDER BY id'));
  fail(await call(app.list.GET, '/api/conjuntos', { rol: null }), 401);
  for (const rol of ['solicitante', 'motorista', 'bodega']) {
    fail(await call(app.list.GET, '/api/conjuntos', { rol }), 403);
    fail(await create({}, { rol }), 403);
  }
  for (const rol of ['tecnico', 'visualizador']) fail(await create({}, { rol }), 403);
  for (const data of [
    { motivo: ' ' }, { motivo: 'ab' }, { motivo: 'x'.repeat(501) },
    { codigo: '' }, { rubro: 'otro' }, { criticidad: 'urgente' }, { ubicacionId: -1 }, { ubicacionId: 999 },
    { creadoPor: 2 }, { createdAt: '1999-01-01T00:00:00.000Z' },
  ]) fail(await create(data), 400);

  const beforeCreateFailure = snapshots();
  faults.statement = (sql) => /insert\s+into\s+["`]?conjunto_eventos/i.test(sql);
  fail(await create(), 500);
  assert.equal(snapshots(), beforeCreateFailure, 'Creation and its first event are atomic');
  const initial = ok(await create(), 201);
  const id = initial.conjunto.id;
  assert.equal(one('SELECT count(*) AS n FROM activos').n, 8, 'A set must not duplicate physical assets');
  let current = await detail(id);
  assert.equal(current.disponibilidad.estado, 'sin_definir');
  assert.equal(current.puestos.length, 0);
  assert.equal(current.eventos.length, 1);
  assert.equal(current.eventos[0].actorNombre, 'Prueba admin');
  assert.equal(current.eventos[0].motivo, base.motivo.toUpperCase());
  assert.equal(one('SELECT creado_por FROM conjuntos WHERE id=?', id).creado_por, 1);
  fail(await create(), 409);
  fail(await create({ codigo: base.codigo.toLowerCase() }), 409);
  for (const rol of ['admin', 'jefe', 'tecnico', 'visualizador']) ok(await call(app.list.GET, '/api/conjuntos', { rol }));
  const secondary = ok(await create({ codigo: 'CONJ-GEN-2', nombre: 'Conjunto secundario', rubro: 'equipo_general', criticidad: 'baja' }, { rol: 'jefe' }), 201).conjunto.id;
  const filtered = ok(await call(app.list.GET, '/api/conjuntos?area=biomedico'));
  assert.deepEqual(filtered.conjuntos.map((row) => row.id), [id]);
  fail(await call(app.list.GET, '/api/conjuntos?area=incorrecta'), 400);
  for (const badId of ['0', '-1', '1.5', 'abc']) fail(await call(app.detail.GET, `/api/conjuntos/${badId}`, { id: badId }), 400);
  fail(await call(app.detail.GET, '/api/conjuntos/999', { id: 999 }), 404);
  for (const fecha of ['ayer', '2025-02-30T12:00:00Z', '2999-01-01T00:00:00Z']) {
    fail(await call(app.detail.GET, `/api/conjuntos/${id}?fecha=${encodeURIComponent(fecha)}`, { id }), 400);
  }
  for (const rol of ['solicitante', 'motorista', 'bodega']) fail(await call(app.detail.GET, `/api/conjuntos/${id}`, { id, rol }), 403);

  const joinData = { accion: 'incorporar', version: current.conjunto.version, activoId: 1, funcion: 'Cámara', esencial: true, motivo: 'Instalación inicial de la cámara' };
  for (const invalid of [
    { motivo: ' ' }, { activoId: 6 }, { activoId: 1.5 }, { version: -1 },
    { funcion: '' }, { esencial: 'sí' },
    { actorId: 1 }, { incorporadoPor: 1 }, { fecha: '1999-01-01T00:00:00.000Z' },
  ]) fail(await change(id, { ...joinData, ...invalid }), 400);
  fail(await change(id, { ...joinData, activoId: 999 }), 404);
  const beforeJoin = Date.now();
  current = ok(await change(id, joinData, { rol: 'jefe' }));
  const afterJoin = Date.now();
  const camera = current.puestos.find((row) => row.funcion === 'CÁMARA');
  assert(camera?.componente);
  assert.equal(camera.componente.activoId, 1);
  const joinedAt = camera.componente.incorporadoEn;
  assert(Date.parse(joinedAt) >= beforeJoin - 1000 && Date.parse(joinedAt) <= afterJoin + 1000, 'Membership time is recorded by the server');
  assert.equal(current.disponibilidad.estado, 'disponible', 'Low component criticality does not mean unavailable');
  assert.equal(current.conjunto.criticidad, 'alta');
  assert.equal(current.historialComponentes[0].incorporadoPorNombre, 'Prueba jefe');
  assert.equal(current.historialComponentes[0].motivoAlta, joinData.motivo.toUpperCase());
  fail(await change(id, { accion: 'reemplazar', version: current.conjunto.version, puestoId: camera.id, activoId: 1, motivo: 'No reemplazar con el mismo equipo' }), 400);
  fail(await change(secondary, { accion: 'retirar', version: (await detail(secondary)).conjunto.version, puestoId: camera.id, motivo: 'No retirar puesto de otro conjunto' }), 400);
  assert.deepEqual(current.planes.map((row) => row.id), [1]);
  assert.equal(current.ordenes.length, 0, 'Existing orders must never be grouped retroactively');
  assert.equal(one('SELECT count(*) AS n FROM orden_conjuntos WHERE orden_id=100').n, 0);

  let other = await detail(secondary);
  fail(await change(secondary, { ...joinData, version: other.conjunto.version }), 409);
  const beforeStale = snapshots();
  fail(await change(id, { ...joinData, activoId: 2, funcion: 'Cabezal' }), 409);
  assert.equal(snapshots(), beforeStale, 'A stale version cannot write a position, relation or event');
  for (const rol of ['tecnico', 'visualizador', 'solicitante']) {
    fail(await change(id, { ...joinData, version: current.conjunto.version, activoId: 2, funcion: 'Cabezal' }, { rol }), 403);
    fail(await edit(id, { version: current.conjunto.version, nombre: 'No permitido', motivo: 'Cambio no autorizado' }, { rol }), 403);
  }

  let result = await call(app.orders.POST, '/api/ordenes', { method: 'POST', data: { titulo: 'Preventivo individual de cámara', activoId: 1, rubro: 'biomedico', sucursalId: 1, tipo: 'preventivo' } });
  const orderId = ok(result, 201).orden.id;
  const orderSnapshot = one('SELECT * FROM orden_conjuntos WHERE orden_id=?', orderId);
  assert.equal(orderSnapshot.conjunto_id, id);
  assert.equal(orderSnapshot.activo_id, 1);
  assert.equal(orderSnapshot.activo_codigo, 'CAM-ORIGINAL');
  assert.equal(orderSnapshot.activo_serial, 'CAM-SERIE-ORIGINAL');
  current = await detail(id);
  assert.deepEqual(current.ordenes.map((row) => row.id), [orderId]);
  const assignedOrderId = ok(await call(app.orders.POST, '/api/ordenes', { method: 'POST', data: { titulo: 'Trabajo propio del técnico', activoId: 1, rubro: 'biomedico', sucursalId: 1, asignadoA: 3 } }), 201).orden.id;
  let technicianView = await detail(id, { rol: 'tecnico' });
  assert.deepEqual(technicianView.ordenes.map((row) => row.id), [assignedOrderId], 'Technicians see only their assigned orders in the set, matching the existing order list');
  assert.deepEqual(technicianView.planes.map((row) => row.id), [1], 'Technicians see only their assigned individual plans');
  const technicianSSR = await app.conjuntos.getConjuntoDetalle(ctx(`/conjuntos/${id}`, { rol: 'tecnico' }), id);
  assert.deepEqual(technicianSSR.ordenes.map((row) => row.id), [assignedOrderId], 'SSR helper enforces the same technician visibility with authenticated context');
  for (const rol of ['admin', 'jefe', 'visualizador']) {
    const view = await detail(id, { rol });
    assert.deepEqual(view.ordenes.map((row) => row.id).sort((a, b) => a - b), [orderId, assignedOrderId]);
  }

  current = ok(await change(id, { accion: 'incorporar', version: current.conjunto.version, activoId: 2, funcion: 'Cabezal', esencial: true, motivo: 'Instalación del cabezal' }));
  const head = current.puestos.find((row) => row.funcion === 'CABEZAL');
  current = ok(await change(id, { accion: 'incorporar', version: current.conjunto.version, activoId: 4, funcion: 'Carro auxiliar', esencial: false, motivo: 'Asignación de mobiliario auxiliar' }));
  assert.equal(current.disponibilidad.estado, 'disponible', 'A broken optional position does not block essential operation');
  assert.equal(one('SELECT rubro FROM activos WHERE id=4').rubro, 'equipo_general', 'Cross-area grouping preserves component area');
  for (const estado of ['averiado', 'mantenimiento', 'baja']) {
    ok(await call(app.assets.PATCH, '/api/activos/2', { method: 'PATCH', id: 2, data: { estado } }));
    current = await detail(id);
    assert.equal(current.disponibilidad.estado, 'no_disponible');
    assert(current.disponibilidad.motivos.length > 0);
  }
  assert.equal(one('SELECT estado FROM activos WHERE id=1').estado, 'operativo', 'An unavailable set cannot change other equipment states');
  ok(await call(app.assets.PATCH, '/api/activos/2', { method: 'PATCH', id: 2, data: { estado: 'operativo' } }));
  current = ok(await change(id, { accion: 'retirar', version: current.conjunto.version, puestoId: head.id, motivo: 'Retiro temporal para revisión' }));
  assert.equal(current.puestos.find((row) => row.id === head.id).componente, null);
  assert.equal(current.disponibilidad.estado, 'no_disponible', 'A vacant essential position prevents availability');
  const headHistory = current.historialComponentes.find((row) => row.activoId === 2);
  assert.equal(headHistory.retiradoPorNombre, 'Prueba admin');
  assert.equal(headHistory.motivoRetiro, 'RETIRO TEMPORAL PARA REVISIÓN');
  current = ok(await change(id, { accion: 'incorporar', version: current.conjunto.version, puestoId: head.id, activoId: 2, funcion: 'Debe conservarse', esencial: false, motivo: 'Reinstalación tras revisión' }));
  assert.equal(current.puestos.find((row) => row.id === head.id).funcion, 'CABEZAL');
  assert.equal(current.puestos.find((row) => row.id === head.id).esencial, true);
  assert.equal(current.disponibilidad.estado, 'disponible');

  ok(await call(app.assets.PATCH, '/api/activos/1', { method: 'PATCH', id: 1, data: { codigo: 'CAM-EDITADA', nombre: 'Nombre actualizado', serial: 'SERIE-ACTUALIZADA' } }));
  current = await detail(id);
  const oldLink = current.historialComponentes.find((row) => row.activoId === 1);
  assert.equal(oldLink.codigo, 'CAM-ORIGINAL');
  assert.equal(oldLink.serial, 'CAM-SERIE-ORIGINAL');
  assert.equal(oldLink.nombre, 'Módulo de cámara original');
  assert.deepEqual(one('SELECT * FROM orden_conjuntos WHERE orden_id=?', orderId), orderSnapshot);

  // The event failure occurs after composition work; D1 must revert all of it.
  let before = snapshots();
  const rollbacksBefore = faults.rollbackCount;
  faults.statement = (sql) => /insert\s+into\s+["`]?conjunto_eventos/i.test(sql);
  result = await change(id, { accion: 'reemplazar', version: current.conjunto.version, puestoId: camera.id, activoId: 5, motivo: 'Sustitución que debe revertirse' });
  assert(result.status >= 400, json(result));
  assert.equal(snapshots(), before, 'Failure writing traceability must roll back replacement and version');
  assert.equal(faults.rollbackCount, rollbacksBefore + 1);

  // A second operation after closing the previous interval is also atomic.
  faults.statement = (sql) => /insert\s+into\s+["`]?conjunto_componentes/i.test(sql);
  result = await change(id, { accion: 'reemplazar', version: current.conjunto.version, puestoId: camera.id, activoId: 5, motivo: 'Otro reemplazo que debe revertirse' });
  assert(result.status >= 400, json(result));
  assert.equal(snapshots(), before, 'Failure adding the replacement must reopen the original interval through rollback');
  assert.equal(faults.rollbackCount, rollbacksBefore + 2);

  // Simulate another successful writer between validation and the batch CAS.
  faults.beforeBatch = async () => ok(await edit(id, { version: current.conjunto.version, descripcion: 'Edición concurrente conservada', motivo: 'Otro usuario guardó antes' }));
  result = await change(id, { accion: 'incorporar', version: current.conjunto.version, activoId: 3, funcion: 'Fuente de luz', esencial: true, motivo: 'Operación con revisión concurrente' });
  fail(result, 409);
  assert.equal(one('SELECT count(*) AS n FROM conjunto_componentes WHERE activo_id=3').n, 0);
  assert.equal(one('SELECT count(*) AS n FROM conjunto_puestos WHERE funcion=?', 'FUENTE DE LUZ').n, 0);
  current = await detail(id);

  // Another set claims a free physical component after this request validated it.
  other = await detail(secondary);
  const mainBeforeRace = current;
  faults.beforeBatch = async () => ok(await change(secondary, { accion: 'incorporar', version: other.conjunto.version, activoId: 7, funcion: 'Reserva', esencial: true, motivo: 'Asignación concurrente en otro conjunto' }));
  result = await change(id, { accion: 'incorporar', version: current.conjunto.version, activoId: 7, funcion: 'Reserva concurrente', esencial: false, motivo: 'Debe rechazar asignación duplicada' });
  fail(result, 409);
  current = await detail(id);
  assert.deepEqual(current, mainBeforeRace, 'A racing assignment must roll back the losing composition, version and event');
  assert.equal(one('SELECT count(*) AS n FROM conjunto_componentes WHERE activo_id=7 AND retirado_en IS NULL').n, 1);

  // A deleted free asset must not turn INSERT ... SELECT into a silent no-op
  // that commits an empty position and a misleading incorporation event.
  const beforeMissingAsset = await detail(id);
  faults.beforeBatch = async () => ok(await call(app.assets.DELETE, '/api/activos/8', { method: 'DELETE', id: 8 }));
  result = await change(id, { accion: 'incorporar', version: current.conjunto.version, activoId: 8, funcion: 'Equipo eliminado concurrentemente', esencial: true, motivo: 'No debe crear incorporación sin equipo' });
  fail(result, 409);
  current = await detail(id);
  assert.deepEqual(current, beforeMissingAsset, 'An asset disappearing during incorporation must roll back position, event and version');

  // The request has already started when a concurrent order is committed. Its
  // snapshot must still fit inside the component interval when the batch wins.
  let concurrentOrderId;
  let sameMillisecondOrders;
  faults.beforeBatch = async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    concurrentOrderId = ok(await call(app.orders.POST, '/api/ordenes', { method: 'POST', data: { titulo: 'Orden justo antes del reemplazo', activoId: 1, rubro: 'biomedico', sucursalId: 1 } }), 201).orden.id;
    // SQLite freezes 'now' throughout a single statement, including triggers.
    sqlite.exec(`INSERT INTO ordenes(titulo,activo_id,creado_por,rubro,sucursal_id) VALUES
      ('Empate milisegundo primero',1,1,'biomedico',1),
      ('Empate milisegundo segundo',1,1,'biomedico',1)`);
    sameMillisecondOrders = rows("SELECT oc.* FROM orden_conjuntos oc JOIN ordenes o ON o.id=oc.orden_id WHERE o.titulo LIKE 'Empate milisegundo%' ORDER BY o.id");
    assert.equal(sameMillisecondOrders.length, 2);
    assert.equal(sameMillisecondOrders[0].fecha, sameMillisecondOrders[1].fecha, 'The fixture forces orders into exactly the same millisecond');
  };
  current = ok(await change(id, { accion: 'reemplazar', version: current.conjunto.version, puestoId: camera.id, activoId: 5, motivo: 'Reemplazo definitivo por daño en módulo' }, { rol: 'jefe' }));
  assert.equal(current.puestos.find((row) => row.id === camera.id).componente.activoId, 5);
  const originalHistory = current.historialComponentes.find((row) => row.activoId === 1);
  const newHistory = current.historialComponentes.find((row) => row.activoId === 5);
  assert.equal(originalHistory.retiradoEn, newHistory.incorporadoEn, 'Replacement closes and opens intervals at the same instant');
  const concurrentSnapshot = one('SELECT * FROM orden_conjuntos WHERE orden_id=?', concurrentOrderId);
  assert.equal(current.ordenes.find((row) => row.id === concurrentOrderId).vinculadaEn, concurrentSnapshot.fecha, 'The order view exposes its immutable grouping time');
  for (const snapshot of [concurrentSnapshot, ...sameMillisecondOrders]) {
    assert(snapshot.fecha >= originalHistory.incorporadoEn, 'Order timestamps cannot precede their membership');
    assert(snapshot.fecha < originalHistory.retiradoEn, 'An order committed before replacement must remain inside the old interval, even within the same millisecond');
    const whenOrderWasCreated = await app.conjuntos.getConjuntoDetalle(ctx(`/conjuntos/${id}`), id, snapshot.fecha);
    assert.equal(whenOrderWasCreated.puestos.find((row) => row.id === camera.id).componente.activoId, 1);
  }
  assert.equal(originalHistory.retiradoPorNombre, 'Prueba jefe');
  assert.equal(newHistory.incorporadoPorNombre, 'Prueba jefe');
  assert.equal(originalHistory.motivoRetiro, 'REEMPLAZO DEFINITIVO POR DAÑO EN MÓDULO');
  assert.equal(newHistory.motivoAlta, 'REEMPLAZO DEFINITIVO POR DAÑO EN MÓDULO');
  const replacementEvent = current.eventos.find((event) => event.motivo === 'REEMPLAZO DEFINITIVO POR DAÑO EN MÓDULO');
  assert.equal(replacementEvent.actorNombre, 'Prueba jefe');
  assert(replacementEvent.antes && typeof replacementEvent.antes === 'object');
  assert(replacementEvent.despues && typeof replacementEvent.despues === 'object');
  assert(json(replacementEvent.antes).includes('CAM-ORIGINAL'));
  assert(json(replacementEvent.despues).includes('CAM-NUEVA'));
  assert.equal(json(rows('SELECT * FROM planes_mantenimiento ORDER BY id')), plansBefore, 'Individual plans are never transferred or duplicated');
  assert.deepEqual(current.planes.map((row) => row.id), [2]);
  technicianView = await detail(id, { rol: 'tecnico' });
  assert.deepEqual(technicianView.planes, [], 'Replacement does not reveal or transfer another technician’s plan');
  assert.deepEqual(technicianView.ordenes.map((row) => row.id), [assignedOrderId], 'Their historical order remains visible after the component replacement');
  assert.deepEqual(one('SELECT * FROM orden_conjuntos WHERE orden_id=?', orderId), orderSnapshot);
  assert.equal(current.ordenes.find((row) => row.id === orderId).activoId, 1, 'The order stays with its original physical equipment');
  const historic = await app.conjuntos.getConjuntoDetalle(ctx(`/conjuntos/${id}`), id, joinedAt);
  assert.equal(historic.puestos.find((row) => row.id === camera.id).componente.activoId, 1);
  assert.deepEqual(historic.puestos.map((row) => row.id), [camera.id], 'Positions created later must not appear in an earlier composition');
  assert(!historic.planes?.length, 'Historical composition must not present current planning as historical');
  assert(!historic.disponibilidad, 'Current equipment status cannot be represented as historical availability');
  const boundary = await app.conjuntos.getConjuntoDetalle(ctx(`/conjuntos/${id}`), id, newHistory.incorporadoEn);
  assert.equal(boundary.puestos.find((row) => row.id === camera.id).componente.activoId, 5, 'Intervals are inclusive at joining and exclusive at removal');

  // Direct SQL assertions exercise the deployed triggers, beyond API guards.
  const rejected = [
    ['DELETE FROM conjuntos WHERE id=?', id],
    ['DELETE FROM conjunto_puestos WHERE id=?', camera.id],
    ['DELETE FROM conjunto_componentes WHERE id=?', originalHistory.id],
    ['UPDATE conjunto_componentes SET motivo_retiro=? WHERE id=?', 'Falsificación', originalHistory.id],
    ['UPDATE conjunto_componentes SET activo_id=? WHERE id=?', 3, newHistory.id],
    ['DELETE FROM conjunto_eventos WHERE conjunto_id=?', id],
    ['UPDATE conjunto_eventos SET motivo=? WHERE conjunto_id=?', 'Falsificación', id],
    ['DELETE FROM orden_conjuntos WHERE orden_id=?', orderId],
    ['UPDATE orden_conjuntos SET activo_id=? WHERE orden_id=?', 5, orderId],
    ['DELETE FROM ordenes WHERE id=?', orderId],
    ['UPDATE ordenes SET activo_id=? WHERE id=?', 5, orderId],
    ['DELETE FROM activos WHERE id=?', 1],
  ];
  for (const [query, ...args] of rejected) assert.throws(() => sqlite.prepare(query).run(...args), undefined, query);
  assert.throws(() => sqlite.prepare(`INSERT INTO conjunto_componentes(puesto_id,activo_id,incorporado_en,incorporado_por,motivo_alta,activo_codigo,activo_nombre,activo_serial,incorporado_por_nombre)
    SELECT puesto_id,activo_id,incorporado_en,incorporado_por,motivo_alta,activo_codigo,activo_nombre,activo_serial,incorporado_por_nombre FROM conjunto_componentes WHERE id=?`).run(newHistory.id), /UNIQUE/);
  fail(await call(app.assets.DELETE, '/api/activos/1', { method: 'DELETE', id: 1 }), 409);
  sqlite.prepare('INSERT INTO adjuntos(orden_id,usuario_id,nombre,content_type,tamano,r2_key) VALUES(?,?,?,?,?,?)').run(orderId, 1, 'Prueba.txt', 'text/plain', 10, 'isolated-test-attachment');
  sqlite.prepare('INSERT INTO comentarios(orden_id,usuario_id,texto) VALUES(?,?,?)').run(orderId, 1, 'Historia clínica técnica de prueba');
  const beforeOrderRead = queries.length;
  faults.enforceColumnLimit = true;
  const orderRead = ok(await call(app.order.GET, `/api/ordenes/${assignedOrderId}`, { id: assignedOrderId }));
  const orderQueryReads = queries.slice(beforeOrderRead);
  assert(orderQueryReads.every((query) => query.columns.length <= 100), 'Every authenticated order query must stay within the D1 column projection limit');
  assert(orderQueryReads.filter((query) => /join\s+["`]?usuarios/i.test(query.sql)).every((query) => !query.columns.includes('password_hash')), 'Related-user projections must not retrieve password hashes');
  assert.equal(orderRead.orden.activo.id, 1);
  assert.deepEqual(Object.keys(orderRead.orden.activo).sort(), ['codigo', 'id', 'nombre']);
  assert.deepEqual(Object.keys(orderRead.orden.asignado).sort(), ['id', 'nombre']);
  const commentedRead = ok(await call(app.order.GET, `/api/ordenes/${orderId}`, { id: orderId }));
  assert.equal(commentedRead.comentarios.length, 1);
  assert.deepEqual(Object.keys(commentedRead.comentarios[0].autor).sort(), ['id', 'nombre']);
  assert.equal(json(commentedRead).includes('passwordHash'), false);
  assert.equal(json(commentedRead).includes('password_hash'), false);
  assert.equal(commentedRead.adjuntos.length, 1);
  const linkedBefore = json([rows('SELECT * FROM adjuntos'), rows('SELECT * FROM comentarios'), rows('SELECT * FROM ordenes ORDER BY id')]);
  for (const rol of [null, 'tecnico']) {
    const expected = rol ? 403 : 401;
    assert.equal((await call(app.order.DELETE, `/api/ordenes/${orderId}`, { method: 'DELETE', id: orderId, rol })).status, expected);
    assert.equal((await call(app.bulkOrderDelete.POST, '/api/ordenes/bulk-delete', { method: 'POST', data: { ids: [orderId, 100] }, rol })).status, expected);
  }
  fail(await call(app.order.DELETE, `/api/ordenes/${orderId}`, { method: 'DELETE', id: orderId }), 409);
  fail(await call(app.bulkOrderDelete.POST, '/api/ordenes/bulk-delete', { method: 'POST', data: { ids: [orderId, 100] } }), 409);
  assert.equal(json([rows('SELECT * FROM adjuntos'), rows('SELECT * FROM comentarios'), rows('SELECT * FROM ordenes ORDER BY id')]), linkedBefore, 'Rejected single or bulk deletion must leave every related row untouched');
  assert.equal(effects.r2Deletes, 0, 'Rejected deletion must stop before deleting R2 attachments');
  fail(await call(app.order.PATCH, `/api/ordenes/${orderId}`, { method: 'PATCH', id: orderId, data: { activoId: 5 } }), 409);
  ok(await call(app.order.PATCH, `/api/ordenes/${orderId}`, { method: 'PATCH', id: orderId, data: { estado: 'cancelada' } }));
  assert.deepEqual(one('SELECT * FROM orden_conjuntos WHERE orden_id=?', orderId), orderSnapshot, 'Cancellation preserves the immutable order snapshot');

  // The first writer establishes the order's immutable physical identity after
  // the losing PATCH has checked for an existing set relationship.
  const raceOrder = ok(await call(app.orders.POST, '/api/ordenes', { method: 'POST', data: { titulo: 'Orden con asignación concurrente', rubro: 'biomedico', sucursalId: 1 } }), 201).orden.id;
  faults.beforeStatement = {
    matches: (sql) => /^update\s+["`]?ordenes["`]?\s/i.test(sql),
    run: async () => ok(await call(app.order.PATCH, `/api/ordenes/${raceOrder}`, { method: 'PATCH', id: raceOrder, data: { activoId: 5 } })),
  };
  fail(await call(app.order.PATCH, `/api/ordenes/${raceOrder}`, { method: 'PATCH', id: raceOrder, data: { activoId: 2 } }), 409);
  assert.equal(one('SELECT activo_id FROM ordenes WHERE id=?', raceOrder).activo_id, 5);
  assert.equal(one('SELECT activo_id FROM orden_conjuntos WHERE orden_id=?', raceOrder).activo_id, 5);

  // Asset deletion must also handle a membership established after its check.
  const otherForAssetRace = await detail(secondary);
  faults.beforeStatement = {
    matches: (sql) => /^delete\s+from\s+["`]?activos["`]?\s/i.test(sql),
    run: async () => ok(await change(secondary, { accion: 'incorporar', version: otherForAssetRace.conjunto.version, activoId: 3, funcion: 'Fuente de luz', esencial: true, motivo: 'Incorporación durante solicitud de borrado' })),
  };
  fail(await call(app.assets.DELETE, '/api/activos/3', { method: 'DELETE', id: 3 }), 409);
  assert(one('SELECT id FROM activos WHERE id=3'));
  assert.equal(one('SELECT count(*) AS n FROM conjunto_componentes WHERE activo_id=3 AND retirado_en IS NULL').n, 1);

  // A traced assignment may race a deletion after its preflight check. The
  // deployed trigger rejects DELETE and the transaction restores FK cleanup.
  for (const bulk of [false, true]) {
    const candidate = ok(await call(app.orders.POST, '/api/ordenes', { method: 'POST', data: { titulo: 'Orden pendiente de equipo', rubro: 'biomedico', sucursalId: 1 } }), 201).orden.id;
    sqlite.prepare('INSERT INTO tickets(tracking_token,solicitante_nombre,solicitante_email,asunto,descripcion,ot_id,rubro) VALUES(?,?,?,?,?,?,?)').run(`isolated-${candidate}`, 'Prueba', 'test@example.invalid', 'Solicitud vinculada', 'Conservar su enlace', candidate, 'biomedico');
    sqlite.prepare('INSERT INTO adjuntos(orden_id,usuario_id,nombre,content_type,tamano,r2_key) VALUES(?,?,?,?,?,?)').run(candidate, 1, 'Prueba.txt', 'text/plain', 10, `isolated-${candidate}`);
    const ticketId = one('SELECT id FROM tickets WHERE ot_id=?', candidate).id;
    faults.beforeBatch = async () => ok(await call(app.order.PATCH, `/api/ordenes/${candidate}`, { method: 'PATCH', id: candidate, data: { activoId: 5 } }));
    const removal = bulk
      ? await call(app.bulkOrderDelete.POST, '/api/ordenes/bulk-delete', { method: 'POST', data: { ids: [candidate, 100] } })
      : await call(app.order.DELETE, `/api/ordenes/${candidate}`, { method: 'DELETE', id: candidate });
    fail(removal, 409);
    assert.equal(one('SELECT ot_id FROM tickets WHERE id=?', ticketId).ot_id, candidate);
    assert(one('SELECT id FROM ordenes WHERE id=?', candidate));
    assert(one('SELECT id FROM ordenes WHERE id=100'));
    assert(one('SELECT id FROM adjuntos WHERE orden_id=?', candidate));
    assert.equal(one('SELECT activo_id FROM orden_conjuntos WHERE orden_id=?', candidate).activo_id, 5, 'Assigning equipment to an unlinked order captures its current set');
    assert.equal(effects.r2Deletes, 0);
  }

  before = snapshots();
  fail(await edit(id, { version: current.conjunto.version, activo: false, motivo: 'Archivo con componentes activos' }), 409);
  assert.equal(snapshots(), before);
  for (const invalid of [
    { codigo: 'CODIGO-CAMBIADO' }, { rubro: 'equipo_general' }, { actorId: 2 }, { fecha: '1999-01-01T00:00:00.000Z' },
  ]) fail(await edit(id, { version: current.conjunto.version, nombre: 'Nombre no guardado', motivo: 'No se modifica identidad ni autor', ...invalid }), 400);
  faults.statement = (sql) => /insert\s+into\s+["`]?conjunto_eventos/i.test(sql);
  fail(await edit(id, { version: current.conjunto.version, nombre: 'Edición sin evento no válida', motivo: 'Debe revertirse todo' }), 500);
  assert.equal(snapshots(), before, 'Editing metadata without its traceability event must roll back');
  current = ok(await edit(id, { version: current.conjunto.version, nombre: 'Torre principal', criticidad: 'media', motivo: 'Identificación y evaluación actualizadas' }));
  assert.equal(current.conjunto.nombre, 'TORRE PRINCIPAL');
  assert.equal(current.conjunto.criticidad, 'media');
  for (const position of current.puestos.filter((row) => row.componente)) {
    current = ok(await change(id, { accion: 'retirar', version: current.conjunto.version, puestoId: position.id, motivo: 'Desmontaje documentado para archivo' }));
  }
  const historyCount = current.historialComponentes.length;
  current = ok(await edit(id, { version: current.conjunto.version, activo: false, motivo: 'Archivo de conjunto desinstalado' }));
  assert.equal(current.conjunto.activo, false);
  assert.equal(current.historialComponentes.length, historyCount);
  assert(current.eventos.some((event) => event.motivo === 'ARCHIVO DE CONJUNTO DESINSTALADO'));
  fail(await change(id, { accion: 'incorporar', version: current.conjunto.version, activoId: 7, funcion: 'Reserva', esencial: true, motivo: 'No debe ocupar un conjunto archivado' }), 409);
  assert.equal(json(rows('SELECT * FROM usuarios ORDER BY id')), usersBefore, 'All user accounts remain unchanged');
  assert.equal(json(rows('SELECT * FROM planes_mantenimiento ORDER BY id')), plansBefore);
  assert.deepEqual(rows('PRAGMA foreign_key_check'), []);
  assert.equal(networkCalls, 0);
  assert(queries.every((query) => query.columns.length <= 100), 'All exercised application queries remain within D1 column limits');
  assert(faults.batchCount > 0, 'Writes must use transactional D1 batches');
  console.log(`PASS: conjuntos (${fixture.requests} authenticated API requests; ${fixture.migrations.length} real migrations). Composition intervals, actor/reason/time, identity snapshots, per-equipment plans, retained order context, availability, permissions, stale revisions, transactional rollback, archive and deletion guards. No network or email.`);
} finally {
  globalThis.fetch = originalFetch;
  console.error = originalError;
  if (fixture) await fixture.close();
}
