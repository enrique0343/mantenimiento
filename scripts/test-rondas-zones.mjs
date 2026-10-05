// Real handlers and transactional SQLite; fixtures only, with all network effects forbidden.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { setup, root } from './test-support/sqlite-app.mjs';

let checks = 0;
let networkCalls = 0;
const failures = [];
let monthlyQueryBudget;
let inspectionQueryBudget;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { networkCalls++; throw new Error('Network forbidden in zone integration tests'); };
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const point = (code, extra = {}) => ({
  code, group: 'infraestructura', label: `Control ${code}`, criterion: 'Funcionamiento sin anomalías observado',
  active: true, frequency: 'diaria', firstDate: '2026-10-01', evidencePolicy: 'none', assetId: null, ...extra,
});
const config = (extra = {}) => ({
  effectiveFrom: '2026-10-01', name: 'Ronda local', siteId: 1, shift: 'diurno', timezoneOffset: '-06:00',
  time: '08:00', windowMinutes: 60, ownerId: 2, reviewerId: 3, reason: 'Configuración de prueba aislada',
  points: [point('puerta')], notifications: { recipientIds: [], events: [] }, ...extra,
});
const zoneBody = (extra = {}) => ({ name: 'Zona local', siteId: 1, locationIds: [2, 1], reason: 'Agrupación de prueba aislada', ...extra });
const approval = { action: 'approve', reason: 'Hallazgo revisado en prueba aislada', priority: 'media', dueAt: '2026-10-08T16:00:00Z', assignedTo: 2 };

async function fixture() {
  const { api, sqlite, ctx, close } = await setup({ modules: { rounds: 'api/rondas/[...path].ts' } });
  let beforeBatch = null;
  const queries = { first: 0, all: 0, run: 0 };
  function statement(sql, args = []) {
    const s = sqlite.prepare(sql);
    return {
      sql, bind(...values) { return statement(sql, values); },
      async all() { queries.all++; return { results: s.all(...args), success: true }; },
      async first() { queries.first++; return s.get(...args) ?? null; },
      async run() { queries.run++; return { success: true, meta: s.run(...args) }; },
    };
  }
  const DB = {
    prepare: sql => statement(sql),
    async batch(statements) {
      if (beforeBatch) await beforeBatch(statements);
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const s of statements) results.push(await s.all());
        sqlite.exec('COMMIT'); return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  async function call(path, { userId = 1, rol = 'admin', data, method = data ? 'POST' : 'GET', authenticated = true } = {}) {
    const c = ctx(`/api/rondas${path}`, { method, data });
    c.testUser = authenticated ? { id: userId, nombre: `Local user ${userId}`, rol } : null;
    c.locals.runtime.env.DB = DB;
    const response = await api.rounds[method](c);
    const text = await response.text();
    let body; try { body = JSON.parse(text); } catch { body = { text }; }
    return { ...body, httpStatus: response.status };
  }
  sqlite.exec(await fs.readFile(`${root}/migrations/0051_rondas.sql`, 'utf8'));
  sqlite.exec(await fs.readFile(`${root}/migrations/0053_rondas_zonas.sql`, 'utf8'));
  sqlite.exec(`
    INSERT INTO usuarios(id,nombre,email,password_hash,rol) VALUES
      (2,'Inspector local','inspector@example.invalid','isolated','tecnico'),
      (3,'Jefe local','jefe@example.invalid','isolated','jefe'),
      (4,'Consulta local','consulta@example.invalid','isolated','visualizador');
    INSERT INTO sucursales(id,nombre,activa) VALUES(1,'Sede local',1),(2,'Otra sede local',1),(3,'Sede inactiva',0);
    INSERT INTO ubicaciones(id,nombre,sucursal_id,padre_id,activa) VALUES
      (1,'Sala local A',1,NULL,1),(2,'Sala local B',1,NULL,1),(3,'Anexo de A',1,1,1),
      (4,'Sala otra sede',2,NULL,1),(5,'Sala local C',1,NULL,1),(6,'Sala inactiva',1,NULL,0),(7,'Sala sede inactiva',3,NULL,1);
    INSERT INTO activos(id,codigo,nombre,ubicacion_id,rubro) VALUES
      (1,'LOCAL-A','Equipo local A',1,'aires'),(2,'LOCAL-B','Equipo local B',2,'aires'),
      (3,'LOCAL-ANEXO','Equipo anexo excluido',3,'aires'),(4,'LOCAL-C','Equipo local C',5,'aires');
    INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha,asignado_a) VALUES
      (1,1,'Plan local A','trimestral','2027-01-09',2),(2,2,'Plan local B','anual','2027-06-17',2);
  `);
  const all = (sql, ...args) => sqlite.prepare(sql).all(...args).map(row => ({ ...row }));
  const get = (sql, ...args) => { const row = sqlite.prepare(sql).get(...args); return row ? { ...row } : undefined; };
  const preservedTables = ['ubicaciones', 'sucursales', 'activos', 'planes_mantenimiento', 'planes_vehiculo', 'extintores'];
  const preserved = () => Object.fromEntries(preservedTables.map(table => [table, all(`SELECT * FROM ${table} ORDER BY id`)]));
  const initial = preserved();
  const zoneTables = () => all("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rondas_zone%' ORDER BY name").map(row => row.name);
  const zoneState = () => Object.fromEntries(zoneTables().map(table => [table, all(`SELECT * FROM ${table} ORDER BY rowid`)]));
  const versionsTable = () => zoneTables().find(name => /versions$/.test(name));
  const createZone = async (extra = {}, actor = {}) => {
    const result = await call('/zones', { ...actor, data: zoneBody(extra) });
    eq(result.httpStatus, 201, JSON.stringify(result)); return result.zone;
  };
  const createTemplate = async c => {
    const result = await call('/templates', { data: c });
    eq(result.httpStatus, 201, JSON.stringify(result)); return result.template;
  };
  const generate = async (templateId, dateFrom = '2026-10-01', dateTo = dateFrom) => {
    const result = await call('/generate', { data: { templateId, dateFrom, dateTo } });
    eq(result.httpStatus, 200, JSON.stringify(result)); return result.executions;
  };
  const detail = async id => {
    const result = await call(`/executions/${id}`);
    eq(result.httpStatus, 200, JSON.stringify(result)); return result;
  };
  const save = async (id, pointId, extra = {}) => call(`/executions/${id}/action`, {
    userId: 2, rol: 'tecnico', data: { action: 'save', expectedRevision: get('SELECT revision FROM rondas_executions WHERE id=?', id).revision, pointId, result: 'conforme', ...extra },
  });
  return { sqlite, call, all, get, close, createZone, createTemplate, generate, detail, save,
    preserved, initial, zoneState, versionsTable, beforeBatch(fn) { beforeBatch = fn; },
    resetQueryCount() { queries.first = 0; queries.all = 0; queries.run = 0; },
    queryCount() { return { ...queries, total: queries.first + queries.all + queries.run }; } };
}

async function scenario(name, run) {
  const f = await fixture();
  try {
    await run(f);
    eq(f.preserved(), f.initial, `${name}: all original locations/equipment and PM calendars unchanged`);
    eq(f.all('PRAGMA foreign_key_check'), [], `${name}: valid foreign keys`);
  } catch (error) {
    failures.push(new Error(`${name}: ${error.message}`, { cause: error }));
  } finally { await f.close(); }
}
async function storageFailure(call) {
  const original = console.error; console.error = () => {};
  try { return await call(); } finally { console.error = original; }
}
async function approvedZonePreventive(f) {
  f.sqlite.exec(`
    INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha,asignado_a) VALUES
      (3,3,'Plan local de alcance','mensual','2026-09-01',2);
    INSERT INTO ordenes(id,titulo,tipo,estado,activo_id,plan_id,sucursal_id,ubicacion_id,asignado_a,creado_por,created_at,completada_en,verificado_por,verificado_en,trabajos_realizados,verificacion_notas) VALUES
      (99,'Servicio previo local verificado','preventivo','cerrada',3,3,1,3,2,1,'2026-08-01T12:00:00Z','2026-08-01T12:00:00Z',3,'2026-08-02T12:00:00Z','Trabajo local documentado','Revisión local independiente');
  `);
  const originalPlan = f.get('SELECT * FROM planes_mantenimiento WHERE id=3');
  f.initial.planes_mantenimiento.push(originalPlan);
  const zone = await f.createZone({ name: 'Zona local para PM vinculado', locationIds: [3] });
  const template = await f.createTemplate(config({ zoneId: zone.id, points: [point('equipo', { locationId: 3, assetId: 3 })] }));
  const id = (await f.generate(template.id))[0].id;
  eq((await f.save(id, 'equipo@3')).httpStatus, 200, 'Inspection creates the required verified overdue PM request');
  const proposal = f.get("SELECT * FROM rondas_proposals WHERE kind='preventivo'"); ok(proposal);
  const decision = await f.call(`/proposals/${proposal.id}/decision`, { userId: 3, rol: 'jefe', data: approval });
  eq(decision.httpStatus, 200, JSON.stringify(decision));
  eq(f.get('SELECT tipo,estado,sucursal_id,ubicacion_id FROM ordenes WHERE id=?', decision.orderId), { tipo: 'preventivo', estado: 'abierta', sucursal_id: 1, ubicacion_id: 3 });
  const afterPlan = f.get('SELECT * FROM planes_mantenimiento WHERE id=3');
  eq({ ...afterPlan, ultima_generacion: originalPlan.ultima_generacion }, originalPlan, 'Only the approved OT generation timestamp may change in the fixture plan');
  f.initial.planes_mantenimiento[f.initial.planes_mantenimiento.findIndex(plan => plan.id === 3)] = afterPlan;
  const state = () => ({
    execution: f.get('SELECT * FROM rondas_executions WHERE id=?', id),
    events: f.all('SELECT * FROM rondas_events WHERE execution_id=? ORDER BY id', id),
    proposals: f.all('SELECT * FROM rondas_proposals ORDER BY id'),
    proposalLinks: f.all('SELECT * FROM rondas_proposal_links ORDER BY rowid'),
    orderLinks: f.all('SELECT * FROM rondas_order_links ORDER BY rowid'),
    notifications: f.all('SELECT * FROM rondas_notifications ORDER BY id'),
  });
  return { id, orderId: decision.orderId, state };
}

try {
  await scenario('roles and membership validation', async f => {
    eq((await f.call('/zones', { authenticated: false })).httpStatus, 401, 'Zone catalogue requires authentication');
    for (const rol of ['tecnico', 'visualizador']) {
      eq((await f.call('/zones', { userId: rol === 'tecnico' ? 2 : 4, rol, data: zoneBody() })).httpStatus, 403, `${rol} cannot create a zone`);
    }
    for (const body of [
      { locationIds: [] }, { locationIds: [1, 1] }, { locationIds: [1, 4] }, { locationIds: [6] },
      { locationIds: [999] }, { locationIds: [0] }, { locationIds: [1.5] }, { locationIds: ['1'] },
      { siteId: 3, locationIds: [7] }, { name: '' }, { reason: '' },
    ]) eq((await f.call('/zones', { data: zoneBody(body) })).httpStatus, 400, `Invalid membership rejected: ${JSON.stringify(body)}`);
    const first = await f.createZone();
    eq(first.version, 1); eq(first.locations.map(location => location.id), [2, 1], 'Membership preserves requested visit order');
    eq(first.locations.map(location => location.nombre), ['Sala local B', 'Sala local A']);
    const second = await f.createZone({ name: 'Zona anexo', locationIds: [3] }, { userId: 3, rol: 'jefe' });
    ok(second.id !== first.id, 'Jefe may create zones');
    const beforeConflict = f.zoneState();
    eq((await f.call('/zones', { data: zoneBody({ locationIds: [5, 1] }) })).httpStatus, 409, 'One location belongs to only one current zone');
    eq(f.zoneState(), beforeConflict, 'Conflicting membership cannot leave an empty zone or partial members/version');
    const listed = await f.call('/zones', { userId: 2, rol: 'tecnico' });
    eq(listed.httpStatus, 200); eq(listed.zones.length, 2);
    const catalog = await f.call('/catalog');
    eq(catalog.httpStatus, 200); eq(catalog.zones.find(zone => zone.id === first.id).locations.map(location => location.id), [2, 1]);
    eq(catalog.locations.length, 6, 'Zones do not replace or remove original active locations');
    eq((await f.call(`/zones/${first.id}/delete`, { data: {} })).httpStatus, 404, 'No destructive zone API');
  });

  await scenario('versions and exclusive reassignment', async f => {
    const zone = await f.createZone();
    const versions = f.versionsTable(); ok(versions, 'Zone version history exists');
    const published = f.all(`SELECT * FROM ${versions} ORDER BY id`);
    for (const rol of ['tecnico', 'visualizador']) {
      eq((await f.call(`/zones/${zone.id}/version`, { userId: rol === 'tecnico' ? 2 : 4, rol, data: zoneBody({ expectedVersion: 1, locationIds: [5] }) })).httpStatus, 403, `${rol} cannot edit zone membership`);
    }
    let result = await f.call(`/zones/${zone.id}/version`, { userId: 3, rol: 'jefe', data: zoneBody({ name: 'Zona revisada', expectedVersion: 1, locationIds: [5, 2] }) });
    eq(result.httpStatus, 200, JSON.stringify(result)); eq(result.zone.version, 2); eq(result.zone.locations.map(location => location.id), [5, 2]);
    eq(f.all(`SELECT * FROM ${versions} ORDER BY id`).slice(0, published.length), published, 'Published membership remains unchanged');
    const after = f.zoneState();
    result = await f.call(`/zones/${zone.id}/version`, { data: zoneBody({ expectedVersion: 1, locationIds: [1] }) });
    eq(result.httpStatus, 409, 'Stale zone editor rejected'); eq(f.zoneState(), after, 'Stale edit leaves all zone rows unchanged');
    const next = await f.createZone({ name: 'Nueva zona A', locationIds: [1] });
    eq(next.locations.map(location => location.id), [1], 'Removing a member permits explicit reassignment to another zone');
    const afterReassignment = f.zoneState();
    eq((await f.call(`/zones/${zone.id}/version`, { data: zoneBody({ expectedVersion: 2, locationIds: [1, 2] }) })).httpStatus, 409, 'Cannot take a current member from another zone');
    eq(f.zoneState(), afterReassignment, 'Failed reassignment is atomic');
    assert.throws(() => f.sqlite.exec(`UPDATE ${versions} SET reason='Changed history'`), /immutable/i); checks++;
    assert.throws(() => f.sqlite.exec(`DELETE FROM ${versions}`), /immutable/i); checks++;
  });

  await scenario('empty edit releases a sole member safely', async f => {
    const zone = await f.createZone({ name: 'Zona A original', locationIds: [1] });
    const template = await f.createTemplate(config({ zoneId: zone.id }));
    const id = (await f.generate(template.id))[0].id;
    const originalSnapshot = f.get('SELECT snapshot_json,data_json FROM rondas_executions WHERE id=?', id);
    const originalHistory = f.all(`SELECT * FROM ${f.versionsTable()} ORDER BY id`);
    const cleared = await f.call(`/zones/${zone.id}/version`, { data: zoneBody({ name: 'Zona sin ubicaciones actuales', locationIds: [], expectedVersion: 1, reason: 'Retirar la única ubicación para reasignarla' }) });
    eq(cleared.httpStatus, 200, JSON.stringify(cleared)); eq(cleared.zone.version, 2); eq(cleared.zone.locations, []);
    eq(f.all(`SELECT * FROM ${f.versionsTable()} ORDER BY id`).slice(0, 1), originalHistory, 'Empty current membership preserves the published nonempty historical version');
    const next = await f.createZone({ name: 'Zona A nueva', locationIds: [1] }); eq(next.locations.map(location => location.id), [1], 'Last member can be explicitly reassigned without deleting its old zone');
    eq((await f.call('/templates', { data: config({ zoneId: zone.id }) })).httpStatus, 400, 'An empty current zone cannot start a new template');
    eq((await f.call('/generate', { data: { templateId: template.id, dateFrom: '2026-10-02', dateTo: '2026-10-02' } })).httpStatus, 409, 'An emptied zone requires template refresh before new generation');
    eq((await f.generate(template.id)).map(execution => execution.id), [id], 'Existing historical date remains idempotently readable');
    const historical = await f.detail(id);
    eq(historical.points.map(p => p.locationId), [1]); eq(historical.equipment.map(asset => asset.id), [1]);
    eq(f.get('SELECT snapshot_json,data_json FROM rondas_executions WHERE id=?', id), originalSnapshot, 'Retiring/reassigning the last location never changes prior execution scope');
    const listed = await f.call('/zones'); eq(listed.zones.find(item => item.id === zone.id).locations, [], 'The old zone remains visible with an empty current membership');
  });

  await scenario('stale edit race', async f => {
    const zone = await f.createZone();
    let winner;
    f.beforeBatch(async statements => {
      if (!statements.some(s => /UPDATE rondas_zones SET/.test(s.sql))) return;
      f.beforeBatch(null);
      winner = await f.call(`/zones/${zone.id}/version`, { data: zoneBody({ name: 'Concurrent winner', expectedVersion: 1, locationIds: [5, 2] }) });
      eq(winner.httpStatus, 200, JSON.stringify(winner));
    });
    const loser = await f.call(`/zones/${zone.id}/version`, { data: zoneBody({ name: 'Stale loser', expectedVersion: 1, locationIds: [1, 3] }) });
    eq(loser.httpStatus, 409, 'Writer losing the compare-and-swap race receives a conflict'); ok(winner, 'Race injected after preparation and before transaction');
    const listed = await f.call('/zones');
    eq(listed.zones[0].version, 2); eq(listed.zones[0].name, 'Concurrent winner'); eq(listed.zones[0].locations.map(location => location.id), [5, 2]);
    eq(f.all(`SELECT * FROM ${f.versionsTable()}`).length, 2, 'Losing edit cannot publish a version');
  });

  await scenario('unique member claim race', async f => {
    let winner;
    f.beforeBatch(async statements => {
      if (!statements.some(s => /INSERT INTO rondas_zones/.test(s.sql))) return;
      f.beforeBatch(null);
      winner = await f.call('/zones', { data: zoneBody({ name: 'Concurrent member owner', locationIds: [5] }) });
      eq(winner.httpStatus, 201, JSON.stringify(winner));
    });
    const loser = await storageFailure(() => f.call('/zones', { data: zoneBody({ name: 'Losing member owner', locationIds: [1, 5] }) }));
    eq(loser.httpStatus, 409, 'Database uniqueness resolves two claims validated before either transaction'); ok(winner);
    const listed = await f.call('/zones'); eq(listed.zones.length, 1); eq(listed.zones[0].locations.map(location => location.id), [5]);
    eq(f.all(`SELECT * FROM ${f.versionsTable()}`).length, 1, 'Unique membership violation rolls back the losing zone and its history');
    await f.createZone({ name: 'Room A remained available', locationIds: [1] });
  });

  await scenario('version storage failure', async f => {
    const zone = await f.createZone(); const before = f.zoneState();
    f.sqlite.exec(`CREATE TRIGGER fail_zone_version BEFORE INSERT ON ${f.versionsTable()} BEGIN SELECT RAISE(ABORT,'Injected version failure'); END`);
    const result = await storageFailure(() => f.call(`/zones/${zone.id}/version`, { data: zoneBody({ expectedVersion: 1, locationIds: [3, 5] }) }));
    eq(result.httpStatus, 500, 'Storage failure reaches caller'); eq(f.zoneState(), before, 'Zone, members and version publish as one transaction');
    f.sqlite.exec('DROP TRIGGER fail_zone_version');
    eq((await f.call(`/zones/${zone.id}/version`, { data: zoneBody({ expectedVersion: 1, locationIds: [3, 5] }) })).httpStatus, 200, 'A failed version may be retried safely');
  });

  await scenario('member activation race', async f => {
    const before = f.zoneState();
    f.beforeBatch(statements => {
      if (!statements.some(s => /INSERT INTO rondas_zones/.test(s.sql))) return;
      f.beforeBatch(null); f.sqlite.exec('UPDATE ubicaciones SET activa=0 WHERE id=1');
    });
    const result = await f.call('/zones', { data: zoneBody() });
    eq(result.httpStatus, 409, 'Membership must still refer to active rooms when its transaction commits');
    eq(f.zoneState(), before, 'A location deactivated after prevalidation leaves no partial zone');
    f.sqlite.exec('UPDATE ubicaciones SET activa=1 WHERE id=1');
  });

  await scenario('multi-location points and exact equipment', async f => {
    const zone = await f.createZone();
    const c = config({ zoneId: zone.id, points: [point('puerta'), point('acA', { locationId: 1, assetId: 1 }), point('acB', { locationId: 2, assetId: 2 })] });
    for (const invalid of [
      { siteId: 2 }, { points: [point('outside', { locationId: 5 })] },
      { points: [point('descendant', { locationId: 3, assetId: 3 })] },
      { points: [point('wrong-room', { locationId: 1, assetId: 2 })] },
      { points: [point('ambiguous-equipment', { assetId: 1 })] },
    ]) eq((await f.call('/templates', { data: { ...c, ...invalid } })).httpStatus, 400, `Out-of-zone or misplaced point rejected: ${JSON.stringify(invalid)}`);
    const template = await f.createTemplate(c);
    eq(template.config.zoneId, zone.id); eq(template.config.zoneName, zone.name); eq(template.config.zoneVersion, 1);
    eq(template.config.locations.map(location => location.id), [2, 1], 'Template freezes ordered membership');
    const executions = await f.generate(template.id, '2026-10-01', '2026-10-02'); eq(executions.length, 2);
    const first = executions[0].id;
    const initial = await f.detail(first);
    eq(initial.points.map(p => p.id).sort(), ['acA@1', 'acB@2', 'puerta@1', 'puerta@2'].sort(), 'Common point creates independent per-room observations');
    eq(initial.points.filter(p => p.code === 'puerta').map(p => p.locationId).sort(), [1, 2]);
    eq(initial.points.find(p => p.id === 'puerta@1').locationName, 'Sala local A');
    eq(initial.equipment.map(asset => asset.id).sort(), [1, 2], 'Zone scope includes exact member equipment and excludes their descendants');
    const stored = f.get('SELECT snapshot_json,data_json FROM rondas_executions WHERE id=?', first);
    const repeat = await f.generate(template.id, '2026-10-01', '2026-10-02'); eq(repeat.map(row => row.id), executions.map(row => row.id));
    eq(f.get('SELECT COUNT(*) count FROM rondas_executions').count, 2, 'Generation remains idempotent');
    eq(f.get('SELECT snapshot_json,data_json FROM rondas_executions WHERE id=?', first), stored, 'Repeat cannot reset existing inspection state');
    eq((await f.save(first, 'puerta@1')).httpStatus, 200);
    const observed = f.get('SELECT snapshot_json,data_json,equipment_snapshot_json,revision,status FROM rondas_executions WHERE id=?', first);
    const observedEvents = f.all('SELECT * FROM rondas_events WHERE execution_id=? ORDER BY id', first);
    eq((await f.generate(template.id, '2026-10-01', '2026-10-02')).map(row => row.id), executions.map(row => row.id));
    eq(f.get('SELECT snapshot_json,data_json,equipment_snapshot_json,revision,status FROM rondas_executions WHERE id=?', first), observed, 'Regeneration preserves saved per-room inspection, captured equipment and revision/status');
    eq(f.all('SELECT * FROM rondas_events WHERE execution_id=? ORDER BY id', first), observedEvents, 'Regeneration cannot append duplicate generation audit events');
    eq((await f.call(`/executions/${first}/action`, { userId: 2, rol: 'tecnico', data: { action: 'submit', expectedRevision: 1 } })).httpStatus, 400, 'Inspecting one room cannot complete other rooms');
    for (const id of ['puerta@2', 'acA@1', 'acB@2']) eq((await f.save(first, id)).httpStatus, 200);
    const sent = await f.call(`/executions/${first}/action`, { userId: 2, rol: 'tecnico', data: { action: 'submit', expectedRevision: 4 } });
    eq(sent.httpStatus, 200); eq(sent.execution.status, 'pendiente_validacion');
    eq((await f.call(`/executions/${first}/action`, { userId: 3, rol: 'jefe', data: { action: 'approve', expectedRevision: 5, reason: 'Todas las salas verificadas localmente' } })).httpStatus, 200);
    eq(f.get('SELECT COUNT(*) count FROM rondas_proposals').count, 0, 'Conforming room observations create no unnecessary orders');
  });

  await scenario('location-major traversal order', async f => {
    const zone = await f.createZone({ locationIds: [5, 2, 1] });
    const template = await f.createTemplate(config({ zoneId: zone.id, points: [point('primero'), point('segundo')] }));
    const id = (await f.generate(template.id))[0].id;
    eq((await f.detail(id)).points.map(p => p.id), ['primero@5', 'segundo@5', 'primero@2', 'segundo@2', 'primero@1', 'segundo@1'], 'Finish each location controls before moving to the next configured visit');
  });

  await scenario('31-day generation D1 query budget', async f => {
    const zone = await f.createZone({ locationIds: [5, 2, 1] });
    const template = await f.createTemplate(config({ zoneId: zone.id, points: [point('primero'), point('segundo')], notifications: { recipientIds: [3, 4], events: ['asignada'] } }));
    f.resetQueryCount();
    const result = await f.call('/generate', { data: { templateId: template.id, dateFrom: '2026-10-01', dateTo: '2026-10-31' } });
    monthlyQueryBudget = f.queryCount();
    eq(result.httpStatus, 200, JSON.stringify(result)); eq(result.executions.length, 31);
    ok(monthlyQueryBudget.total <= 45, `31-day round generation must fit D1 query budget: ${JSON.stringify(monthlyQueryBudget)}`);
    eq(f.get('SELECT COUNT(*) count FROM rondas_executions').count, 31);
    eq(f.get("SELECT COUNT(*) count FROM rondas_events WHERE action='generada'").count, 31, 'Each generated date retains its own audit event');
    eq(f.get('SELECT COUNT(*) count FROM rondas_notifications').count, 62, 'Each configured recipient gets a simulated assignment per date');
    eq(f.get("SELECT COUNT(*) count FROM rondas_notifications WHERE status<>'dry_run'").count, 0, 'Query optimization cannot change simulated notifications into deliveries');
  });

  await scenario('20-room findings save and submission query budget', async f => {
    const locationIds = Array.from({ length: 20 }, (_, i) => 100 + i);
    const insert = f.sqlite.prepare('INSERT INTO ubicaciones(id,nombre,sucursal_id,activa) VALUES(?,?,1,1)');
    for (const id of locationIds) insert.run(id, `Sala local de recorrido ${id}`);
    f.initial.ubicaciones = f.preserved().ubicaciones;
    const zone = await f.createZone({ name: 'Recorrido local con hallazgos', locationIds });
    const template = await f.createTemplate(config({ zoneId: zone.id, points: [point('control-comun')] }));
    const id = (await f.generate(template.id))[0].id;
    let maxSave = 0;
    for (const [index, locationId] of locationIds.entries()) {
      f.resetQueryCount();
      const result = await f.save(id, `control-comun@${locationId}`, { result: 'hallazgo', notes: 'Hallazgo local documentado para seguimiento' });
      const queries = f.queryCount(); maxSave = Math.max(maxSave, queries.total);
      eq(result.httpStatus, 200, JSON.stringify(result));
      ok(queries.total < 45, `Saving room ${index + 1}/20 fits the D1 budget rather than rescanning earlier findings: ${JSON.stringify(queries)}`);
      eq(f.get("SELECT COUNT(*) count FROM rondas_proposals WHERE kind='correctivo'").count, index + 1, 'Each newly observed room creates its own required action request');
      eq(f.get("SELECT COUNT(*) count FROM rondas_events WHERE action='solicitud_creada'").count, index + 1, 'Each room finding has one proposal creation audit event');
    }
    const proposals = f.all('SELECT * FROM rondas_proposals ORDER BY id');
    eq(proposals.map(proposal => proposal.location_id), locationIds, 'Common control findings remain distinct by actual room');
    eq(f.get('SELECT COUNT(*) count FROM rondas_proposal_links').count, 20, 'Every saved room retains its required action link');
    f.resetQueryCount();
    const submitted = await f.call(`/executions/${id}/action`, { userId: 2, rol: 'tecnico', data: { action: 'submit', expectedRevision: 20 } });
    const submitQueries = f.queryCount(); inspectionQueryBudget = { roomCount: 20, maxSave, submit: submitQueries.total };
    eq(submitted.httpStatus, 200, JSON.stringify(submitted)); eq(submitted.execution.status, 'pendiente_validacion');
    ok(submitQueries.total < 45, `Submitting completed room findings fits the D1 budget: ${JSON.stringify(submitQueries)}`);
    eq(f.all('SELECT * FROM rondas_proposals ORDER BY id'), proposals, 'Submit reuses every already-required same-condition proposal without modifying its identity or audit');
    eq(f.get('SELECT COUNT(*) count FROM rondas_proposal_links').count, 20);
    eq(f.get("SELECT COUNT(*) count FROM rondas_events WHERE action='solicitud_creada'").count, 20, 'Submit creates no duplicate proposal audit');
    eq(f.get('SELECT COUNT(*) count FROM ordenes').count, 0, 'Inspection/submission cannot create an OT before chief approval');
  });

  await scenario('expanded point count guard is write-free', async f => {
    const locationIds = Array.from({ length: 100 }, (_, i) => 100 + i);
    const insert = f.sqlite.prepare('INSERT INTO ubicaciones(id,nombre,sucursal_id,activa) VALUES(?,?,1,1)');
    for (const id of locationIds) insert.run(id, `Sala local de capacidad ${id}`);
    f.initial.ubicaciones = f.preserved().ubicaciones;
    const zone = await f.createZone({ name: 'Zona local de capacidad', locationIds });
    const template = await f.createTemplate(config({ zoneId: zone.id, points: Array.from({ length: 21 }, (_, i) => point(`control-${i}`)), notifications: { recipientIds: [3], events: ['asignada'] } }));
    const result = await f.call('/generate', { data: { templateId: template.id, dateFrom: '2026-10-01', dateTo: '2026-10-01' } });
    eq(result.httpStatus, 400, 'Twenty-one common controls across 100 rooms exceed the 1500-point execution bound');
    for (const table of ['rondas_executions', 'rondas_events', 'rondas_notifications']) eq(f.get(`SELECT COUNT(*) count FROM ${table}`).count, 0, `Expansion rejection writes no ${table}`);
  });

  await scenario('combined execution payload guard is write-free', async f => {
    const locationIds = Array.from({ length: 100 }, (_, i) => 100 + i);
    const insert = f.sqlite.prepare('INSERT INTO ubicaciones(id,nombre,sucursal_id,activa) VALUES(?,?,1,1)');
    for (const id of locationIds) insert.run(id, `Sala local de capacidad ${id}`);
    f.initial.ubicaciones = f.preserved().ubicaciones;
    const zone = await f.createZone({ name: 'Zona local de límite de texto', locationIds });
    const criterion = `Criterio local aprobado: ${'x'.repeat(1950)}`;
    const template = await f.createTemplate(config({ zoneId: zone.id, points: Array.from({ length: 15 }, (_, i) => point(`control-${i}`, { criterion })), notifications: { recipientIds: [3], events: ['asignada'] } }));
    const result = await f.call('/generate', { data: { templateId: template.id, dateFrom: '2026-10-01', dateTo: '2026-10-01' } });
    eq(result.httpStatus, 400, 'The count-valid 1500-point round still rejects an oversized nested snapshot and data payload');
    for (const table of ['rondas_executions', 'rondas_events', 'rondas_notifications']) eq(f.get(`SELECT COUNT(*) count FROM ${table}`).count, 0, `Payload rejection writes no ${table}`);
  });

  await scenario('legacy point cannot cross its location scope', async f => {
    eq((await f.call('/templates', { data: config({ locationId: 1, points: [point('ajeno', { locationId: 4 })] }) })).httpStatus, 400, 'Legacy single-location template cannot target a point in another site');
    eq((await f.call('/templates', { data: config({ locationId: 1, points: [point('otra-sala', { locationId: 2 })] }) })).httpStatus, 400, 'Legacy single-location template cannot target another room in the same site either');
    eq(f.get('SELECT COUNT(*) count FROM rondas_templates').count, 0, 'Invalid legacy point scope creates no template');
  });

  await scenario('frozen zone scope and explicit template refresh', async f => {
    const zone = await f.createZone();
    const c = config({ zoneId: zone.id }); const template = await f.createTemplate(c);
    const first = (await f.generate(template.id))[0].id;
    const versionsBefore = f.all('SELECT * FROM rondas_template_versions');
    const snapshot = f.get('SELECT snapshot_json FROM rondas_executions WHERE id=?', first).snapshot_json;
    const edit = await f.call(`/zones/${zone.id}/version`, { data: zoneBody({ name: 'Zona nueva B/C', expectedVersion: 1, locationIds: [5, 2] }) }); eq(edit.httpStatus, 200);
    eq(f.all('SELECT * FROM rondas_template_versions'), versionsBefore, 'Zone edit never silently rewrites a template version');
    eq(f.get('SELECT snapshot_json FROM rondas_executions WHERE id=?', first).snapshot_json, snapshot, 'Existing execution retains original zone identity');
    const staleGeneration = await f.call('/generate', { data: { templateId: template.id, dateFrom: '2026-10-02', dateTo: '2026-10-02' } });
    eq(staleGeneration.httpStatus, 409, 'A changed zone must be explicitly republished in a template before generating new dates');
    eq(f.get('SELECT COUNT(*) count FROM rondas_executions').count, 1, 'Rejected stale generation writes no execution');
    const repeat = await f.generate(template.id);
    eq(repeat.map(execution => execution.id), [first], 'Already generated dates remain idempotently readable after a zone edit');
    eq((await f.detail(first)).equipment.map(asset => asset.id).sort(), [1, 2], 'Live equipment lookup uses execution frozen scope after room removal');
    const update = await f.call(`/templates/${template.id}/version`, { data: { ...c, expectedVersion: 1, effectiveFrom: '2026-10-03', reason: 'Aplicar explícitamente la nueva zona' } });
    eq(update.httpStatus, 200, JSON.stringify(update)); eq(update.template.config.zoneVersion, 2); eq(update.template.config.zoneName, 'Zona nueva B/C');
    eq(update.template.config.locations.map(location => location.id), [5, 2]);
    const third = (await f.generate(template.id, '2026-10-03'))[0].id;
    eq((await f.detail(third)).points.map(p => p.locationId).sort(), [2, 5], 'New template version adopts the chosen zone version');
    eq((await f.detail(third)).equipment.map(asset => asset.id).sort(), [2, 4]);
    eq(f.get('SELECT snapshot_json FROM rondas_executions WHERE id=?', first).snapshot_json, snapshot, 'New template version leaves prior execution immutable');
    const oldRequest = await f.call(`/executions/${first}/order`, { userId: 2, rol: 'tecnico', data: { pointId: 'puerta@1', kind: 'correctivo', reason: 'Observación histórica de la sala retirada' } });
    eq(oldRequest.httpStatus, 201, 'A historical round retains the ability to request action in its original room');
    const oldDecision = await f.call(`/proposals/${oldRequest.proposalId}/decision`, { data: approval }); eq(oldDecision.httpStatus, 200);
    eq(f.get('SELECT ubicacion_id FROM ordenes WHERE id=?', oldDecision.orderId).ubicacion_id, 1, 'Historical action cannot be rerouted to new zone members');
    assert.throws(() => f.sqlite.exec(`UPDATE rondas_executions SET snapshot_json='{}' WHERE id=${first}`), /immutable/i); checks++;
  });

  await scenario('zone changes during template publication', async f => {
    const zone = await f.createZone();
    f.beforeBatch(async statements => {
      if (!statements.some(s => s.sql.startsWith('INSERT INTO rondas_templates'))) return;
      f.beforeBatch(null);
      const edit = await f.call(`/zones/${zone.id}/version`, { data: zoneBody({ name: 'Concurrent B/C', expectedVersion: 1, locationIds: [5, 2] }) });
      eq(edit.httpStatus, 200);
    });
    const result = await f.call('/templates', { data: config({ zoneId: zone.id }) });
    eq(result.httpStatus, 409, 'A template cannot publish zone membership that changed after it was read');
    eq(f.get('SELECT COUNT(*) count FROM rondas_templates').count, 0, 'Concurrent zone rejection leaves no template');
    eq(f.get('SELECT COUNT(*) count FROM rondas_template_versions').count, 0, 'Concurrent zone rejection leaves no published template version');
  });

  await scenario('zone changes during execution generation', async f => {
    const zone = await f.createZone(); const template = await f.createTemplate(config({ zoneId: zone.id }));
    f.beforeBatch(async statements => {
      if (!statements.some(s => s.sql.startsWith('INSERT OR IGNORE INTO rondas_executions'))) return;
      f.beforeBatch(null);
      const edit = await f.call(`/zones/${zone.id}/version`, { data: zoneBody({ name: 'Concurrent B/C', expectedVersion: 1, locationIds: [5, 2] }) });
      eq(edit.httpStatus, 200);
    });
    const result = await f.call('/generate', { data: { templateId: template.id, dateFrom: '2026-10-01', dateTo: '2026-10-01' } });
    eq(result.httpStatus, 409, 'Generation checks zone version when its insertion actually commits');
    eq(f.get('SELECT COUNT(*) count FROM rondas_executions').count, 0, 'Concurrent zone edit creates no stale execution');
    eq(f.get('SELECT COUNT(*) count FROM rondas_events').count, 0, 'Concurrent zone edit creates no misleading generation audit');
  });

  await scenario('location-only actions and legacy semantic reuse', async f => {
    const zone = await f.createZone();
    const template = await f.createTemplate(config({ zoneId: zone.id })); const id = (await f.generate(template.id))[0].id;
    const request = (execution, pointId, reason) => f.call(`/executions/${execution}/order`, { userId: 2, rol: 'tecnico', data: { pointId, kind: 'correctivo', reason } });
    const roomB = await request(id, 'puerta@2', 'Cierre irregular documentado'); eq(roomB.httpStatus, 201);
    const roomA = await request(id, 'puerta@1', 'Cierre irregular documentado'); eq(roomA.httpStatus, 201); ok(roomA.proposalId !== roomB.proposalId, 'Same control/symptom in different rooms needs separate action');
    const stored = f.get('SELECT * FROM rondas_proposals WHERE id=?', roomB.proposalId); eq(stored.location_id, 2); eq(stored.point_code, 'puerta');
    const legacyTemplate = await f.createTemplate(config({ name: 'Legado sala B', locationId: 2 })); const legacyId = (await f.generate(legacyTemplate.id))[0].id;
    const legacyDetail = await f.detail(legacyId); eq(legacyDetail.points.map(p => p.id), ['puerta'], 'Single-location legacy point IDs remain unchanged');
    const legacyRequest = await request(legacyId, 'puerta', '  CIERRE   irregular documentado  ');
    eq(legacyRequest.httpStatus, 201); eq(legacyRequest.proposalId, roomB.proposalId, 'Legacy and zone forms reuse exact semantic point/location/finding');
    eq(f.get('SELECT COUNT(*) count FROM rondas_proposals').count, 2);
    f.sqlite.exec(`INSERT INTO ordenes(id,titulo,tipo,estado,sucursal_id,ubicacion_id,creado_por,asignado_a) VALUES
      (100,'OT otra sala','correctivo','abierta',1,1,1,2),(101,'OT misma sala','correctivo','abierta',1,2,1,2)`);
    eq((await f.call(`/proposals/${roomB.proposalId}/decision`, { data: { ...approval, existingOrderId: 100 } })).httpStatus, 400, 'No-asset OT from another room is rejected');
    eq((await f.call(`/proposals/${roomB.proposalId}/decision`, { data: { ...approval, existingOrderId: 101 } })).httpStatus, 200, 'No-asset OT in the actual point room may be linked');
    const roomAOrder = await f.call(`/proposals/${roomA.proposalId}/decision`, { userId: 3, rol: 'jefe', data: approval }); eq(roomAOrder.httpStatus, 200);
    eq(f.get('SELECT ubicacion_id,sucursal_id,activo_id FROM ordenes WHERE id=?', roomAOrder.orderId), { ubicacion_id: 1, sucursal_id: 1, activo_id: null }, 'New OT routes to the actual point location, not the zone first location');
    eq((await f.detail(legacyId)).linkedOrders[0].id, 101, 'Shared semantic proposal links its approved OT to the legacy execution too');
  });

  await scenario('equipment actions route to the exact room', async f => {
    const zone = await f.createZone();
    const template = await f.createTemplate(config({ zoneId: zone.id, points: [point('equipo', { locationId: 1, assetId: 1 })] }));
    const id = (await f.generate(template.id))[0].id;
    const request = await f.call(`/executions/${id}/order`, { userId: 2, rol: 'tecnico', data: { pointId: 'equipo@1', kind: 'correctivo', reason: 'Ruido documentado de equipo local' } }); eq(request.httpStatus, 201);
    eq(f.get('SELECT location_id,asset_id,point_code FROM rondas_proposals WHERE id=?', request.proposalId), { location_id: 1, asset_id: 1, point_code: 'equipo' });
    f.sqlite.exec("INSERT INTO ordenes(id,titulo,tipo,estado,activo_id,sucursal_id,ubicacion_id,creado_por,asignado_a) VALUES(100,'Equipo correcto sala incorrecta','correctivo','abierta',1,1,2,1,2)");
    eq((await f.call(`/proposals/${request.proposalId}/decision`, { data: { ...approval, existingOrderId: 100 } })).httpStatus, 400, 'Even a matching asset cannot link an OT stored in another room');
    const decision = await f.call(`/proposals/${request.proposalId}/decision`, { data: approval }); eq(decision.httpStatus, 200);
    eq(f.get('SELECT ubicacion_id,sucursal_id,activo_id FROM ordenes WHERE id=?', decision.orderId), { ubicacion_id: 1, sucursal_id: 1, activo_id: 1 }, 'Asset OT points to its member room, not the zone first room');
  });

  await scenario('matching asset and room cannot link another site OT', async f => {
    const zone = await f.createZone();
    const template = await f.createTemplate(config({ zoneId: zone.id, points: [point('equipo', { locationId: 1, assetId: 1 })] }));
    const id = (await f.generate(template.id))[0].id;
    const request = await f.call(`/executions/${id}/order`, { userId: 2, rol: 'tecnico', data: { pointId: 'equipo@1', kind: 'correctivo', reason: 'Revisión con sucursal de OT inconsistente' } }); eq(request.httpStatus, 201);
    f.sqlite.exec("INSERT INTO ordenes(id,titulo,tipo,estado,activo_id,sucursal_id,ubicacion_id,creado_por,asignado_a) VALUES(100,'Mismo equipo y sala sede incorrecta','correctivo','abierta',1,2,1,1,2)");
    const result = await f.call(`/proposals/${request.proposalId}/decision`, { data: { ...approval, existingOrderId: 100 } });
    eq(result.httpStatus, 400, 'Zone approval rejects an OT whose branch conflicts even when room and asset IDs match');
    eq(f.get('SELECT status FROM rondas_proposals WHERE id=?', request.proposalId).status, 'pendiente_aprobacion');
    eq(f.get('SELECT COUNT(*) count FROM rondas_order_links').count, 0, 'Cross-site OT cannot be linked');
  });

  await scenario('pre-migration proposal metadata fallback', async f => {
    const zone = await f.createZone();
    const legacyTemplate = await f.createTemplate(config({ name: 'Plantilla antigua sala B', locationId: 2 }));
    const legacyId = (await f.generate(legacyTemplate.id))[0].id;
    const legacy = await f.call(`/executions/${legacyId}/order`, { userId: 2, rol: 'tecnico', data: { pointId: 'puerta', kind: 'correctivo', reason: 'Cierre irregular legado' } }); eq(legacy.httpStatus, 201);
    // Existing 0051 proposals acquire nullable metadata columns in additive 0053.
    f.sqlite.prepare('UPDATE rondas_proposals SET location_id=NULL,point_code=NULL WHERE id=?').run(legacy.proposalId);
    const zoneTemplate = await f.createTemplate(config({ zoneId: zone.id })); const zoneId = (await f.generate(zoneTemplate.id))[0].id;
    const reused = await f.call(`/executions/${zoneId}/order`, { userId: 2, rol: 'tecnico', data: { pointId: 'puerta@2', kind: 'correctivo', reason: ' CIERRE   irregular legado ' } });
    eq(reused.httpStatus, 201); eq(reused.proposalId, legacy.proposalId, 'Nullable migrated metadata derives semantic location/code from the legacy execution');
    eq(f.get('SELECT COUNT(*) count FROM rondas_proposals').count, 1, 'Migration fallback does not duplicate an unresolved legacy request');
    const decision = await f.call(`/proposals/${legacy.proposalId}/decision`, { data: approval }); eq(decision.httpStatus, 200);
    eq(f.get('SELECT ubicacion_id FROM ordenes WHERE id=?', decision.orderId).ubicacion_id, 2, 'Approval of nullable legacy metadata uses its actual single-room source');
    eq((await f.detail(zoneId)).linkedOrders[0].id, decision.orderId, 'Legacy-approved OT propagates to the corresponding zone room link');
  });

  await scenario('shared PM cycle uses actual child room scope', async f => {
    f.sqlite.exec(`
      INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha,asignado_a,checklist) VALUES
        (3,3,'Plan local anexo','mensual','2026-09-01',2,'[{"texto":"Control local","hecho":false}]');
      INSERT INTO ordenes(id,titulo,tipo,estado,activo_id,plan_id,sucursal_id,ubicacion_id,asignado_a,creado_por,created_at,completada_en,verificado_por,verificado_en,trabajos_realizados,verificacion_notas) VALUES
        (99,'Servicio local anexo verificado','preventivo','cerrada',3,3,1,3,2,1,'2026-08-01T12:00:00Z','2026-08-01T12:00:00Z',3,'2026-08-02T12:00:00Z','Trabajo documentado local','Comprobación independiente local');
    `);
    const originalPlan = f.get('SELECT * FROM planes_mantenimiento WHERE id=3');
    f.initial.planes_mantenimiento.push(originalPlan);
    const legacyTemplate = await f.createTemplate(config({ name: 'Recorrido padre legado', locationId: 1, points: [point('ac-anexo', { assetId: 3 })] }));
    const legacyId = (await f.generate(legacyTemplate.id))[0].id;
    const legacy = await f.call(`/executions/${legacyId}/order`, { userId: 2, rol: 'tecnico', data: { pointId: 'ac-anexo', kind: 'preventivo', planId: 3, reason: 'Recuperar ciclo mensual verificado del equipo anexo' } }); eq(legacy.httpStatus, 201);
    // Model an existing pending PM proposal created before 0053 metadata existed.
    f.sqlite.prepare('UPDATE rondas_proposals SET location_id=NULL,point_code=NULL WHERE id=?').run(legacy.proposalId);
    const zone = await f.createZone({ name: 'Zona exacta anexo', locationIds: [3] });
    const zoneTemplate = await f.createTemplate(config({ zoneId: zone.id, points: [point('ac-anexo', { locationId: 3, assetId: 3 })] }));
    const zoneId = (await f.generate(zoneTemplate.id))[0].id;
    const zoneRequest = await f.call(`/executions/${zoneId}/order`, { userId: 2, rol: 'tecnico', data: { pointId: 'ac-anexo@3', kind: 'preventivo', planId: 3, reason: 'Mismo ciclo preventivo global desde la zona exacta' } });
    eq(zoneRequest.httpStatus, 201); eq(zoneRequest.proposalId, legacy.proposalId, 'Global PM cycle deduplicates the parent legacy and exact child-zone requests');
    eq(f.get('SELECT COUNT(*) count FROM rondas_proposals').count, 1); eq(f.get('SELECT COUNT(*) count FROM rondas_proposal_links').count, 2, 'Both rounds retain links to their shared PM request');
    const decision = await f.call(`/proposals/${legacy.proposalId}/decision`, { userId: 3, rol: 'jefe', data: approval }); eq(decision.httpStatus, 200, JSON.stringify(decision));
    eq(f.get('SELECT activo_id,plan_id,sucursal_id,ubicacion_id FROM ordenes WHERE id=?', decision.orderId), { activo_id: 3, plan_id: 3, sucursal_id: 1, ubicacion_id: 3 }, 'Shared preventive OT targets the actual child room, never the legacy parent anchor');
    eq((await f.detail(zoneId)).linkedOrders[0].id, decision.orderId); eq((await f.detail(legacyId)).linkedOrders[0].id, decision.orderId);
    const afterPlan = f.get('SELECT * FROM planes_mantenimiento WHERE id=3');
    eq({ ...afterPlan, ultima_generacion: originalPlan.ultima_generacion }, originalPlan, 'Approved PM request preserves every plan field except documented generation bookkeeping');
    ok(afterPlan.ultima_generacion, 'Generation timestamp records the explicitly approved preventive order');
    f.initial.planes_mantenimiento[f.initial.planes_mantenimiento.findIndex(plan => plan.id === 3)] = afterPlan;
  });

  await scenario('linked open PM order moved before submission', async f => {
    const round = await approvedZonePreventive(f);
    const before = round.state();
    f.sqlite.prepare('UPDATE ordenes SET ubicacion_id=2 WHERE id=?').run(round.orderId);
    const result = await f.call(`/executions/${round.id}/action`, { userId: 2, rol: 'tecnico', data: { action: 'submit', expectedRevision: before.execution.revision } });
    eq(result.httpStatus, 409, 'A linked open PM order moved to another room cannot be silently reused on submission');
    eq(round.state(), before, 'Invalid linked PM routing changes no inspection, revision, history, proposal, links or notifications');
  });

  await scenario('linked open PM order site changes during submission', async f => {
    const round = await approvedZonePreventive(f);
    const before = round.state(); let injected = false;
    f.beforeBatch(statements => {
      if (!statements.some(statement => statement.sql.startsWith('UPDATE rondas_executions SET'))) return;
      f.beforeBatch(null); injected = true;
      f.sqlite.prepare('UPDATE ordenes SET sucursal_id=2 WHERE id=?').run(round.orderId);
    });
    const result = await f.call(`/executions/${round.id}/action`, { userId: 2, rol: 'tecnico', data: { action: 'submit', expectedRevision: before.execution.revision } });
    ok(injected, 'The linked PM order move occurred after read validation and before round mutation');
    eq(result.httpStatus, 409, 'Round compare-and-swap checks linked open PM routing again inside the mutation transaction');
    eq(round.state(), before, 'The losing submission writes no inspection, revision, history, proposals, links or notifications');
  });

  await scenario('equipment moves before action request', async f => {
    const zone = await f.createZone();
    const template = await f.createTemplate(config({ zoneId: zone.id, points: [point('equipo', { locationId: 1, assetId: 1 })] }));
    const id = (await f.generate(template.id))[0].id;
    f.sqlite.exec('UPDATE activos SET ubicacion_id=2 WHERE id=1');
    const result = await f.call(`/executions/${id}/order`, { userId: 2, rol: 'tecnico', data: { pointId: 'equipo@1', kind: 'correctivo', reason: 'Equipo trasladado fuera del control original' } });
    ok([400, 409].includes(result.httpStatus), 'A moved asset cannot create a proposal for its old point room');
    eq(f.get('SELECT COUNT(*) count FROM rondas_proposals').count, 0, 'Moved equipment rejection writes no request');
    f.sqlite.exec('UPDATE activos SET ubicacion_id=1 WHERE id=1');
  });

  await scenario('equipment moves during action request', async f => {
    const zone = await f.createZone();
    const template = await f.createTemplate(config({ zoneId: zone.id, points: [point('equipo', { locationId: 1, assetId: 1 })] }));
    const id = (await f.generate(template.id))[0].id;
    const counts = () => ['rondas_proposals', 'rondas_proposal_links', 'rondas_order_links', 'rondas_events'].map(table => f.get(`SELECT COUNT(*) count FROM ${table}`).count);
    const before = counts();
    f.beforeBatch(statements => {
      if (!statements.some(s => s.sql.startsWith('INSERT OR IGNORE INTO rondas_proposals'))) return;
      f.beforeBatch(null); f.sqlite.exec('UPDATE activos SET ubicacion_id=2 WHERE id=1');
    });
    const result = await f.call(`/executions/${id}/order`, { userId: 2, rol: 'tecnico', data: { pointId: 'equipo@1', kind: 'correctivo', reason: 'Observación antes de traslado concurrente' } });
    eq(result.httpStatus, 409, 'Action request rechecks equipment room inside its transactional insertion guard');
    eq(counts(), before, 'Concurrent equipment move writes no proposal, links or misleading action audit');
    f.sqlite.exec('UPDATE activos SET ubicacion_id=1 WHERE id=1');
  });

  await scenario('existing order room changes during approval', async f => {
    const zone = await f.createZone(); const template = await f.createTemplate(config({ zoneId: zone.id }));
    const id = (await f.generate(template.id))[0].id;
    const request = await f.call(`/executions/${id}/order`, { userId: 2, rol: 'tecnico', data: { pointId: 'puerta@1', kind: 'correctivo', reason: 'Hallazgo local con OT existente' } }); eq(request.httpStatus, 201);
    f.sqlite.exec("INSERT INTO ordenes(id,titulo,tipo,estado,sucursal_id,ubicacion_id,creado_por,asignado_a) VALUES(100,'OT sala A','correctivo','abierta',1,1,1,2)");
    f.beforeBatch(statements => {
      if (!statements.some(s => s.sql.startsWith("UPDATE rondas_proposals SET status='aprobada'"))) return;
      f.beforeBatch(null); f.sqlite.exec('UPDATE ordenes SET ubicacion_id=2 WHERE id=100');
    });
    const result = await f.call(`/proposals/${request.proposalId}/decision`, { data: { ...approval, existingOrderId: 100 } });
    eq(result.httpStatus, 409, 'Approval checks actual OT room again inside its transactional guard');
    eq(f.get('SELECT status FROM rondas_proposals WHERE id=?', request.proposalId).status, 'pendiente_aprobacion');
    eq(f.get('SELECT COUNT(*) count FROM rondas_order_links').count, 0, 'A mismatched concurrent OT cannot be linked');
  });

  await scenario('equipment moves during approval', async f => {
    const zone = await f.createZone();
    const template = await f.createTemplate(config({ zoneId: zone.id, points: [point('equipo', { locationId: 1, assetId: 1 })] }));
    const id = (await f.generate(template.id))[0].id;
    const request = await f.call(`/executions/${id}/order`, { userId: 2, rol: 'tecnico', data: { pointId: 'equipo@1', kind: 'correctivo', reason: 'Ruido local antes de traslado' } }); eq(request.httpStatus, 201);
    f.beforeBatch(statements => {
      if (!statements.some(s => s.sql.startsWith("UPDATE rondas_proposals SET status='aprobada'"))) return;
      f.beforeBatch(null); f.sqlite.exec('UPDATE activos SET ubicacion_id=2 WHERE id=1');
    });
    const result = await f.call(`/proposals/${request.proposalId}/decision`, { data: approval });
    eq(result.httpStatus, 409, 'Approval rechecks equipment exact point-room assignment inside its transaction');
    eq(f.get('SELECT status FROM rondas_proposals WHERE id=?', request.proposalId).status, 'pendiente_aprobacion');
    eq(f.get('SELECT COUNT(*) count FROM ordenes').count, 0, 'Moved asset cannot leave a newly routed OT');
    f.sqlite.exec('UPDATE activos SET ubicacion_id=1 WHERE id=1');
  });

  eq(networkCalls, 0, 'No network/email/storage traffic');
  if (failures.length) throw new AggregateError(failures, `${failures.length} zone integration scenarios failed after ${checks} passing checks`);
  console.log(`PASS: ${checks} zone integration checks: exclusive ordered membership, roles, atomic race guards, immutable versions, exact equipment, per-room completion, legacy reuse, room-specific OTs, query/payload bounds and preserved PM/locations; 31-day generation ${monthlyQueryBudget?.total} D1 statements; 20-room findings max save ${inspectionQueryBudget?.maxSave}, submit ${inspectionQueryBudget?.submit}; local SQLite only.`);
} finally { globalThis.fetch = originalFetch; }
