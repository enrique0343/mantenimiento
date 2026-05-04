import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, asc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { actividadCategorias } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const db = getDb(ctx);
  const rows = await db.select().from(actividadCategorias).where(eq(actividadCategorias.activo, true)).orderBy(asc(actividadCategorias.orden));
  return Response.json({ categorias: rows });
};

const schema = z.object({
  nombre: z.string().min(1),
  icono: z.string().nullable().optional(),
  orden: z.number().int().default(0),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const [row] = await db.insert(actividadCategorias).values(parsed.data).returning();
  return Response.json({ categoria: row }, { status: 201 });
};
