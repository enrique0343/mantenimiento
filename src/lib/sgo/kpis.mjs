import { dateOnly, fail, instant, sameScope, sha256 } from './security.mjs';

export const METRIC_IDS = Object.freeze(['MNT-01', 'MNT-02', 'MNT-03', 'MNT-06', 'MNT-11']);
export const FORMULA_VERSION = 'correctivos-v1.1';
const pendingStates = new Set(['abierta', 'en_proceso', 'en_espera']);
const finishedStates = new Set(['completada', 'verificada', 'cerrada']);
const definitions = {
  'MNT-01': ['Correctivos registrados', 'COUNT DISTINCT correctivos con created_at en [inicio,fin) y no posteriores al corte; incluye canceladas.', 'orders'],
  'MNT-02': ['Correctivos en estado abierta', 'COUNT DISTINCT correctivos con estado abierta al corte.', 'orders'],
  'MNT-03': ['Correctivos pendientes', 'COUNT DISTINCT correctivos en abierta/en_proceso/en_espera al corte, sin limitar su fecha de creación al período.', 'orders'],
  'MNT-06': ['Antigüedad media de pendientes', 'SUM((cutoff_at-created_at)/86400000) / COUNT pendientes con fechas válidas; no reiniciar por reapertura.', 'days'],
  'MNT-11': ['Tiempo transcurrido de resolución', 'SUM((completed_at-created_at)/3600000) / COUNT correctivos finalizados en el período hasta el corte, estado completada/verificada/cerrada y fechas válidas. Incluye esperas; no es MTTR ni horas-persona.', 'hours'],
};
export function metricCatalog() { return METRIC_IDS.map(metric_id => ({ metric_id, name: definitions[metric_id][0], formula: definitions[metric_id][1], formula_version: FORMULA_VERSION, unit: definitions[metric_id][2], capability: 'available' })); }
export function validMetric(id) { return /^MNT-(0[1-9]|1[0-7])$/.test(id); }
export function period(start, end, cutoff) {
  if (!dateOnly(start) || !dateOnly(end) || start >= end) fail(400, 'invalid_request');
  const a = Date.parse(start + 'T06:00:00Z'), b = Date.parse(end + 'T06:00:00Z');
  if (b - a > 3660 * 86400000) fail(400, 'invalid_request');
  const c = Date.parse(cutoff);
  if (!Number.isFinite(c)) fail(503, 'temporarily_unavailable');
  return { start, end, time_zone: 'America/El_Salvador', date_basis: 'metric_definition', start_at: new Date(a).toISOString(), end_at: new Date(b).toISOString(), effective_end_at: new Date(Math.min(b, c)).toISOString(), is_complete: c >= b };
}
export function coverageKnown(value) { return value === 'complete' || value?.complete === true || value?.status === 'complete'; }
export async function computeKpis({ records, scope, snapshot, checkpoint, period: p, metricIds = METRIC_IDS, baseUrl }) {
  if (!Array.isArray(records) || records.length > 20000) fail(503, 'temporarily_unavailable');
  const orders = records.filter(x => x.resource === 'order').map(x => x.record).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (orders.some(x => !sameScope(x, scope))) fail(503, 'temporarily_unavailable');
  const unique = new Set();
  for (const row of orders) { if (unique.has(row.id)) fail(503, 'temporarily_unavailable'); unique.add(row.id); }
  const a = Date.parse(p.start_at), b = Date.parse(p.end_at), c = Date.parse(snapshot.cutoff_at);
  const sufficient = coverageKnown(checkpoint.order_coverage);
  const historicalCoverage = instant(checkpoint.history_available_from);
  const outputs = [], evidence = [];
  for (const id of metricIds) {
    if (!validMetric(id)) fail(400, 'invalid_request');
    if (!METRIC_IDS.includes(id)) {
      const technicallyPending = ['MNT-08','MNT-10','MNT-13','MNT-15','MNT-16','MNT-17'].includes(id);
      outputs.push({ metric_id: id, formula_version: 'reserved', formula: 'Fuera del perfil correctivos-v1; no evaluado.', numerator: null, denominator: null, value: null, unit: ['MNT-12','MNT-16'].includes(id) ? 'hours' : id === 'MNT-13' ? 'person_hours' : id === 'MNT-08' ? 'occurrences' : id === 'MNT-14' ? 'assets' : ['MNT-10','MNT-15','MNT-17'].includes(id) ? 'percent' : 'orders', capability: technicallyPending ? 'pending' : ['MNT-04','MNT-05','MNT-07','MNT-09','MNT-12'].includes(id) ? 'partial' : 'available', data_status: 'insufficient_data', reason_codes: ['outside_active_profile'], coverage: { complete: false, eligible_records: 0, included_records: 0, excluded_records: 0, records_missing_required_fields: 0, exclusions: [] }, source_updated_at: null, evidence: null, evaluation_status: 'not_evaluated', source_hash: null });
      continue;
    }
    const sources = [], localEvidence = [], exclusions = new Map();
    let total = 0, included = 0, missing = 0;
    for (const o of orders) {
      if (o.type !== 'correctivo') continue;
      const created = instant(o.created_at), completed = instant(o.completed_at);
      const createdMs = created ? Date.parse(created) : NaN, completedMs = completed ? Date.parse(completed) : NaN;
      let qualifies = false, problem = null, contribution = 1;
      if (id === 'MNT-01') {
        if (!created) { qualifies = true; problem = 'invalid_created_at'; }
        else qualifies = createdMs >= a && createdMs < b && createdMs <= c;
      } else if (id === 'MNT-02') qualifies = o.status === 'abierta';
      else if (id === 'MNT-03' || id === 'MNT-06') qualifies = pendingStates.has(o.status);
      else if (id === 'MNT-11') {
        if (!finishedStates.has(o.status)) continue;
        if (!completed) { qualifies = true; problem = 'missing_completed_at'; }
        else qualifies = completedMs >= a && completedMs < b && completedMs <= c;
      }
      if (!qualifies) continue;
      if ((!created && !['MNT-02','MNT-03'].includes(id)) || createdMs > c) problem ??= 'invalid_created_at';
      if (id === 'MNT-11' && createdMs > completedMs) problem ??= 'inverted_resolution_interval';
      if (id === 'MNT-06' && !problem) contribution = (c - createdMs) / 86400000;
      if (id === 'MNT-11' && !problem) contribution = (completedMs - createdMs) / 3600000;
      if (problem) { missing++; exclusions.set(problem, (exclusions.get(problem) ?? 0) + 1); }
      else { total += contribution; included++; }
      sources.push({ id: o.id, revision: o.revision, status: o.status, created_at: created, completed_at: completed, type: o.type });
      const facts = { order_type: 'correctivo', order_status: o.status };
      if (created) facts.created_at = created;
      if (completed) facts.completed_at = completed;
      if (!problem && id === 'MNT-06') facts.age_days = contribution;
      if (!problem && id === 'MNT-11') facts.elapsed_hours = contribution;
      localEvidence.push({ metric_id: id, formula_version: FORMULA_VERSION, source_refs: [{ resource: 'order', id: o.id, revision: o.revision, record_url: `${baseUrl}/records?${new URLSearchParams({ ...scope, snapshot_id: snapshot.snapshot_id, resource: 'order', record_id: o.id })}` }], included: !problem, reason_code: problem, numerator_contribution: problem ? null : contribution, denominator_contribution: ['MNT-06','MNT-11'].includes(id) ? (problem ? 0 : 1) : null, facts });
    }
    const mean = ['MNT-06', 'MNT-11'].includes(id), flow = ['MNT-01', 'MNT-11'].includes(id);
    const reasons = [];
    let status = 'ok', value = mean ? (included ? total / included : null) : total;
    if (!sufficient) { status = 'insufficient_data'; value = null; reasons.push('source_coverage_unconfirmed'); }
    if (flow && (!historicalCoverage || Date.parse(historicalCoverage) > a)) { status = 'insufficient_data'; value = null; reasons.push('source_history_incomplete'); }
    if (flow && a > c) { status = 'insufficient_data'; value = null; reasons.push('period_not_observed'); }
    if (missing && status === 'ok') { status = 'partial'; reasons.push('excluded_invalid_source_records'); }
    if (mean && !included && missing) { status = 'insufficient_data'; value = null; reasons.push('no_valid_resolution_records'); }
    if (mean && !included && status === 'ok') { status = 'not_applicable'; reasons.push('no_eligible_records'); }
    if (flow && !p.is_complete && status !== 'insufficient_data' && status !== 'not_applicable') { status = 'partial'; reasons.push('period_in_progress'); }
    const knownCoverage = sufficient && (!flow || !!historicalCoverage && Date.parse(historicalCoverage) <= a) && missing === 0;
    const coverage = { complete: knownCoverage, eligible_records: sources.length, included_records: included, excluded_records: missing, records_missing_required_fields: missing, exclusions: [...exclusions].map(([reason_code, count]) => ({ reason_code, count })) };
    const sourceHash = await sha256({ source_instance_id: snapshot.source_instance_id, scope, snapshot_id: snapshot.snapshot_id, cutoff_at: snapshot.cutoff_at, period: p, metric_id: id, formula_version: FORMULA_VERSION, sources, coverage });
    outputs.push({ metric_id: id, formula_version: FORMULA_VERSION, formula: definitions[id][1], numerator: total, denominator: mean ? included : null, value, unit: definitions[id][2], capability: 'available', data_status: status, reason_codes: reasons, coverage, source_updated_at: instant(checkpoint.source_updated_at), evidence: { url: '', source_ids_sample: localEvidence.slice(0, 10).map(x => x.source_refs[0].id), sample_is_exhaustive: localEvidence.length <= 10 }, evaluation_status: 'evaluated', source_hash: sourceHash });
    evidence.push(...localEvidence);
  }
  return { data: outputs, evidence };
}
