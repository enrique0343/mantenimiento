import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { requireUserJson } from "@/lib/auth";
import { planesMantenimiento } from "@/lib/schema";
import { historialDePlanes, ROLES_TABLERO } from "@/lib/preventivos";

export const prerender = false;

// GET /api/preventivos/[id]/historial — quién cambió qué y cuándo en el preventivo.
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUserJson(ctx, [...ROLES_TABLERO]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Preventivo no válido." }, { status: 400 });
  const db = getDb(ctx);
  const [plan] = await db.select({ id: planesMantenimiento.id, titulo: planesMantenimiento.titulo }).from(planesMantenimiento).where(eq(planesMantenimiento.id, id)).limit(1);
  if (!plan) return Response.json({ error: "Ese preventivo ya no existe." }, { status: 404 });
  return Response.json({ plan, entradas: await historialDePlanes(db, { planId: id }) });
};
