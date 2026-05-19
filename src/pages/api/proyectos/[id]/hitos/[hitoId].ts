import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { proyectoHitos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

const schema = z.object({
  titulo: z.string().min(1).optional(),
  descripcion: z.string().nullable().optional(),
  fechaObjetivo: z.string().nullable().optional(),
  completado: z.boolean().optional(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const hitoId = Number(ctx.params.hitoId);
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.completado !== undefined) {
    data.fechaCompletado = parsed.data.completado ? new Date().toISOString() : null;
  }
  const [row] = await db.update(proyectoHitos).set(data).where(eq(proyectoHitos.id, hitoId)).returning();
  if (!row) return Response.json({ error: "No encontrado" }, { status: 404 });
  return Response.json({ hito: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const hitoId = Number(ctx.params.hitoId);
  const db = getDb(ctx);
  await db.delete(proyectoHitos).where(eq(proyectoHitos.id, hitoId));
  return Response.json({ ok: true });
};
