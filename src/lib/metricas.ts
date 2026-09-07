// Cálculo y captura de KPIs de mantenimiento (JCI Fase 36).
// Computa los 6 indicadores por alcance (global / general / biomédico) para un
// período [inicio, fin) y los persiste en metricas_kpi para documentar tendencia.
import type { APIContext } from "astro";
import { and, eq, gte, lt, sql, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "./db";
import { ordenes, activos, ordenRepuestos, items as itemsTable, usuarios, metricasKpi } from "./schema";

export type Scope = "global" | "general" | "biomedico";
export const SCOPES: Scope[] = ["global", "general", "biomedico"];
export const SCOPE_LABEL: Record<Scope, string> = {
  global: "Global", general: "General", biomedico: "Biomédico",
};

// Línea base del sistema (reinicio de KPIs). Las OTs/eventos previos a esta
// fecha NO cuentan para los KPIs de mantenimiento (SLA, MTTR, MTBF, backlog,
// tendencia JCI). Se introdujo porque retrasos y cambios de sistema impidieron
// cerrar OTs/tickets a tiempo y distorsionaban las métricas con datos
// históricos no representativos.
// Satisfacción y Disponibilidad NO se ven afectadas (no son métricas
// dependientes del histórico de OTs).
// Si en el futuro hay que mover el corte, basta cambiar esta fecha.
export const KPI_BASELINE_DATE = "2026-05-30";

// Devuelve el mayor entre la fecha de inicio solicitada y la línea base, de
// forma que cualquier ventana temporal queda topada por el reinicio.
export function aplicarLineaBase(inicio: string): string {
  return inicio > KPI_BASELINE_DATE ? inicio : KPI_BASELINE_DATE;
}

export interface KpiPeriodo {
  cumplimientoPreventivo: number | null;
  mttrHoras: number | null;
  mtbfHoras: number | null;
  disponibilidadPct: number | null;
  backlogCorrectivos: number;
  costoTotal: number;
  costoPorActivo: number;
  otsCompletadas: number;
  otsCorrectivas: number;
  otsPreventivas: number;
  preventivosProgramados: number;
  numActivos: number;
}

// 'YYYY-MM' del mes actual en hora de El Salvador (UTC-6).
export function periodoActualSV(): string {
  const sv = new Date(Date.now() - 6 * 3600_000);
  return `${sv.getUTCFullYear()}-${String(sv.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Límites [inicio, fin) de un período 'YYYY-MM' como fechas 'YYYY-MM-DD'.
export function limitesPeriodo(periodo: string): { inicio: string; fin: string } {
  const [y, m] = periodo.split("-").map(Number);
  const inicio = `${periodo}-01`;
  const finDate = new Date(Date.UTC(y, m, 1)); // m es 1-based → mes siguiente
  const fin = finDate.toISOString().slice(0, 10);
  return { inicio, fin };
}

// Lista de los últimos N períodos 'YYYY-MM' hasta el mes actual (incluido).
export function ultimosPeriodos(n: number): string[] {
  const out: string[] = [];
  const sv = new Date(Date.now() - 6 * 3600_000);
  let y = sv.getUTCFullYear(), m = sv.getUTCMonth(); // 0-based
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-${String(m + 1).padStart(2, "0")}`);
    m--; if (m < 0) { m = 11; y--; }
  }
  return out;
}

type Db = ReturnType<typeof getDb>;

// Computa los KPIs del período para los 3 alcances en una sola pasada.
export async function computarPeriodo(db: Db, inicio: string, fin: string): Promise<Record<Scope, KpiPeriodo>> {
  // Aplica la línea base: si el período es entero anterior al reinicio,
  // devuelve KPIs vacíos. Si lo atraviesa, recortamos el inicio.
  const inicioReal = aplicarLineaBase(inicio);
  if (inicioReal >= fin) {
    const vacio = (): KpiPeriodo => ({
      cumplimientoPreventivo: null, mttrHoras: null, mtbfHoras: null,
      disponibilidadPct: null, backlogCorrectivos: 0, costoTotal: 0,
      costoPorActivo: 0, otsCompletadas: 0, otsCorrectivas: 0,
      otsPreventivas: 0, preventivosProgramados: 0, numActivos: 0,
    });
    return SCOPES.reduce((acc, s) => { acc[s] = vacio(); return acc; }, {} as Record<Scope, KpiPeriodo>);
  }
  inicio = inicioReal;
  const horasPeriodo = (new Date(fin).getTime() - new Date(inicio).getTime()) / 3_600_000;

  // Parque de equipos (excluye dados de baja). tipo por activo para bucketing.
  const activosRows = await db.select({ id: activos.id, tipo: activos.tipo, estado: activos.estado }).from(activos);
  const tipoMap = new Map<number, string>();
  const numActivos: Record<Scope, number> = { global: 0, general: 0, biomedico: 0 };
  for (const a of activosRows) {
    tipoMap.set(a.id, a.tipo);
    if (a.estado === "baja") continue;
    numActivos.global++;
    if (a.tipo === "general") numActivos.general++;
    else if (a.tipo === "biomedico") numActivos.biomedico++;
  }

  const matchScope = (activoId: number | null, scope: Scope): boolean => {
    if (scope === "global") return true;
    if (activoId == null) return false;
    return tipoMap.get(activoId) === scope;
  };

  // OTs completadas en el período (costo, MTTR, disponibilidad).
  const completadas = await db.select({
    id: ordenes.id, tipo: ordenes.tipo, activoId: ordenes.activoId,
    createdAt: ordenes.createdAt, iniciadaEn: ordenes.iniciadaEn, completadaEn: ordenes.completadaEn,
    horas: ordenes.horasTrabajadas, asignadoA: ordenes.asignadoA,
  }).from(ordenes).where(and(
    isNotNull(ordenes.completadaEn),
    gte(ordenes.completadaEn, inicio),
    lt(ordenes.completadaEn, fin),
  ));

  // Tarifas de los técnicos asignados (para mano de obra).
  const tecIds = [...new Set(completadas.map((o) => o.asignadoA).filter((x): x is number => !!x))];
  const tarifaMap = new Map<number, number>();
  if (tecIds.length > 0) {
    const us = await db.select({ id: usuarios.id, t: usuarios.tarifaHora }).from(usuarios).where(inArray(usuarios.id, tecIds));
    for (const u of us) tarifaMap.set(u.id, Number(u.t));
  }

  // Repuestos de esas OTs.
  const otIds = completadas.map((o) => o.id);
  const repuestosPorOt = new Map<number, number>();
  if (otIds.length > 0) {
    const reps = await db.select({
      ordenId: ordenRepuestos.ordenId, cantidad: ordenRepuestos.cantidad,
      precio: sql<number>`COALESCE(${ordenRepuestos.precioUnitario}, ${itemsTable.precioReferencia}, 0)`,
    }).from(ordenRepuestos)
      .leftJoin(itemsTable, eq(itemsTable.id, ordenRepuestos.itemId))
      .where(inArray(ordenRepuestos.ordenId, otIds));
    for (const r of reps) repuestosPorOt.set(r.ordenId, (repuestosPorOt.get(r.ordenId) ?? 0) + Number(r.precio) * r.cantidad);
  }

  // Correctivos creados en el período (tasa de fallas).
  const correctivos = await db.select({ activoId: ordenes.activoId }).from(ordenes).where(and(
    eq(ordenes.tipo, "correctivo"), gte(ordenes.createdAt, inicio), lt(ordenes.createdAt, fin),
  ));

  // Preventivos creados en el período (volumen).
  const preventivosCreados = await db.select({ activoId: ordenes.activoId }).from(ordenes).where(and(
    eq(ordenes.tipo, "preventivo"), gte(ordenes.createdAt, inicio), lt(ordenes.createdAt, fin),
  ));

  // Preventivos programados (vencimiento en el período) → cumplimiento.
  const preventivosProg = await db.select({
    activoId: ordenes.activoId, completadaEn: ordenes.completadaEn, vencimiento: ordenes.vencimiento,
  }).from(ordenes).where(and(
    eq(ordenes.tipo, "preventivo"), isNotNull(ordenes.vencimiento),
    gte(ordenes.vencimiento, inicio), lt(ordenes.vencimiento, fin),
  ));

  // Backlog de correctivos: abiertos al final del período.
  const backlog = await db.select({ activoId: ordenes.activoId }).from(ordenes).where(and(
    eq(ordenes.tipo, "correctivo"),
    lt(ordenes.createdAt, fin),
    sql`${ordenes.estado} != 'cancelada'`,
    sql`(${ordenes.completadaEn} IS NULL OR ${ordenes.completadaEn} >= ${fin})`,
  ));

  const horasReparacion = (o: typeof completadas[number]): number => {
    const ini = o.iniciadaEn ?? o.createdAt;
    return Math.max(0, (new Date(o.completadaEn!).getTime() - new Date(ini).getTime()) / 3_600_000);
  };

  const resultado = {} as Record<Scope, KpiPeriodo>;
  for (const scope of SCOPES) {
    const compS = completadas.filter((o) => matchScope(o.activoId, scope));
    const correctivosComp = compS.filter((o) => o.tipo === "correctivo");
    const nActivos = numActivos[scope];

    // Costo (mano de obra + repuestos).
    let costoTotal = 0;
    for (const o of compS) {
      const mo = Number(o.horas ?? 0) * (o.asignadoA ? tarifaMap.get(o.asignadoA) ?? 0 : 0);
      costoTotal += mo + (repuestosPorOt.get(o.id) ?? 0);
    }

    // MTTR.
    const mttr = correctivosComp.length > 0
      ? correctivosComp.reduce((s, o) => s + horasReparacion(o), 0) / correctivosComp.length
      : null;

    // Tasa de fallas y MTBF.
    const nCorrectivos = correctivos.filter((o) => matchScope(o.activoId, scope)).length;
    const mtbf = nCorrectivos > 0 && nActivos > 0 ? (horasPeriodo * nActivos) / nCorrectivos : null;

    // Disponibilidad: 1 - tiempo de reparación correctiva / (horas × parque).
    const tiempoFuera = correctivosComp.reduce((s, o) => s + horasReparacion(o), 0);
    const denom = horasPeriodo * nActivos;
    const disponibilidad = denom > 0 ? Math.max(0, Math.min(100, (1 - tiempoFuera / denom) * 100)) : null;

    // Cumplimiento del programa preventivo.
    const progS = preventivosProg.filter((o) => matchScope(o.activoId, scope));
    const aTiempo = progS.filter((o) => o.completadaEn && o.vencimiento && o.completadaEn <= o.vencimiento).length;
    const cumplimiento = progS.length > 0 ? (aTiempo / progS.length) * 100 : null;

    resultado[scope] = {
      cumplimientoPreventivo: cumplimiento,
      mttrHoras: mttr,
      mtbfHoras: mtbf,
      disponibilidadPct: disponibilidad,
      backlogCorrectivos: backlog.filter((o) => matchScope(o.activoId, scope)).length,
      costoTotal,
      costoPorActivo: nActivos > 0 ? costoTotal / nActivos : 0,
      otsCompletadas: compS.length,
      otsCorrectivas: nCorrectivos,
      otsPreventivas: preventivosCreados.filter((o) => matchScope(o.activoId, scope)).length,
      preventivosProgramados: progS.length,
      numActivos: nActivos,
    };
  }
  return resultado;
}

// Computa y persiste (upsert) el snapshot de un período 'YYYY-MM' para los 3 alcances.
export async function capturarSnapshot(ctx: APIContext, periodo: string): Promise<void> {
  const db = getDb(ctx);
  const { inicio, fin } = limitesPeriodo(periodo);
  const porScope = await computarPeriodo(db, inicio, fin);
  const ahora = new Date().toISOString();
  for (const scope of SCOPES) {
    const k = porScope[scope];
    const valores = {
      cumplimientoPreventivo: k.cumplimientoPreventivo,
      mttrHoras: k.mttrHoras,
      mtbfHoras: k.mtbfHoras,
      disponibilidadPct: k.disponibilidadPct,
      backlogCorrectivos: k.backlogCorrectivos,
      costoTotal: k.costoTotal,
      costoPorActivo: k.costoPorActivo,
      otsCompletadas: k.otsCompletadas,
      otsCorrectivas: k.otsCorrectivas,
      otsPreventivas: k.otsPreventivas,
      preventivosProgramados: k.preventivosProgramados,
      numActivos: k.numActivos,
      capturadoEn: ahora,
    };
    await db.insert(metricasKpi)
      .values({ periodo, scope, ...valores })
      .onConflictDoUpdate({ target: [metricasKpi.periodo, metricasKpi.scope], set: valores });
  }
}
