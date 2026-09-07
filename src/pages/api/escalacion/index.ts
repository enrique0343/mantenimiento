import type { APIRoute } from "astro";
import { z } from "zod";
import { asc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { escalacionNiveles } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const db = getDb(ctx);
  const rows = await db.select().from(escalacionNiveles).orderBy(asc(escalacionNiveles.criticidad), asc(escalacionNiveles.nivel));
  return Response.json({ niveles: rows });
};

const createSchema = z.object({
  criticidad: z.enum(["alta", "media", "baja", "todas"]).default("alta"),
  nivel: z.number().int().min(1).max(10).default(1),
  minutosParaEscalar: z.number().int().min(0).nullable().optional(),
  contactoNombre: z.string().nullable().optional(),
  contactoCargo: z.string().nullable().optional(),
  contactoTelefono: z.string().nullable().optional(),
  contactoEmail: z.string().nullable().optional(),
  accion: z.string().nullable().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const [row] = await db.insert(escalacionNiveles).values(parsed.data).returning();
  return Response.json({ nivel: row }, { status: 201 });
};
