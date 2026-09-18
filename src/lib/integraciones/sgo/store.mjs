/** Transactional source storage for the private correctivos-v1 connector.
 * Reads never publish snapshots or mutate business records. The database, not
 * individual HTTP writers, owns revisions, scoped sequences and withdrawals.
 */
export const ACTIVE_PROFILE = 'correctivos-v1';
export const RESOURCES = Object.freeze(['asset', 'order']);
export const MAINTENANCE_AREAS = Object.freeze(['aires', 'infraestructura', 'equipo_general', 'biomedico']);
const MAX_MATERIALIZED_RECORDS = 100_000;
const AREA_NAMES = Object.freeze({ aires: 'AIRES ACONDICIONADOS', infraestructura: 'INFRAESTRUCTURA', equipo_general: 'EQUIPOS GENERALES', biomedico: 'EQUIPOS BIOMÉDICOS' });

export class SgoStoreError extends Error {
  constructor(status, code) { super(code); this.name = 'SgoStoreError'; this.status = status; this.code = code; }
}
const database = (env) => env?.DB ?? env;
const rows = async (db, sql, values = []) => (await db.prepare(sql).bind(...values).all()).results ?? [];
const scopeValues = (scope) => {
  if (!scope || !/^[1-9]\d*$/.test(String(scope.site_id)) || !MAINTENANCE_AREAS.includes(scope.maintenance_area_id)) throw new SgoStoreError(400, 'invalid_scope');
  return [String(scope.site_id), scope.maintenance_area_id];
};
const sequence = (value) => {
  if (!/^(0|[1-9]\d*)$/.test(String(value)) || BigInt(value) > 9_007_199_254_740_991n) throw new SgoStoreError(400, 'invalid_sequence');
  return String(value);
};

/** Source legacy timestamps are UTC; a civil due date remains a civil date. */
export function utcInstant(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?$/.test(text)) return null;
  if (!civilDate(text.slice(0, 10)) || Number(text.slice(11, 13)) > 23 || Number(text.slice(14, 16)) > 59 || Number(text.slice(17, 19)) > 59) return null;
  const explicitZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(text);
  const parsed = new Date(text.replace(' ', 'T') + (explicitZone ? '' : 'Z'));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
function civilDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
function safeNumber(value, integer = false) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && (!integer || Number.isSafeInteger(value)) ? value : null;
}
/** Only fields constructed by the allowlist SQL views can enter these records. */
export function normalizeRecord(row) {
  const record = JSON.parse(row.payload);
  record.revision = String(row.revision);
  record.updated_at = utcInstant(row.source_updated_at);
  const invalidTimes = [];
  const dateKeys = row.resource === 'order' ? ['created_at', 'assigned_at', 'started_at', 'paused_at', 'completed_at', 'verified_at', 'closed_at'] : ['created_at'];
  for (const key of dateKeys) {
    const original = record[key];
    record[key] = utcInstant(original);
    if (original != null && original !== '' && !record[key]) invalidTimes.push(key);
  }
  if (row.resource === 'order') {
    const due = record.due_raw;
    record.due_date = civilDate(due);
    record.due_at = record.due_date ? null : utcInstant(due);
    if (due != null && due !== '' && !record.due_date && !record.due_at) invalidTimes.push('due_at');
    delete record.due_raw;
    record.assigned = record.assigned === 1;
    record.paused_minutes = safeNumber(record.paused_minutes, true);
    record.automatic_elapsed_hours = safeNumber(record.automatic_elapsed_hours);
    const final = ['completada', 'verificada', 'cerrada'].includes(record.status);
    const reopened = ['abierta', 'en_proceso', 'en_espera'].includes(record.status) && !!(record.completed_at || record.verified_at || record.closed_at);
    const flags = [];
    if (record.status !== 'abierta' && record.status !== 'cancelada' && !record.started_at) flags.push('missing_started_at');
    if (final && !record.completed_at) flags.push('missing_completion');
    if (reopened) flags.push('reopened_legacy_timestamps');
    if (record.scope_origin !== 'explicit_order') flags.push('scope_current_only');
    if (!record.updated_at) flags.push('unknown_updated_at');
    if (invalidTimes.length || (record.completed_at && record.created_at && record.completed_at < record.created_at)) flags.push('invalid_source_timestamp');
    flags.push('deadline_origin_unknown');
    if (reopened || !final || !record.completed_at || !record.created_at || record.completed_at < record.created_at) record.automatic_elapsed_hours = null;
    record.quality_flags = flags;
  }
  return { resource: row.resource, record };
}

export async function getIntegrationSettings(env) {
  const result = await database(env).prepare('SELECT source_instance_id,installed_at,enabled,projection_version,resource_set_version,snapshot_ttl_seconds FROM sgo_instance WHERE id=1').first();
  if (!result) throw new SgoStoreError(503, 'integration_not_configured');
  return { ...result, enabled: result.enabled === 1, active_profile: ACTIVE_PROFILE };
}
function assertEnabled(settings) { if (!settings.enabled) throw new SgoStoreError(503, 'integration_disabled'); }
function snapshotScope(row, version) {
  return { site_id: row.site_id, maintenance_area_id: row.maintenance_area_id,
    through_seq: String(row.through_seq), minimum_available_seq: String(row.minimum_available_seq),
    source_updated_at: row.source_updated_at, history_available_from: row.history_available_from,
    asset_coverage: row.asset_coverage, order_coverage: row.order_coverage,
    active_profile: ACTIVE_PROFILE, projection_version: version.projection_version,
    resource_set_version: version.resource_set_version, admitted_resources: [...RESOURCES] };
}
export async function getPublishedSnapshot(env, snapshotId) {
  const db = database(env);
  assertEnabled(await getIntegrationSettings(db));
  const snapshot = snapshotId
    ? await db.prepare('SELECT * FROM sgo_snapshots WHERE snapshot_id=? AND snapshot_published_at IS NOT NULL').bind(snapshotId).first()
    : await db.prepare('SELECT * FROM sgo_snapshots WHERE snapshot_published_at IS NOT NULL AND snapshot_expires_at>? ORDER BY cutoff_at DESC,snapshot_id DESC LIMIT 1').bind(new Date().toISOString()).first();
  if (!snapshot) throw new SgoStoreError(snapshotId ? 410 : 503, snapshotId ? 'snapshot_expired' : 'snapshot_not_ready');
  if (snapshot.snapshot_expires_at <= new Date().toISOString()) throw new SgoStoreError(410, 'snapshot_expired');
  const scopes = await rows(db, 'SELECT * FROM sgo_snapshot_scopes WHERE snapshot_id=? ORDER BY site_id,maintenance_area_id', [snapshot.snapshot_id]);
  return { ...snapshot, active_profile: ACTIVE_PROFILE, scopes: scopes.map((row) => snapshotScope(row, snapshot)) };
}
export async function loadScopes(env, snapshotId) { return (await getPublishedSnapshot(env, snapshotId)).scopes; }
export const getSnapshot = getPublishedSnapshot;
function requireScope(snapshot, scope) {
  const [site, area] = scopeValues(scope);
  const found = snapshot.scopes.find((row) => row.site_id === site && row.maintenance_area_id === area);
  if (!found) throw new SgoStoreError(404, 'scope_not_found');
  return found;
}
/** The API must pass the already authorized exact pairs, never a Cartesian product. */
export async function getAllowedReferences(env, snapshot, allowedScopes) {
  if (typeof snapshot === 'string' || !snapshot) snapshot = await getPublishedSnapshot(env, snapshot);
  const allowed = new Set(allowedScopes.map((s) => JSON.stringify(scopeValues(s))));
  const all = await rows(database(env), 'SELECT site_id,maintenance_area_id,site_code,site_name,site_active FROM sgo_snapshot_scopes WHERE snapshot_id=? ORDER BY site_id,maintenance_area_id', [snapshot.snapshot_id]);
  const visible = all.filter((s) => allowed.has(JSON.stringify([s.site_id, s.maintenance_area_id])));
  const sites = [...new Map(visible.map((s) => [s.site_id, { id: s.site_id, name: s.site_name, active: s.site_active === 1, updated_at: null }])).values()];
  const areas = [...new Set(visible.map((s) => s.maintenance_area_id))];
  return { sites, maintenance_areas: areas.map((id) => ({ id, name: AREA_NAMES[id] })), allowed_scope_pairs: visible.map(({ site_id, maintenance_area_id }) => ({ site_id, maintenance_area_id })) };
}
export async function listSnapshotRecords(env, snapshotId, scope, resource) {
  if (!RESOURCES.includes(resource)) throw new SgoStoreError(409, 'resource_not_ready');
  const snapshot = await getPublishedSnapshot(env, snapshotId);
  requireScope(snapshot, scope);
  const result = await rows(database(env), 'SELECT resource,id,revision,payload,source_updated_at FROM sgo_snapshot_records WHERE snapshot_id=? AND site_id=? AND maintenance_area_id=? AND resource=? ORDER BY id LIMIT ?', [snapshot.snapshot_id, ...scopeValues(scope), resource, MAX_MATERIALIZED_RECORDS + 1]);
  if (result.length > MAX_MATERIALIZED_RECORDS) throw new SgoStoreError(503, 'snapshot_capacity_exceeded');
  return result.map(normalizeRecord);
}
export const loadRecords = listSnapshotRecords;
export async function listSnapshotChanges(env, snapshotId, scope, afterSeq) {
  const snapshot = await getPublishedSnapshot(env, snapshotId);
  const checkpoint = requireScope(snapshot, scope);
  const after = sequence(afterSeq);
  if (BigInt(after) + 1n < BigInt(checkpoint.minimum_available_seq)) throw new SgoStoreError(410, 'resync_required');
  if (BigInt(after) > BigInt(checkpoint.through_seq)) throw new SgoStoreError(409, 'resync_required');
  const result = await rows(database(env), 'SELECT seq,resource,id,revision,operation,reason,payload,changed_at,source_updated_at FROM sgo_journal WHERE site_id=? AND maintenance_area_id=? AND seq>? AND seq<=? ORDER BY seq LIMIT ?', [...scopeValues(scope), after, checkpoint.through_seq, MAX_MATERIALIZED_RECORDS + 1]);
  if (result.length > MAX_MATERIALIZED_RECORDS) throw new SgoStoreError(503, 'snapshot_capacity_exceeded');
  return result.map((row) => ({ seq: String(row.seq), resource: row.resource, id: row.id,
    changed_at: row.changed_at, operation: row.operation, revision: String(row.revision),
    ...(row.operation === 'upsert' ? { payload: normalizeRecord(row) } : { reason: row.reason }) }));
}
export const loadChanges = listSnapshotChanges;

/** Stable sorted JSON hashing uses Workers WebCrypto, no Node-only runtime. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function sha256(value) {
  const data = new TextEncoder().encode(typeof value === 'string' ? value : canonicalJson(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
/** Internal job only. A single batch freezes metadata, exact pair checkpoints and
 * all records. A second compare-and-seal exposes it only after integrity hashing.
 * Concurrent business writes cannot modify the frozen draft or a published cut.
 * TTL must be an explicit internal configuration, not an assumed retention policy.
 */
export async function publishSnapshot(env, { expiresAt } = {}) {
  const db = database(env);
  const settings = await getIntegrationSettings(db);
  assertEnabled(settings);
  if (expiresAt !== undefined && (!utcInstant(expiresAt) || new Date(expiresAt).getTime() <= Date.now())) throw new SgoStoreError(400, 'invalid_snapshot_expiry');
  if (!expiresAt && !settings.snapshot_ttl_seconds) throw new SgoStoreError(503, 'configuration_required');
  const snapshotId = crypto.randomUUID();
  const explicitExpiry = expiresAt ? utcInstant(expiresAt) : null;
  await db.batch([
    db.prepare(`INSERT INTO sgo_snapshots(snapshot_id,source_instance_id,cutoff_at,projection_version,resource_set_version,snapshot_expires_at)
      SELECT ?,source_instance_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),projection_version,resource_set_version,
      COALESCE(?,strftime('%Y-%m-%dT%H:%M:%fZ','now','+'||snapshot_ttl_seconds||' seconds'))
      FROM sgo_instance WHERE id=1 AND enabled=1 AND (? IS NOT NULL OR snapshot_ttl_seconds>0)`).bind(snapshotId, explicitExpiry, explicitExpiry),
    db.prepare(`INSERT INTO sgo_snapshot_scopes(snapshot_id,site_id,maintenance_area_id,through_seq,minimum_available_seq,source_updated_at,history_available_from,asset_coverage,order_coverage,site_code,site_name,site_active)
      SELECT p.snapshot_id,s.site_id,s.maintenance_area_id,s.seq,s.minimum_available_seq,s.source_updated_at,s.history_available_from,s.asset_coverage,s.order_coverage,
      NULL,COALESCE(b.nombre,s.site_id),COALESCE(b.activa,0)
      FROM sgo_scopes s JOIN sgo_snapshots p ON p.snapshot_id=? LEFT JOIN sucursales b ON CAST(b.id AS TEXT)=s.site_id`).bind(snapshotId),
    db.prepare(`INSERT INTO sgo_snapshot_records(snapshot_id,site_id,maintenance_area_id,resource,id,revision,payload,source_updated_at)
      SELECT p.snapshot_id,e.site_id,e.maintenance_area_id,e.resource,e.id,e.revision,e.payload,e.source_updated_at
      FROM sgo_entities e JOIN sgo_snapshots p ON p.snapshot_id=? WHERE e.site_id IS NOT NULL AND e.deleted=0`).bind(snapshotId),
    db.prepare('UPDATE sgo_snapshots SET materialized=1 WHERE snapshot_id=? AND materialized=0').bind(snapshotId),
  ]);
  const draft = await db.prepare('SELECT * FROM sgo_snapshots WHERE snapshot_id=?').bind(snapshotId).first();
  if (!draft) throw new SgoStoreError(503, 'integration_disabled');
  const scopes = await rows(db, 'SELECT * FROM sgo_snapshot_scopes WHERE snapshot_id=? ORDER BY site_id,maintenance_area_id', [snapshotId]);
  const records = await rows(db, 'SELECT * FROM sgo_snapshot_records WHERE snapshot_id=? ORDER BY site_id,maintenance_area_id,resource,id LIMIT ?', [snapshotId, MAX_MATERIALIZED_RECORDS + 1]);
  if (records.length > MAX_MATERIALIZED_RECORDS) throw new SgoStoreError(503, 'snapshot_capacity_exceeded');
  const sourceHash = await sha256({ snapshot: draft, scopes, records });
  const sealed = await db.prepare(`UPDATE sgo_snapshots SET source_hash=?,snapshot_published_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE snapshot_id=? AND materialized=1 AND source_hash IS NULL AND EXISTS(SELECT 1 FROM sgo_instance WHERE id=1 AND enabled=1 AND projection_version=? AND resource_set_version=?)
    RETURNING snapshot_id`).bind(sourceHash, snapshotId, draft.projection_version, draft.resource_set_version).first();
  if (!sealed) throw new SgoStoreError(409, 'snapshot_configuration_changed');
  return getPublishedSnapshot(db, snapshotId);
}
