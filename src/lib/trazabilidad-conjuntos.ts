import type { APIContext } from "astro";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { conjuntoComponentes, ordenConjuntos } from "./schema";

type Contexto = APIContext | { locals: App.Locals };

export async function activoTieneHistorialConjunto(ctx: Contexto, activoId: number): Promise<boolean> {
  const rows = await getDb(ctx).select({ id: conjuntoComponentes.id }).from(conjuntoComponentes)
    .where(eq(conjuntoComponentes.activoId, activoId)).limit(1);
  return rows.length > 0;
}

export async function ordenesTienenConjunto(ctx: Contexto, ids: number[]): Promise<boolean> {
  if (!ids.length) return false;
  const rows = await getDb(ctx).select({ id: ordenConjuntos.ordenId }).from(ordenConjuntos)
    .where(inArray(ordenConjuntos.ordenId, ids)).limit(1);
  return rows.length > 0;
}

export const MENSAJE_ACTIVO_TRAZADO = "Este equipo tiene historial en un conjunto y debe conservarse. Puedes retirarlo del conjunto o darlo de baja desde su ficha.";
export const MENSAJE_ORDEN_TRAZADA = "Esta orden forma parte del historial de un conjunto y debe conservarse. Puedes cancelarla si ya no corresponde realizarla.";
