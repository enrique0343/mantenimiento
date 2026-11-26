// ─── Espacios con la base: el espacio de un registro guardado ───────────────
//
// Complemento de src/lib/espacio.ts (que es puro) para las API que reciben un id
// que no pasa por registroDeRuta en el middleware (adjuntos, documentos, /campo,
// proyectos) y para las validaciones de lotes y asignaciones.
//
// - espacioDeActivoId / espacioDeOrdenId / espacioDeTicketId / espacioDeProyectoId: el espacio del
//   registro (null si no existe), con las mismas reglas que espacioDeActivo y
//   espacioDeTrabajo.
// - bloqueoEspacio(user, e): el 403 JSON { error } si el usuario no entra a e.
// - espacioAjenoDeActivos(db, user, ids): el primer espacio de esos equipos al que
//   el usuario no entra (todo o nada). Un solo parámetro JSON: D1 corta a 100.
// - asignadoFueraDeEspacio(db, usuarioId, espacios): la persona que se quiere
//   asignar y el espacio que no ve (su especialidad), para no dejar trabajo que
//   en /campo no puede abrir.
import { eq, sql } from "drizzle-orm";
import type { getDb } from "./db";
import { activoAreaExpression } from "./areas";
import { activos, ordenes, proyectos, tickets, usuarios } from "./schema";
import {
  ESPACIO_KEYS, espacioDeArea, espacioDeActivo, espacioDeTrabajo, espaciosPermitidos, puedeEntrar, respuestaOtroEspacio,
  type Espacio, type UsuarioEspacio,
} from "./espacio";

type Db = ReturnType<typeof getDb>;

export async function espacioDeActivoId(db: Db, id: number | null | undefined): Promise<Espacio | null> {
  if (!id) return null;
  const [a] = await db.select({ rubro: activos.rubro, tipo: activos.tipo }).from(activos).where(eq(activos.id, id)).limit(1);
  return a ? espacioDeActivo(a) : null;
}

/** Orden o solicitud: su rubro; sin rubro, el de su equipo; sin ninguno, General. */
export async function espacioDeTrabajoGuardado(db: Db, rubro: string | null, activoId: number | null): Promise<Espacio> {
  if (rubro || !activoId) return espacioDeTrabajo(rubro, null);
  return (await espacioDeActivoId(db, activoId)) ?? "general";
}

export async function espacioDeOrdenId(db: Db, id: number | null | undefined): Promise<Espacio | null> {
  if (!id) return null;
  const [o] = await db.select({ rubro: ordenes.rubro, activoId: ordenes.activoId }).from(ordenes).where(eq(ordenes.id, id)).limit(1);
  return o ? espacioDeTrabajoGuardado(db, o.rubro, o.activoId) : null;
}

export async function espacioDeTicketId(db: Db, id: number | null | undefined): Promise<Espacio | null> {
  if (!id) return null;
  const [t] = await db.select({ rubro: tickets.rubro, activoId: tickets.activoId }).from(tickets).where(eq(tickets.id, id)).limit(1);
  return t ? espacioDeTrabajoGuardado(db, t.rubro, t.activoId) : null;
}

/** Proyecto: el espacio de su equipo; sin equipo, el de su solicitud; sin ninguno, General. */
export async function espacioDeProyectoId(db: Db, id: number | null | undefined): Promise<Espacio | null> {
  if (!id) return null;
  const [p] = await db.select({ activoId: proyectos.activoId, ticketId: proyectos.ticketId }).from(proyectos).where(eq(proyectos.id, id)).limit(1);
  if (!p) return null;
  if (p.activoId) return (await espacioDeActivoId(db, p.activoId)) ?? "general";
  return (await espacioDeTicketId(db, p.ticketId)) ?? "general";
}

/** El 403 JSON del otro espacio, o null si el usuario entra (o no hay espacio). */
export function bloqueoEspacio(user: UsuarioEspacio, e: Espacio | null | undefined): Response | null {
  return e && !puedeEntrar(user, e) ? respuestaOtroEspacio(e) : null;
}

/** El primer espacio de esos equipos al que el usuario no entra, o null si entra a todos. */
export async function espacioAjenoDeActivos(db: Db, user: UsuarioEspacio, ids: number[]): Promise<Espacio | null> {
  const permitidos = espaciosPermitidos(user);
  if (permitidos.length === ESPACIO_KEYS.length || !ids.length) return permitidos.length ? null : "general";
  const filas = await db
    .select({ area: sql<string>`${activoAreaExpression}` })
    .from(activos)
    .where(sql`${activos.id} in (select value from json_each(${JSON.stringify(ids)}))`)
    .groupBy(sql`1`);
  for (const f of filas) {
    const e = espacioDeArea(f.area);
    if (!permitidos.includes(e)) return e;
  }
  return null;
}

export interface AsignadoFuera { nombre: string; espacio: Espacio }

/**
 * La persona que se quiere asignar no ve alguno de esos espacios (su especialidad):
 * devuelve su nombre y el espacio que no ve. null si los ve todos o no existe.
 */
export async function asignadoFueraDeEspacio(db: Db, usuarioId: number | null | undefined, espacios: Iterable<Espacio>): Promise<AsignadoFuera | null> {
  if (!usuarioId) return null;
  const [u] = await db.select({ nombre: usuarios.nombre, rol: usuarios.rol, especialidad: usuarios.especialidad }).from(usuarios).where(eq(usuarios.id, usuarioId)).limit(1);
  if (!u) return null;
  const suyos = espaciosPermitidos({ rol: u.rol, especialidad: u.especialidad });
  const fuera = [...espacios].find((e) => !suyos.includes(e));
  return fuera ? { nombre: u.nombre, espacio: fuera } : null;
}

/** «X es de mantenimiento general: no ve el trabajo biomédico. Elige a alguien de biomédico.» */
export function mensajeAsignadoFuera({ nombre, espacio }: AsignadoFuera, que: { biomedico: string; general: string; quien?: string } = { biomedico: "el trabajo biomédico", general: "el trabajo de mantenimiento general" }): string {
  const quien = que.quien ?? "a alguien";
  if (espacio === "tecnologia") return `${nombre} no tiene acceso al trabajo de tecnología. Elige ${quien} de tecnología.`;
  return espacio === "biomedico"
    ? `${nombre} no tiene acceso a biomédico: no ve ${que.biomedico}. Elige ${quien} de biomédico.`
    : `${nombre} no tiene acceso a general: no ve ${que.general}. Elige ${quien} de general.`;
}
