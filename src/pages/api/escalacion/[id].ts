import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { escalacionNiveles } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

const patchSchema = z.object({
  criticidad: z.enum(["alta", "media", "baja", "todas"]).optional(),
  nivel: z.number().int().min(1).max(10).optional(),
  minutosParaEscalar: z.number().int().min(0).nullable().optional(),
  contactoNombre: z.string().nullable().optional(),
  contactoCargo: z.string().nullable().optional(),
  contactoTelefono: z.string().nullable().optional(),
  contactoEmail: z.string().nullable().optional(),
  accion: z.string().nullable().optional(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const [row] = await db.update(escalacionNiveles).set(parsed.data).where(eq(escalacionNiveles.id, id)).returning();
  if (!row) return Response.json({ error: "No encontrado" }, { status: 404 });
  return Response.json({ nivel: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  await db.delete(escalacionNiveles).where(eq(escalacionNiveles.id, id));
  return Response.json({ ok: true });
};
