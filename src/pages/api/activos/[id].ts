import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { activos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

const updateSchema = z.object({
  codigo: z.string().min(1).optional(),
  nombre: z.string().min(1).optional(),
  descripcion: z.string().nullable().optional(),
  ubicacion: z.string().nullable().optional(),
  estado: z.enum(["operativo", "averiado", "mantenimiento", "baja"]).optional(),
});

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  const [row] = await db.select().from(activos).where(eq(activos.id, id)).limit(1);
  if (!row) return Response.json({ error: "No encontrado" }, { status: 404 });
  return Response.json({ activo: row });
};

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "tecnico"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const [row] = await db.update(activos).set(parsed.data).where(eq(activos.id, id)).returning();
  if (!row) return Response.json({ error: "No encontrado" }, { status: 404 });
  return Response.json({ activo: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  await db.delete(activos).where(eq(activos.id, id));
  return Response.json({ ok: true });
};
