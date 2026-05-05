import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { ordenes, adjuntos, planesMantenimiento, actividades } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

const schema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
});

// Borrado masivo: solo admin. Resetea planes/actividades vinculadas y borra
// adjuntos de R2 antes de eliminar las OTs.
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;

  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const env = getEnv(ctx);

  // Cargar OTs para saber cuáles tienen planId/actividadId
  const ots = await db.select().from(ordenes).where(inArray(ordenes.id, parsed.data.ids));
  if (!ots.length) return Response.json({ ok: true, borradas: 0 });

  // Borrar adjuntos de R2
  const adjs = await db.select().from(adjuntos).where(inArray(adjuntos.ordenId, parsed.data.ids));
  if (adjs.length) {
    await Promise.allSettled(adjs.map((a) => env.R2.delete(a.r2Key)));
  }

  // Borrar las OTs (cascade limpia comentarios, adjuntos, etc.)
  await db.delete(ordenes).where(inArray(ordenes.id, parsed.data.ids));

  // Resetear planes y actividades vinculadas para que el cron pueda
  // generar nuevas OTs en el próximo ciclo
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
