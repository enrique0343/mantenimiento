import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { ubicaciones } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  const [row] = await db.select().from(ubicaciones).where(eq(ubicaciones.id, id)).limit(1);
  if (!row) return Response.json({ error: "No encontrada" }, { status: 404 });
  return Response.json({ ubicacion: row });
};

const updateSchema = z.object({
  nombre: z.string().min(1).optional(),
  tipo: z.enum(["edificio", "piso", "area", "sala"]).optional(),
  padreId: z.number().int().nullable().optional(),
  activa: z.boolean().optional(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const [row] = await db.update(ubicaciones).set(parsed.data).where(eq(ubicaciones.id, id)).returning();
  if (!row) return Response.json({ error: "No encontrada" }, { status: 404 });
  return Response.json({ ubicacion: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  await db.delete(ubicaciones).where(eq(ubicaciones.id, id));
  return Response.json({ ok: true });
};
