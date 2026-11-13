// Tablero de preventivos (pedido de la gerencia de operaciones, 13/11/2026): qué
// preventivos vienen, cuáles están atrasados y quién los tiene. Y la regla de
// responsabilidad: la fecha programada y la frecuencia de un preventivo no
// cambian sin motivo, y todo cambio hecho por una persona queda en audit_log con
// quién, cuándo, antes, después y motivo, en el mismo lote que el cambio.
//
// Definiciones (se muestran también en /preventivos):
// - Fecha programada: planes_mantenimiento.proxima_fecha. El cron crea la OT del
//   preventivo cuando esa fecha llega (proxima_fecha <= hoy) y no la mueve; solo
//   avanza cuando la OT se verifica y se cierra (orden-verificacion.ts), desde el
//   día en que se ejecutó. Por eso, mientras la OT está abierta, su fecha
//   programada es la proxima_fecha de su plan. El vencimiento de la OT (fecha +
//   días de alerta) es otro plazo y aquí no se usa.
// - Completado: la OT pasó a «completada» (enviada a verificación), «verificada»
//   o «cerrada». Enviada a verificación ya no cuenta como atraso del técnico.
// - Atrasado: la fecha programada es anterior a hoy en El Salvador (1 día o más)
//   y el preventivo no se completó: su OT sigue abierta, en proceso o en espera, o
//   el plan activo no tiene OT (no se generó, o la del ciclo se canceló o borró).
import type { APIContext } from "astro";
import { and, asc, desc, eq, gte, isNotNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "./db";
import { activos, auditLog, ordenes, planesMantenimiento, sucursales, ubicaciones, usuarios } from "./schema";
// calcularDiff es una función pura: se importa por ruta relativa a propósito.
import { calcularDiff, labelCampo, type DiffEntry } from "./audit";
import { activoAreaCondition, parseArea, type AreaKey } from "./areas";
import { FRECUENCIAS } from "./frecuencias";
import { fmtFechaSoloCompacta, fmtMarcaSV, msDeMarca } from "./datetime";
import { etiquetaOT } from "./orden-codigo";
import { ahoraSV } from "./turnos";
import { aplicarCambioOrden } from "./orden-cambio";
import { crearNotificacion } from "@/lib/notif-app";

type Db = ReturnType<typeof getDb>;
type Usuario = { id: number; rol: string; nombre: string };

export const OT_ABIERTA = ["abierta", "en_proceso", "en_espera"] as const;
export const OT_EN_VERIFICACION = ["completada", "verificada"] as const;
export const ROLES_TABLERO = ["admin", "jefe"] as const;
export const MOTIVO_MINIMO = 10;
export const MENSAJE_MOTIVO = `Escribe el motivo (mínimo ${MOTIVO_MINIMO} caracteres). Cambiar la fecha programada o la frecuencia, desactivar o eliminar un preventivo queda registrado con tu nombre, la hora, el antes y el después.`;
export const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
export const DIAS_POR_DEFECTO = 14;
const LIMITE_FILAS = 500;

export const motivoValido = (m: unknown): m is string => typeof m === "string" && m.trim().length >= MOTIVO_MINIMO;
export const esJefatura = (rol: string | null | undefined) => rol === "admin" || rol === "jefe";
export const frecuenciaTexto = (f: string | null | undefined) =>
  FRECUENCIAS.find((x) => x.value === f)?.label ?? (f ? f.charAt(0).toUpperCase() + f.slice(1) : "—");

// ─── Fechas: AAAA-MM-DD sin pasar por la zona del runtime ────────────────────
export const hoySV = () => ahoraSV().fecha;
const msDia = (f: string) => { const [y, m, d] = f.slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d); };
export const sumarDias = (fecha: string, dias: number) => new Date(msDia(fecha) + dias * 86_400_000).toISOString().slice(0, 10);
export const diasEntre = (desde: string, hasta: string) => Math.round((msDia(hasta) - msDia(desde)) / 86_400_000);
const fechaValida = (f: string) => FECHA_RE.test(f) && new Date(msDia(f)).toISOString().slice(0, 10) === f;

const estadosSql = (e: readonly string[]) => sql.raw(e.map((x) => `'${x}'`).join(", "));
/** Lista de ids en un solo parámetro: D1 rechaza más de 100 por consulta. */
const enListaDePlanes = (ids: number[]) => sql`${planesMantenimiento.id} in (select value from json_each(${JSON.stringify(ids)}))`;

// ─── La regla del motivo ─────────────────────────────────────────────────────
export type DiffPlan = Record<string, DiffEntry>;

/** Cambiar la fecha programada o la frecuencia, o desactivar el preventivo, pide motivo. */
export function cambioPideMotivo(diff: DiffPlan): boolean {
  return "proximaFecha" in diff || "frecuencia" in diff || (diff.activo !== undefined && !diff.activo.despues);
}

export function accionDeCambio(diff: DiffPlan): string {
  if ("proximaFecha" in diff || "frecuencia" in diff) return "reprogramacion";
  if (diff.activo) return diff.activo.despues ? "activacion" : "desactivacion";
  if ("asignadoA" in diff && Object.keys(diff).length === 1) return "asignacion";
  return "update";
}

export function diffDePlan(actual: Record<string, unknown>, cambios: Record<string, unknown>): DiffPlan {
  return calcularDiff(actual, cambios);
}

function resumenDeCambio(accion: string, titulo: string, diff: DiffPlan): string {
  const t = `«${titulo}»`;
  if (accion === "reprogramacion") {
    const partes: string[] = [];
    if (diff.proximaFecha) partes.push(`fecha ${fmtFechaSoloCompacta(String(diff.proximaFecha.antes ?? ""))} → ${fmtFechaSoloCompacta(String(diff.proximaFecha.despues ?? ""))}`);
    if (diff.frecuencia) partes.push(`frecuencia ${frecuenciaTexto(String(diff.frecuencia.antes))} → ${frecuenciaTexto(String(diff.frecuencia.despues))}`);
    return `Reprogramó ${t}: ${partes.join(", ")}`;
  }
  if (accion === "desactivacion") return `Desactivó ${t}`;
  if (accion === "activacion") return `Activó ${t}`;
  if (accion === "asignacion") return diff.asignadoA?.despues ? `Cambió el técnico de ${t}` : `Quitó el técnico de ${t}`;
  return `Modificó ${t}: ${Object.keys(diff).map(labelCampo).join(", ")}`;
}

/**
 * Las dos filas de audit_log de un cambio en preventivos: una del plan (su
 * historial) y otra del equipo (el historial de la ficha). Se insertan con un
 * SELECT sobre los planes que cumplen `donde`, en el mismo lote que el cambio y
 * antes de él: si la guarda ya no se cumple, no queda ni el cambio ni el registro.
 */
export function registrosDePlanes(db: Db, a: { donde: SQL; usuarioId: number | null; accion: string; cambios: SQL; resumen: SQL }) {
  const fila = (entidad: "plan" | "activo") => db.insert(auditLog).select(db.select({
    id: sql<number>`null`.as("id"),
    entidad: sql<string>`${entidad}`.as("entidad"),
    entidadId: sql<number>`${entidad === "plan" ? planesMantenimiento.id : planesMantenimiento.activoId}`.as("entidad_id"),
    accion: sql<string>`${a.accion}`.as("accion"),
    usuarioId: sql<number>`${a.usuarioId}`.as("usuario_id"),
    cambios: sql<string>`${a.cambios}`.as("cambios"),
    resumen: sql<string>`${entidad === "plan" ? a.resumen : sql`'Preventivo: ' || ${a.resumen}`}`.as("resumen"),
    createdAt: sql<string>`CURRENT_TIMESTAMP`.as("created_at"),
  }).from(planesMantenimiento).where(a.donde));
  return [fila("plan"), fila("activo")] as const;
}

/** Igualdad con lo que se leyó, campo por campo: la guarda de una escritura sobre un plan. */
export function guardaDePlan(actual: Record<string, any>, campos: string[]): SQL | undefined {
  const condiciones = campos.map((campo) => {
    const columna = (planesMantenimiento as any)[campo];
    const valor = actual[campo];
    return valor === null || valor === undefined ? sql`${columna} is null` : eq(columna, valor);
  });
  return condiciones.length ? and(...condiciones) : undefined;
}

/**
 * Aplica un cambio de una persona a un plan: guarda el cambio y su registro en un
 * solo lote, con la guarda de lo que se leyó. Quien llama ya revisó la regla del
 * motivo. null si otra escritura cambió el plan en medio.
 */
export async function escribirCambioDePlan(
  db: Db,
  plan: typeof planesMantenimiento.$inferSelect,
  cambios: Record<string, unknown>,
  diff: DiffPlan,
  usuario: Usuario,
  motivo: string | null,
) {
  const campos = Object.keys(diff);
  const guarda = and(eq(planesMantenimiento.id, plan.id), guardaDePlan(plan, campos))!;
  const accion = accionDeCambio(diff);
  const cuerpo = JSON.stringify({ ...diff, ...(motivo?.trim() ? { motivo: motivo.trim() } : {}) });
  const set = Object.fromEntries(campos.map((c) => [c, cambios[c]]));
  const [registroPlan, registroActivo] = registrosDePlanes(db, {
    donde: guarda, usuarioId: usuario.id, accion, cambios: sql`${cuerpo}`, resumen: sql`${resumenDeCambio(accion, plan.titulo, diff)}`,
  });
  const resultado = await db.batch([
    registroPlan, registroActivo,
    db.update(planesMantenimiento).set(set).where(guarda).returning(),
  ]);
  const [fila] = resultado[2] as (typeof planesMantenimiento.$inferSelect)[];
  return fila ?? null;
}

/** Elimina planes con su registro (motivo incluido). Si un plan tiene órdenes ligadas, la base lo impide y no queda nada. */
export async function eliminarPlanes(db: Db, ids: number[], usuario: Usuario, motivo: string): Promise<{ ok: true; n: number } | { ok: false; error: string }> {
  const donde = enListaDePlanes(ids);
  const cuerpo = sql`json_object(
    'proximaFecha', json_object('antes', ${planesMantenimiento.proximaFecha}, 'despues', null),
    'frecuencia', json_object('antes', ${planesMantenimiento.frecuencia}, 'despues', null),
    'asignadoA', json_object('antes', ${planesMantenimiento.asignadoA}, 'despues', null),
    'motivo', ${motivo.trim()})`;
  const [registroPlan, registroActivo] = registrosDePlanes(db, {
    donde, usuarioId: usuario.id, accion: "delete", cambios: cuerpo, resumen: sql`'Eliminó «' || ${planesMantenimiento.titulo} || '»'`,
  });
  try {
    const r = await db.batch([registroPlan, registroActivo, db.delete(planesMantenimiento).where(donde).returning({ id: planesMantenimiento.id })]);
    return { ok: true, n: (r[2] as unknown[]).length };
  } catch {
    return { ok: false, error: "No se puede eliminar: el preventivo ya tiene órdenes u otros registros ligados. Desactívalo con su motivo; su historial se conserva." };
  }
}

/** Activa o desactiva planes con su registro. Solo cambia los que estaban al revés. */
export async function activarPlanes(db: Db, ids: number[], activo: boolean, usuario: Usuario, motivo: string | null) {
  const donde = and(enListaDePlanes(ids), eq(planesMantenimiento.activo, !activo))!;
  const cuerpo = JSON.stringify({ activo: { antes: !activo, despues: activo }, ...(motivo?.trim() ? { motivo: motivo.trim() } : {}) });
  const [registroPlan, registroActivo] = registrosDePlanes(db, {
    donde, usuarioId: usuario.id, accion: activo ? "activacion" : "desactivacion", cambios: sql`${cuerpo}`,
    resumen: sql`${activo ? "Activó «" : "Desactivó «"} || ${planesMantenimiento.titulo} || '»'`,
  });
  const r = await db.batch([registroPlan, registroActivo, db.update(planesMantenimiento).set({ activo }).where(donde).returning({ id: planesMantenimiento.id })]);
  return (r[2] as unknown[]).length;
}

// ─── Asignar ─────────────────────────────────────────────────────────────────
type ErrorOrden = { ordenId: number; error: string };

/**
 * El técnico de las OT abiertas de esos planes, por el camino de siempre
 * (aplicarCambioOrden): mismas reglas, mismo rastro y la notificación al técnico.
 */
export async function reasignarOrdenesAbiertas(ctx: APIContext, usuario: Usuario, planIds: number[], tecnicoId: number | null, motivo: string | null) {
  const db = getDb(ctx);
  const abiertas = await db.select({ id: ordenes.id, planId: ordenes.planId, asignadoA: ordenes.asignadoA }).from(ordenes)
    .where(and(sql`${ordenes.planId} in (select value from json_each(${JSON.stringify(planIds)}))`, sql`${ordenes.estado} in (${estadosSql(OT_ABIERTA)})`));
  let cambiadas = 0;
  const errores: ErrorOrden[] = [];
  for (const o of abiertas) {
    if (o.asignadoA === tecnicoId) continue;
    const r = await aplicarCambioOrden(ctx, usuario as any, o.id, { asignadoA: tecnicoId, ...(motivo?.trim() ? { motivoReasignacion: motivo.trim() } : {}) });
    if (r.ok) cambiadas++;
    else {
      const j: any = await r.json().catch(() => ({}));
      errores.push({ ordenId: o.id, error: typeof j?.error === "string" ? j.error : "No se pudo reasignar la orden." });
    }
  }
  return { cambiadas, errores, planesConOrden: new Set(abiertas.map((o) => o.planId as number)) };
}

export type ResultadoAsignacion =
  | { ok: true; planes: number; ordenes: number; errores: ErrorOrden[] }
  | { ok: false; status: number; error: string };

/**
 * Asigna (o quita, con null) el técnico de varios preventivos: queda en el plan
 * para las próximas OT y en la OT abierta de cada uno. Cada plan que cambia deja
 * su registro en el mismo lote.
 */
export async function asignarPreventivos(ctx: APIContext, db: Db, usuario: Usuario, planIds: number[], tecnicoId: number | null, motivo: string | null = null): Promise<ResultadoAsignacion> {
  const ids = [...new Set(planIds)];
  if (!ids.length) return { ok: false, status: 400, error: "Elige al menos un preventivo." };
  const enLista = enListaDePlanes(ids);
  const encontrados = await db.select({ id: planesMantenimiento.id, codigo: activos.codigo }).from(planesMantenimiento)
    .innerJoin(activos, eq(activos.id, planesMantenimiento.activoId)).where(enLista);
  if (encontrados.length !== ids.length) return { ok: false, status: 404, error: "Alguno de los preventivos ya no existe. Actualiza la página." };
  let nombre: string | null = null;
  if (tecnicoId !== null) {
    const [t] = await db.select({ nombre: usuarios.nombre, rol: usuarios.rol, activo: usuarios.activo }).from(usuarios).where(eq(usuarios.id, tecnicoId)).limit(1);
    if (!t || !t.activo || t.rol !== "tecnico") return { ok: false, status: 400, error: "Elige un técnico activo." };
    nombre = t.nombre;
  }
  const motivoLimpio = motivo?.trim() || null;
  const cambia = and(enLista, sql`${planesMantenimiento.asignadoA} is not ${tecnicoId}`)!;
  const cuerpo = motivoLimpio
    ? sql`json_object('asignadoA', json_object('antes', ${planesMantenimiento.asignadoA}, 'despues', ${tecnicoId}), 'motivo', ${motivoLimpio})`
    : sql`json_object('asignadoA', json_object('antes', ${planesMantenimiento.asignadoA}, 'despues', ${tecnicoId}))`;
  const resumen = nombre
    ? sql`'Asignó «' || ${planesMantenimiento.titulo} || '» a ' || ${nombre}`
    : sql`'Quitó el técnico de «' || ${planesMantenimiento.titulo} || '»'`;
  const [registroPlan, registroActivo] = registrosDePlanes(db, { donde: cambia, usuarioId: usuario.id, accion: "asignacion", cambios: cuerpo, resumen });
  const r = await db.batch([registroPlan, registroActivo, db.update(planesMantenimiento).set({ asignadoA: tecnicoId }).where(cambia).returning({ id: planesMantenimiento.id })]);
  const cambiados = (r[2] as { id: number }[]).map((x) => x.id);

  const ots = await reasignarOrdenesAbiertas(ctx, usuario, ids, tecnicoId, motivoLimpio);
  // Las OT avisan por su cuenta. Los planes sin OT abierta, un solo aviso al técnico.
  const sinOrden = cambiados.filter((id) => !ots.planesConOrden.has(id));
  if (tecnicoId !== null && tecnicoId !== usuario.id && sinOrden.length) {
    const codigo = encontrados.find((e) => e.id === sinOrden[0])?.codigo ?? "";
    try {
      await crearNotificacion(ctx, {
        usuarioId: tecnicoId, tipo: "preventivo_asignado",
        titulo: sinOrden.length === 1 ? `Te asignaron el preventivo de ${codigo}` : `Te asignaron ${sinOrden.length} preventivos`,
        mensaje: "La orden te llega el día programado.", link: "/cronograma",
      });
    } catch {}
  }
  return { ok: true, planes: cambiados.length, ordenes: ots.cambiadas, errores: ots.errores };
}

// ─── El tablero ──────────────────────────────────────────────────────────────
export interface FiltrosTablero { desde: string; hasta: string; sedeId: number | null; area: AreaKey | null; q: string }

export function leerFiltros(params: URLSearchParams, hoy = hoySV()): { filtros: FiltrosTablero; error: string | null } {
  const porDefecto = { desde: hoy, hasta: sumarDias(hoy, DIAS_POR_DEFECTO - 1) };
  let desde = params.get("desde") || porDefecto.desde;
  let hasta = params.get("hasta") || porDefecto.hasta;
  let error: string | null = null;
  if (!fechaValida(desde) || !fechaValida(hasta)) { error = "Las fechas deben tener el formato AAAA-MM-DD."; ({ desde, hasta } = porDefecto); }
  else if (hasta < desde) { error = "La fecha final es anterior a la inicial."; ({ desde, hasta } = porDefecto); }
  else if (diasEntre(desde, hasta) > 366) { error = "El rango puede ser de un año como máximo."; ({ desde, hasta } = porDefecto); }
  const sede = Number(params.get("sede"));
  return {
    filtros: { desde, hasta, sedeId: Number.isInteger(sede) && sede > 0 ? sede : null, area: parseArea(params.get("area")), q: (params.get("q") ?? "").trim().slice(0, 100) },
    error,
  };
}

const otFila = alias(ordenes, "ot");
const tecnicoDelPlan = alias(usuarios, "tec_plan");
const tecnicoDeLaOt = alias(usuarios, "tec_ot");
// La OT abierta más reciente del plan (normalmente es una sola).
const otAbiertaDelPlan = sql`(select max(o2.id) from ordenes o2 where o2.plan_id = ${planesMantenimiento.id} and o2.estado in (${estadosSql(OT_ABIERTA)}))`;
const enVerificacionDelPlan = sql`exists (select 1 from ordenes o3 where o3.plan_id = ${planesMantenimiento.id} and o3.estado in (${estadosSql(OT_EN_VERIFICACION)}))`;

async function consultarFilas(db: Db, donde: SQL | undefined) {
  return db.select({
    planId: planesMantenimiento.id, titulo: planesMantenimiento.titulo, frecuencia: planesMantenimiento.frecuencia,
    fecha: planesMantenimiento.proximaFecha, prioridad: planesMantenimiento.prioridad, planActivo: planesMantenimiento.activo,
    planAsignadoA: planesMantenimiento.asignadoA, ultimaGeneracion: planesMantenimiento.ultimaGeneracion,
    activoId: activos.id, codigo: activos.codigo, nombre: activos.nombre, rubro: activos.rubro, tipo: activos.tipo, estadoEquipo: activos.estado,
    ubicacionId: activos.ubicacionId, ubicacionTexto: activos.ubicacion, sede: sucursales.nombre,
    tecnicoPlan: tecnicoDelPlan.nombre,
    otId: otFila.id, otCodigo: otFila.codigo, otEstado: otFila.estado, otAsignadoA: otFila.asignadoA, tecnicoOt: tecnicoDeLaOt.nombre,
    enVerificacion: sql<number>`${enVerificacionDelPlan}`,
  }).from(planesMantenimiento)
    .innerJoin(activos, eq(activos.id, planesMantenimiento.activoId))
    .leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId))
    .leftJoin(sucursales, eq(sucursales.id, ubicaciones.sucursalId))
    .leftJoin(tecnicoDelPlan, eq(tecnicoDelPlan.id, planesMantenimiento.asignadoA))
    .leftJoin(otFila, sql`${otFila.id} = ${otAbiertaDelPlan}`)
    .leftJoin(tecnicoDeLaOt, eq(tecnicoDeLaOt.id, otFila.asignadoA))
    .where(donde)
    .orderBy(asc(planesMantenimiento.proximaFecha), asc(activos.codigo), asc(planesMantenimiento.id))
    .limit(LIMITE_FILAS + 1);
}

export type FilaTablero = ReturnType<typeof armarFila>;

function armarFila(r: Awaited<ReturnType<typeof consultarFilas>>[number], hoy: string, ruta: (id: number | null) => string | null) {
  const ot = r.otId ? { id: r.otId, etiqueta: etiquetaOT({ id: r.otId, codigo: r.otCodigo }), estado: r.otEstado!, asignadoA: r.otAsignadoA, asignado: r.tecnicoOt } : null;
  // Quién tiene el trabajo: con OT abierta, el de la OT; sin ella, el del plan.
  const tecnicoId = ot ? ot.asignadoA : r.planAsignadoA;
  const tecnico = ot ? ot.asignado : r.tecnicoPlan;
  const dias = diasEntre(r.fecha, hoy);
  const cicloGenerado = !!(r.ultimaGeneracion && r.ultimaGeneracion.slice(0, 10) >= r.fecha);
  return {
    planId: r.planId, titulo: r.titulo, frecuencia: r.frecuencia, frecuenciaTexto: frecuenciaTexto(r.frecuencia),
    fecha: r.fecha, fechaTexto: fmtFechaSoloCompacta(r.fecha), diasAtraso: Math.max(0, dias), diasParaFecha: Math.max(0, -dias),
    prioridad: r.prioridad, planActivo: !!r.planActivo,
    equipo: { id: r.activoId, codigo: r.codigo, nombre: r.nombre, area: parseArea(r.rubro) ?? (r.tipo === "biomedico" ? "biomedico" : "equipo_general"), estado: r.estadoEquipo },
    ubicacion: ruta(r.ubicacionId) ?? r.ubicacionTexto ?? null, sede: r.sede ?? null,
    ot, enVerificacion: !!Number(r.enVerificacion),
    tecnicoPlan: r.planAsignadoA ? { id: r.planAsignadoA, nombre: r.tecnicoPlan ?? `#${r.planAsignadoA}` } : null,
    tecnico: tecnicoId ? { id: tecnicoId, nombre: tecnico ?? `#${tecnicoId}` } : null,
    // Sin OT y con el ciclo ya generado: la OT se canceló o se borró; el cron no genera otra hasta que cambie la fecha.
    otCanceladaOBorrada: !ot && cicloGenerado,
  };
}

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export async function datosTablero(db: Db, filtros: FiltrosTablero, hoy = hoySV()) {
  // Rutas de ubicación: el árbol completo en una consulta sin parámetros.
  const ubs = await db.select({ id: ubicaciones.id, nombre: ubicaciones.nombre, padreId: ubicaciones.padreId }).from(ubicaciones);
  const porId = new Map(ubs.map((u) => [u.id, u]));
  const ruta = (id: number | null) => {
    const u = id ? porId.get(id) : undefined;
    if (!u) return null;
    const partes = [u.nombre];
    let p = u.padreId ? porId.get(u.padreId) : undefined;
    for (let i = 0; p && i < 6; i++) { partes.unshift(p.nombre); p = p.padreId ? porId.get(p.padreId) : undefined; }
    return partes.join(" · ");
  };
  const comunes = and(
    filtros.sedeId ? eq(ubicaciones.sucursalId, filtros.sedeId) : undefined,
    filtros.area ? activoAreaCondition(filtros.area) : undefined,
  );
  const [prog, atr] = await Promise.all([
    consultarFilas(db, and(eq(planesMantenimiento.activo, true), gte(planesMantenimiento.proximaFecha, filtros.desde), lte(planesMantenimiento.proximaFecha, filtros.hasta), comunes)),
    consultarFilas(db, and(
      lt(planesMantenimiento.proximaFecha, hoy),
      or(isNotNull(otFila.id), and(eq(planesMantenimiento.activo, true), sql`not ${enVerificacionDelPlan}`)),
      comunes,
    )),
  ]);
  const q = normalizar(filtros.q);
  const pasa = (f: FilaTablero) => !q || normalizar([f.equipo.codigo, f.equipo.nombre, f.titulo, f.ubicacion ?? "", f.sede ?? "", f.tecnico?.nombre ?? ""].join(" ")).includes(q);
  const programados = prog.slice(0, LIMITE_FILAS).map((r) => armarFila(r, hoy, ruta)).filter(pasa);
  const atrasados = atr.slice(0, LIMITE_FILAS).map((r) => armarFila(r, hoy, ruta)).filter(pasa)
    .sort((a, b) => b.diasAtraso - a.diasAtraso || a.equipo.codigo.localeCompare(b.equipo.codigo));

  const tecnicos = await db.select({
    id: usuarios.id, nombre: usuarios.nombre,
    abiertas: sql<number>`(select count(*) from ordenes o4 where o4.asignado_a = ${usuarios.id} and o4.estado in (${estadosSql(OT_ABIERTA)}))`,
    preventivos: sql<number>`(select count(*) from planes_mantenimiento p4 where p4.asignado_a = ${usuarios.id} and p4.activo = 1)`,
  }).from(usuarios).where(and(eq(usuarios.rol, "tecnico"), eq(usuarios.activo, true))).orderBy(asc(usuarios.nombre));
  const sedes = await db.select({ id: sucursales.id, nombre: sucursales.nombre }).from(sucursales).where(eq(sucursales.activa, true)).orderBy(asc(sucursales.nombre));

  return {
    hoy, filtros,
    programados,
    atrasados: { sinAsignar: atrasados.filter((f) => !f.tecnico), asignados: atrasados.filter((f) => !!f.tecnico) },
    truncado: prog.length > LIMITE_FILAS || atr.length > LIMITE_FILAS,
    tecnicos: tecnicos.map((t) => ({ id: t.id, nombre: t.nombre, abiertas: Number(t.abiertas), preventivos: Number(t.preventivos) })),
    sedes,
  };
}

// ─── Historial de un preventivo ──────────────────────────────────────────────
export interface EntradaHistorial {
  planId: number;
  cuando: string;
  cuandoTexto: string;
  autor: string;
  accion: string;
  accionTexto: string;
  resumen: string | null;
  cambios: { campo: string; label: string; antes: string; despues: string }[];
  motivo: string | null;
  ordenId?: number;
}

const ACCION_TEXTO: Record<string, string> = {
  reprogramacion: "Reprogramación", asignacion: "Asignación", desactivacion: "Desactivación", activacion: "Activación",
  delete: "Eliminación", create: "Creación", update: "Edición", ot_generada: "OT generada", ot_cerrada: "OT cerrada",
};

/**
 * Lo que una persona cambió en el preventivo (audit_log) y lo que hizo el sistema
 * (OT generada, OT verificada y cerrada que movió la fecha), del más nuevo al más
 * viejo. Por plan o por todos los planes de un equipo, con subconsultas.
 */
export async function historialDePlanes(db: Db, filtro: { planId: number } | { activoId: number }, limite = 100): Promise<EntradaHistorial[]> {
  const planesDe = "planId" in filtro
    ? (col: any) => eq(col, filtro.planId)
    : (col: any) => sql`${col} in (select id from planes_mantenimiento where activo_id = ${filtro.activoId})`;
  const filas = await db.select({ planId: auditLog.entidadId, accion: auditLog.accion, cambios: auditLog.cambios, resumen: auditLog.resumen, createdAt: auditLog.createdAt, autor: usuarios.nombre })
    .from(auditLog).leftJoin(usuarios, eq(usuarios.id, auditLog.usuarioId))
    .where(and(eq(auditLog.entidad, "plan"), planesDe(auditLog.entidadId)))
    .orderBy(desc(auditLog.id)).limit(limite);
  const verificador = alias(usuarios, "verificador");
  const ots = await db.select({ id: ordenes.id, codigo: ordenes.codigo, planId: ordenes.planId, estado: ordenes.estado, createdAt: ordenes.createdAt, completadaEn: ordenes.completadaEn, cerradoEn: ordenes.cerradoEn, verificador: verificador.nombre })
    .from(ordenes).leftJoin(verificador, eq(verificador.id, ordenes.verificadoPor))
    .where(planesDe(ordenes.planId)).orderBy(desc(ordenes.id)).limit(limite);
  const nombres = new Map((await db.select({ id: usuarios.id, nombre: usuarios.nombre }).from(usuarios)).map((u) => [u.id, u.nombre]));

  const valor = (campo: string, v: unknown): string => {
    if (v === null || v === undefined || v === "") return campo === "asignadoA" ? "Sin asignar" : "—";
    if (campo === "proximaFecha") return fmtFechaSoloCompacta(String(v));
    if (campo === "frecuencia") return frecuenciaTexto(String(v));
    if (campo === "asignadoA") return nombres.get(Number(v)) ?? `#${v}`;
    if (campo === "activo") return v ? "Activo" : "Desactivado";
    if (campo === "checklist") return "(lista de pasos)";
    return String(v);
  };
  const entradas: EntradaHistorial[] = filas.map((f) => {
    let cuerpo: Record<string, any> = {};
    try { cuerpo = f.cambios ? JSON.parse(f.cambios) : {}; } catch {}
    const motivo = typeof cuerpo.motivo === "string" ? cuerpo.motivo : null;
    const cambios = Object.entries(cuerpo)
      .filter(([campo, v]) => campo !== "motivo" && v && typeof v === "object" && "antes" in v)
      .map(([campo, v]: [string, any]) => ({ campo, label: labelCampo(campo), antes: valor(campo, v.antes), despues: valor(campo, v.despues) }));
    return { planId: f.planId, cuando: f.createdAt, cuandoTexto: fmtMarcaSV(f.createdAt), autor: f.autor ?? "Sistema", accion: f.accion, accionTexto: ACCION_TEXTO[f.accion] ?? "Cambio", resumen: f.resumen, cambios, motivo };
  });
  for (const o of ots) {
    const etiqueta = etiquetaOT(o);
    entradas.push({ planId: o.planId!, cuando: o.createdAt, cuandoTexto: fmtMarcaSV(o.createdAt), autor: "Sistema", accion: "ot_generada", accionTexto: ACCION_TEXTO.ot_generada, resumen: `Se generó la ${etiqueta}.`, cambios: [], motivo: null, ordenId: o.id });
    if (o.estado === "cerrada" && o.cerradoEn) {
      entradas.push({
        planId: o.planId!, cuando: o.cerradoEn, cuandoTexto: fmtMarcaSV(o.cerradoEn), autor: o.verificador ?? "Sistema", accion: "ot_cerrada", accionTexto: ACCION_TEXTO.ot_cerrada,
        resumen: `Verificó y cerró la ${etiqueta}. El sistema calculó la próxima fecha desde la ejecución${o.completadaEn ? ` del ${fmtMarcaSV(o.completadaEn).slice(0, 10)}` : ""}.`,
        cambios: [], motivo: null, ordenId: o.id,
      });
    }
  }
  return entradas.sort((a, b) => (msDeMarca(b.cuando) ?? 0) - (msDeMarca(a.cuando) ?? 0)).slice(0, limite);
}
