import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { empresa } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const db = getDb(ctx);
  const rows = await db.select().from(empresa).limit(1);
  return Response.json({ empresa: rows[0] ?? null });
};

const updateSchema = z.object({
  nombre: z.string().min(1).optional(),
  nit: z.string().nullable().optional(),
  pais: z.string().nullable().optional(),
  moneda: z.string().nullable().optional(),
  telefono: z.string().nullable().optional(),
  direccion: z.string().nullable().optional(),
});

export const PUT: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const [row] = await db
    .update(empresa)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(eq(empresa.id, 1))
    .returning();
  return Response.json({ empresa: row });
};
