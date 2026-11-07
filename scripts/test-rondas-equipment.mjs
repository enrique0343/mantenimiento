// Read-only PM context against SQLite and every real migration. No network/R2.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mantenimiento-rounds-equipment-'));
const sqlite = new DatabaseSync(':memory:');
const now = '2026-10-03T12:00:00.000Z';
const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error('Network forbidden in equipment-context tests'); };
let assertions = 0;
const equal = (actual, expected, message) => { assertions++; assert.deepEqual(actual, expected, message); };
const run = (sql, ...args) => sqlite.prepare(sql).run(...args);
const get = (sql, ...args) => sqlite.prepare(sql).get(...args);
const all = (sql, ...args) => sqlite.prepare(sql).all(...args);
const snapshot = () => JSON.stringify(Object.fromEntries(
  all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .map(({ name }) => [name, all(`SELECT * FROM "${name}"`).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))])));
const queries = [];
function prepared(sql, args = []) {
  // Helpers must only issue read statements. Also assert state after each call.
  assert.match(sql, /^WITH\s/i);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|PRAGMA)\b/i);
  return {
    bind(...values) { return prepared(sql, values); },
    async all() { queries.push(sql); return { success: true, results: all(sql, ...args), meta: {} }; },
  };
}
const DB = {
  prepare: prepared,
  async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = await Promise.all(statements.map(statement => statement.all())); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};

try {
  const filename = path.join(temporary, 'equipment.mjs');
  await build({ entryPoints: [path.join(root, 'src/lib/rondas/equipment.ts')], outfile: filename,
    bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
  const { getEquipmentContext, getAssetMaintenance } = await import(pathToFileURL(filename).href);
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const migration of (await fs.readdir(path.join(root, 'migrations'))).filter(name => /^\d{4}.*\.sql$/.test(name)).sort()) {
    sqlite.exec(await fs.readFile(path.join(root, 'migrations', migration), 'utf8'));
  }
  sqlite.exec(`
    INSERT INTO usuarios(id,nombre,email,password_hash,rol) VALUES
      (1,'Ejecutor','exec@example.invalid','isolated','tecnico'),
      (2,'Verificador','review@example.invalid','isolated','jefe'),
      (3,'Ejecutor anterior','prior@example.invalid','isolated','tecnico');
    INSERT INTO sucursales(id,nombre) VALUES(1,'Hospital principal'),(2,'Otra sede');
    INSERT INTO ubicaciones(id,sucursal_id,nombre,padre_id) VALUES
      (1,1,'Edificio',NULL),(2,1,'Piso',1),(3,1,'Sala',2),(4,1,'Otra sala',NULL),
      (5,2,'Enlace legado entre sedes',1);
    INSERT INTO activos(id,codigo,nombre,ubicacion_id,rubro) VALUES
      (1,'AC-001','Aire raíz',1,'aires'),(2,'AC-002','Aire hijo',2,'aires'),
      (3,'AC-003','Aire nieto',3,'aires'),(4,'AC-004','Fuera de área',4,'aires'),
      (5,'AC-005','Otra sede',5,'aires'),(6,'AC-006','Sin ubicación',NULL,'aires'),
      (7,'AC-007','Sin plan',1,'aires'),(8,'AC-008','Plan inactivo',1,'aires'),
      (9,'AC-009','Fecha de plan inválida',1,'aires'),(10,'AC-010','Vence hoy',1,'aires'),
      (11,'AC-011','Casos de evidencia',2,'aires');
    INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha,activo) VALUES
      (1,1,'Trimestral','trimestral','2026-09-01',1),
      (2,2,'Anual','anual','2027-01-01',1),
      (3,3,'Semanal','semanal','2026-10-02',1),
      (8,8,'Semestral pausado','semestral','2020-01-01',0),
      (9,9,'Fecha inválida','diaria','2026-02-30',1),
      (10,10,'Hoy','quincenal','2026-10-03',1),
      (11,11,'Bimestral','bimestral','2026-11-01',1),
      (12,1,'Segundo plan anual','anual','2027-12-31',1);
    INSERT INTO ordenes(id,titulo,tipo,activo_id,plan_id,creado_por,asignado_a,estado,
      completada_en,verificado_por,verificado_en,trabajos_realizados,verificacion_notas) VALUES
      (101,'Preventivo documentado','preventivo',1,1,1,1,'cerrada','2026-08-01 12:00:00',2,'2026-08-02 12:00:00',NULL,NULL),
      (102,'Cierre automático','preventivo',1,1,1,1,'cerrada','2026-09-25T12:00:00Z',NULL,NULL,'Trabajo realizado',NULL),
      (103,'Correctivo reciente','correctivo',1,1,1,1,'cerrada','2026-10-02T12:00:00Z',2,'2026-10-02T13:00:00Z','Trabajo correctivo','Verificado'),
      (104,'Autoverificación','preventivo',1,1,1,1,'verificada','2026-09-26T12:00:00Z',1,'2026-09-26T13:00:00Z','Trabajo realizado','Autoverificado'),
      (301,'Registro documental suficiente','preventivo',3,3,1,1,'verificada','2026-09-29T12:00:00Z',2,'2026-09-29T13:00:00Z','Revisión y limpieza del filtro','Filtro limpio y funcionamiento comprobado'),
      (1101,'Caso de prueba','preventivo',11,11,1,1,'verificada','2026-10-01T12:00:00Z',2,'2026-10-02T12:00:00Z',NULL,NULL);
    INSERT INTO adjuntos(id,orden_id,usuario_id,nombre,content_type,tamano,r2_key,categoria,created_at) VALUES
      (1,101,1,'Prueba final.jpg','image/jpeg',100,'private/do-not-export','despues','2026-08-01 12:30:00'),
      (2,1101,1,'Trabajo.pdf','application/pdf',200,'private/second','documento','2026-10-01 13:00:00');
  `);
  const initial = snapshot();
  const contexts = await getEquipmentContext(DB, 1, now);
  equal(contexts.map(asset => asset.id).sort((a, b) => a - b), [1,2,3,7,8,9,10,11], 'Descendants included; siblings, unrelated sede and unlocated equipment excluded');
  equal(queries.length, 4, 'Four batched reads regardless of number of equipment');
  equal(snapshot(), initial, 'Full read leaves every real table untouched');
  equal(JSON.parse(JSON.stringify(contexts)), contexts, 'Snapshot is fully JSON-serializable');
  const first = contexts.find(asset => asset.id === 1);
  equal(first.planes.map(plan => plan.frecuencia), ['trimestral', 'anual']);
  equal(first.planes[0].proximaFecha, '2026-09-01');
  equal(first.nextDue, '2026-11-01');
  equal(first.configuredNextDue, '2026-09-01');
  equal(first.scheduleDiscrepancy, true);
  equal(first.planes[0].complianceStatus, 'vigente');
  equal(first.complianceStatus, 'sin_historial', 'A second activity without proof cannot inherit current status');
  equal(first.scheduleStatus, 'vencido');
  equal(first.overdue, false);
  equal(first.configuredOverdue, true);
  equal(first.daysElapsed, 63, 'Elapsed days use execution date, not independent verification date');
  equal(first.lastVerifiedExecution.id, 101);
  equal(first.latestRecordedExecution.id, 104, 'Corrective order cannot satisfy preventive history');
  equal(first.latestUnverifiedExecution.id, 104);
  equal(first.latestUnverifiedExecution.verificationIssues.includes('autoverificacion'), true);
  equal(first.lastVerifiedExecution.evidenceTypes, ['adjunto']);
  equal(first.lastVerifiedExecution.ejecutadoPor, null);
  equal(first.lastVerifiedExecution.ejecutoresIds, []);
  equal(first.lastVerifiedExecution.executorIdentitySource, 'solo_asignacion', 'Legacy assignment is not claimed as actual execution identity');
  equal(first.lastVerifiedExecution.evidence[0].url, '/api/adjuntos/1');
  equal(JSON.stringify(contexts).includes('private/'), false, 'Never reveal storage keys');
  equal(first.planes[1].lastVerifiedExecution, null, 'A different plan cannot borrow execution proof');
  equal(first.planes[1].evidenceStatus, 'sin_evidencia');
  const annual = contexts.find(asset => asset.id === 2);
  equal([annual.evidenceStatus, annual.daysElapsed, annual.overdue, annual.scheduleStatus], ['sin_evidencia', null, false, 'al_dia'], 'Missing history is not schedule-overdue or never-done');
  const documentary = contexts.find(asset => asset.id === 3);
  equal([documentary.evidenceStatus, documentary.overdue, documentary.daysElapsed], ['verificado', false, 4]);
  equal(documentary.lastVerifiedExecution.evidenceTypes, ['registro_trabajo_y_verificacion']);
  equal(documentary.lastVerifiedExecution.evidence, []);
  equal(documentary.lastVerifiedExecution.trabajosRealizados, 'Revisión y limpieza del filtro');
  equal(contexts.find(asset => asset.id === 7).scheduleStatus, 'sin_plan');
  equal([contexts.find(asset => asset.id === 8).scheduleStatus, contexts.find(asset => asset.id === 8).overdue], ['sin_plan', false]);
  equal([contexts.find(asset => asset.id === 9).scheduleStatus, contexts.find(asset => asset.id === 9).nextDue], ['sin_fecha', null]);
  equal(contexts.find(asset => asset.id === 10).overdue, false, 'Date-only schedule stays current throughout due day');
  equal((await getEquipmentContext(DB, 2, now)).map(asset => asset.id).sort((a, b) => a - b), [2,3,11]);
  equal(await getEquipmentContext(DB, 999, now), []);
  equal(await getAssetMaintenance(DB, 999, now), null);
  equal((await getAssetMaintenance(DB, 6, now)).ubicacionId, null);

  // Metadata and independent identities must substantiate every verified claim.
  const detail = async () => {
    const before = snapshot();
    const result = await getAssetMaintenance(DB, 11, now);
    equal(snapshot(), before, 'Each history read preserves state');
    return result;
  };
  equal((await detail()).evidenceStatus, 'verificado');
  const reset = () => {
    run("UPDATE ordenes SET estado='verificada',completada_en='2026-10-01T12:00:00Z',verificado_por=2,verificado_en='2026-10-02T12:00:00Z',asignado_a=1,trabajos_realizados=NULL,verificacion_notas=NULL WHERE id=1101");
    run("UPDATE adjuntos SET tamano=200,r2_key='private/second',categoria='documento',created_at='2026-10-01 13:00:00' WHERE id=2");
  };
  for (const [sql, expectedIssue] of [
    ["UPDATE ordenes SET verificado_por=NULL,verificado_en=NULL,estado='cerrada' WHERE id=1101", 'sin_verificacion'],
    ["UPDATE ordenes SET completada_en=NULL WHERE id=1101", 'sin_fecha_ejecucion'],
    ["UPDATE ordenes SET completada_en='not-a-date' WHERE id=1101", 'fecha_ejecucion_invalida'],
    ["UPDATE ordenes SET verificado_en='not-a-date' WHERE id=1101", 'fecha_verificacion_invalida'],
    ["UPDATE ordenes SET verificado_en='2026-09-30 12:00:00' WHERE id=1101", 'verificacion_anterior'],
    ["UPDATE ordenes SET verificado_en='2026-10-04 12:00:00' WHERE id=1101", 'verificacion_futura'],
    ["UPDATE ordenes SET completada_en='2026-10-04 12:00:00' WHERE id=1101", 'ejecucion_futura'],
    ["UPDATE ordenes SET verificado_por=1 WHERE id=1101", 'autoverificacion'],
    ["UPDATE ordenes SET asignado_a=NULL WHERE id=1101", 'sin_ejecutor_identificado'],
    ["UPDATE ordenes SET estado='en_proceso' WHERE id=1101", 'estado_no_final'],
    ["UPDATE adjuntos SET tamano=0 WHERE id=2", 'sin_evidencia'],
    ["UPDATE adjuntos SET r2_key='' WHERE id=2", 'sin_evidencia'],
    ["UPDATE adjuntos SET categoria='antes' WHERE id=2", 'sin_evidencia'],
    ["UPDATE adjuntos SET created_at='2026-10-03 11:00:00' WHERE id=2", 'sin_evidencia'],
    ["UPDATE adjuntos SET created_at='2026-10-04 11:00:00' WHERE id=2", 'sin_evidencia'],
  ]) {
    reset(); sqlite.exec(sql);
    const asset = await detail();
    equal(asset.evidenceStatus, 'sin_evidencia', sql);
    equal(asset.lastVerifiedExecution, null, sql);
    equal(asset.latestUnverifiedExecution.verificationIssues.includes(expectedIssue), true, sql);
    equal(asset.overdue, false, 'A verification issue cannot change plan schedule');
  }
  reset();
  // The new workflow preserves every executor, even after reassignment.
  run("INSERT INTO orden_verificacion(orden_id,ejecutado_por,executores_json) VALUES(1101,2,'[1,2]')");
  equal((await detail()).latestUnverifiedExecution.verificationIssues.includes('autoverificacion'), true, 'Actual executor cannot verify after an assignee change');
  run("UPDATE orden_verificacion SET ejecutado_por=1,executores_json='[1,2,3]' WHERE orden_id=1101");
  equal((await detail()).evidenceStatus, 'sin_evidencia', 'A prior executor cannot verify either');
  run("UPDATE orden_verificacion SET ejecutado_por=1,executores_json='[1,3]' WHERE orden_id=1101");
  equal((await detail()).evidenceStatus, 'verificado');
  equal((await detail()).lastVerifiedExecution.ejecutoresIds, [1,3]);
  run("UPDATE ordenes SET asignado_a=NULL WHERE id=1101");
  equal((await detail()).lastVerifiedExecution.ejecutadoPor, 1, 'Known actual executor supports independent verification without current assignment');

  // Compliance derives from execution and current frequency, never OT scheduling.
  reset();
  run("UPDATE ordenes SET created_at='2026-09-01T12:00:00Z',completada_en='2026-09-01T12:00:00Z',verificado_en='2026-09-02T12:00:00Z',trabajos_realizados='Trabajo demostrado',verificacion_notas='Comprobación independiente' WHERE id=1101");
  run("UPDATE planes_mantenimiento SET frecuencia='mensual',proxima_fecha='2026-12-31' WHERE id=11");
  run("INSERT INTO ordenes(id,titulo,tipo,activo_id,plan_id,creado_por,asignado_a,estado,created_at,vencimiento) VALUES(1102,'OT para mañana','preventivo',11,11,1,1,'abierta','2026-09-25T12:00:00Z','2026-10-04T12:00:00Z')");
  let motor = await detail();
  let motorPlan = motor.planes[0];
  equal([motorPlan.complianceStatus,motorPlan.nextDue,motorPlan.overdue,motorPlan.configuredNextDue], ['vencido','2026-10-01',true,'2026-12-31']);
  equal(motorPlan.managementStatus, 'programada');
  equal(motorPlan.currentCycleOrders.map(order => order.id), [1102], 'Same asset+plan+current inferred cycle only');
  equal(motorPlan.scheduleDiscrepancy, true);
  const monthlyCycle = motorPlan.cycleId;
  run("UPDATE ordenes SET estado='en_proceso' WHERE id=1102");
  motorPlan = (await detail()).planes[0];
  equal([motorPlan.complianceStatus,motorPlan.managementStatus], ['vencido','en_proceso']);
  run("UPDATE ordenes SET estado='completada',completada_en='2026-10-02T12:00:00Z' WHERE id=1102");
  motorPlan = (await detail()).planes[0];
  equal([motorPlan.complianceStatus,motorPlan.managementStatus,motorPlan.lastVerifiedExecution.id], ['vencido','ejecutada_pendiente_validacion',1101]);
  run("UPDATE ordenes SET estado='abierta',completada_en=NULL WHERE id=1102");
  run("UPDATE planes_mantenimiento SET frecuencia='trimestral' WHERE id=11");
  motorPlan = (await detail()).planes[0];
  equal([motorPlan.complianceStatus,motorPlan.nextDue,motorPlan.managementStatus], ['vigente','2026-12-01','programada'], 'Changed current rule recalculates due without closing the existing OT');
  equal(motorPlan.cycleId === monthlyCycle, false, 'Current-rule cycle key changes with configured frequency');
  equal((await detail()).planes[0].cycleId, motorPlan.cycleId, 'Stable repeated-read cycle key supports deduplication');
  run("INSERT INTO ordenes(id,titulo,tipo,activo_id,plan_id,creado_por,asignado_a,estado,created_at) VALUES(1103,'Otro plan','preventivo',11,1,1,1,'abierta','2026-10-01T12:00:00Z'),(1104,'Correctivo','correctivo',11,11,1,1,'abierta','2026-10-01T12:00:00Z'),(1105,'Ciclo anterior','preventivo',11,11,1,1,'abierta','2026-08-01T12:00:00Z')");
  motorPlan = (await detail()).planes[0];
  equal(motorPlan.currentCycleOrders.map(order => order.id), [1102]);
  equal(motorPlan.pendingOrders.find(order => order.id === 1105).cycleMatch, 'previous');
  equal(motorPlan.pendingOrders.find(order => order.id === 1105).cycleId, null);
  equal(motorPlan.pendingOrders.some(order => [1103,1104].includes(order.id)), false, 'Unrelated activity and random corrective OT do not match');
  run("UPDATE planes_mantenimiento SET frecuencia='legado_desconocido' WHERE id=11");
  motorPlan = (await detail()).planes[0];
  equal([motorPlan.complianceStatus,motorPlan.nextDue,motorPlan.overdue], ['sin_config',null,false], 'Unsupported frequency never defaults to monthly');
  run("UPDATE planes_mantenimiento SET frecuencia='mensual' WHERE id=11");
  run("UPDATE ordenes SET verificado_por=NULL,verificado_en=NULL WHERE id=1101");
  motorPlan = (await detail()).planes[0];
  equal([motorPlan.complianceStatus,motorPlan.nextDue,motorPlan.overdue], ['sin_historial',null,false], 'Open OT cannot substitute for missing verified history');
  equal(motorPlan.currentCycleOrders, []);
  equal(motorPlan.pendingOrders.every(order => order.cycleMatch === 'unknown'), true);

  // Bad location trees do not loop. Paused location nodes still preserve assets.
  run('UPDATE ubicaciones SET padre_id=3,activa=0 WHERE id=1');
  equal((await getEquipmentContext(DB, 1, now)).map(asset => asset.id).sort((a, b) => a - b), [1,2,3,7,8,9,10,11]);
  for (const id of [0, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(() => getAssetMaintenance(DB, id, now), RangeError);
    await assert.rejects(() => getEquipmentContext(DB, id, now), RangeError);
  }
  for (const badNow of ['bad', '2026-02-30', '2026-13-01']) await assert.rejects(() => getAssetMaintenance(DB, 1, badNow), RangeError);
  equal(networkCalls, 0);
  equal(all('PRAGMA foreign_key_check'), []);
  equal(snapshot() === initial, false, 'Tests intentionally varied fixture data after immutable-read assertions');
  console.log(`PASS rounds equipment: ${assertions} assertions; all real migrations; descendant scope, real schedules, independent proof, documentary evidence, read-only snapshots`);
} finally {
  globalThis.fetch = originalFetch;
  sqlite.close();
  await fs.rm(temporary, { recursive: true, force: true });
}
