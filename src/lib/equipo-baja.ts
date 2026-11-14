// Fase 59 · Requisito 13: a un equipo dado de baja no se le abren órdenes de trabajo.
// Una sola regla para lo que crea órdenes desde la oficina:
//  · a mano (Nueva orden, convertir una solicitud, generar desde un proyecto) → 409 con
//    MENSAJE_ORDEN_EQUIPO_BAJA, el mismo texto en todas;
//  · automático (medición fuera de rango, solicitud que se asigna) → la orden no se crea
//    y la operación principal sigue.
// El celular ya lo impedía (src/lib/campo.ts); el cron y los planes lo revisan aparte.
// Ojo: «baja» también es una prioridad («prioridad baja»); aquí solo cuenta activos.estado.
import { eq } from "drizzle-orm";
import type { getDb } from "./db";
import { activos } from "./schema";
import { rubroDeActivo, type RubroKey } from "./rubros";

type Db = ReturnType<typeof getDb>;

export const MENSAJE_ORDEN_EQUIPO_BAJA = "El equipo está dado de baja: no se le abren órdenes de trabajo.";

const idValido = (id: number | null | undefined): id is number => typeof id === "number" && Number.isInteger(id) && id > 0;

/**
 * El equipo, si existe y está dado de baja; null si sigue en servicio, si no existe o si
 * no hay equipo (eso lo valida quien llama).
 */
export async function equipoDadoDeBaja(
  db: Db,
  activoId: number | null | undefined,
): Promise<{ id: number; codigo: string; nombre: string; area: RubroKey } | null> {
  if (!idValido(activoId)) return null;
  const [a] = await db
    .select({ id: activos.id, codigo: activos.codigo, nombre: activos.nombre, estado: activos.estado, rubro: activos.rubro, tipo: activos.tipo })
    .from(activos).where(eq(activos.id, activoId)).limit(1);
  if (!a || a.estado !== "baja") return null;
  return { id: a.id, codigo: a.codigo, nombre: a.nombre, area: rubroDeActivo(a.rubro, a.tipo) };
}

/** true si el equipo existe y está dado de baja. */
export async function equipoDeBaja(db: Db, activoId: number | null | undefined): Promise<boolean> {
  return (await equipoDadoDeBaja(db, activoId)) !== null;
}

/** Para quien abre una orden a mano: 409 si el equipo está dado de baja; null si se puede. */
export async function rechazoOrdenEquipoBaja(db: Db, activoId: number | null | undefined): Promise<Response | null> {
  return (await equipoDeBaja(db, activoId))
    ? Response.json({ error: MENSAJE_ORDEN_EQUIPO_BAJA }, { status: 409 })
    : null;
}
