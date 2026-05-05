import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import {
  ordenes, adjuntos, planesMantenimiento, actividades,
  tickets, movimientosInventario, extintorEventos,
} from "@/lib/schema";
import { requireUser } from "@/lib/auth";

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

  const ots = await db.select().from(ordenes).where(inArray(ordenes.id, ids));
  if (!ots.length) return Response.json({ ok: true, borradas: 0 });

  // 1) Borrar adjuntos de R2 (las filas en DB se borran por cascade)
  const adjs = await db.select().from(adjuntos).where(inArray(adjuntos.ordenId, ids));
  if (adjs.length) {
    await Promise.allSettled(adjs.map((a) => env.R2.delete(a.r2Key)));
  }

  // 2) Limpiar FKs sin cascade — poner a NULL para preservar el historial en
  //    tickets/movimientos/eventos extintores
  try { await db.update(tickets).set({ otId: null }).where(inArray(tickets.otId, ids)); } catch (e) { console.error("clean tickets:", e); }
  try { await db.update(movimientosInventario).set({ ordenId: null }).where(inArray(movimientosInventario.ordenId, ids)); } catch (e) { console.error("clean movimientos:", e); }
  try { await db.update(extintorEventos).set({ otId: null }).where(inArray(extintorEventos.otId, ids)); } catch (e) { console.error("clean extintor eventos:", e); }

  // 3) Borrar las OTs (cascade limpia comentarios, adjuntos, repuestos, firmas, etc.)
  try {
    await db.delete(ordenes).where(inArray(ordenes.id, ids));
  } catch (e: any) {
    return Response.json({ error: `No se pudieron borrar las OTs: ${e?.message ?? e}` }, { status: 500 });
  }

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
