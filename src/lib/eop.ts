// ─── EOP · la emergencia en el celular ──────────────────────────────────────
//
// El técnico trabaja la emergencia con lo que se sabe de memoria: las tres
// primeras acciones de su EOP, como pasos, y tres toques que fijan las horas
// (llegué, situación controlada, servicio restablecido). Las horas se
// registran, pero el celular no las muestra: los indicadores 5 y 7 los lee la
// jefatura en la ficha.
import type { APIContext } from "astro";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { activos, eopFicha, ordenes, procedimientos, ubicaciones } from "@/lib/schema";
import { queSigue } from "@/lib/resolver";
import { logAudit } from "@/lib/audit";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;
type Orden = typeof ordenes.$inferSelect;

/** Rótulo del toque intermedio cuando el EOP no fija el suyo («Energía de emergencia en servicio»). */
export const ETIQUETA_MITIGACION_CAMPO = "Situación controlada";

/** Cada toque del celular y la columna que fija. El primer toque manda; la jefatura corrige en la ficha. */
export const HITOS_EOP = {
  llegada: "horaLlegada",
  mitigacion: "horaMitigacion",
  restablecimiento: "horaRestablecimiento",
} as const;
export type HitoEop = keyof typeof HITOS_EOP;
export const esHitoEop = (x: unknown): x is HitoEop => typeof x === "string" && Object.prototype.hasOwnProperty.call(HITOS_EOP, x);

/** Lo que va antes de cada toque: un hito no puede quedar antes del anterior. */
export function minimoDeHito(o: Pick<Orden, "horaAlarma" | "horaLlegada" | "horaMitigacion">, hito: HitoEop): string | null {
  if (hito === "llegada") return o.horaAlarma ?? null;
  if (hito === "mitigacion") return o.horaLlegada ?? o.horaAlarma ?? null;
  return o.horaMitigacion ?? o.horaLlegada ?? o.horaAlarma ?? null;
}

export interface FichaEop {
  id: number;
  codigo: string;
  titulo: string;
  tipo: string;
  acciones: string[];
  etiquetaMitigacion: string;
}

/** Lo que el celular necesita del EOP de una emergencia. */
export interface EopDeOrden {
  codigo: string | null;
  titulo: string | null;
  etiquetaMitigacion: string;
  acciones: string[];
}

export const SIN_EOP: EopDeOrden = { codigo: null, titulo: null, etiquetaMitigacion: ETIQUETA_MITIGACION_CAMPO, acciones: [] };

const accionesDe = (...xs: Array<string | null | undefined>) => xs.map((x) => (x ?? "").trim()).filter(Boolean);
const etiquetaDe = (t: string | null | undefined) => (t ?? "").trim() || ETIQUETA_MITIGACION_CAMPO;

export function fichaEop(f: { id: number; codigo: string; titulo: string; tipo: string; a1?: string | null; a2?: string | null; a3?: string | null; etiqueta?: string | null }): FichaEop {
  return { id: f.id, codigo: f.codigo, titulo: f.titulo, tipo: f.tipo, acciones: accionesDe(f.a1, f.a2, f.a3), etiquetaMitigacion: etiquetaDe(f.etiqueta) };
}

/** Las fichas de varios documentos en una consulta. Un documento sin ficha de EOP queda sin acciones. */
export async function fichasEop(db: Db, ids: number[]): Promise<Map<number, FichaEop>> {
  const unicos = [...new Set(ids)];
  if (!unicos.length) return new Map();
  const filas = await db
    .select({
      id: procedimientos.id, codigo: procedimientos.codigoCorto, titulo: procedimientos.titulo, tipo: procedimientos.tipo,
      a1: eopFicha.accion1, a2: eopFicha.accion2, a3: eopFicha.accion3, etiqueta: eopFicha.etiquetaHoraMitigacion,
    })
    .from(procedimientos)
    .leftJoin(eopFicha, eq(eopFicha.procedimientoId, procedimientos.id))
    .where(inArray(procedimientos.id, unicos));
  return new Map(filas.map((f) => [f.id, fichaEop(f)]));
}

const vista = (f: FichaEop): EopDeOrden => ({ codigo: f.codigo, titulo: f.titulo, etiquetaMitigacion: f.etiquetaMitigacion, acciones: f.acciones });

export interface OrdenParaEop {
  id: number;
  procedimientoId: number | null;
  activoId: number | null;
  sedeId: number | null;
}

/**
 * El EOP de cada emergencia: el vinculado a la orden; si no tiene, el que
 * resuelve queSigue para la falla de su equipo. `conocidas` son fichas ya
 * leídas (el paquete trae todas las vigentes). `maxResolver` pone tope a las
 * búsquedas por equipo: D1 corta a 50 consultas por solicitud, y la orden que
 * quede fuera se resuelve al abrirla.
 */
export async function eopsDeOrdenes(
  db: Db, lista: OrdenParaEop[],
  opciones: { conocidas?: Map<number, FichaEop>; maxResolver?: number; conEtiqueta?: boolean } = {},
): Promise<Map<number, EopDeOrden>> {
  const conocidas = new Map(opciones.conocidas ?? []);
  const vinculadas = lista.map((o) => o.procedimientoId).filter((id): id is number => id != null && !conocidas.has(id));
  for (const [id, f] of await fichasEop(db, vinculadas)) conocidas.set(id, f);

  const out = new Map<number, EopDeOrden>();
  // Por equipo y sede: dos emergencias del mismo equipo no buscan dos veces.
  const resueltas = new Map<string, { docId: number | null; eop: EopDeOrden }>();
  let buscadas = 0;
  const max = opciones.maxResolver ?? Infinity;
  for (const o of lista) {
    const vinculada = o.procedimientoId != null ? conocidas.get(o.procedimientoId) : undefined;
    if (vinculada?.tipo === "eop") { out.set(o.id, vista(vinculada)); continue; }
    if (!o.activoId) { out.set(o.id, SIN_EOP); continue; }
    const clave = `${o.activoId}:${o.sedeId ?? ""}`;
    let r = resueltas.get(clave);
    if (!r) {
      if (buscadas >= max) { out.set(o.id, SIN_EOP); continue; }
      buscadas++;
      const sigue = await queSigue(db, o.activoId, "falla", o.sedeId);
      const doc = sigue.documento?.tipo === "eop" ? sigue.documento : null;
      r = doc
        ? { docId: doc.id, eop: { codigo: doc.codigoCorto, titulo: doc.titulo, etiquetaMitigacion: conocidas.get(doc.id)?.etiquetaMitigacion ?? ETIQUETA_MITIGACION_CAMPO, acciones: accionesDe(...sigue.primerasAcciones) } }
        : { docId: null, eop: SIN_EOP };
      resueltas.set(clave, r);
    }
    out.set(o.id, r.eop);
  }
  // El rótulo del toque intermedio sale de la ficha: si el documento resuelto no estaba entre las conocidas, se lee.
  const sinRotulo = [...resueltas.values()].filter((r) => r.docId != null && !conocidas.has(r.docId));
  if (opciones.conEtiqueta !== false && sinRotulo.length) {
    const fichas = await fichasEop(db, sinRotulo.map((r) => r.docId as number));
    for (const r of sinRotulo) { const f = fichas.get(r.docId as number); if (f) r.eop.etiquetaMitigacion = f.etiquetaMitigacion; }
  }
  return out;
}

/** Un checklist vacío de verdad. Uno ilegible no cuenta como vacío: no se pisa. */
export const checklistVacio = (raw: string | null | undefined) => raw == null || ["", "[]"].includes(raw.trim());

/** Las acciones del EOP como pasos normales de la orden. */
export const pasosDeAcciones = (acciones: string[]) => acciones.map((texto) => ({ texto, estado: "pendiente" as const }));

/** La sede de la orden como la ve el paquete: la de la ubicación de su equipo, la de su ubicación o la suya. */
async function sedeDeOrden(db: Db, o: Orden): Promise<number | null> {
  if (o.activoId) {
    const [a] = await db.select({ sede: ubicaciones.sucursalId }).from(activos).leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId)).where(eq(activos.id, o.activoId)).limit(1);
    if (a?.sede != null) return a.sede;
  }
  if (o.ubicacionId) {
    const [u] = await db.select({ sede: ubicaciones.sucursalId }).from(ubicaciones).where(eq(ubicaciones.id, o.ubicacionId)).limit(1);
    if (u?.sede != null) return u.sede;
  }
  return o.sucursalId ?? null;
}

const EN_CURSO = ["abierta", "en_proceso", "en_espera"] as const;

/**
 * Una emergencia con checklist vacío recibe, una sola vez, las acciones de su
 * EOP como pasos: los mismos textos que mandó el paquete. Es configuración de
 * la orden, como copiar la plantilla al crearla: no es ejecución. Enviada a
 * verificación ya no se toca.
 */
export async function sembrarAccionesEop(ctx: APIContext, db: Db, o: Orden): Promise<Orden> {
  if (o.tipo !== "emergencia" || !checklistVacio(o.checklistEjecucion) || !(EN_CURSO as readonly string[]).includes(o.estado)) return o;
  const conocidas = await fichasEop(db, o.procedimientoId ? [o.procedimientoId] : []);
  // La sede solo importa si hay que resolver el EOP por el equipo.
  const vinculada = o.procedimientoId ? conocidas.get(o.procedimientoId) : undefined;
  const sedeId = vinculada?.tipo !== "eop" && o.activoId ? await sedeDeOrden(db, o) : null;
  const eop = (await eopsDeOrdenes(db, [{ id: o.id, procedimientoId: o.procedimientoId ?? null, activoId: o.activoId ?? null, sedeId }], { conocidas, conEtiqueta: false })).get(o.id) ?? SIN_EOP;
  if (!eop.acciones.length) return o;
  const checklist = JSON.stringify(pasosDeAcciones(eop.acciones));
  const sembrada = await db
    .update(ordenes)
    .set({ checklistEjecucion: checklist })
    .where(and(
      eq(ordenes.id, o.id), inArray(ordenes.estado, [...EN_CURSO]),
      or(isNull(ordenes.checklistEjecucion), sql`trim(${ordenes.checklistEjecucion}) in ('', '[]')`),
    ))
    .returning({ id: ordenes.id });
  if (!sembrada.length) {
    // Otra operación la sembró primero o la orden ya salió de ejecución: se trabaja con lo que quedó guardado.
    const [actual] = await db.select().from(ordenes).where(eq(ordenes.id, o.id)).limit(1);
    return actual ?? o;
  }
  await logAudit(ctx, { entidad: "orden", entidadId: o.id, accion: "update", resumen: `Pasos de la emergencia tomados de ${eop.codigo ?? "su EOP"}: ${eop.acciones.length} acciones` });
  return { ...o, checklistEjecucion: checklist };
}
