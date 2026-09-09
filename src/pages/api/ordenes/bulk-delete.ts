import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import {
  ordenes, adjuntos, planesMantenimiento, actividades,
  tickets, movimientosInventario, extintorEventos,
} from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { ordenesTienenConjunto, MENSAJE_ORDEN_TRAZADA } from "@/lib/trazabilidad-conjuntos";

export const prerender = false;

const schema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
});

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
    return Response.json({ error: `No se pudieron borrar las OTs: ${e?.message ?? e}` }, { status: 500 });
  }

  if (adjs.length) await Promise.allSettled(adjs.map((a) => env.R2.delete(a.r2Key)));

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
