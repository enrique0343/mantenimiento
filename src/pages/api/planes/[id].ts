import type { APIRoute } from "astro";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { planesMantenimiento, activos, proveedores } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit, calcularDiff } from "@/lib/audit";

import { parseArea } from "@/lib/areas";
import { rubroDeActivo } from "@/lib/rubros";
import { errorMapEs, fechaIsoSchema, frecuenciaRutinaSchema, respuestaZod } from "@/lib/validacion-api";
export const prerender = false;

// K-E1: las nueve frecuencias de biomedico.ts; «turno» con su propio mensaje.
const updateSchema = z.object({
  titulo: z.string().trim().min(1, "Escribe el nombre de la rutina.").optional(),
  descripcion: z.string().nullable().optional(),
  frecuencia: frecuenciaRutinaSchema.optional(),
  proximaFecha: fechaIsoSchema("Fecha no válida.").optional(),
  alertaDiasAntes: z.number().int().min(0).max(90).optional(),
  prioridad: z.enum(["baja", "media", "alta", "urgente"]).optional(),
  horasEstimadas: z.number().positive().nullable().optional(),
  checklist: z.array(z.object({
    texto: z.string(),
    criterio: z.string().nullable().optional(),
    bloqueante: z.boolean().optional(),
    minutos: z.number().nullable().optional(),
    materiales: z.string().nullable().optional(),
    requiereValor: z.boolean().optional(),
    unidad: z.string().nullable().optional(),
    esperadoMin: z.number().nullable().optional(),
    esperadoMax: z.number().nullable().optional(),
  })).optional(),
  asignadoA: z.number().int().positive().nullable().optional(),
  activo: z.boolean().optional(),
  modalidad: z.enum(["interno", "contratado", "mixto"]).optional(),
  contratoId: z.number().int().positive().nullable().optional(),
  // Fase 59: proveedor del servicio externo (plan anual), aunque no haya contrato.
  proveedorId: z.number({ errorMap: () => ({ message: "Proveedor no válido." }) }).int().positive().nullable().optional(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body, { errorMap: errorMapEs });
  if (!parsed.success) return respuestaZod(parsed.error);
  const esJefatura = user.rol === "admin" || user.rol === "jefe";
  if (!esJefatura && (parsed.data.modalidad !== undefined || parsed.data.contratoId !== undefined || parsed.data.proveedorId !== undefined)) {
    return Response.json({ error: "Solo la jefatura define modalidad, contrato y proveedor." }, { status: 403 });
  }
  const data: Record<string, unknown> = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
  if (parsed.data.checklist) data.checklist = JSON.stringify(parsed.data.checklist);
  const areaParam = ctx.url.searchParams.get("area");
  const area = parseArea(areaParam);
  if (areaParam && !area) return Response.json({ error: "Área no válida" }, { status: 400 });
  const db = getDb(ctx);

  const [actual] = await db.select().from(planesMantenimiento).where(eq(planesMantenimiento.id, id)).limit(1);
  if (!actual) return Response.json({ error: "No encontrado" }, { status: 404 });
  const [activo] = await db.select({ rubro: activos.rubro, tipo: activos.tipo, estado: activos.estado }).from(activos).where(eq(activos.id, actual.activoId)).limit(1);
  if (area && (!activo || rubroDeActivo(activo.rubro, activo.tipo) !== area)) return Response.json({ error: "Plan no encontrado en esta área" }, { status: 404 });

  // Equipo dado de baja: sus rutinas no se activan ni se cambian; solo se desactivan.
  if (activo?.estado === "baja") {
    if (parsed.data.activo === true) return Response.json({ error: "El equipo está dado de baja: la rutina no se puede activar." }, { status: 409 });
    if (Object.keys(data).some((k) => k !== "activo")) {
      return Response.json({ error: "El equipo está dado de baja: sus rutinas no se cambian, solo se desactivan." }, { status: 409 });
    }
  }
  if (parsed.data.proveedorId) {
    const [prov] = await db.select({ id: proveedores.id }).from(proveedores)
      .where(and(eq(proveedores.id, parsed.data.proveedorId), eq(proveedores.activo, true))).limit(1);
    if (!prov) return Response.json({ error: "Proveedor no válido." }, { status: 400 });
  }
  if (Object.keys(data).length === 0) return Response.json({ plan: actual });

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
  const [activo] = await db.select({ rubro: activos.rubro, tipo: activos.tipo }).from(activos).where(eq(activos.id, actual.activoId)).limit(1);
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
