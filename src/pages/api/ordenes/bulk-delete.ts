import type { APIRoute } from "astro";
import { z } from "zod";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import {
  ordenes, adjuntos, planesMantenimiento, actividades,
  tickets, movimientosInventario, extintorEventos, ordenVerificacionEventos,
  ordenIncidentes,
} from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAuditLote } from "@/lib/audit";
import { etiquetaOT } from "@/lib/orden-codigo";
import { lineasBorradoLote, mensajeOrdenesMarcadas } from "@/lib/incidentes";
import { ordenesTienenConjunto, MENSAJE_ORDEN_TRAZADA } from "@/lib/trazabilidad-conjuntos";

export const prerender = false;

const schema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
});

// Órdenes de la selección marcadas como incidente (Fase 59). Los ids viajan en un
// solo parámetro JSON: D1 acepta hasta 100 parámetros por consulta.
const marcadasEn = (db: ReturnType<typeof getDb>, ids: number[]) => db
  .select({ id: ordenes.id, codigo: ordenes.codigo })
  .from(ordenIncidentes)
  .innerJoin(ordenes, eq(ordenes.id, ordenIncidentes.ordenId))
  .where(sql`${ordenIncidentes.ordenId} IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`)
  .orderBy(asc(ordenes.id));

// Borrado masivo: solo admin. Limpia FKs sin cascade, adjuntos R2, y resetea
// planes/actividades vinculadas antes de eliminar las OTs.
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;

  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const env = getEnv(ctx);
  const ids = parsed.data.ids;

  if (await ordenesTienenConjunto(ctx, ids)) {
    return Response.json({ error: "La selección contiene una orden que debe conservarse. " + MENSAJE_ORDEN_TRAZADA }, { status: 409 });
  }

  const historial = await db.select({ id: ordenVerificacionEventos.id }).from(ordenVerificacionEventos).where(inArray(ordenVerificacionEventos.ordenId, ids)).limit(1);
  if (historial.length) return Response.json({ error: "La selección contiene una orden con historial inmutable de ejecución o verificación." }, { status: 409 });

  // Una orden marcada como incidente es evidencia para Calidad: se quita la marca antes.
  const marcadas = await marcadasEn(db, ids);
  if (marcadas.length) return Response.json({ error: mensajeOrdenesMarcadas(marcadas.map(etiquetaOT)) }, { status: 409 });

  const ots = await db.select().from(ordenes).where(inArray(ordenes.id, ids));
  if (!ots.length) return Response.json({ ok: true, borradas: 0 });

  // Comprobar y borrar en una transacción antes de tocar los archivos R2.
  const adjs = await db.select().from(adjuntos).where(inArray(adjuntos.ordenId, ids));
  try {
    await db.batch([
      db.update(tickets).set({ otId: null }).where(inArray(tickets.otId, ids)),
      db.update(movimientosInventario).set({ ordenId: null }).where(inArray(movimientosInventario.ordenId, ids)),
      db.update(extintorEventos).set({ otId: null }).where(inArray(extintorEventos.otId, ids)),
      db.delete(ordenes).where(inArray(ordenes.id, ids)),
    ]);
  } catch (e: any) {
    if (await ordenesTienenConjunto(ctx, ids)) return Response.json({ error: MENSAJE_ORDEN_TRAZADA }, { status: 409 });
    const marcadasAhora = await marcadasEn(db, ids);
    if (marcadasAhora.length) return Response.json({ error: mensajeOrdenesMarcadas(marcadasAhora.map(etiquetaOT)) }, { status: 409 });
    return Response.json({ error: `No se pudieron borrar las OTs: ${e?.message ?? e}` }, { status: 500 });
  }

  if (adjs.length) await Promise.allSettled(adjs.map((a) => env.R2.delete(a.r2Key)));

  // Bitácora: una línea por orden borrada, en una sola ida a la base.
  await logAuditLote(ctx, lineasBorradoLote(ots));

  // 4) Resetear planes/actividades vinculadas para que el cron pueda regenerar
  const planIds = Array.from(new Set(ots.map((o) => o.planId).filter((x): x is number => !!x)));
  const actividadIds = Array.from(new Set(ots.map((o) => o.actividadId).filter((x): x is number => !!x)));

  if (planIds.length) {
    try { await db.update(planesMantenimiento).set({ ultimaGeneracion: null }).where(inArray(planesMantenimiento.id, planIds)); } catch {}
  }
  if (actividadIds.length) {
    try { await db.update(actividades).set({ ultimaGeneracion: null }).where(inArray(actividades.id, actividadIds)); } catch {}
  }

  return Response.json({ ok: true, borradas: ots.length });
};
