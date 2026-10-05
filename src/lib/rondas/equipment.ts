import { FRECUENCIAS, siguienteFecha, type Frecuencia } from "../frecuencias";

/** Read-only, serializable preventive-maintenance context for a round.
 *
 * Scheduling and evidence deliberately remain separate: legacy completion can
 * automatically close an OT and advance its plan without independent review.
 * This module must never generate/reschedule plans or alter equipment/orders.
 */
export type EvidenceStatus = "verificado" | "sin_evidencia";
export type ComplianceStatus = "vigente" | "vencido" | "sin_historial" | "sin_config";
export type ManagementStatus = "sin_ot" | "programada" | "en_proceso" | "ejecutada_pendiente_validacion" | "verificada_cerrada";
export type ScheduleStatus = "vencido" | "al_dia" | "sin_plan" | "sin_fecha";
export type VerificationIssue =
  | "sin_fecha_ejecucion" | "fecha_ejecucion_invalida" | "ejecucion_futura"
  | "sin_verificacion" | "fecha_verificacion_invalida" | "verificacion_anterior"
  | "verificacion_futura" | "sin_ejecutor_identificado" | "autoverificacion"
  | "sin_evidencia" | "estado_no_final";

export interface MaintenanceEvidence {
  id: number;
  nombre: string;
  contentType: string;
  tamano: number;
  categoria: string;
  createdAt: string;
  /** Authenticated application endpoint, never an R2 key or public URL. */
  url: string;
}

export type MaintenanceEvidenceType = "adjunto" | "registro_trabajo_y_verificacion";

export interface MaintenanceExecution {
  id: number;
  titulo: string;
  planId: number | null;
  estado: string;
  actividadId: number | null;
  createdAt: string;
  vencimiento: string | null;
  completadaEn: string | null;
  verificadoEn: string | null;
  verificadoPor: number | null;
  verificadorNombre: string | null;
  asignadoA: number | null;
  asignadoNombre: string | null;
  ejecutadoPor: number | null;
  /** Recorded execution actors only; assignment is never called execution. */
  ejecutoresIds: number[];
  executorIdentitySource: "ejecucion_registrada" | "solo_asignacion" | "sin_identidad";
  trabajosRealizados: string | null;
  verificacionNotas: string | null;
  evidenceTypes: MaintenanceEvidenceType[];
  verified: boolean;
  verificationIssues: VerificationIssue[];
  evidence: MaintenanceEvidence[];
}

export interface MaintenanceHistory {
  /** Most recent completion supported by independent verification and evidence. */
  lastVerifiedExecution: MaintenanceExecution | null;
  /** Most recent recorded completion, even if it is not verified. */
  latestRecordedExecution: MaintenanceExecution | null;
  /** Most recent recorded completion that fails verification/evidence checks. */
  latestUnverifiedExecution: MaintenanceExecution | null;
  evidenceStatus: EvidenceStatus;
  /** Full elapsed days since the verified execution, not since its verification. */
  daysElapsed: number | null;
}

export interface PendingMaintenanceOrder extends MaintenanceExecution {
  cycleId: string | null;
  /** No historical OT stores its PM cycle: these are explicitly inferred. */
  cycleMatch: "inferred" | "previous" | "unknown";
}

export interface MaintenanceCompliance {
  complianceStatus: ComplianceStatus;
  /** Calculated from verified execution plus current plan frequency. */
  nextDue: string | null;
  overdue: boolean;
  /** Raw stored plan calendar remains independently visible. */
  configuredNextDue: string | null;
  configuredOverdue: boolean;
  scheduleDiscrepancy: boolean;
  managementStatus: ManagementStatus;
  pendingOrders: PendingMaintenanceOrder[];
  currentCycleOrders: PendingMaintenanceOrder[];
}

export interface PlanMaintenance extends MaintenanceHistory, MaintenanceCompliance {
  id: number;
  titulo: string;
  frecuencia: string;
  proximaFecha: string;
  activo: boolean;
  asignadoA: number | null;
  frequencySupported: boolean;
  cycleId: string;
  scheduleStatus: ScheduleStatus;
}

export interface AssetMaintenance extends MaintenanceHistory, MaintenanceCompliance {
  id: number;
  codigo: string;
  nombre: string;
  tipo: string;
  rubro: string | null;
  estado: string;
  ubicacionId: number | null;
  ubicacionNombre: string | null;
  planes: PlanMaintenance[];
  scheduleStatus: ScheduleStatus;
  capturedAt: string;
}

interface AssetRow {
  id: number; codigo: string; nombre: string; tipo: string; rubro: string | null;
  estado: string; ubicacionId: number | null; ubicacionNombre: string | null;
}
interface PlanRow {
  id: number; activoId: number; titulo: string; frecuencia: string;
  proximaFecha: string; activo: number; asignadoA: number | null;
}
interface OrderRow {
  id: number; activoId: number; titulo: string; planId: number | null; estado: string;
  completadaEn: string | null; verificadoEn: string | null; verificadoPor: number | null;
  verificadorNombre: string | null; asignadoA: number | null; asignadoNombre: string | null;
  ejecutadoPor: number | null; executoresJson: string | null;
  actividadId: number | null; createdAt: string; vencimiento: string | null;
  trabajosRealizados: string | null; verificacionNotas: string | null;
}
interface AttachmentRow {
  id: number; ordenId: number; nombre: string; contentType: string; tamano: number;
  categoria: string; createdAt: string; hasStorageKey: number;
}

const DAY_MS = 86_400_000;

/** Interpret D1's timezone-less CURRENT_TIMESTAMP as UTC, not server-local time. */
function timestamp(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)) return null;
  const date = value.slice(0, 10);
  const midnight = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== date) return null;
  const normalized = value.length === 10 ? `${value}T00:00:00Z`
    : /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value.replace(" ", "T")
    : `${value.replace(" ", "T")}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function validateId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) throw new RangeError("Identificador no válido");
}

function summarizeHistory(executions: MaintenanceExecution[], nowMs: number): MaintenanceHistory {
  // Missing or malformed dates are kept visible as unverified records, but can
  // never win over a valid, more recent completion or create an elapsed value.
  const ordered = [...executions].sort((a, b) =>
    (timestamp(b.completadaEn) ?? -Infinity) - (timestamp(a.completadaEn) ?? -Infinity) || b.id - a.id);
  const lastVerifiedExecution = ordered.find((order) => order.verified) ?? null;
  const completedMs = timestamp(lastVerifiedExecution?.completadaEn ?? null);
  return {
    lastVerifiedExecution,
    latestRecordedExecution: ordered[0] ?? null,
    latestUnverifiedExecution: ordered.find((order) => !order.verified) ?? null,
    evidenceStatus: lastVerifiedExecution ? "verificado" : "sin_evidencia",
    daysElapsed: completedMs === null ? null : Math.max(0, Math.floor((nowMs - completedMs) / DAY_MS)),
  };
}

function execution(row: OrderRow, attachments: AttachmentRow[], nowMs: number): MaintenanceExecution {
  const issues: VerificationIssue[] = [];
  const completedMs = timestamp(row.completadaEn);
  const verifiedMs = timestamp(row.verificadoEn);
  if (!row.completadaEn) issues.push("sin_fecha_ejecucion");
  else if (completedMs === null) issues.push("fecha_ejecucion_invalida");
  else if (completedMs > nowMs) issues.push("ejecucion_futura");
  if (!row.verificadoEn || !row.verificadoPor) issues.push("sin_verificacion");
  else if (verifiedMs === null) issues.push("fecha_verificacion_invalida");
  if (completedMs !== null && verifiedMs !== null && verifiedMs < completedMs) issues.push("verificacion_anterior");
  if (verifiedMs !== null && verifiedMs > nowMs) issues.push("verificacion_futura");
  let recordedExecutors: unknown = [];
  try { recordedExecutors = JSON.parse(row.executoresJson ?? "[]"); } catch { /* Missing proof stays unverified. */ }
  const ejecutoresIds = [...new Set([
    ...(Array.isArray(recordedExecutors) ? recordedExecutors.filter((id): id is number => Number.isSafeInteger(id) && id > 0) : []),
    ...[row.ejecutadoPor].filter((id): id is number => id !== null && Number.isSafeInteger(id) && id > 0),
  ])].sort((a, b) => a - b);
  const executorIdentitySource = ejecutoresIds.length ? "ejecucion_registrada" : row.asignadoA ? "solo_asignacion" : "sin_identidad";
  if (executorIdentitySource === "sin_identidad") issues.push("sin_ejecutor_identificado");
  else if (row.verificadoPor !== null && (ejecutoresIds.includes(row.verificadoPor) || row.asignadoA === row.verificadoPor)) issues.push("autoverificacion");
  if (!["completada", "verificada", "cerrada"].includes(row.estado)) issues.push("estado_no_final");

  // Metadata proves a record exists, not that the underlying R2 blob is still
  // available. Its authenticated endpoint performs that check when opened.
  const evidence = attachments.filter((attachment) => {
    const createdMs = timestamp(attachment.createdAt);
    return attachment.hasStorageKey === 1 && attachment.tamano > 0 && !!attachment.contentType.trim()
      && !!attachment.nombre.trim() && createdMs !== null && createdMs <= nowMs;
  }).map(({ id, nombre, contentType, tamano, categoria, createdAt }) => ({
    id, nombre, contentType, tamano, categoria, createdAt, url: `/api/adjuntos/${id}`,
  }));
  // Before-only photos don't substantiate completed work. Evidence uploaded
  // after verification cannot have been reviewed by that recorded verification.
  const reviewedEvidence = evidence.some((attachment) => attachment.categoria !== "antes"
    && verifiedMs !== null && (timestamp(attachment.createdAt) ?? Infinity) <= verifiedMs);
  // Routine preventive work may use documentary evidence without a photo:
  // retain both the execution record and the independent review's actual text.
  const documentedWork = !!row.trabajosRealizados?.trim() && !!row.verificacionNotas?.trim();
  const evidenceTypes: MaintenanceEvidenceType[] = [];
  if (reviewedEvidence) evidenceTypes.push("adjunto");
  if (documentedWork) evidenceTypes.push("registro_trabajo_y_verificacion");
  if (!evidenceTypes.length) issues.push("sin_evidencia");
  return {
    id: row.id, titulo: row.titulo, planId: row.planId, estado: row.estado,
    actividadId: row.actividadId, createdAt: row.createdAt, vencimiento: row.vencimiento,
    completadaEn: row.completadaEn, verificadoEn: row.verificadoEn,
    verificadoPor: row.verificadoPor, verificadorNombre: row.verificadorNombre,
    asignadoA: row.asignadoA, asignadoNombre: row.asignadoNombre,
    ejecutadoPor: row.ejecutadoPor, ejecutoresIds, executorIdentitySource,
    trabajosRealizados: row.trabajosRealizados, verificacionNotas: row.verificacionNotas, evidenceTypes,
    verified: issues.length === 0, verificationIssues: issues, evidence,
  };
}

async function getContext(DB: D1Database, id: number | number[], byLocation: boolean, now?: string): Promise<AssetMaintenance[]> {
  if (Array.isArray(id)) {
    if (!id.length || id.length > 100) throw new RangeError("Seleccione entre 1 y 100 ubicaciones");
    id.forEach(validateId);
  } else validateId(id);
  const nowMs = timestamp(now ?? new Date().toISOString());
  if (nowMs === null) throw new RangeError("Fecha de consulta no válida");
  const capturedAt = new Date(nowMs).toISOString();
  const today = capturedAt.slice(0, 10);
  // UNION (not UNION ALL) makes malformed cyclic location trees finite. Keep
  // descendants in the root's branch even if legacy data has cross-branch links.
  // Operational zones contain explicit locations. One JSON parameter avoids
  // D1's per-statement binding limit and IN keeps duplicate IDs from repeating assets.
  const scopeParameter = Array.isArray(id) ? JSON.stringify([...new Set(id)]) : id;
  const scope = Array.isArray(id) ? `WITH selected_assets AS (
    SELECT a.* FROM activos a WHERE a.ubicacion_id IN (SELECT value FROM json_each(?))
  )` : byLocation ? `WITH RECURSIVE selected_locations(id,sucursal_id) AS (
    SELECT id,sucursal_id FROM ubicaciones WHERE id=?
    UNION
    SELECT u.id,u.sucursal_id FROM ubicaciones u JOIN selected_locations parent ON u.padre_id=parent.id
      AND u.sucursal_id=parent.sucursal_id
  ), selected_assets AS (SELECT a.* FROM activos a WHERE a.ubicacion_id IN (SELECT id FROM selected_locations))`
    : `WITH selected_assets AS (SELECT a.* FROM activos a WHERE a.id=?)`;
  // D1 batch provides one consistent read transaction without any mutation.
  const results = await DB.batch([
    DB.prepare(`${scope}
      SELECT a.id,a.codigo,a.nombre,a.tipo,a.rubro,a.estado,a.ubicacion_id AS ubicacionId,
        u.nombre AS ubicacionNombre FROM selected_assets a LEFT JOIN ubicaciones u ON u.id=a.ubicacion_id
      ORDER BY a.nombre COLLATE NOCASE,a.id`).bind(scopeParameter),
    DB.prepare(`${scope}
      SELECT p.id,p.activo_id AS activoId,p.titulo,p.frecuencia,p.proxima_fecha AS proximaFecha,
        p.activo,p.asignado_a AS asignadoA FROM planes_mantenimiento p JOIN selected_assets a ON a.id=p.activo_id
      ORDER BY p.proxima_fecha,p.id`).bind(scopeParameter),
    DB.prepare(`${scope}
      SELECT o.id,o.activo_id AS activoId,o.titulo,o.plan_id AS planId,o.estado,
        o.completada_en AS completadaEn,o.verificado_en AS verificadoEn,o.verificado_por AS verificadoPor,
        v.nombre AS verificadorNombre,o.asignado_a AS asignadoA,e.nombre AS asignadoNombre,
        ov.ejecutado_por AS ejecutadoPor,ov.executores_json AS executoresJson,
        o.trabajos_realizados AS trabajosRealizados,o.verificacion_notas AS verificacionNotas,
        o.actividad_id AS actividadId,o.created_at AS createdAt,o.vencimiento
      FROM ordenes o JOIN selected_assets a ON a.id=o.activo_id
      LEFT JOIN usuarios v ON v.id=o.verificado_por LEFT JOIN usuarios e ON e.id=o.asignado_a
      LEFT JOIN orden_verificacion ov ON ov.orden_id=o.id
      WHERE o.tipo='preventivo' ORDER BY o.id`).bind(scopeParameter),
    DB.prepare(`${scope}
      SELECT f.id,f.orden_id AS ordenId,f.nombre,f.content_type AS contentType,f.tamano,f.categoria,
        f.created_at AS createdAt,CASE WHEN length(trim(f.r2_key))>0 THEN 1 ELSE 0 END AS hasStorageKey
      FROM adjuntos f JOIN ordenes o ON o.id=f.orden_id JOIN selected_assets a ON a.id=o.activo_id
      WHERE o.tipo='preventivo'
      ORDER BY f.id`).bind(scopeParameter),
  ]);
  const assets = results[0].results as unknown as AssetRow[];
  const plans = results[1].results as unknown as PlanRow[];
  const orders = results[2].results as unknown as OrderRow[];
  const attachments = results[3].results as unknown as AttachmentRow[];
  const attachmentsByOrder = new Map<number, AttachmentRow[]>();
  for (const attachment of attachments) {
    const list = attachmentsByOrder.get(attachment.ordenId) ?? [];
    list.push(attachment);
    attachmentsByOrder.set(attachment.ordenId, list);
  }
  const historyByAsset = new Map<number, MaintenanceExecution[]>();
  for (const order of orders) {
    const list = historyByAsset.get(order.activoId) ?? [];
    list.push(execution(order, attachmentsByOrder.get(order.id) ?? [], nowMs));
    historyByAsset.set(order.activoId, list);
  }
  const plansByAsset = new Map<number, PlanRow[]>();
  for (const plan of plans) {
    const list = plansByAsset.get(plan.activoId) ?? [];
    list.push(plan);
    plansByAsset.set(plan.activoId, list);
  }
  const recorded = (orders: MaintenanceExecution[]) => orders.filter((order) => order.completadaEn !== null
    || ["completada", "verificada", "cerrada"].includes(order.estado));
  const management = (pending: PendingMaintenanceOrder[], last: MaintenanceExecution | null): ManagementStatus => {
    if (pending.some((order) => timestamp(order.completadaEn) !== null)) return "ejecutada_pendiente_validacion";
    if (pending.some((order) => ["en_proceso", "en_espera"].includes(order.estado))) return "en_proceso";
    if (pending.length) return "programada";
    return last?.verified ? "verificada_cerrada" : "sin_ot";
  };
  return assets.map((asset) => {
    const history = historyByAsset.get(asset.id) ?? [];
    const assetPlans: PlanMaintenance[] = (plansByAsset.get(asset.id) ?? []).map((plan) => {
      const matchingOrders = history.filter((order) => order.planId === plan.id);
      const summary = summarizeHistory(recorded(matchingOrders), nowMs);
      const frequencySupported = FRECUENCIAS.some((frequency) => frequency.value === plan.frecuencia);
      const configuredNextDue = timestamp(plan.proximaFecha) === null ? null : plan.proximaFecha;
      const configuredOverdue = !!plan.activo && configuredNextDue !== null && configuredNextDue.slice(0, 10) < today;
      const completedAt = summary.lastVerifiedExecution?.completadaEn ?? null;
      const completedMs = timestamp(completedAt);
      const nextDue = frequencySupported && completedMs !== null
        ? siguienteFecha(new Date(completedMs).toISOString().slice(0, 10), plan.frecuencia as Frecuencia) : null;
      const overdue = !!plan.activo && nextDue !== null && nextDue < today;
      const complianceStatus: ComplianceStatus = !plan.activo || !frequencySupported ? "sin_config"
        : nextDue === null ? "sin_historial" : overdue ? "vencido" : "vigente";
      // A deterministic current-rule snapshot key, not a historical cycle claim.
      const cycleId = `activo:${asset.id}:plan:${plan.id}:desde:${completedAt ?? "sin_historial"}:frecuencia:${plan.frecuencia}:vence:${nextDue ?? "sin_fecha"}`;
      const pendingOrders: PendingMaintenanceOrder[] = matchingOrders.filter((order) => !order.verified
        && (["abierta", "en_proceso", "en_espera", "completada"].includes(order.estado)
          || (["cerrada", "verificada"].includes(order.estado) && timestamp(order.completadaEn) !== null)))
        .map((order) => {
          const createdMs = timestamp(order.createdAt);
          const cycleMatch = completedMs === null || createdMs === null ? "unknown"
            : createdMs >= completedMs ? "inferred" : "previous";
          return { ...order, cycleId: cycleMatch === "inferred" ? cycleId : null, cycleMatch };
        });
      const currentCycleOrders = pendingOrders.filter((order) => order.cycleMatch === "inferred");
      return {
        id: plan.id, titulo: plan.titulo, frecuencia: plan.frecuencia, proximaFecha: plan.proximaFecha,
        activo: !!plan.activo, asignadoA: plan.asignadoA, frequencySupported, cycleId,
        ...summary, nextDue, overdue, complianceStatus, configuredNextDue, configuredOverdue,
        scheduleDiscrepancy: nextDue !== null && configuredNextDue !== null && nextDue !== configuredNextDue.slice(0, 10),
        scheduleStatus: configuredNextDue === null ? "sin_fecha" : configuredOverdue ? "vencido" : "al_dia",
        pendingOrders, currentCycleOrders,
        managementStatus: management(pendingOrders.filter((order) => order.cycleMatch !== "previous"), summary.latestRecordedExecution),
      };
    });
    const activePlans = assetPlans.filter((plan) => plan.activo);
    const nextDue = activePlans.map((plan) => plan.nextDue).filter((date): date is string => date !== null).sort()[0] ?? null;
    const configuredNextDue = activePlans.map((plan) => plan.configuredNextDue).filter((date): date is string => date !== null).sort()[0] ?? null;
    const overdue = activePlans.some((plan) => plan.overdue);
    const configuredOverdue = activePlans.some((plan) => plan.configuredOverdue);
    const summary = summarizeHistory(recorded(history), nowMs);
    const complianceStatus: ComplianceStatus = !activePlans.length ? "sin_config" : overdue ? "vencido"
      : activePlans.some((plan) => plan.complianceStatus === "sin_config") ? "sin_config"
      : activePlans.some((plan) => plan.complianceStatus === "sin_historial") ? "sin_historial" : "vigente";
    const pendingOrders = activePlans.flatMap((plan) => plan.pendingOrders);
    const currentCycleOrders = activePlans.flatMap((plan) => plan.currentCycleOrders);
    return {
      ...asset, planes: assetPlans, ...summary, nextDue, overdue, complianceStatus,
      configuredNextDue, configuredOverdue, scheduleDiscrepancy: activePlans.some((plan) => plan.scheduleDiscrepancy),
      scheduleStatus: !activePlans.length ? "sin_plan" : configuredOverdue ? "vencido" : configuredNextDue === null ? "sin_fecha" : "al_dia",
      pendingOrders, currentCycleOrders,
      managementStatus: management(pendingOrders.filter((order) => order.cycleMatch !== "previous"), summary.latestRecordedExecution),
      capturedAt,
    };
  });
}

/** Include equipment in the selected location and its same-branch descendants. */
export async function getEquipmentContext(DB: D1Database, ubicacionId: number, now?: string): Promise<AssetMaintenance[]> {
  return getContext(DB, ubicacionId, true, now);
}

/** Include equipment only in the explicit zone locations, without descendants. */
export async function getEquipmentContextForLocations(DB: D1Database, ubicacionIds: number[], now?: string): Promise<AssetMaintenance[]> {
  return getContext(DB, ubicacionIds, true, now);
}

/** Equipment detail, including plans/history even when no location is assigned. */
export async function getAssetMaintenance(DB: D1Database, activoId: number, now?: string): Promise<AssetMaintenance | null> {
  return (await getContext(DB, activoId, false, now))[0] ?? null;
}
