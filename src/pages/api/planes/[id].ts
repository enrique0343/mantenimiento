import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { planesMantenimiento, activos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit, calcularDiff } from "@/lib/audit";

import { parseArea } from "@/lib/areas";
import { rubroDeActivo } from "@/lib/rubros";
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
  checklist: z.array(z.object({
    texto: z.string(),
    criterio: z.string().nullable().optional(),
    bloqueante: z.boolean().optional(),
    minutos: z.number().nullable().optional(),
    materiales: z.string().nullable().optional(),
  })).optional(),
  asignadoA: z.number().int().positive().nullable().optional(),
  activo: z.boolean().optional(),
  modalidad: z.enum(["interno", "contratado", "mixto"]).optional(),
  contratoId: z.number().int().positive().nullable().optional(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.checklist) data.checklist = JSON.stringify(parsed.data.checklist);
  const areaParam = ctx.url.searchParams.get("area");
  const area = parseArea(areaParam);
  if (areaParam && !area) return Response.json({ error: "Área no válida" }, { status: 400 });
  const db = getDb(ctx);

  const [actual] = await db.select().from(planesMantenimiento).where(eq(planesMantenimiento.id, id)).limit(1);
  if (!actual) return Response.json({ error: "No encontrado" }, { status: 404 });
  const [activo] = await db.select().from(activos).where(eq(activos.id, actual.activoId)).limit(1);
  if (area && (!activo || rubroDeActivo(activo.rubro, activo.tipo) !== area)) return Response.json({ error: "Plan no encontrado en esta área" }, { status: 404 });

  const [row] = await db.update(planesMantenimiento).set(data).where(eq(planesMantenimiento.id, id)).returning();

  // Audit + log para activo asociado (asi aparece en el historial del equipo)
  const diff = calcularDiff(actual as any, data as any);
  if (Object.keys(diff).length > 0) {
    await logAudit(ctx, { entidad: "plan", entidadId: id, accion: "update", cambios: diff });
    if (actual.activoId) {
      await logAudit(ctx, {
        entidad: "activo", entidadId: actual.activoId, accion: "update",
        cambios: diff, resumen: `Plan "${actual.titulo}" — cambios`,
      });
    }
  }

  return Response.json({ plan: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const areaParam = ctx.url.searchParams.get("area");
  const area = parseArea(areaParam);
  if (areaParam && !area) return Response.json({ error: "Área no válida" }, { status: 400 });
  const db = getDb(ctx);
  const [actual] = await db.select().from(planesMantenimiento).where(eq(planesMantenimiento.id, id)).limit(1);
  if (!actual) return Response.json({ error: "No encontrado" }, { status: 404 });
  const [activo] = await db.select().from(activos).where(eq(activos.id, actual.activoId)).limit(1);
  if (area && (!activo || rubroDeActivo(activo.rubro, activo.tipo) !== area)) return Response.json({ error: "Plan no encontrado en esta área" }, { status: 404 });
  await db.delete(planesMantenimiento).where(eq(planesMantenimiento.id, id));
  if (actual) {
    await logAudit(ctx, { entidad: "plan", entidadId: id, accion: "delete", resumen: `Plan "${actual.titulo}" eliminado` });
    if (actual.activoId) {
      await logAudit(ctx, { entidad: "activo", entidadId: actual.activoId, accion: "delete", resumen: `Plan "${actual.titulo}" eliminado del cronograma` });
    }
  }
  return Response.json({ ok: true });
};
