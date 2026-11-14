import type { APIRoute } from "astro";
import { sql, and } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { ordenes, activos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { condicionActivoEspacio, espacioDelContexto, condicionOrdenEspacio } from "@/lib/espacio";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const db = getDb(ctx);
  // Las cifras del espacio de la sesión.
  const espacio = espacioDelContexto(ctx, user);
  const deOrdenes = condicionOrdenEspacio(espacio);

  const ordenesPorEstado = await db
    .select({ estado: ordenes.estado, n: sql<number>`count(*)` })
    .from(ordenes)
    .where(deOrdenes)
    .groupBy(ordenes.estado);

  const ordenesPorPrioridad = await db
    .select({ prioridad: ordenes.prioridad, n: sql<number>`count(*)` })
    .from(ordenes)
    .where(and(deOrdenes, sql`${ordenes.estado} != 'completada' AND ${ordenes.estado} != 'cancelada'`))
    .groupBy(ordenes.prioridad);

  const activosPorEstado = await db
    .select({ estado: activos.estado, n: sql<number>`count(*)` })
    .from(activos)
    .where(condicionActivoEspacio(espacio))
    .groupBy(activos.estado);

  const vencidas = await db
    .select({ n: sql<number>`count(*)` })
    .from(ordenes)
    .where(and(
      deOrdenes,
      sql`${ordenes.vencimiento} IS NOT NULL AND ${ordenes.vencimiento} < datetime('now') AND ${ordenes.estado} IN ('abierta','en_proceso')`,
    ));

  return Response.json({
    ordenesPorEstado,
    ordenesPorPrioridad,
    activosPorEstado,
    vencidas: vencidas[0]?.n ?? 0,
    espacio,
  });
};
