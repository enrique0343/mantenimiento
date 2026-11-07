import { authenticate, authorize, canonical, CONTRACT_VERSION, errorResponse, fail, instant, dateOnly, PREFIX, PROFILE, sameScope, scopeKey, sha256, signToken, verifyToken, validId, AREAS, SgoError, secretEqual } from './security.mjs';
import { computeKpis, FORMULA_VERSION, METRIC_IDS, metricCatalog, period, validMetric } from './kpis.mjs';

const RESOURCES = ['asset', 'order', 'plan', 'activity', 'order_event', 'preventive_occurrence', 'worklog', 'downtime'];
const required = (query, name) => { const v = query.get(name); if (!v) fail(400, 'invalid_request'); return v; };
const sequence = value => typeof value === 'string' && /^(0|[1-9]\d{0,30})$/.test(value);
const publicScope = s => ({ site_id: s.site_id, maintenance_area_id: s.maintenance_area_id });
const safeLabel = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 160) : '';
const pick = (object, fields) => Object.fromEntries(fields.map(field => [field, object[field] ?? null]));
const codeAllowed = ['missing_started_at','missing_completion','reopened_legacy_timestamps','scope_current_only','unknown_updated_at','invalid_source_timestamp','deadline_origin_unknown'];
const baseFields = ['id','site_id','maintenance_area_id','scope_origin','created_at','updated_at','revision'];
const assetFields = ['display_code','location_id','status','criticality'];
const orderFields = ['asset_id','plan_id','activity_id','location_id','type','status','priority','assigned','assigned_at','started_at','paused_at','paused_minutes','due_at','due_date','completed_at','verified_at','closed_at','automatic_elapsed_hours','duration_kind','due_basis','quality_flags'];
export function safeRecord(item, scope) {
  if (!item || !['asset','order'].includes(item.resource) || !sameScope(item.record, scope)) fail(503, 'temporarily_unavailable');
  const v = pick(item.record, [...baseFields, ...(item.resource === 'asset' ? assetFields : orderFields)]);
  if (!validId(v.id) || !sequence(v.revision) || !['explicit_order','location_current','activity_current','unknown'].includes(v.scope_origin)) fail(503, 'temporarily_unavailable');
  if (v.scope_origin === 'unknown') fail(503, 'temporarily_unavailable');
  for (const name of Object.keys(v)) {
    if (name.endsWith('_at')) v[name] = instant(v[name]);
    if (name.endsWith('_id') && name !== 'maintenance_area_id' && v[name] !== null && !validId(v[name])) fail(503, 'temporarily_unavailable');
  }
  if (item.resource === 'asset') {
    if (!['operativo','averiado','mantenimiento','baja'].includes(v.status)) fail(503, 'temporarily_unavailable');
    if (![null,'alta','media','baja'].includes(v.criticality)) v.criticality = null;
    v.display_code = typeof v.display_code === 'string' && /^[A-Z0-9_-]{1,64}$/.test(v.display_code) ? v.display_code : null;
  } else {
    if (!['preventivo','correctivo','predictivo'].includes(v.type) || !['abierta','en_proceso','en_espera','completada','verificada','cerrada','cancelada'].includes(v.status) || !['baja','media','alta','urgente'].includes(v.priority)) fail(503, 'temporarily_unavailable');
    v.assigned = v.assigned === true; v.due_date = dateOnly(v.due_date); v.duration_kind = 'workflow_elapsed_minus_recorded_wait';
    v.due_basis = ['manual','asset_sla','preventive_schedule'].includes(v.due_basis) ? v.due_basis : 'legacy_unknown';
    v.paused_minutes = Number.isInteger(v.paused_minutes) && v.paused_minutes >= 0 ? v.paused_minutes : null;
    v.automatic_elapsed_hours = Number.isFinite(v.automatic_elapsed_hours) && v.automatic_elapsed_hours >= 0 ? v.automatic_elapsed_hours : null;
    v.quality_flags = Array.isArray(v.quality_flags) ? v.quality_flags.filter(x => codeAllowed.includes(x)) : [];
  }
  return { resource: item.resource, record: v };
}
function safeChange(change, scope) {
  if (!change || !sequence(change.seq) || !sequence(change.revision) || !validId(change.id) || !['asset','order'].includes(change.resource) || !instant(change.changed_at)) fail(503, 'temporarily_unavailable');
  const v = { seq: change.seq, resource: change.resource, id: change.id, changed_at: instant(change.changed_at), operation: change.operation, revision: change.revision };
  if (v.operation === 'upsert') {
    v.payload = safeRecord(change.payload, scope);
    if (v.payload.resource !== v.resource || v.payload.record.id !== v.id || v.payload.record.revision !== v.revision) fail(503, 'temporarily_unavailable');
  } else if (v.operation === 'remove' && ['deleted','scope_changed'].includes(change.reason)) v.reason = change.reason;
  else fail(503, 'temporarily_unavailable');
  return v;
}
function checkpointOf(snapshot, scope) {
  const found = snapshot.scopes.find(s => sameScope(s, scope));
  if (!found) fail(404, 'not_found');
  if (!sequence(found.through_seq) || !sequence(found.minimum_available_seq)) fail(503, 'temporarily_unavailable');
  return found;
}
function metadata(snapshot, allowed, scope, p, requestId, now) {
  const checkpoints = scope ? [checkpointOf(snapshot, scope)] : snapshot.scopes.filter(s => allowed.some(a => sameScope(a,s)));
  const updates = checkpoints.map(s => instant(s.source_updated_at)).filter(Boolean).sort();
  const histories = checkpoints.map(s => instant(s.history_available_from));
  return { source_system: 'mantenimiento', source_instance_id: snapshot.source_instance_id, contract_version: CONTRACT_VERSION, snapshot_id: snapshot.snapshot_id, cutoff_at: snapshot.cutoff_at, snapshot_published_at: snapshot.snapshot_published_at, through_seq: scope ? checkpoints[0].through_seq : null, source_updated_at: updates.at(-1) ?? null, time_zone: 'America/El_Salvador', scope: scope ? publicScope(scope) : null, period: p ?? null, timestamp_semantics: 'source_utc', request_id: requestId, generated_at: new Date(now).toISOString(), history_available_from: histories.length && histories.every(Boolean) ? histories.sort().at(-1) : null, active_profile: PROFILE, projection_version: snapshot.projection_version, resource_set_version: snapshot.resource_set_version };
}
function validateQuery(url, endpoint) {
  const common = ['site_id','maintenance_area_id','snapshot_id','limit','cursor'];
  const extras = { meta: ['snapshot_id'], references: ['snapshot_id'], records: [...common,'resource','record_id','period_start','period_end','date_basis','updated_since'], changes: [...common,'after_seq','updated_since','projection_version','resource_set_version'], kpis: ['site_id','maintenance_area_id','snapshot_id','period_start','period_end','metric_ids'], evidence: common }[endpoint];
  if (!extras) fail(404, 'not_found');
  for (const key of url.searchParams.keys()) if (!extras.includes(key) || url.searchParams.getAll(key).length !== 1) fail(400, 'invalid_request');
}
function versions(snapshot) { return { projection_version: snapshot.projection_version, resource_set_version: snapshot.resource_set_version }; }
function numericSort(a, b) { const x=BigInt(a), y=BigInt(b); return x < y ? -1 : x > y ? 1 : 0; }
export function createSgoApi({ store, keyResolver, clock = () => Date.now() }) {
  return async function handle(request, env) {
    const requestId = crypto.randomUUID();
    try {
      if (env?.SGO_INTEGRATION_ENABLED !== 'true') fail(503, 'temporarily_unavailable');
      if (request.method !== 'GET') fail(405, 'method_not_allowed');
      const now = clock();
      const { config, principal } = await authenticate(request, env, { keyResolver, now });
      const url = new URL(request.url), route = url.pathname.slice(PREFIX.length).replace(/\/$/, '');
      const evidenceMatch = route.match(/^\/kpis\/([^/]+)\/evidence$/);
      const endpoint = evidenceMatch ? 'evidence' : route.slice(1);
      validateQuery(url, endpoint);
      const q = url.searchParams;
      let scope = null;
      if (!['meta','references'].includes(endpoint)) {
        scope = { site_id: required(q,'site_id'), maintenance_area_id: required(q,'maintenance_area_id') };
        if (!validId(scope.site_id) || !AREAS.includes(scope.maintenance_area_id)) fail(400, 'invalid_request');
        authorize(principal, scope, now); required(q, 'snapshot_id');
      }
      const snapshotId = q.get('snapshot_id');
      if (snapshotId && !/^[A-Za-z0-9_.-]{1,128}$/.test(snapshotId)) fail(400, 'invalid_request');
      const snapshot = await store.getPublishedSnapshot(env, snapshotId ?? undefined);
      if (!snapshot || !Array.isArray(snapshot.scopes) || !instant(snapshot.cutoff_at) || !instant(snapshot.snapshot_expires_at) || Date.parse(snapshot.snapshot_expires_at) <= now) fail(410, 'snapshot_expired');
      const checkpoint = scope ? checkpointOf(snapshot, scope) : null;
      const visible = snapshot.scopes.filter(s => principal.scopes.some(a => sameScope(a,s)));
      const decodedCursor = q.has('cursor') ? await verifyToken('cursor', required(q, 'cursor'), config) : null;
      if (endpoint === 'changes' && !q.has('after_seq') && decodedCursor?.after_seq !== undefined) q.set('after_seq', decodedCursor.after_seq);
      const context = { path: url.pathname, principal: principal.id, grantVersion: principal.grantVersion, snapshot: snapshot.snapshot_id, scope, endpoint, ...versions(snapshot), filters: Object.fromEntries([...q.entries()].filter(([key]) => key !== 'cursor').sort()) };
      const binding = await sha256(context);
      let limit = q.has('limit') ? Number(q.get('limit')) : 100;
      if (q.has('limit') && !/^\d{1,3}$/.test(q.get('limit')) || !Number.isInteger(limit) || limit < 1 || limit > 200) fail(400, 'invalid_request');
      let position = 0;
      if (q.has('cursor')) {
        const cursor = decodedCursor;
        if (cursor.binding !== binding || !Number.isSafeInteger(cursor.position) || cursor.position < 0) fail(400, 'invalid_request');
        position = cursor.position;
      }
      let response;
      const meta = (p) => metadata(snapshot, principal.scopes, scope, p, requestId, now);
      const paginate = async (rows, cursorExtra = {}) => {
        if (rows.length > 20000 || position > rows.length) fail(503, 'temporarily_unavailable');
        const data = rows.slice(position, position + limit), has_more = position + limit < rows.length;
        const grantExpires = scope ? Date.parse(authorize(principal, scope, now).valid_until) : principal.expires;
        const expires = Math.min(now + 15 * 60000, Date.parse(snapshot.snapshot_expires_at), principal.expires, grantExpires);
        const next_cursor = has_more ? await signToken('cursor', { binding, position: position + limit, ...cursorExtra }, config, expires) : null;
        return { pagination: { limit, next_cursor, has_more }, data };
      };
      if (endpoint === 'meta') {
        response = { meta: meta(), allowed_scope_pairs: principal.scopes.map(publicScope), readiness: { status: 'partial', resources: RESOURCES.map(resource => ({ resource, state: ['asset','order'].includes(resource) ? 'ready' : 'pending', reason_code: ['asset','order'].includes(resource) ? 'published_projection' : 'outside_active_profile', supported_date_bases: resource === 'order' ? ['created','completed','due'] : [] })), incremental_ready: true, minimum_available_seq: null, snapshot_expires_at: snapshot.snapshot_expires_at, scope_checkpoints: visible.map(s => ({ scope: publicScope(s), through_seq: s.through_seq, minimum_available_seq: s.minimum_available_seq, active_profile: PROFILE, ...versions(snapshot), admitted_resources: ['asset','order'] })), active_profile: PROFILE, ...versions(snapshot), admitted_resources: ['asset','order'], admitted_metric_ids: [...METRIC_IDS], bootstrap_policy: 'full_scope_on_projection_or_resource_set_change' }, metric_catalog: metricCatalog() };
      } else if (endpoint === 'references') {
        const refs = await store.getAllowedReferences(env, snapshot, principal.scopes.map(publicScope));
        const ids = new Set(principal.scopes.map(x => x.site_id)), areas = new Set(principal.scopes.map(x => x.maintenance_area_id));
        response = { meta: meta(), sites: (refs.sites ?? []).filter(x => ids.has(x.id)).map(x => ({ id: x.id, name: safeLabel(x.name), active: x.active === true, updated_at: instant(x.updated_at) })), maintenance_areas: (refs.maintenance_areas ?? []).filter(x => areas.has(x.id)).map(x => ({ id: x.id, name: safeLabel(x.name) })), allowed_scope_pairs: principal.scopes.map(publicScope) };
      } else if (endpoint === 'records') {
        const resource = required(q, 'resource');
        if (!RESOURCES.includes(resource)) fail(400, 'invalid_request');
        if (!['asset','order'].includes(resource)) fail(409, 'resource_not_ready');
        if (q.has('record_id') && (!validId(q.get('record_id')) || q.has('cursor') || q.has('limit'))) fail(400,'invalid_request');
        const hasPeriod = q.has('period_start') || q.has('period_end') || q.has('date_basis');
        let p = null;
        if (hasPeriod) {
          if (resource !== 'order' || !['created','completed','due'].includes(required(q,'date_basis'))) fail(400,'invalid_request');
          p = period(required(q,'period_start'), required(q,'period_end'), snapshot.cutoff_at); p.date_basis = q.get('date_basis');
        }
        let rows = (await store.listSnapshotRecords(env, snapshot.snapshot_id, scope, resource)).map(x => safeRecord(x, scope));
        if (rows.length > 20000) fail(503, 'temporarily_unavailable');
        if (q.has('updated_since')) {
          const since = instant(required(q,'updated_since')); if (!since) fail(400,'invalid_request');
          if (rows.some(x => !x.record.updated_at)) fail(409,'resource_not_ready');
          rows = rows.filter(x => x.record.updated_at >= since);
        }
        if (p) {
          const field = { created:'created_at', completed:'completed_at', due:'due_at' }[p.date_basis];
          rows = rows.filter(({record}) => p.date_basis === 'due' && record.due_date
            ? record.due_date >= p.start && record.due_date < p.end
            : record[field] && record[field] >= p.start_at && record[field] < p.end_at && (p.date_basis === 'due' || record[field] <= snapshot.cutoff_at));
        }
        if (q.has('record_id')) { rows = rows.filter(x => x.record.id === q.get('record_id')); if (!rows.length) fail(404,'not_found'); }
        rows.sort((x,y) => numericSort(x.record.id,y.record.id));
        response = { meta: meta(p), ...await paginate(rows) };
      } else if (endpoint === 'changes') {
        const active = await store.getIntegrationSettings(env);
        if (active.projection_version !== snapshot.projection_version || active.resource_set_version !== snapshot.resource_set_version) fail(409,'resync_required');
        if (required(q,'projection_version') !== snapshot.projection_version || required(q,'resource_set_version') !== snapshot.resource_set_version) fail(409,'resync_required');
        // Snapshot history is immutable; version changes require a new full bootstrap.
        const after = q.get('after_seq');
        if (!sequence(after)) fail(400,'invalid_request');
        if (BigInt(after) < BigInt(checkpoint.minimum_available_seq) - 1n) fail(410,'resync_required');
        if (BigInt(after) > BigInt(checkpoint.through_seq)) fail(400,'invalid_request');
        if (q.has('updated_since') && !instant(q.get('updated_since'))) fail(400,'invalid_request');
        const rows = (await store.listSnapshotChanges(env, snapshot.snapshot_id, scope, after)).map(x => safeChange(x,scope));
        rows.sort((x,y) => numericSort(x.seq,y.seq));
        if (rows.some((x,i) => BigInt(x.seq) <= BigInt(after) || BigInt(x.seq) > BigInt(checkpoint.through_seq) || i && x.seq === rows[i-1].seq)) fail(503,'temporarily_unavailable');
        response = { meta: meta(), after_seq: after, through_seq: checkpoint.through_seq, next_after_seq: checkpoint.through_seq, ...await paginate(rows, { after_seq: after }) };
      } else if (endpoint === 'kpis' || endpoint === 'evidence') {
        let p, metricIds, calculationId = null, tokenPayload;
        if (endpoint === 'evidence') {
          calculationId = evidenceMatch[1];
          tokenPayload = await verifyToken('calculation', calculationId, config);
          if (tokenPayload.principal !== principal.id || tokenPayload.grantVersion !== principal.grantVersion || !sameScope(tokenPayload.scope,scope) || tokenPayload.snapshot !== snapshot.snapshot_id || tokenPayload.formula !== FORMULA_VERSION || tokenPayload.projection_version !== snapshot.projection_version || tokenPayload.resource_set_version !== snapshot.resource_set_version) fail(404,'not_found');
          p = period(tokenPayload.start, tokenPayload.end, snapshot.cutoff_at); metricIds = tokenPayload.metrics;
          if (!Array.isArray(metricIds) || metricIds.length > 17 || metricIds.some(x => !validMetric(x))) fail(400,'invalid_request');
        } else {
          p = period(required(q,'period_start'),required(q,'period_end'),snapshot.cutoff_at);
          metricIds = q.has('metric_ids') ? q.get('metric_ids').split(',') : [...METRIC_IDS];
          if (!metricIds.length || metricIds.length > 17 || new Set(metricIds).size !== metricIds.length || metricIds.some(x => !validMetric(x))) fail(400,'invalid_request');
          metricIds.sort();
        }
        const records = metricIds.some(x => METRIC_IDS.includes(x)) ? (await store.listSnapshotRecords(env,snapshot.snapshot_id,scope,'order')).map(x => safeRecord(x,scope)) : [];
        const results = await computeKpis({ records,scope,snapshot,checkpoint,period:p,metricIds,baseUrl:config.origin+PREFIX });
        const sourceHash = await sha256(results.data.map(x => [x.metric_id,x.source_hash]));
        if (tokenPayload && tokenPayload.source_hash !== sourceHash) fail(409,'snapshot_mismatch');
        if (!calculationId && results.data.some(x => x.evaluation_status === 'evaluated')) calculationId = await signToken('calculation', { principal:principal.id,grantVersion:principal.grantVersion,scope,snapshot:snapshot.snapshot_id,start:p.start,end:p.end,metrics:metricIds,formula:FORMULA_VERSION,source_hash:sourceHash,...versions(snapshot) },config,Math.min(Date.parse(snapshot.snapshot_expires_at),principal.expires,Date.parse(authorize(principal,scope,now).valid_until)));
        for (const result of results.data) if (result.evidence) result.evidence.url = `${config.origin}${PREFIX}/kpis/${calculationId}/evidence?${new URLSearchParams({...scope,snapshot_id:snapshot.snapshot_id})}`;
        if (endpoint === 'evidence') response = { meta:meta(p),calculation_id:calculationId,...await paginate(results.evidence) };
        else response = { meta:meta(p),calculation_id:calculationId,calculated_at:calculationId?new Date(now).toISOString():null,formula_catalog_version:FORMULA_VERSION,supersedes_calculation_id:null,data:results.data };
      }
      return Response.json(response,{ headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'} });
    } catch(error) {
      if (!(error instanceof SgoError) && [404,409,410].includes(error?.status)) error = new SgoError(error.status, ['snapshot_expired','snapshot_not_ready','resync_required','not_found','snapshot_mismatch'].includes(error.code) ? (error.code === 'snapshot_not_ready' ? 'resource_not_ready' : error.code) : 'temporarily_unavailable');
      return errorResponse(error,requestId);
    }
  };
}
export function createSnapshotPublisher({ store }) {
  return async(request,env) => {
    const requestId=crypto.randomUUID();
    try {
      if(env?.SGO_INTEGRATION_ENABLED!=='true') fail(503,'temporarily_unavailable');
      if(request.method!=='POST') { const response=errorResponse(new SgoError(405,'method_not_allowed'),requestId); response.headers.set('Allow','POST'); return response; }
      if(!await secretEqual(env.SGO_PUBLISH_SECRET,request.headers.get('X-SGO-Publish-Secret'))) fail(401,'unauthenticated');
      // No request body can choose SQL, expiry, grants or source scopes.
      const published=await store.publishSnapshot(env);
      return Response.json({ok:true,snapshot_id:published.snapshot_id},{headers:{'Cache-Control':'no-store'}});
    } catch(error) { return errorResponse(error,requestId); }
  };
}
