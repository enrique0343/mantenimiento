import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { variablesPredictivas } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const db = getDb(ctx);
  const url = new URL(ctx.request.url);
  const activoId = url.searchParams.get("activo_id");
  const rows = activoId
    ? await db.select().from(variablesPredictivas).where(eq(variablesPredictivas.activoId, Number(activoId))).orderBy(variablesPredictivas.nombre)
    : await db.select().from(variablesPredictivas).orderBy(desc(variablesPredictivas.id));
  return Response.json({ variables: rows });
};

const createSchema = z.object({
  activoId: z.number().int().positive(),
  nombre: z.string().min(1),
  unidad: z.string().nullable().optional(),
  minCritico: z.number().nullable().optional(),
  minWarning: z.number().nullable().optional(),
  maxWarning: z.number().nullable().optional(),
  maxCritico: z.number().nullable().optional(),
  notas: z.string().nullable().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const [row] = await db.insert(variablesPredictivas).values(parsed.data).returning();
  return Response.json({ variable: row }, { status: 201 });
};
