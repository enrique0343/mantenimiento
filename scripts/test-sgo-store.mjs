import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { unstable_splitSqlQuery } from 'wrangler';
import * as store from '../src/lib/integraciones/sgo/store.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let assertions = 0;
function check(...args) { assertions++; assert.deepEqual(...args); }
function fixture(seed = true) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const name of fs.readdirSync(path.join(root, 'migrations')).filter((name) => /^\d{4}.*\.sql$/.test(name)).sort()) {
    if (name.startsWith('0050') && seed) sqlite.exec(`
      INSERT INTO usuarios(id,nombre,email,password_hash,rol) VALUES(1,'PERSONA SECRETA','secret@example.invalid','fixture','admin');
      INSERT INTO sucursales(id,nombre) VALUES(1,'SEDE A'),(2,'SEDE B');
      INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo) VALUES(1,1,'UBICACIÓN PRIVADA','sala'),(2,2,'OTRA UBICACIÓN','sala');
      INSERT INTO activos(id,codigo,nombre,rubro,ubicacion_id,serial,descripcion,created_at) VALUES(1,'CÓDIGO LIBRE PRIVADO','NOMBRE PRIVADO','aires',1,'SERIE PRIVADA','DATOS PRIVADOS','2026-01-01 08:00:00');
      INSERT INTO ordenes(id,titulo,descripcion,tipo,estado,rubro,activo_id,sucursal_id,creado_por,created_at,vencimiento)
      VALUES(1,'TÍTULO PRIVADO','RELATO PRIVADO','correctivo','abierta','aires',1,1,1,'2026-01-01 10:00:00','2026-01-31');
    `);
    const source = fs.readFileSync(path.join(root, 'migrations', name), 'utf8');
    if (name.startsWith('0050')) {
      const statements = unstable_splitSqlQuery(source);
      assert(statements.length > 50, 'Wrangler must not collapse CASE/END trigger bodies with subsequent statements');
      for (const statement of statements) {
        assert((statement.match(/CREATE TRIGGER/g) ?? []).length <= 1, 'one complete trigger per D1 statement');
        sqlite.exec(statement);
      }
    } else sqlite.exec(source);
  }
  const faults = { beforeBatch: null, batchFailure: -1, beforeStatement: null, writes: 0 };
  function prepare(sql, args = []) {
    const exec = () => { if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) faults.writes++; return sqlite.prepare(sql).all(...args); };
    async function before() { const hook = faults.beforeStatement; if (hook && hook.matches(sql)) { faults.beforeStatement = null; await hook.run(); } }
    return { sql, bind(...values) { return prepare(sql, values); }, execute: exec,
      async all() { await before(); return { results: exec(), success: true }; },
      async first() { await before(); return exec()[0] ?? null; },
      async run() { await before(); exec(); return { success: true }; } };
  }
  const DB = { prepare, async batch(statements) {
    const hook = faults.beforeBatch; faults.beforeBatch = null; await hook?.();
    sqlite.exec('BEGIN IMMEDIATE');
    try { const result = statements.map((s, i) => { if (i === faults.batchFailure) throw Error('injected batch failure'); return { results: s.execute() }; }); sqlite.exec('COMMIT'); return result; }
    catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    finally { faults.batchFailure = -1; }
  } };
  return { sqlite, DB, faults };
}
const { sqlite: db, DB, faults } = fixture();
const scalar = (sql, ...params) => Object.values(db.prepare(sql).get(...params))[0];
const state = (resource, id) => db.prepare('SELECT * FROM sgo_entities WHERE resource=? AND id=?').get(resource, String(id));
const events = (resource, id) => db.prepare('SELECT * FROM sgo_journal WHERE resource=? AND id=? ORDER BY revision,site_id,seq').all(resource, String(id));
const A = { site_id: '1', maintenance_area_id: 'aires' }, B = { site_id: '2', maintenance_area_id: 'aires' };
const initialUsers = JSON.stringify(db.prepare('SELECT * FROM usuarios').all());
check(state('asset', 1).revision, 1);
check(state('order', 1).source_updated_at, null);
check(scalar('SELECT count(*) FROM sgo_scopes'), 8);
check(scalar('SELECT count(*) FROM sgo_refresh'), 0);
assert.match((await store.getIntegrationSettings(DB)).source_instance_id, /^[0-9a-f-]{36}$/);
const other = fixture(false);
assert.notEqual((await store.getIntegrationSettings(DB)).source_instance_id, (await store.getIntegrationSettings(other.DB)).source_instance_id); other.sqlite.close();
await assert.rejects(store.publishSnapshot(DB), { code: 'integration_disabled' });
db.exec('UPDATE sgo_instance SET enabled=1');
await assert.rejects(store.publishSnapshot(DB), { code: 'configuration_required' });
await assert.rejects(store.getPublishedSnapshot(DB), { code: 'snapshot_not_ready' });
db.exec('UPDATE sgo_instance SET snapshot_ttl_seconds=7200');
const first = await store.publishSnapshot(DB);
check(first.scopes.length, 8);
check(first.scopes.every((s) => s.order_coverage === 'unknown' && s.asset_coverage === 'unknown'), true);
check(first.scopes.find((s) => s.site_id === '1' && s.maintenance_area_id === 'aires').source_updated_at, null);
assert.match(first.source_hash, /^[0-9a-f]{64}$/);
const initialRecords = await store.listSnapshotRecords(DB, first.snapshot_id, A, 'order');
check(initialRecords[0].record.updated_at, null);
check(initialRecords[0].record.created_at, '2026-01-01T10:00:00.000Z');
check(initialRecords[0].record.due_at, null);
check(initialRecords[0].record.due_date, '2026-01-31');
check(initialRecords[0].record.quality_flags.includes('unknown_updated_at'), true);
const serialized = JSON.stringify(await store.listSnapshotRecords(DB, first.snapshot_id, A, 'asset')) + JSON.stringify(initialRecords);
for (const forbidden of ['PRIVAD', 'SECRETA', 'SERIE', 'RELATO', '@example', 'descripcion', 'asignado_a', 'creado_por', 'costo', 'nombre']) assert(!serialized.includes(forbidden), forbidden);
const readsBefore = faults.writes;
await store.getPublishedSnapshot(DB, first.snapshot_id);
await store.getAllowedReferences(DB, first, [A]);
await store.listSnapshotRecords(DB, first.snapshot_id, A, 'asset');
await store.listSnapshotChanges(DB, first.snapshot_id, A, '0');
check(faults.writes, readsBefore, 'all GET helpers are read-only');
for (const sql of [
 "UPDATE sgo_journal SET revision=9", "DELETE FROM sgo_journal", "UPDATE sgo_snapshots SET source_hash='wrong'",
 "DELETE FROM sgo_snapshots", "UPDATE sgo_snapshot_records SET revision=9", "DELETE FROM sgo_snapshot_scopes",
 `INSERT INTO sgo_snapshot_records SELECT snapshot_id,site_id,maintenance_area_id,resource,'999',revision,payload,source_updated_at FROM sgo_snapshot_records LIMIT 1`,
 "UPDATE sgo_instance SET source_instance_id='new'", "UPDATE sgo_scopes SET seq=0 WHERE seq>0",
 "DELETE FROM sgo_entities", "UPDATE sgo_entities SET revision=99", "UPDATE sgo_instance SET bootstrapping=1",
]) assert.throws(() => db.exec(sql), /sgo_/);
const startCount = scalar('SELECT count(*) FROM sgo_journal');
db.exec("UPDATE ordenes SET titulo='OTRO TEXTO PRIVADO',descripcion='OTRA NOTA' WHERE id=1");
check(scalar('SELECT count(*) FROM sgo_journal'), startCount, 'unexported narrative does not leak an update event');
db.exec("UPDATE ordenes SET estado='en_proceso',iniciada_en='2026-01-02 08:00:00' WHERE id=1");
check(state('order', 1).revision, 2);
assert(state('order', 1).source_updated_at);
check((await store.listSnapshotRecords(DB, first.snapshot_id, A, 'order'))[0].record.status, 'abierta', 'published cut cannot change');

// Indirect asset movement does not move an explicitly scoped order.
db.exec('UPDATE activos SET ubicacion_id=2 WHERE id=1');
check(state('asset', 1).site_id, '2');
check(state('order', 1).site_id, '1');
check(JSON.parse(state('order', 1).payload).asset_id, null, 'cross-scope association redacted');
const moved = events('asset', 1).filter((e) => e.revision === 2);
check(moved.map((e) => [e.site_id, e.operation, e.revision]), [['1','remove',2],['2','upsert',2]]);
check(moved[0].reason, 'scope_changed'); check(moved[0].payload, null);

// Indirect order scope follows the asset, including A->B->A, independently of explicit orders.
db.exec(`INSERT INTO ordenes(id,titulo,rubro,activo_id,creado_por) VALUES(2,'PRIVADO','aires',1,1)`);
check(state('order', 2).site_id, '2');
db.exec('UPDATE activos SET ubicacion_id=1 WHERE id=1');
check(state('order', 2).site_id, '1');
check(state('order', 2).revision, 2);
db.exec('UPDATE activos SET ubicacion_id=2 WHERE id=1');
check(state('order', 2).site_id, '2'); check(state('order', 2).revision, 3);
check(events('order', 2).filter((e) => e.revision > 1).length, 4);

// A conflict/unknown scope withdraws prior membership; no default from tipo/name.
db.exec("UPDATE activos SET rubro=NULL WHERE id=1");
check(state('asset', 1).site_id, null); check(state('order', 2).site_id, null);
check(events('asset', 1).at(-1).operation, 'remove');
db.exec("UPDATE activos SET rubro='aires' WHERE id=1");
check(state('asset', 1).site_id, '2');
db.exec('UPDATE ordenes SET ubicacion_id=2 WHERE id=1');
check(state('order', 1).site_id, null, 'explicit site versus own location conflict excluded');
db.exec('UPDATE ordenes SET ubicacion_id=NULL WHERE id=1');
check(state('order', 1).site_id, '1');

// Activity-derived orders without assets; update activity, location, then site.
db.exec(`INSERT INTO actividades(id,codigo,titulo,rubro,sucursal_id,frecuencia,proxima_fecha) VALUES(1,'ACT','PRIVADO','aires',1,'mensual','2026-02-01');
 INSERT INTO ordenes(id,titulo,rubro,actividad_id,creado_por) VALUES(3,'PRIVADO','aires',1,1);`);
check(state('order', 3).site_id, '1'); check(JSON.parse(state('order', 3).payload).scope_origin, 'activity_current');
db.exec('UPDATE actividades SET sucursal_id=2 WHERE id=1'); check(state('order', 3).site_id, '2');
db.exec('UPDATE ubicaciones SET sucursal_id=1 WHERE id=2');
check(state('asset', 1).site_id, '1'); check(state('order', 2).site_id, '1');
db.exec('UPDATE sucursales SET activa=0 WHERE id=1');
check(state('asset', 1).site_id, null); check(state('order', 1).site_id, null); check(state('order', 2).site_id, null);
db.exec('UPDATE sucursales SET activa=1 WHERE id=1');
check(state('asset', 1).site_id, '1'); check(state('order', 1).site_id, '1');
db.exec('UPDATE ubicaciones SET activa=0 WHERE id=2'); check(state('asset', 1).site_id, null);
db.exec('UPDATE ubicaciones SET activa=1 WHERE id=2'); check(state('asset', 1).site_id, '1');

// Bulk statement rollback: a trigger failure after another row prevents partial business/journal writes.
const preBulk = JSON.stringify(db.prepare('SELECT id,estado FROM ordenes ORDER BY id').all());
const preJournal = scalar('SELECT count(*) FROM sgo_journal');
db.exec("CREATE TEMP TRIGGER fail_sgo_journal BEFORE INSERT ON sgo_journal WHEN NEW.resource='order' AND NEW.id='2' BEGIN SELECT RAISE(ABORT,'injected journal failure'); END");
assert.throws(() => db.exec("UPDATE ordenes SET estado='en_espera'"), /injected/);
check(JSON.stringify(db.prepare('SELECT id,estado FROM ordenes ORDER BY id').all()), preBulk);
check(scalar('SELECT count(*) FROM sgo_journal'), preJournal);
db.exec('DROP TRIGGER fail_sgo_journal');
db.exec("UPDATE ordenes SET estado='en_espera'");
check(scalar("SELECT count(*) FROM ordenes WHERE estado='en_espera'"), 3);

// Deletes retain identities and scoped tombstones, also across bulk deletes.
db.exec('DELETE FROM ordenes WHERE id IN(2,3)');
check(state('order', 2).deleted, 1); check(state('order', 3).deleted, 1);
check(events('order', 2).at(-1).reason, 'deleted');
db.exec("INSERT INTO activos(id,codigo,nombre,rubro,ubicacion_id) VALUES(77,'D','PRIVADO','aires',1)");
db.exec('DELETE FROM activos WHERE id=77'); check(state('asset', 77).deleted, 1);
check(events('asset', 77).at(-1).reason, 'deleted');
check(scalar('SELECT count(*) FROM sgo_refresh'), 0);

// Copy metadata/checkpoints and records in one transaction; fail leaves no draft.
const snapshotsBefore = scalar('SELECT count(*) FROM sgo_snapshots');
faults.batchFailure = 2;
await assert.rejects(store.publishSnapshot(DB), /injected batch/);
check(scalar('SELECT count(*) FROM sgo_snapshots'), snapshotsBefore);
// Business mutation between materialization and seal cannot alter the captured cut.
faults.beforeStatement = { matches: (sql) => sql.startsWith('SELECT * FROM sgo_snapshots WHERE snapshot_id='), run: () => db.exec("UPDATE ordenes SET estado='completada',completada_en='2026-01-03 09:00:00' WHERE id=1") };
const frozen = await store.publishSnapshot(DB);
check((await store.listSnapshotRecords(DB, frozen.snapshot_id, A, 'order'))[0].record.status, 'en_espera');
check(JSON.parse(state('order', 1).payload).status, 'completada');
const next = await store.publishSnapshot(DB);
check((await store.listSnapshotRecords(DB, next.snapshot_id, A, 'order'))[0].record.status, 'completada');
const from = frozen.scopes.find((s) => s.site_id === '1' && s.maintenance_area_id === 'aires').through_seq;
const delta = await store.listSnapshotChanges(DB, next.snapshot_id, A, from);
check(delta.length, 1); check(delta[0].payload.record.status, 'completada');
assert(BigInt(delta[0].seq) > BigInt(from));
const lastSeq = scalar("SELECT seq FROM sgo_scopes WHERE site_id='1' AND maintenance_area_id='aires'");
db.exec("UPDATE sgo_instance SET projection_version='correctivos-projection-test-2',resource_set_version='correctivos-resources-test-2'");
const newVersion = await store.publishSnapshot(DB);
check(newVersion.projection_version, 'correctivos-projection-test-2');
check(scalar("SELECT seq FROM sgo_scopes WHERE site_id='1' AND maintenance_area_id='aires'"), lastSeq);
check((await store.listSnapshotRecords(DB, newVersion.snapshot_id, A, 'order')).length, 1, 'new versions still contain unchanged legacy rows');
await assert.rejects(store.listSnapshotRecords(DB, next.snapshot_id, A, 'plan'), { code: 'resource_not_ready' });
await assert.rejects(store.listSnapshotChanges(DB, next.snapshot_id, A, '999999'), { code: 'resync_required' });
const visible = await store.getAllowedReferences(DB, next, [A]);
check(visible.sites.map((s) => s.id), ['1']); check(visible.maintenance_areas.map((s) => s.id), ['aires']);
check(visible.allowed_scope_pairs, [A]);
check(JSON.stringify(db.prepare('SELECT * FROM usuarios').all()), initialUsers, 'all user records unchanged');
check(db.prepare('PRAGMA foreign_key_check').all(), []);
check(store.utcInstant('2026-02-30T01:00:00Z'), null);
check(store.utcInstant('2026-01-01'), null);
check(store.utcInstant('2026-01-01T23:00:00-06:00'), '2026-01-02T05:00:00.000Z');
// Configuration races cannot publish a mixed-version or disabled cut.
const visibleBefore = scalar('SELECT count(*) FROM sgo_snapshots WHERE snapshot_published_at IS NOT NULL');
faults.beforeBatch = () => db.exec('UPDATE sgo_instance SET enabled=0');
await assert.rejects(store.publishSnapshot(DB), { code: 'integration_disabled' });
check(scalar('SELECT count(*) FROM sgo_snapshots WHERE snapshot_published_at IS NOT NULL'), visibleBefore);
db.exec('UPDATE sgo_instance SET enabled=1');
faults.beforeStatement = { matches: (sql) => sql.startsWith('UPDATE sgo_snapshots SET source_hash='), run: () => {
  // Frozen draft cannot accept an extra row even before it is published.
  assert.throws(() => db.exec(`INSERT INTO sgo_snapshot_records SELECT snapshot_id,site_id,maintenance_area_id,resource,'98765',revision,payload,source_updated_at FROM sgo_snapshot_records WHERE snapshot_id IN(SELECT snapshot_id FROM sgo_snapshots WHERE snapshot_published_at IS NULL) LIMIT 1`), /sgo_snapshot_immutable/);
  db.exec("UPDATE sgo_instance SET projection_version='correctivos-projection-test-3'");
} };
await assert.rejects(store.publishSnapshot(DB), { code: 'snapshot_configuration_changed' });
check(scalar('SELECT count(*) FROM sgo_snapshots WHERE snapshot_published_at IS NOT NULL'), visibleBefore);
// Latest source does not overwrite previous sealed snapshots during retries.
check((await store.getPublishedSnapshot(DB, first.snapshot_id)).projection_version, 'correctivos-projection-1');
const expired = await store.publishSnapshot(DB, { expiresAt: new Date(Date.now() + 1000).toISOString() });
await new Promise((resolve) => setTimeout(resolve, 1100));
await assert.rejects(store.getPublishedSnapshot(DB, expired.snapshot_id), { code: 'snapshot_expired' });
db.close();
console.log(`PASS: SGO storage (${assertions} exact assertions + rejection/immutability/privacy cases). Real migrations, scoped journal, bulk rollback, indirect moves/deletes, immutable transactional snapshots, no network.`);
