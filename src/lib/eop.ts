// ─── EOP · la emergencia en el celular ──────────────────────────────────────
//
// El técnico trabaja la emergencia con lo que se sabe de memoria: las tres
// primeras acciones de su EOP, como pasos, y tres toques que fijan las horas
// (llegué, situación controlada, servicio restablecido). Las horas se
// registran, pero el celular no las muestra: los indicadores 5 y 7 los lee la
// jefatura en la ficha.
import type { APIContext } from "astro";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { activos, eopFicha, ordenes, procedimientos, ubicaciones } from "@/lib/schema";
import { inferirSistema, type Sistema } from "@/lib/resolver";
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

/** Las acciones que mostró el celular, como llegan en orden.iniciar y orden.paso. */
export const MAX_ACCIONES_CELULAR = 10;
export const MAX_TEXTO_ACCION = 300;

// Con el tope que acepta orden.iniciar: el celular devuelve tal cual lo que mostró.
const accionesDe = (...xs: Array<string | null | undefined>) => xs.map((x) => (x ?? "").trim().slice(0, MAX_TEXTO_ACCION).trim()).filter(Boolean);
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
 * El EOP de cada emergencia: el vinculado a la orden; si no tiene, el que rige
 * la falla de su equipo. `conocidas` son fichas ya leídas (el paquete trae
 * todas las vigentes). Todas las órdenes se resuelven juntas, en unas pocas
 * consultas: D1 corta a 50 por solicitud y ninguna emergencia se queda sin
 * sus acciones por ser la tercera o la décima.
 */
export async function eopsDeOrdenes(
  db: Db, lista: OrdenParaEop[],
  opciones: { conocidas?: Map<number, FichaEop> } = {},
): Promise<Map<number, EopDeOrden>> {
  const conocidas = new Map(opciones.conocidas ?? []);
  const vinculadas = lista.map((o) => o.procedimientoId).filter((id): id is number => id != null && !conocidas.has(id));
  for (const [id, f] of await fichasEop(db, vinculadas)) conocidas.set(id, f);

  const out = new Map<number, EopDeOrden>();
  const porEquipo: Array<OrdenParaEop & { activoId: number }> = [];
  for (const o of lista) {
    const vinculada = o.procedimientoId != null ? conocidas.get(o.procedimientoId) : undefined;
    if (vinculada?.tipo === "eop") out.set(o.id, vista(vinculada));
    else if (o.activoId) porEquipo.push({ ...o, activoId: o.activoId });
    else out.set(o.id, SIN_EOP);
  }
  const deFalla = await eopsDeFalla(db, porEquipo, conocidas);
  for (const o of porEquipo) out.set(o.id, deFalla.get(claveEquipo(o.activoId, o.sedeId)) ?? SIN_EOP);
  return out;
}

const claveEquipo = (activoId: number, sedeId: number | null) => `${activoId}:${sedeId ?? ""}`;

// D1 acepta hasta 100 parámetros por consulta: las listas largas van en tandas, en un solo batch.
const TANDA = 90;
async function enTandas<T>(db: Db, ids: number[], consulta: (parte: number[]) => any): Promise<T[]> {
  if (ids.length <= TANDA) return (await consulta(ids)) as T[];
  const partes: any[] = [];
  for (let i = 0; i < ids.length; i += TANDA) partes.push(consulta(ids.slice(i, i + TANDA)));
  return ((await db.batch(partes as [any, ...any[]])) as T[][]).flat();
}

/**
 * El EOP de la falla de varios equipos a la vez, con las reglas de
 * queSigue(…, "falla"): el sistema que declara el equipo, el de su ancestro
 * más cercano que lo declare (hasta tres niveles) o el que se infiere de su
 * nombre y, si es un minisplit, de su sala; luego el EOP de ese sistema, de
 * su sede o modelo, el vigente antes que el que está en validación. Unas
 * pocas consultas para todos, no varias por equipo.
 */
async function eopsDeFalla(db: Db, pares: Array<{ activoId: number; sedeId: number | null }>, conocidas: Map<number, FichaEop>): Promise<Map<string, EopDeOrden>> {
  const out = new Map<string, EopDeOrden>();
  const ids = [...new Set(pares.map((p) => p.activoId))];
  if (!ids.length) return out;
  // La sala con su propio nombre de columna: en un batch, D1 devuelve objetos y dos «nombre» se pisan.
  const equipos = await enTandas<{ id: number; nombre: string; categoria: string | null; rubro: string | null; sistema: string | null; padreId: number | null; sala: string | null }>(db, ids, (parte) =>
    db.select({ id: activos.id, nombre: activos.nombre, categoria: activos.categoria, rubro: activos.rubro, sistema: activos.sistema, padreId: activos.padreId, sala: sql<string | null>`${ubicaciones.nombre}`.as("sala") })
      .from(activos).leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId)).where(inArray(activos.id, parte)));

  // El sistema: el declarado; si no, el del ancestro más cercano que lo declare, hasta tres niveles.
  const sistemaDe = new Map<number, Sistema>();
  let subir = new Map<number, number>();
  for (const e of equipos) {
    if (e.sistema) sistemaDe.set(e.id, e.sistema as Sistema);
    else if (e.padreId) subir.set(e.id, e.padreId);
  }
  for (let nivel = 0; nivel < 3 && subir.size; nivel++) {
    const padres = await enTandas<{ id: number; sistema: string | null; padreId: number | null }>(db, [...new Set(subir.values())], (parte) =>
      db.select({ id: activos.id, sistema: activos.sistema, padreId: activos.padreId }).from(activos).where(inArray(activos.id, parte)));
    const padre = new Map(padres.map((p) => [p.id, p]));
    const siguiente = new Map<number, number>();
    for (const [equipo, padreId] of subir) {
      const p = padre.get(padreId);
      if (!p) continue;
      if (p.sistema) sistemaDe.set(equipo, p.sistema as Sistema);
      else if (p.padreId) siguiente.set(equipo, p.padreId);
    }
    subir = siguiente;
  }
  // Si nadie lo declara, se infiere del nombre; un minisplit en un área crítica es climatización crítica.
  for (const e of equipos) {
    if (sistemaDe.has(e.id)) continue;
    const sugerido = inferirSistema(e.nombre, e.categoria, e.rubro);
    sistemaDe.set(e.id, sugerido === "minisplit" ? inferirSistema(e.nombre, e.categoria, e.rubro, e.sala) : sugerido);
  }

  const sistemas = [...new Set(sistemaDe.values())];
  const sedes = [...new Set(pares.map((p) => p.sedeId).filter((x): x is number => !!x))];
  const docs = sistemas.length
    ? await db
        .select({ id: procedimientos.id, codigo: procedimientos.codigoCorto, titulo: procedimientos.titulo, sistema: procedimientos.sistema, estado: procedimientos.estado, sucursalId: procedimientos.sucursalId })
        .from(procedimientos)
        .where(and(
          eq(procedimientos.activo, true), eq(procedimientos.tipo, "eop"), inArray(procedimientos.sistema, sistemas as any),
          sedes.length ? or(isNull(procedimientos.sucursalId), inArray(procedimientos.sucursalId, sedes)) : isNull(procedimientos.sucursalId),
        ))
        .orderBy(asc(procedimientos.id))
    : [];
  const elegido = new Map<string, (typeof docs)[number]>();
  for (const p of pares) {
    const clave = claveEquipo(p.activoId, p.sedeId);
    const sistema = sistemaDe.get(p.activoId);
    if (elegido.has(clave) || !sistema) continue;
    // Los de su sede y los modelo; se opera con lo aprobado.
    const candidatos = docs.filter((d) => d.sistema === sistema && (d.sucursalId == null || (!!p.sedeId && d.sucursalId === p.sedeId)));
    const doc = candidatos.find((d) => d.estado === "vigente") ?? candidatos.find((d) => d.estado === "en_validacion") ?? candidatos[0];
    if (doc) elegido.set(clave, doc);
  }
  // Las acciones y el rótulo del toque intermedio salen de la ficha del EOP.
  const faltan = [...new Set([...elegido.values()].map((d) => d.id).filter((id) => !conocidas.has(id)))];
  const fichas = new Map(conocidas);
  for (const [id, f] of await fichasEop(db, faltan)) fichas.set(id, f);
  for (const [clave, doc] of elegido) {
    const f = fichas.get(doc.id);
    out.set(clave, { codigo: doc.codigo, titulo: doc.titulo, etiquetaMitigacion: f?.etiquetaMitigacion ?? ETIQUETA_MITIGACION_CAMPO, acciones: f?.acciones ?? [] });
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
 * Lee «acciones» de una operación del celular: undefined si no vino (celular
 * viejo); si vino, la lista recortada, o un error que se puede mostrar tal cual.
 */
export function accionesDelCelular(raw: unknown): { acciones?: string[]; error?: string } {
  if (raw === undefined || raw === null) return {};
  const mal = { error: `Las acciones de la emergencia no se entendieron: tienen que ser hasta ${MAX_ACCIONES_CELULAR} textos de 1 a ${MAX_TEXTO_ACCION} letras.` };
  if (!Array.isArray(raw) || raw.length > MAX_ACCIONES_CELULAR) return mal;
  const acciones = raw.map((x) => (typeof x === "string" ? x.trim() : ""));
  if (acciones.some((x) => x.length < 1 || x.length > MAX_TEXTO_ACCION)) return mal;
  return { acciones };
}

/**
 * Una emergencia con checklist vacío recibe, una sola vez, las acciones de su
 * EOP como pasos. Si el celular dice cuáles mostró (`acciones`), se guardan
 * exactamente esas, aunque sea ninguna; si no lo dice (celular viejo), las
 * que resuelve el servidor, que son las que mandó el paquete. Es
 * configuración de la orden, como copiar la plantilla al crearla: no es
 * ejecución. Una orden con pasos o ya enviada a verificación no se toca.
 */
export async function sembrarAccionesEop(ctx: APIContext, db: Db, o: Orden, delCelular?: string[]): Promise<Orden> {
  if (o.tipo !== "emergencia" || !checklistVacio(o.checklistEjecucion) || !(EN_CURSO as readonly string[]).includes(o.estado)) return o;
  let eop: EopDeOrden;
  if (delCelular) {
    eop = { ...SIN_EOP, acciones: delCelular };
  } else {
    const conocidas = await fichasEop(db, o.procedimientoId ? [o.procedimientoId] : []);
    // La sede solo importa si hay que resolver el EOP por el equipo.
    const vinculada = o.procedimientoId ? conocidas.get(o.procedimientoId) : undefined;
    const sedeId = vinculada?.tipo !== "eop" && o.activoId ? await sedeDeOrden(db, o) : null;
    eop = (await eopsDeOrdenes(db, [{ id: o.id, procedimientoId: o.procedimientoId ?? null, activoId: o.activoId ?? null, sedeId }], { conocidas })).get(o.id) ?? SIN_EOP;
  }
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
  await logAudit(ctx, { entidad: "orden", entidadId: o.id, accion: "update", resumen: delCelular
    ? `Pasos de la emergencia: las ${eop.acciones.length} acciones que mostró el celular`
    : `Pasos de la emergencia tomados de ${eop.codigo ?? "su EOP"}: ${eop.acciones.length} acciones` });
  return { ...o, checklistEjecucion: checklist };
}
