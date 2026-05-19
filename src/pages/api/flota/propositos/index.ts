import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { viajePropositos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeVerFlota } from "@/lib/flota";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerFlota(user.rol)) return new Response("Sin permisos", { status: 403 });
  const db = getDb(ctx);
  const rows = await db.select().from(viajePropositos).orderBy(viajePropositos.orden);
  return Response.json({ propositos: rows });
};

const schema = z.object({
  nombre: z.string().min(1),
  orden: z.number().int().default(0),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const [row] = await db.insert(viajePropositos).values(parsed.data).returning();
  return Response.json({ proposito: row }, { status: 201 });
};
