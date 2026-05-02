import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { planesMantenimiento } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

const updateSchema = z.object({
  titulo: z.string().min(1).optional(),
  descripcion: z.string().nullable().optional(),
  frecuencia: z
    .enum([
      "diaria",
      "semanal",
      "quincenal",
      "mensual",
      "bimestral",
      "trimestral",
      "semestral",
      "anual",
    ])
    .optional(),
  proximaFecha: z.string().min(8).optional(),
  alertaDiasAntes: z.number().int().min(0).max(90).optional(),
  prioridad: z.enum(["baja", "media", "alta", "urgente"]).optional(),
  horasEstimadas: z.number().positive().nullable().optional(),
  checklist: z.array(z.object({ texto: z.string() })).optional(),
  asignadoA: z.number().int().positive().nullable().optional(),
  activo: z.boolean().optional(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "tecnico"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.checklist) data.checklist = JSON.stringify(parsed.data.checklist);
  const db = getDb(ctx);
  const [row] = await db.update(planesMantenimiento).set(data).where(eq(planesMantenimiento.id, id)).returning();
  if (!row) return Response.json({ error: "No encontrado" }, { status: 404 });
  return Response.json({ plan: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  await db.delete(planesMantenimiento).where(eq(planesMantenimiento.id, id));
  return Response.json({ ok: true });
};
