// Exercise the catalog and physical equipment through public handlers, real
// migrations, authenticated sessions and transactional SQLite. Never production.
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const originalFetch = globalThis.fetch;
const originalError = console.error;
console.error = (...args) => {
  if (args.some(value => value instanceof Error && value.message === 'Injected catalog history failure')) return;
  originalError(...args);
};
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error('Network forbidden in catalog tests'); };
let fixture;
let legacyBefore;
try {
  fixture = await setupConjuntos({
    modules: {
      catalogList: 'pages/api/catalogo-aires/index',
      catalogDetail: 'pages/api/catalogo-aires/[id]/index',
    },
    beforeMigration(sqlite, migration) {
      if (!migration.startsWith('0049_')) return;
      sqlite.exec(`
        INSERT INTO usuarios(id,nombre,email,password_hash,rol) VALUES(900,'Usuario histórico','historico@example.invalid','isolated','admin');
        INSERT INTO activos(id,codigo,nombre,serial,rubro,tipo,qr_code) VALUES(900,'LEGADO-AC-1','Aire anterior sin modificar','Serie anterior','aires','general','QR-LEGADO-AC-1');
        INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha,asignado_a) VALUES(900,900,'Plan anterior','mensual','2030-01-01',900);
        INSERT INTO ordenes(id,titulo,activo_id,creado_por,rubro) VALUES(900,'Orden anterior',900,900,'aires');
      `);
      legacyBefore = Object.fromEntries(['usuarios', 'activos', 'planes_mantenimiento', 'ordenes'].map(table => [table, sqlite.prepare(`SELECT * FROM ${table} WHERE id=900`).get()]));
    },
  });
  const { app, sqlite, call, faults } = fixture;
  const one = (sql, ...args) => sqlite.prepare(sql).get(...args);
  const rows = (sql, ...args) => sqlite.prepare(sql).all(...args);
  const json = value => JSON.stringify(value);
  const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
  const expect = (result, status = 200) => {
    assert.equal(result.status, status, json(result));
    return result.body;
  };
  const create = (data, options = {}) => call(app.catalogList.POST, '/api/catalogo-aires', { method: 'POST', data, ...options });
  const created = async (data, options) => expect(await create(data, options), 201).modelo;
  const edit = (id, data, options = {}) => call(app.catalogDetail.PATCH, `/api/catalogo-aires/${id}`, { method: 'PATCH', id, data, ...options });
  const detail = async (id, options = {}) => expect(await call(app.catalogDetail.GET, `/api/catalogo-aires/${id}`, { id, ...options }));
  const list = async (query = '', options = {}) => expect(await call(app.catalogList.GET, `/api/catalogo-aires${query}`, options)).modelos;
  const createUnit = (data, options = {}) => call(app.assetCreate.POST, '/api/activos', { method: 'POST', data, ...options });
  const unit = async (modelo, data = {}, options = {}) => expect(await createUnit({ rubro: 'aires', modeloAireId: modelo.id, modeloAireVersion: modelo.version, ...data }, options), 201).activo;
  const savedUnit = id => one('SELECT * FROM activos WHERE id=?', id);
  const catalogState = () => json({ modelos: rows('SELECT * FROM modelos_aire ORDER BY id'), historial: rows('SELECT * FROM modelos_aire_historial ORDER BY id') });
  const unitState = () => json({ activos: rows('SELECT * FROM activos ORDER BY id'), planes: rows('SELECT * FROM planes_mantenimiento ORDER BY id') });
  const state = () => json([catalogState(), unitState()]);
  const base = {
    nombre: ' mini split de ejemplo ñ ', marca: ' marca de prueba ', modelo: ' serie modelo á ',
    categoria: ' climatización ', descripcion: ' unidad para consultorio\ncon conexión óptima ',
    datosTecnicos: { tipoUnidad: ' mini split ', capacidadBtuH: 12000, refrigerante: ' r-410a ' },
  };
  assert(legacyBefore, 'Migration 0049 must run against existing data');
  for (const [table, before] of Object.entries(legacyBefore)) {
    const after = one(`SELECT * FROM ${table} WHERE id=900`);
    assert.equal(json(Object.fromEntries(Object.keys(before).map(key => [key, after[key]]))), json(before), `${table}: migration preserves all historical values`);
  }
  assert.equal(savedUnit(900).modelo_aire_id, null);
  assert.equal(savedUnit(900).modelo_aire_snapshot, null);
  const usersBefore = json(rows('SELECT * FROM usuarios ORDER BY id'));
  sqlite.exec(`
    INSERT INTO sucursales(id,nombre) VALUES(1,'Sede de prueba');
    INSERT INTO ubicaciones(id,nombre,sucursal_id) VALUES(1,'Consultorio uno',1),(2,'Consultorio dos',1);
  `);

  // Authentication and permissions are exercised through signed fixture cookies.
  expect(await call(app.catalogList.GET, '/api/catalogo-aires', { rol: null }), 401);
  expect(await create(base, { rol: null }), 401);
  for (const rol of ['jefe', 'visualizador', 'solicitante', 'motorista', 'bodega']) expect(await create(base, { rol }), 403);
  for (const data of [
    null, [], '', {}, { nombre: '' }, { nombre: ' \n ' }, { nombre: 1 },
    { ...base, serial: 'not-a-model-field' }, { ...base, ubicacionId: 1 },
    { ...base, responsableId: 1 }, { ...base, codigo: 'AC-FORGED' },
    { ...base, creadoPor: 2 }, { ...base, version: 99 }, { ...base, unknown: 'value' },
    { ...base, datosTecnicos: { servicio: 'cirugía' } },
    { ...base, datosTecnicos: { capacidadBtuH: -1 } },
    { ...base, datosTecnicos: { serial: 'not-a-model-field' } },
    { ...base, datosTecnicos: { tipoUnidad: 'ß'.repeat(101) } },
  ]) expect(await create(data), 400);
  assert.equal(one('SELECT count(*) AS n FROM modelos_aire').n, 0);

  // The model and first trace event must commit together.
  const beforeFailedCreate = catalogState();
  sqlite.exec("CREATE TEMP TRIGGER test_fail_catalog_history BEFORE INSERT ON modelos_aire_historial BEGIN SELECT RAISE(ABORT, 'Injected catalog history failure'); END;");
  let failedCreate = false;
  try { failedCreate = (await create(base)).status >= 500; } catch { failedCreate = true; }
  sqlite.exec('DROP TRIGGER test_fail_catalog_history');
  assert(failedCreate);
  assert.equal(catalogState(), beforeFailedCreate);
  const initial = await created(base);
  const id = initial.id;
  assert.equal(initial.version, 1);
  assert.equal(initial.activo, true);
  for (const field of ['nombre', 'marca', 'modelo', 'categoria', 'descripcion']) assert.equal(initial[field], base[field].trim().toUpperCase());
  assert.deepEqual(parse(initial.datosTecnicos), { tipoUnidad: 'MINI SPLIT', capacidadBtuH: 12000, refrigerante: 'R-410A' });
  let current = await detail(id);
  assert.equal(current.historial.length, 1);
  assert.equal(current.historial[0].accion, 'crear');
  assert.equal(current.historial[0].usuarioNombre, 'Prueba admin');
  assert.equal(current.historial[0].usuarioId, 1);
  assert.equal(current.historial[0].version, 1);
  assert.equal(parse(current.historial[0].snapshot).nombre, initial.nombre);
  const firstEvent = json(rows('SELECT * FROM modelos_aire_historial WHERE modelo_aire_id=? ORDER BY id', id));
  expect(await create({ ...base, nombre: initial.nombre.toLowerCase() }), 409);
  for (const rol of ['admin', 'jefe', 'tecnico', 'visualizador', 'solicitante', 'motorista', 'bodega']) {
    assert.equal((await list('', { rol })).some(row => row.id === id), true);
    assert.equal((await detail(id, { rol })).modelo.id, id);
  }
  expect(await call(app.catalogDetail.GET, `/api/catalogo-aires/${id}`, { id, rol: null }), 401);
  expect(await edit(id, { version: 1, nombre: 'No permitido' }, { rol: null }), 401);
  for (const rol of ['jefe', 'visualizador', 'solicitante', 'motorista', 'bodega']) expect(await edit(id, { version: 1, nombre: 'No permitido' }, { rol }), 403);
  for (const badId of ['0', '-1', '1.5', 'abc']) expect(await call(app.catalogDetail.GET, `/api/catalogo-aires/${badId}`, { id: badId }), 400);
  expect(await call(app.catalogDetail.GET, '/api/catalogo-aires/99999', { id: 99999 }), 404);
  const minimal = await created({ nombre: ' ficha sin datos técnicos ' }, { rol: 'tecnico' });
  assert.equal(minimal.nombre, 'FICHA SIN DATOS TÉCNICOS');
  assert.equal((await detail(minimal.id)).historial[0].usuarioNombre, 'Prueba tecnico');
  const minimalUnit = await unit(minimal, { ubicacionId: 1 });
  assert.equal(minimalUnit.datosTecnicos, null, 'Models without technical data must still pass the snapshot linkage trigger');
  assert.equal(parse(minimalUnit.modeloAireSnapshot).datosTecnicos, null);
  assert.equal((await detail(minimal.id)).unidades.find(row => row.id === minimalUnit.id).ubicacion, 'Sede de prueba · Consultorio uno', 'Catalog detail resolves a saved location even when the free-text location is empty');
  const unicodeBoundary = await created({ nombre: 'ficha unicode', datosTecnicos: { tipoUnidad: 'ß'.repeat(100) } });
  assert.equal(unicodeBoundary.datosTecnicos.tipoUnidad, 'SS'.repeat(100));
  assert.equal(parse((await unit(unicodeBoundary)).datosTecnicos).tipoUnidad, 'SS'.repeat(100));

  // Selecting one model creates distinct physical units, never one shared asset.
  const a = await unit(initial, { serial: ' serie á uno ', ubicacionId: 1, ubicacion: ' pared norte ' });
  const b = await unit(initial, { serial: ' serie á dos ', ubicacionId: 2, ubicacion: ' pared sur ' });
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.codigo, b.codigo);
  assert.notEqual(a.qrCode, b.qrCode);
  for (const row of [a, b]) {
    assert.match(row.codigo, /^AC-[A-Z0-9]+$/);
    assert.equal(row.qrCode, `QR-${row.codigo}`);
    for (const field of ['nombre', 'marca', 'modelo', 'categoria', 'descripcion']) assert.equal(row[field], initial[field]);
    assert.deepEqual(parse(row.datosTecnicos), parse(initial.datosTecnicos));
    assert.equal(row.modeloAireId, id);
    assert.equal(parse(row.modeloAireSnapshot).version, 1);
    assert.equal(parse(row.modeloAireSnapshot).nombre, initial.nombre);
    assert.equal(savedUnit(row.id).modelo_aire_snapshot, row.modeloAireSnapshot);
  }
  assert.equal(a.serial, 'SERIE Á UNO');
  assert.equal(b.serial, 'SERIE Á DOS');
  assert.equal(a.ubicacionId, 1);
  assert.equal(b.ubicacionId, 2);
  assert.equal(a.ubicacion, 'PARED NORTE');
  assert.equal(b.ubicacion, 'PARED SUR');
  current = await detail(id);
  assert.deepEqual(current.unidades.map(row => row.id).sort((x, y) => x - y), [a.id, b.id]);
  assert.equal(current.unidades.find(row => row.id === a.id).ubicacion, 'Sede de prueba · Consultorio uno · PARED NORTE');
  assert.equal(current.unidades.find(row => row.id === b.id).ubicacion, 'Sede de prueba · Consultorio dos · PARED SUR');
  const unitsBeforeModelChange = json([savedUnit(a.id), savedUnit(b.id)]);
  const oldOrigin = a.modeloAireSnapshot;

  // Only absent fields inherit defaults; explicit per-unit values, including
  // blank/null choices and partial technical overrides, remain deliberate.
  const overridden = await unit(initial, {
    nombre: ' unidad especial ', marca: '', modelo: null, categoria: ' uso especial ', descripcion: null,
    datosTecnicos: { capacidadBtuH: 24000, refrigerante: '' },
  });
  assert.equal(overridden.nombre, 'UNIDAD ESPECIAL');
  assert.equal(overridden.marca, '');
  assert.equal(overridden.modelo, null);
  assert.equal(overridden.categoria, 'USO ESPECIAL');
  assert.equal(overridden.descripcion, null);
  assert.deepEqual(parse(overridden.datosTecnicos), { tipoUnidad: 'MINI SPLIT', capacidadBtuH: 24000 });
  assert.equal(parse(overridden.modeloAireSnapshot).nombre, initial.nombre);
  assert.equal(parse(overridden.modeloAireSnapshot).marca, initial.marca);
  const noTechnical = await unit(initial, { datosTecnicos: null });
  assert.equal(noTechnical.datosTecnicos, null);
  const noName = await unit(initial, { nombre: '' });
  assert.match(noName.nombre, /PENDIENTE DE IDENTIFICAR/);
  const plain = expect(await createUnit({ rubro: 'aires' }), 201).activo;
  assert.equal(plain.modeloAireId, null);
  assert.equal(plain.modeloAireSnapshot, null);
  assert.match(plain.nombre, /PENDIENTE DE IDENTIFICAR/);

  const beforeBadLinks = state();
  for (const data of [
    { rubro: 'aires', modeloAireId: id },
    { rubro: 'aires', modeloAireVersion: 1 },
    { rubro: 'aires', modeloAireId: id, modeloAireVersion: 0 },
    { rubro: 'aires', modeloAireId: -1, modeloAireVersion: 1 },
    { rubro: 'aires', modeloAireId: '1', modeloAireVersion: 1 },
    { rubro: 'biomedico', modeloAireId: id, modeloAireVersion: 1 },
    { rubro: 'equipo_general', modeloAireId: id, modeloAireVersion: 1 },
    { modeloAireId: id, modeloAireVersion: 1 },
    { rubro: 'aires', modeloAireId: id, modeloAireVersion: 1, modeloAireSnapshot: '{}' },
    { rubro: 'aires', modeloAireId: id, modeloAireVersion: 1, datosTecnicos: { servicio: 'no válido' } },
  ]) expect(await createUnit(data), 400);
  expect(await createUnit({ rubro: 'aires', modeloAireId: 99999, modeloAireVersion: 1 }), 404);
  expect(await createUnit({ rubro: 'aires', modeloAireId: id, modeloAireVersion: 99 }), 409);
  assert.equal(state(), beforeBadLinks, 'Invalid linkage cannot save a physical unit or alter its source model');

  for (const data of [
    { nombre: 'No version' }, { version: 0, nombre: 'No version' },
    { version: 1, serial: 'No individual fields' },
    { version: 1, ubicacionId: 1 }, { version: 1, usuarioId: 2 },
    { version: 1, datosTecnicos: { capacidadBtuH: -1 } },
    { version: 1, datosTecnicos: { servicio: 'No' } },
  ]) expect(await edit(id, data), 400);
  expect(await edit(id, { version: 1, nombre: minimal.nombre.toLowerCase() }), 409);
  const beforeFailedEdit = state();
  sqlite.exec("CREATE TEMP TRIGGER test_fail_catalog_history BEFORE INSERT ON modelos_aire_historial BEGIN SELECT RAISE(ABORT, 'Injected catalog history failure'); END;");
  let failedEdit = false;
  try { failedEdit = (await edit(id, { version: 1, marca: 'Cambio fallido' })).status >= 500; } catch { failedEdit = true; }
  sqlite.exec('DROP TRIGGER test_fail_catalog_history');
  assert(failedEdit);
  assert.equal(state(), beforeFailedEdit, 'Model edit and its historical snapshot roll back together');
  const changed = expect(await edit(id, { version: 1, nombre: ' ficha revisada á ', marca: ' marca nueva ', datosTecnicos: { tipoUnidad: ' cassette ', capacidadBtuH: 36000, refrigerante: ' r32 ' } }, { rol: 'tecnico' })).modelo;
  assert.equal(changed.version, 2);
  assert.equal(changed.nombre, 'FICHA REVISADA Á');
  assert.equal(changed.marca, 'MARCA NUEVA');
  assert.deepEqual(parse(changed.datosTecnicos), { tipoUnidad: 'CASSETTE', capacidadBtuH: 36000, refrigerante: 'R32' });
  assert.equal(json([savedUnit(a.id), savedUnit(b.id)]), unitsBeforeModelChange, 'Editing a reusable model cannot rewrite registered unit descriptions or snapshots');
  current = await detail(id);
  assert.equal(current.historial.length, 2);
  const editEvent = current.historial.find(row => row.version === 2);
  assert.equal(editEvent.accion, 'editar');
  assert.equal(editEvent.usuarioId, 3);
  assert.equal(editEvent.usuarioNombre, 'Prueba tecnico');
  assert.equal(parse(editEvent.snapshot).marca, 'MARCA NUEVA');
  assert.equal(json(rows('SELECT * FROM modelos_aire_historial WHERE modelo_aire_id=? AND version=1 ORDER BY id', id)), firstEvent);
  const beforeStale = state();
  expect(await edit(id, { version: 1, marca: 'No sobrescribir' }), 409);
  expect(await createUnit({ rubro: 'aires', modeloAireId: id, modeloAireVersion: 1 }), 409);
  assert.equal(state(), beforeStale);
  const newUnit = await unit(changed, { serial: ' serie nueva ' });
  assert.equal(newUnit.marca, 'MARCA NUEVA');
  assert.equal(parse(newUnit.modeloAireSnapshot).version, 2);
  assert.equal(savedUnit(a.id).modelo_aire_snapshot, oldOrigin);
  const editedUnit = expect(await call(app.assets.PATCH, `/api/activos/${a.id}`, { method: 'PATCH', id: a.id, data: { nombre: ' aire revisado individual ', marca: ' marca individual ' } })).activo;
  assert.equal(editedUnit.nombre, 'AIRE REVISADO INDIVIDUAL');
  assert.equal(editedUnit.modeloAireSnapshot, oldOrigin, 'Individual edits retain the model used at registration');
  assert.equal((await detail(id)).modelo.marca, 'MARCA NUEVA');
  const beforeAreaChange = json(savedUnit(a.id));
  for (const data of [{ modeloAireId: minimal.id }, { modeloAireVersion: 99 }, { modeloAireSnapshot: '{}' }]) {
    expect(await call(app.assets.PATCH, `/api/activos/${a.id}`, { method: 'PATCH', id: a.id, data }), 400);
    assert.equal(json(savedUnit(a.id)), beforeAreaChange);
  }
  expect(await call(app.assets.PATCH, `/api/activos/${a.id}`, { method: 'PATCH', id: a.id, data: { rubro: 'biomedico', tipo: 'biomedico' } }), 409);
  assert.equal(json(savedUnit(a.id)), beforeAreaChange);
  assert.throws(() => sqlite.prepare('UPDATE activos SET modelo_aire_snapshot=? WHERE id=?').run('{}', a.id));
  assert.throws(() => sqlite.prepare('UPDATE activos SET modelo_aire_id=? WHERE id=?').run(minimal.id, a.id));
  assert.equal(json(savedUnit(a.id)), beforeAreaChange);

  // Optimistic versioning must resolve concurrent writers with one winner and
  // exactly one new historical event, even when both readers observed version 2.
  const simultaneous = await Promise.all([
    edit(id, { version: 2, descripcion: ' primer cambio simultáneo ' }),
    edit(id, { version: 2, descripcion: ' segundo cambio simultáneo ' }),
  ]);
  assert.deepEqual(simultaneous.map(result => result.status).sort(), [200, 409]);
  current = await detail(id);
  assert.equal(current.modelo.version, 3);
  assert.equal(current.historial.length, 3);
  assert.equal(current.historial.filter(row => row.version === 3).length, 1);
  assert.equal(parse(current.historial.find(row => row.version === 3).snapshot).descripcion, current.modelo.descripcion);

  const archive = expect(await edit(id, { version: 3, activo: false })).modelo;
  assert.equal(archive.version, 4);
  assert.equal(archive.activo, false);
  assert.equal((await list()).some(row => row.id === id), false);
  assert.equal((await list('?incluirArchivados=1')).some(row => row.id === id), true);
  expect(await create({ nombre: archive.nombre.toLowerCase() }), 409);
  const beforeArchivedRegistration = state();
  expect(await createUnit({ rubro: 'aires', modeloAireId: id, modeloAireVersion: 4 }), 409);
  assert.equal(state(), beforeArchivedRegistration);
  current = await detail(id);
  assert(current.unidades.some(row => row.id === a.id), 'Archiving a model must not hide its physical units');
  assert.equal(current.historial.find(row => row.version === 4).accion, 'archivar');
  const reactivated = expect(await edit(id, { version: 4, activo: true })).modelo;
  assert.equal(reactivated.version, 5);
  assert.equal((await list()).some(row => row.id === id), true);
  assert.equal((await detail(id)).historial.find(row => row.version === 5).accion, 'reactivar');
  await unit(reactivated);

  // A template changed or archived after the early check must still be rejected
  // by the INSERT trigger, including when an optional plan shares its transaction.
  const raced = await created({ nombre: 'ficha en carrera', marca: 'marca inicial' });
  const beforeRacedUnit = unitState();
  faults.beforeStatement = {
    matches: sql => /insert\s+into\s+["`]?activos/i.test(sql),
    async run() { expect(await edit(raced.id, { version: 1, marca: 'marca cambiada simultáneamente' })); },
  };
  expect(await createUnit({ rubro: 'aires', modeloAireId: raced.id, modeloAireVersion: 1 }), 409);
  assert.equal(unitState(), beforeRacedUnit);
  assert.equal((await detail(raced.id)).modelo.version, 2);
  faults.beforeBatch = async () => { expect(await edit(raced.id, { version: 2, activo: false })); };
  expect(await createUnit({ rubro: 'aires', modeloAireId: raced.id, modeloAireVersion: 2, mantenimientoFrecuencia: 'mensual' }), 409);
  assert.equal(unitState(), beforeRacedUnit);
  assert.equal((await detail(raced.id)).modelo.activo, false);

  // Source linkage and optional preventive plans participate in one atomic unit
  // registration. An invalid foreign key or failed plan leaves no orphan row.
  for (const data of [{ ubicacionId: 99999 }, { responsableId: 99999 }]) {
    const beforeFailure = state();
    let rejected = false;
    try { rejected = (await createUnit({ rubro: 'aires', modeloAireId: id, modeloAireVersion: 5, ...data })).status >= 400; } catch { rejected = true; }
    assert(rejected);
    assert.equal(state(), beforeFailure);
  }
  const beforePlanFailure = state();
  faults.statement = sql => /insert\s+into\s+["`]?planes_mantenimiento/i.test(sql);
  let planFailed = false;
  try { planFailed = (await createUnit({ rubro: 'aires', modeloAireId: id, modeloAireVersion: 5, mantenimientoFrecuencia: 'mensual' })).status >= 500; } catch { planFailed = true; }
  assert(planFailed);
  assert.equal(state(), beforePlanFailure);
  const withPlan = await unit(reactivated, { mantenimientoFrecuencia: 'mensual', mantenimientoTitulo: ' limpieza de serpentín ' });
  const plan = one('SELECT * FROM planes_mantenimiento WHERE activo_id=?', withPlan.id);
  assert.equal(plan.titulo, 'LIMPIEZA DE SERPENTÍN');
  assert.equal(withPlan.modeloAireId, id);
  assert.equal(parse(withPlan.modeloAireSnapshot).version, 5);

  const noHistoryMutation = catalogState();
  assert.throws(() => sqlite.prepare('UPDATE modelos_aire_historial SET usuario_nombre=? WHERE modelo_aire_id=?').run('Falsificar actor', id));
  assert.throws(() => sqlite.prepare('DELETE FROM modelos_aire_historial WHERE modelo_aire_id=?').run(id));
  assert.throws(() => sqlite.prepare('DELETE FROM modelos_aire WHERE id=?').run(id));
  assert.equal(catalogState(), noHistoryMutation);
  assert.equal(json(rows('SELECT * FROM usuarios ORDER BY id')), usersBefore);
  for (const [table, before] of Object.entries(legacyBefore)) {
    const after = one(`SELECT * FROM ${table} WHERE id=900`);
    assert.equal(json(Object.fromEntries(Object.keys(before).map(key => [key, after[key]]))), json(before));
  }
  assert.deepEqual(rows('PRAGMA foreign_key_check'), []);
  assert.equal(networkCalls, 0);
  console.log(`PASS: ${fixture.requests} solicitudes de catálogo de aires; fichas reutilizables, unidades independientes, datos opcionales, mayúsculas Unicode, versiones concurrentes, trazabilidad inmutable, permisos, migración conservadora y transacciones atómicas.`);
} finally {
  await fixture?.close();
  globalThis.fetch = originalFetch;
  console.error = originalError;
}
