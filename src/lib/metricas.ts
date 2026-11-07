// Cálculo y captura de KPIs de mantenimiento (JCI Fase 36).
// Computa los 6 indicadores por alcance (global / general / biomédico) para un
// período [inicio, fin) y los persiste en metricas_kpi para documentar tendencia.
import type { APIContext } from "astro";
import { and, eq, gte, lt, sql, inArray, isNotNull, isNull, notInArray, or, asc, desc } from "drizzle-orm";
import { getDb } from "./db";
import { ordenes, activos, ordenRepuestos, items as itemsTable, usuarios, metricasKpi } from "./schema";
// Tablas de la biblioteca de procedimientos (Fase 47) — ver bloque al final.
import {
  sucursales, procedimientos, procedimientoCampos, procedimientoValidaciones,
} from "./schema";
import { rubroDeActivo, rubroLabel, RUBRO_KEYS, type RubroKey } from "./rubros";
// src/lib/procedimientos.ts es el dueño de la taxonomía del volumen (los 25
// códigos del cap. 8.2, tipos, estados, semanas y la regla de vigencia). No
// importa este módulo, así que no hay ciclo. Aquí NO se redefine nada de eso.
import {
  CODIGOS_VOLUMEN, ESTADO_PROC, MATRIZ_CAP08, SEMANAS_VALIDACION, TIPOS_PROC,
  TIPO_PROC, progresoValidacion, semanaSugerida, sistemaInfo,
  type CampoAzul, type SemanaValidacion, type TipoProc, type ValidacionArea,
} from "./procedimientos";

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

// ═════════════════════════════════════════════════════════════════════════════
// Indicadores del volumen GO-GUI-011-2026 «Biblioteca de procedimientos
// modelo, Mantenimiento General» (capítulos 02 y 08) — Fase 47.
//
// Se AÑADEN a los 6 indicadores JCI de arriba: no sustituyen nada, no tocan
// `computarPeriodo`, `capturarSnapshot` ni la línea base KPI_BASELINE_DATE.
//
//   · Mantenimiento diferido  — toda orden P1 vencida más de 30 días sin
//     riesgo aceptado por escrito (cap. 2.3).
//   · Indicadores 5 y 7       — tiempo de respuesta y de reparación por
//     sistema, que alimenta el EOP (cap. 2.2).
//   · Indicador 8            — horas fuera de rango por sala, que alimenta el
//     AOP (cap. 2.2).
//   · Indicador 1            — cumplimiento del preventivo por dominio, que
//     alimenta el SOP (cap. 2.2). El cumplimiento por *alcance*
//     (global/general/biomédico) ya existe en `computarPeriodo`; esto es el
//     corte por dominio de los cuatro rubros del plan maestro.
//   · Avance de la biblioteca — tablero de la ruta de validación de cuatro
//     semanas (cap. 08).
// ═════════════════════════════════════════════════════════════════════════════

// Días que una orden P1 puede estar vencida antes de contar como mantenimiento
// diferido (definición textual del capítulo 2.3).
export const DIAS_DIFERIDO = 30;

// Etiqueta del sistema: la fuente es SISTEMAS/sistemaInfo de
// src/lib/procedimientos.ts, para que el tablero y la ficha del documento
// nombren igual cada sistema.
export const sistemaLabel = (k: string | null | undefined): string =>
  k ? sistemaInfo(k).label : "Sin sistema";

// ─── Helpers de fecha ────────────────────────────────────────────────────────

// 'YYYY-MM-DD' de hoy en hora de El Salvador (UTC-6).
export function hoySV(): string {
  return new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
}

// Suma/resta días a una cadena SOLO-fecha sin pasar por la zona horaria del
// runtime (regla del proyecto: nunca `new Date("YYYY-MM-DD")` en UTC-6).
export function sumarDiasFecha(fecha: string, dias: number): string {
  const [y, m, d] = fecha.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return fecha.slice(0, 10);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

// Días calendario entre dos cadenas SOLO-fecha (b - a).
export function diasEntreFechas(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.slice(0, 10).split("-").map(Number);
    return Date.UTC(y || 1970, (m || 1) - 1, d || 1);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

// Normaliza un timestamp de SQLite/ISO a milisegundos UTC.
// `CURRENT_TIMESTAMP` de D1 devuelve "YYYY-MM-DD HH:MM:SS" en UTC pero sin
// sufijo: sin normalizar, el runtime lo leería como hora local y en UTC-6
// desplazaría 6 h los tiempos de respuesta y reparación.
function msDeTimestamp(s: string | null | undefined): number | null {
  if (!s) return null;
  let v = String(s).trim();
  if (!v) return null;
  if (v.length === 10) v = `${v}T00:00:00Z`;
  else {
    if (!v.includes("T")) v = v.replace(" ", "T");
    if (!/(Z|[+-]\d\d:?\d\d)$/.test(v)) v = `${v}Z`;
  }
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

// Horas entre dos timestamps (null si falta alguno o si no parsean).
function horasEntre(desde: string | null | undefined, hasta: string | null | undefined): number | null {
  const a = msDeTimestamp(desde);
  const b = msDeTimestamp(hasta);
  if (a == null || b == null) return null;
  return Math.max(0, (b - a) / 3_600_000);
}

const prom = (xs: number[]): number | null =>
  xs.length > 0 ? xs.reduce((s, x) => s + x, 0) / xs.length : null;

// ─── 1. MANTENIMIENTO DIFERIDO ───────────────────────────────────────────────
// Capítulo 2.3: «toda orden P1 vencida más de 30 días sin riesgo aceptado por
// escrito». Al sellar `riesgoAceptadoPor/En/Notas` la OT sale del indicador
// pero la aceptación queda trazada en la propia orden (y en el audit log).
//
// NO se le aplica KPI_BASELINE_DATE a propósito: es un backlog vivo de trabajo
// P1 abierto, no una serie histórica. Recortarlo por la línea base ocultaría
// órdenes realmente vencidas que siguen sin cerrar.

export interface DiferidoRow {
  id: number;
  titulo: string;
  tipo: string;
  estado: string;
  prioridad: string;
  clasePrioridad: string | null;
  nivelRiesgo: string | null;
  vencimiento: string;
  diasVencida: number;
  activoId: number | null;
  activoCodigo: string | null;
  activoNombre: string | null;
  dominio: RubroKey | null;
  dominioLabel: string;
  sistema: string | null;
  procedimientoCodigo: string | null;
  sucursalNombre: string | null;
  asignadoNombre: string | null;
}

export async function mantenimientoDiferido(
  db: Db,
  opts: { hoy?: string; dias?: number } = {},
): Promise<DiferidoRow[]> {
  const hoy = opts.hoy ?? hoySV();
  const corte = sumarDiasFecha(hoy, -(opts.dias ?? DIAS_DIFERIDO));

  const rows = await db
    .select({
      id: ordenes.id,
      titulo: ordenes.titulo,
      tipo: ordenes.tipo,
      estado: ordenes.estado,
      prioridad: ordenes.prioridad,
      clasePrioridad: ordenes.clasePrioridad,
      nivelRiesgo: ordenes.nivelRiesgo,
      vencimiento: ordenes.vencimiento,
      activoId: ordenes.activoId,
      activoCodigo: activos.codigo,
      activoNombre: activos.nombre,
      activoRubro: activos.rubro,
      activoTipo: activos.tipo,
      sistema: procedimientos.sistema,
      procedimientoCodigo: procedimientos.codigoCorto,
      sucursalNombre: sucursales.nombre,
      asignadoNombre: usuarios.nombre,
    })
    .from(ordenes)
    .leftJoin(activos, eq(activos.id, ordenes.activoId))
    .leftJoin(procedimientos, eq(procedimientos.id, ordenes.procedimientoId))
    .leftJoin(sucursales, eq(sucursales.id, ordenes.sucursalId))
    .leftJoin(usuarios, eq(usuarios.id, ordenes.asignadoA))
    .where(and(
      eq(ordenes.clasePrioridad, "P1"),
      isNotNull(ordenes.vencimiento),
      sql`substr(${ordenes.vencimiento}, 1, 10) < ${corte}`,
      notInArray(ordenes.estado, ["cerrada", "cancelada"]),
      isNull(ordenes.riesgoAceptadoPor),
    ));

  return rows
    .map((r): DiferidoRow => {
      const venc = r.vencimiento!.slice(0, 10);
      const dominio = r.activoId != null ? rubroDeActivo(r.activoRubro, r.activoTipo) : null;
      return {
        id: r.id,
        titulo: r.titulo,
        tipo: r.tipo,
        estado: r.estado,
        prioridad: r.prioridad,
        clasePrioridad: r.clasePrioridad,
        nivelRiesgo: r.nivelRiesgo,
        vencimiento: venc,
        diasVencida: diasEntreFechas(venc, hoy),
        activoId: r.activoId,
        activoCodigo: r.activoCodigo,
        activoNombre: r.activoNombre,
        dominio,
        dominioLabel: r.sistema ? sistemaLabel(r.sistema) : rubroLabel(dominio),
        sistema: r.sistema,
        procedimientoCodigo: r.procedimientoCodigo,
        sucursalNombre: r.sucursalNombre,
        asignadoNombre: r.asignadoNombre,
      };
    })
    .sort((a, b) => b.diasVencida - a.diasVencida || a.id - b.id);
}

// Órdenes P1 vencidas >30 d cuyo riesgo YA fue aceptado por escrito: salieron
// del indicador pero siguen trazadas (evidencia del escape documentado).
export interface RiesgoAceptadoRow {
  id: number;
  titulo: string;
  estado: string;
  vencimiento: string | null;
  diasVencida: number | null;
  riesgoAceptadoEn: string | null;
  riesgoAceptadoNotas: string | null;
  aceptadoPorNombre: string | null;
  activoCodigo: string | null;
  activoNombre: string | null;
}

export async function riesgosAceptados(
  db: Db,
  opts: { hoy?: string; limite?: number } = {},
): Promise<RiesgoAceptadoRow[]> {
  const hoy = opts.hoy ?? hoySV();
  const rows = await db
    .select({
      id: ordenes.id,
      titulo: ordenes.titulo,
      estado: ordenes.estado,
      vencimiento: ordenes.vencimiento,
      riesgoAceptadoEn: ordenes.riesgoAceptadoEn,
      riesgoAceptadoNotas: ordenes.riesgoAceptadoNotas,
      aceptadoPorNombre: usuarios.nombre,
      activoCodigo: activos.codigo,
      activoNombre: activos.nombre,
    })
    .from(ordenes)
    .leftJoin(usuarios, eq(usuarios.id, ordenes.riesgoAceptadoPor))
    .leftJoin(activos, eq(activos.id, ordenes.activoId))
    .where(and(
      eq(ordenes.clasePrioridad, "P1"),
      isNotNull(ordenes.riesgoAceptadoPor),
    ))
    .orderBy(desc(ordenes.riesgoAceptadoEn))
    .limit(opts.limite ?? 20);

  return rows.map((r) => ({
    ...r,
    vencimiento: r.vencimiento ? r.vencimiento.slice(0, 10) : null,
    diasVencida: r.vencimiento ? diasEntreFechas(r.vencimiento.slice(0, 10), hoy) : null,
  }));
}

// ─── 2. INDICADORES 5 Y 7 — respuesta y reparación por sistema ───────────────
// respuesta  = horaLlegada           − COALESCE(horaAlarma, createdAt)
// reparación = horaRestablecimiento  − COALESCE(horaAlarma, createdAt)
// Se agrupa por `procedimientos.sistema` cuando la OT trae procedimientoId y
// por dominio (`activos.rubro`) cuando no.

export interface TiempoSistemaRow {
  clave: string;
  label: string;
  fuente: "sistema" | "dominio" | "sin_clasificar";
  ots: number;
  conRespuesta: number;
  respuestaHoras: number | null;
  respuestaMaxHoras: number | null;
  conReparacion: number;
  reparacionHoras: number | null;
  reparacionMaxHoras: number | null;
  conMitigacion: number;
  mitigacionHoras: number | null;
  emergencias: number;
  sinRegistro: number;
}

export async function tiemposPorSistema(
  db: Db,
  inicio: string,
  fin: string,
  opts: { aplicarBase?: boolean } = {},
): Promise<TiempoSistemaRow[]> {
  // Mismo criterio que el resto de indicadores históricos: la ventana se topa
  // con la línea base salvo que el llamador pida lo contrario.
  const ini = opts.aplicarBase === false ? inicio : aplicarLineaBase(inicio);
  if (ini >= fin) return [];

  const rows = await db
    .select({
      id: ordenes.id,
      tipo: ordenes.tipo,
      createdAt: ordenes.createdAt,
      horaAlarma: ordenes.horaAlarma,
      horaLlegada: ordenes.horaLlegada,
      horaMitigacion: ordenes.horaMitigacion,
      horaRestablecimiento: ordenes.horaRestablecimiento,
      procedimientoId: ordenes.procedimientoId,
      sistema: procedimientos.sistema,
      activoId: ordenes.activoId,
      activoRubro: activos.rubro,
      activoTipo: activos.tipo,
    })
    .from(ordenes)
    .leftJoin(procedimientos, eq(procedimientos.id, ordenes.procedimientoId))
    .leftJoin(activos, eq(activos.id, ordenes.activoId))
    .where(and(
      sql`COALESCE(${ordenes.horaAlarma}, ${ordenes.createdAt}) >= ${ini}`,
      sql`COALESCE(${ordenes.horaAlarma}, ${ordenes.createdAt}) < ${fin}`,
      or(
        isNotNull(ordenes.horaLlegada),
        isNotNull(ordenes.horaRestablecimiento),
        isNotNull(ordenes.horaMitigacion),
        eq(ordenes.tipo, "emergencia"),
      ),
    ));

  type Acc = {
    clave: string; label: string; fuente: TiempoSistemaRow["fuente"];
    ots: number; resp: number[]; rep: number[]; mit: number[];
    emergencias: number; sinRegistro: number;
  };
  const grupos = new Map<string, Acc>();

  for (const r of rows) {
    let clave: string, label: string, fuente: TiempoSistemaRow["fuente"];
    if (r.sistema) {
      clave = `sistema:${r.sistema}`; label = sistemaLabel(r.sistema); fuente = "sistema";
    } else if (r.activoId != null) {
      const d = rubroDeActivo(r.activoRubro, r.activoTipo);
      clave = `dominio:${d}`; label = rubroLabel(d); fuente = "dominio";
    } else {
      clave = "sin_clasificar"; label = "Sin sistema ni dominio"; fuente = "sin_clasificar";
    }

    const g = grupos.get(clave) ?? {
      clave, label, fuente, ots: 0, resp: [], rep: [], mit: [], emergencias: 0, sinRegistro: 0,
    };
    g.ots++;
    if (r.tipo === "emergencia") g.emergencias++;
    const base = r.horaAlarma ?? r.createdAt;
    const hResp = horasEntre(base, r.horaLlegada);
    const hRep = horasEntre(base, r.horaRestablecimiento);
    const hMit = horasEntre(base, r.horaMitigacion);
    if (hResp != null) g.resp.push(hResp);
    if (hRep != null) g.rep.push(hRep);
    if (hMit != null) g.mit.push(hMit);
    if (hResp == null && hRep == null && hMit == null) g.sinRegistro++;
    grupos.set(clave, g);
  }

  return [...grupos.values()]
    .map((g): TiempoSistemaRow => ({
      clave: g.clave,
      label: g.label,
      fuente: g.fuente,
      ots: g.ots,
      conRespuesta: g.resp.length,
      respuestaHoras: prom(g.resp),
      respuestaMaxHoras: g.resp.length > 0 ? Math.max(...g.resp) : null,
      conReparacion: g.rep.length,
      reparacionHoras: prom(g.rep),
      reparacionMaxHoras: g.rep.length > 0 ? Math.max(...g.rep) : null,
      conMitigacion: g.mit.length,
      mitigacionHoras: prom(g.mit),
      emergencias: g.emergencias,
      sinRegistro: g.sinRegistro,
    }))
    .sort((a, b) => b.ots - a.ots || a.label.localeCompare(b.label, "es"));
}

// ─── 3. INDICADOR 8 — horas fuera de rango por sala ──────────────────────────
// Lo calcula el motor AOP: `horasFueraRangoPorSala(db, periodo)` en
// src/lib/aop.ts, que es el dueño de aop_eventos y de la regla del episodio
// que sigue abierto. Aquí NO se duplica la consulta, y metricas.ts no importa
// aop.ts porque aop.ts ya importa `limitesPeriodo` de este módulo (sería un
// ciclo): las páginas lo importan directamente de "@/lib/aop".

// ─── 4. INDICADOR 1 — cumplimiento del preventivo por dominio ────────────────
// `computarPeriodo` ya calcula el cumplimiento por ALCANCE (global, general,
// biomédico). Esto lo abre por los cuatro DOMINIOS del plan maestro
// (infraestructura, climatización, equipo general, biomédico), que es el corte
// que pide el capítulo 2.2.
//
// A diferencia del cálculo histórico, aquí «a tiempo» compara solo la parte de
// fecha: una OT cerrada el mismo día del vencimiento cuenta como a tiempo.

export interface CumplimientoDominioRow {
  dominio: RubroKey | "sin_dominio";
  label: string;
  programados: number;
  aTiempo: number;
  tarde: number;
  pendientes: number;
  pct: number | null;
}

export async function cumplimientoPreventivoPorDominio(
  db: Db,
  inicio: string,
  fin: string,
  opts: { aplicarBase?: boolean } = {},
): Promise<CumplimientoDominioRow[]> {
  const ini = opts.aplicarBase === false ? inicio : aplicarLineaBase(inicio);
  if (ini >= fin) return [];

  const rows = await db
    .select({
      vencimiento: ordenes.vencimiento,
      completadaEn: ordenes.completadaEn,
      estado: ordenes.estado,
      activoId: ordenes.activoId,
      activoRubro: activos.rubro,
      activoTipo: activos.tipo,
    })
    .from(ordenes)
    .leftJoin(activos, eq(activos.id, ordenes.activoId))
    .where(and(
      eq(ordenes.tipo, "preventivo"),
      isNotNull(ordenes.vencimiento),
      gte(ordenes.vencimiento, ini),
      lt(ordenes.vencimiento, fin),
    ));

  const acc = new Map<string, { programados: number; aTiempo: number; tarde: number; pendientes: number }>();
  for (const r of rows) {
    const clave: string = r.activoId != null ? rubroDeActivo(r.activoRubro, r.activoTipo) : "sin_dominio";
    const g = acc.get(clave) ?? { programados: 0, aTiempo: 0, tarde: 0, pendientes: 0 };
    g.programados++;
    if (r.completadaEn) {
      if (r.completadaEn.slice(0, 10) <= r.vencimiento!.slice(0, 10)) g.aTiempo++;
      else g.tarde++;
    } else if (r.estado === "cancelada") {
      g.tarde++;
    } else {
      g.pendientes++;
    }
    acc.set(clave, g);
  }

  const claves = [...RUBRO_KEYS as readonly string[], "sin_dominio"];
  return claves
    .filter((k) => acc.has(k))
    .map((k): CumplimientoDominioRow => {
      const g = acc.get(k)!;
      return {
        dominio: k as RubroKey | "sin_dominio",
        label: k === "sin_dominio" ? "Sin dominio (OT sin equipo)" : rubroLabel(k),
        programados: g.programados,
        aTiempo: g.aTiempo,
        tarde: g.tarde,
        pendientes: g.pendientes,
        pct: g.programados > 0 ? (g.aTiempo / g.programados) * 100 : null,
      };
    });
}

// ─── 5. AVANCE DE LA BIBLIOTECA (capítulo 08) ────────────────────────────────
// El volumen entrega 25 documentos (cinco por tipo) y los nombra uno por uno en
// la matriz del capítulo 8.2: esa matriz (MATRIZ_CAP08 / CODIGOS_VOLUMEN de
// src/lib/procedimientos.ts) es la meta, así que el avance se mide contra los
// códigos reales y no contra un contador. La ruta son cuatro semanas: SCP en la
// 1; SOP y AOP en la 2; EOP en la 3 (con simulacro de mesa); MOP en la 4.
//
// Regla 8.1: «un SCP con una celda vacía es un SCP sin aprobar». El avance por
// documento lo calcula `progresoValidacion`, la misma función que decide si un
// documento puede pasar a vigente, para que el tablero y la ficha no difieran.

export const META_BIBLIOTECA = CODIGOS_VOLUMEN.length; // 25

// Códigos del volumen agrupados por tipo, tomados de la matriz del cap. 8.2.
const CODIGOS_POR_TIPO: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const [codigo, fila] of Object.entries(MATRIZ_CAP08)) {
    (out[fila.tipo] ??= []).push(codigo);
  }
  return out;
})();

export interface AvanceTipo {
  tipo: TipoProc;
  label: string;
  nombre: string;
  icono: string;
  color: string;
  semana: SemanaValidacion;
  meta: number;
  existen: number;
  vigentes: number;
  enValidacion: number;
  borradores: number;
  enRevision: number;
  retirados: number;
  docsConCamposPendientes: number;
  camposPendientes: number;
  camposTotal: number;
  validacionesPendientes: number;
  validacionesObservadas: number;
  validacionesValidadas: number;
  validacionesTotal: number;
  /** Códigos del volumen de este tipo que todavía no existen en el sistema. */
  faltantes: string[];
  pctCarga: number;
  pctVigente: number;
}

export interface DocPendienteRow {
  id: number;
  codigoCorto: string;
  codigoInstitucional: string | null;
  titulo: string;
  tipo: string;
  tipoLabel: string;
  sistema: string;
  sistemaLabel: string;
  estado: string;
  estadoLabel: string;
  estadoColor: string;
  version: string;
  semana: number;
  camposPendientes: number;
  validacionesPendientes: number;
  validacionesObservadas: number;
  /** Avance del documento según `progresoValidacion` (campos + áreas). */
  pct: number;
  listo: boolean;
  proximaValidacion: string | null;
}

export interface AvanceSemana {
  semana: SemanaValidacion;
  label: string;
  detalle: string;
  meta: number;
  existen: number;
  vigentes: number;
  validacionesPendientes: number;
  camposPendientes: number;
}

export interface AvanceBiblioteca {
  porTipo: AvanceTipo[];
  porSemana: AvanceSemana[];
  pendientes: DocPendienteRow[];
  totales: {
    meta: number;
    existen: number;
    vigentes: number;
    enValidacion: number;
    borradores: number;
    docsConCamposPendientes: number;
    camposPendientes: number;
    validacionesPendientes: number;
    validacionesObservadas: number;
    validacionesTotal: number;
    /** Códigos del volumen que todavía no se han cargado. */
    faltantes: string[];
    pctCarga: number;
    pctVigente: number;
  };
}

export async function avanceBiblioteca(db: Db): Promise<AvanceBiblioteca> {
  const docs = await db
    .select({
      id: procedimientos.id,
      codigoCorto: procedimientos.codigoCorto,
      codigoInstitucional: procedimientos.codigoInstitucional,
      titulo: procedimientos.titulo,
      tipo: procedimientos.tipo,
      sistema: procedimientos.sistema,
      estado: procedimientos.estado,
      version: procedimientos.version,
      semanaValidacion: procedimientos.semanaValidacion,
    })
    .from(procedimientos)
    .where(eq(procedimientos.activo, true))
    .orderBy(asc(procedimientos.tipo), asc(procedimientos.codigoCorto));

  const ids = docs.map((d) => d.id);

  // Campos en azul: `valor` vacío = celda que Avante todavía debe decidir.
  const campos = ids.length > 0
    ? await db
        .select({
          procedimientoId: procedimientoCampos.procedimientoId,
          etiqueta: procedimientoCampos.etiqueta,
          valor: procedimientoCampos.valor,
        })
        .from(procedimientoCampos)
        .where(inArray(procedimientoCampos.procedimientoId, ids))
    : [];

  const valis = ids.length > 0
    ? await db
        .select({
          procedimientoId: procedimientoValidaciones.procedimientoId,
          area: procedimientoValidaciones.area,
          estado: procedimientoValidaciones.estado,
          fechaProgramada: procedimientoValidaciones.fechaProgramada,
        })
        .from(procedimientoValidaciones)
        .where(inArray(procedimientoValidaciones.procedimientoId, ids))
    : [];

  const camposPorDoc = new Map<number, CampoAzul[]>();
  for (const c of campos) {
    const arr = camposPorDoc.get(c.procedimientoId) ?? [];
    arr.push({ etiqueta: c.etiqueta, valor: c.valor });
    camposPorDoc.set(c.procedimientoId, arr);
  }

  const valisPorDoc = new Map<number, ValidacionArea[]>();
  // Fecha más próxima entre las validaciones que siguen pendientes.
  const proximaPorDoc = new Map<number, string>();
  for (const v of valis) {
    const arr = valisPorDoc.get(v.procedimientoId) ?? [];
    arr.push({ area: v.area, estado: v.estado, fechaProgramada: v.fechaProgramada });
    valisPorDoc.set(v.procedimientoId, arr);
    if (v.estado === "pendiente" && v.fechaProgramada) {
      const actual = proximaPorDoc.get(v.procedimientoId);
      if (!actual || v.fechaProgramada < actual) proximaPorDoc.set(v.procedimientoId, v.fechaProgramada);
    }
  }

  // Un solo cálculo de avance por documento, con la regla del cap. 8.1.
  const progresoPorDoc = new Map<number, ReturnType<typeof progresoValidacion>>();
  for (const d of docs) {
    progresoPorDoc.set(d.id, progresoValidacion(camposPorDoc.get(d.id) ?? [], valisPorDoc.get(d.id) ?? []));
  }

  const presentes = new Set(docs.map((d) => d.codigoCorto.trim().toUpperCase()));

  const porTipo: AvanceTipo[] = TIPOS_PROC.map((tipo) => {
    const ds = docs.filter((d) => d.tipo === tipo);
    const codigos = CODIGOS_POR_TIPO[tipo] ?? [];
    const meta = codigos.length;
    let camposPendientes = 0, camposTotal = 0, docsConCamposPendientes = 0;
    let vPend = 0, vObs = 0, vVal = 0, vTot = 0;
    for (const d of ds) {
      const pr = progresoPorDoc.get(d.id)!;
      camposTotal += pr.camposTotal;
      camposPendientes += pr.camposFaltan;
      if (pr.camposFaltan > 0) docsConCamposPendientes++;
      vPend += pr.areasPendientes;
      vObs += pr.areasObservadas;
      vVal += pr.areasValidadas;
      vTot += pr.areasTotal;
    }
    const vigentes = ds.filter((d) => d.estado === "vigente").length;
    const info = TIPO_PROC[tipo];
    return {
      tipo,
      label: info.label,
      nombre: info.nombre,
      icono: info.icono,
      color: info.color,
      semana: semanaSugerida(tipo),
      meta,
      existen: ds.length,
      vigentes,
      enValidacion: ds.filter((d) => d.estado === "en_validacion").length,
      borradores: ds.filter((d) => d.estado === "borrador").length,
      enRevision: ds.filter((d) => d.estado === "en_revision").length,
      retirados: ds.filter((d) => d.estado === "retirado").length,
      docsConCamposPendientes,
      camposPendientes,
      camposTotal,
      validacionesPendientes: vPend,
      validacionesObservadas: vObs,
      validacionesValidadas: vVal,
      validacionesTotal: vTot,
      faltantes: codigos.filter((c) => !presentes.has(c)),
      pctCarga: meta > 0 ? Math.min(100, Math.round((ds.length / meta) * 100)) : 0,
      pctVigente: meta > 0 ? Math.min(100, Math.round((vigentes / meta) * 100)) : 0,
    };
  });

  const porSemana: AvanceSemana[] = ([1, 2, 3, 4] as SemanaValidacion[]).map((semana) => {
    const ts = porTipo.filter((t) => t.semana === semana);
    return {
      semana,
      label: SEMANAS_VALIDACION[semana].label,
      detalle: SEMANAS_VALIDACION[semana].detalle,
      meta: ts.reduce((s2, t) => s2 + t.meta, 0),
      existen: ts.reduce((s2, t) => s2 + t.existen, 0),
      vigentes: ts.reduce((s2, t) => s2 + t.vigentes, 0),
      validacionesPendientes: ts.reduce((s2, t) => s2 + t.validacionesPendientes, 0),
      camposPendientes: ts.reduce((s2, t) => s2 + t.camposPendientes, 0),
    };
  });

  const pendientes: DocPendienteRow[] = docs
    .map((d): DocPendienteRow => {
      const pr = progresoPorDoc.get(d.id)!;
      const est = ESTADO_PROC[d.estado as keyof typeof ESTADO_PROC] ?? ESTADO_PROC.borrador;
      return {
        id: d.id,
        codigoCorto: d.codigoCorto,
        codigoInstitucional: d.codigoInstitucional,
        titulo: d.titulo,
        tipo: d.tipo,
        tipoLabel: TIPO_PROC[d.tipo as TipoProc]?.label ?? d.tipo.toUpperCase(),
        sistema: d.sistema,
        sistemaLabel: sistemaLabel(d.sistema),
        estado: d.estado,
        estadoLabel: est.label,
        estadoColor: est.color,
        version: d.version,
        semana: d.semanaValidacion ?? semanaSugerida(d.tipo),
        camposPendientes: pr.camposFaltan,
        validacionesPendientes: pr.areasPendientes,
        validacionesObservadas: pr.areasObservadas,
        pct: pr.pct,
        listo: pr.listo,
        proximaValidacion: proximaPorDoc.get(d.id) ?? null,
      };
    })
    .filter((d) => d.camposPendientes > 0 || d.validacionesPendientes > 0 || d.validacionesObservadas > 0)
    .sort((a, b) =>
      a.semana - b.semana ||
      b.camposPendientes - a.camposPendientes ||
      a.codigoCorto.localeCompare(b.codigoCorto, "es"));

  const existen = porTipo.reduce((s2, t) => s2 + t.existen, 0);
  const vigentes = porTipo.reduce((s2, t) => s2 + t.vigentes, 0);

  return {
    porTipo,
    porSemana,
    pendientes,
    totales: {
      meta: META_BIBLIOTECA,
      existen,
      vigentes,
      enValidacion: porTipo.reduce((s2, t) => s2 + t.enValidacion, 0),
      borradores: porTipo.reduce((s2, t) => s2 + t.borradores, 0),
      docsConCamposPendientes: porTipo.reduce((s2, t) => s2 + t.docsConCamposPendientes, 0),
      camposPendientes: porTipo.reduce((s2, t) => s2 + t.camposPendientes, 0),
      validacionesPendientes: porTipo.reduce((s2, t) => s2 + t.validacionesPendientes, 0),
      validacionesObservadas: porTipo.reduce((s2, t) => s2 + t.validacionesObservadas, 0),
      validacionesTotal: porTipo.reduce((s2, t) => s2 + t.validacionesTotal, 0),
      faltantes: CODIGOS_VOLUMEN.filter((c) => !presentes.has(c)),
      pctCarga: Math.min(100, Math.round((existen / META_BIBLIOTECA) * 100)),
      pctVigente: Math.min(100, Math.round((vigentes / META_BIBLIOTECA) * 100)),
    },
  };
}
