import type { APIRoute } from "astro";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { activos, tickets, ordenes, proyectos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit, calcularDiff } from "@/lib/audit";
import { rubroDeActivo } from "@/lib/rubros";
import { activoAreaCondition } from "@/lib/areas";
import { datosTecnicosSchema, datosTecnicosValidosParaArea, serializarDatosTecnicos, leerDatosTecnicos } from "@/lib/activo-area";

export const prerender = false;

const updateSchema = z.object({
  codigo: z.string().min(1).optional(),
  nombre: z.string().min(1).optional(),
  descripcion: z.string().nullable().optional(),
  ubicacion: z.string().nullable().optional(),
  estado: z.enum(["operativo", "averiado", "mantenimiento", "baja"]).optional(),
  tipo: z.enum(["general", "biomedico"]).optional(),
  categoria: z.string().nullable().optional(),
  numeroActivo: z.string().nullable().optional(),
  marca: z.string().nullable().optional(),
  modelo: z.string().nullable().optional(),
  serial: z.string().nullable().optional(),
  anio: z.number().int().nullable().optional(),
  registroSanitario: z.string().nullable().optional(),
  claseRiesgo: z.enum(["I", "IIa", "IIb", "III"]).nullable().optional(),
  ultimaCalibracion: z.string().nullable().optional(),
  proximaCalibracion: z.string().nullable().optional(),
  fechaAdquisicion: z.string().nullable().optional(),
  vidaUtilAnios: z.number().int().nonnegative().nullable().optional(),
  valorAdquisicion: z.number().nonnegative().nullable().optional(),
  responsableId: z.number().int().nullable().optional(),
  criticidadOperacional: z.enum(["alta", "media", "baja"]).optional(),
  rubro: z.enum(["infraestructura", "aires", "equipo_general", "biomedico"]).nullable().optional(),
  datosTecnicos: datosTecnicosSchema,
  subcategoria: z.enum(["soporte_vida", "diagnostico", "tratamiento", "esterilizacion", "cadena_frio", "imagenologia", "apoyo"]).nullable().optional(),
  aceptacionFecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  aceptacionResultado: z.enum(["aprobado", "condicionado", "rechazado"]).nullable().optional(),
  aceptacionNotas: z.string().nullable().optional(),
  requiereCalibracion: z.boolean().optional(),
  ubicacionId: z.number().int().nullable().optional(),
  proveedorId: z.number().int().nullable().optional(),
  slaUrgenteHoras: z.number().int().nonnegative().optional(),
  slaAltaHoras: z.number().int().nonnegative().optional(),
  slaMediaHoras: z.number().int().nonnegative().optional(),
  slaBajaHoras: z.number().int().nonnegative().optional(),
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
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);

  // Estado anterior para diff
  const [actual] = await db.select().from(activos).where(eq(activos.id, id)).limit(1);
  if (!actual) return Response.json({ error: "No encontrado" }, { status: 404 });

  // Al registrar la inspección de aceptación, se firma con el usuario actual
  const data: Record<string, unknown> = { ...parsed.data };
  const areaActual = rubroDeActivo(actual.rubro, actual.tipo);
  const rubro = rubroDeActivo(parsed.data.rubro === undefined ? actual.rubro : parsed.data.rubro, parsed.data.tipo ?? actual.tipo);
  const cambiaArea = rubro !== areaActual;
  const tipo = rubro === "biomedico" ? "biomedico" : "general";
  if (parsed.data.tipo && parsed.data.tipo !== tipo) return Response.json({ error: "El tipo de equipo no corresponde al área seleccionada" }, { status: 400 });
  if (!datosTecnicosValidosParaArea(rubro, parsed.data.datosTecnicos)) return Response.json({ error: "Los datos técnicos no corresponden al área seleccionada" }, { status: 400 });
  data.rubro = rubro;
  data.tipo = tipo;
  if (parsed.data.datosTecnicos !== undefined || cambiaArea) {
    data.datosTecnicos = serializarDatosTecnicos(rubro, parsed.data.datosTecnicos === undefined ? leerDatosTecnicos(actual.datosTecnicos) : parsed.data.datosTecnicos);
  }
  if (parsed.data.aceptacionFecha) data.aceptacionPor = user.id;

  // Los trabajos conservan su área, incluso al cerrarse. La comprobación forma
  // parte de la escritura para no separar el control de vínculos del cambio.
  const [row] = await db.update(activos).set(data).where(and(
    eq(activos.id, id),
    activoAreaCondition(areaActual),
    cambiaArea ? sql`NOT EXISTS (SELECT 1 FROM ${tickets} WHERE ${tickets.activoId} = ${id})` : undefined,
    cambiaArea ? sql`NOT EXISTS (SELECT 1 FROM ${ordenes} WHERE ${ordenes.activoId} = ${id})` : undefined,
    cambiaArea ? sql`NOT EXISTS (SELECT 1 FROM ${proyectos} WHERE ${proyectos.activoId} = ${id})` : undefined,
  )).returning();
  if (!row) return Response.json({ error: cambiaArea
    ? "No se puede cambiar el área porque este activo tiene solicitudes, órdenes o proyectos vinculados, o su área fue modificada por otra persona. Actualiza la página; puedes editar sus demás datos conservando el área."
    : "El área del activo cambió mientras editabas. Actualiza la página antes de guardar.",
  }, { status: 409 });

  // Audit
  const diff = calcularDiff(actual as any, data as any);
  if (Object.keys(diff).length > 0) {
    await logAudit(ctx, { entidad: "activo", entidadId: id, accion: "update", cambios: diff });
  }

  return Response.json({ activo: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  await db.delete(activos).where(eq(activos.id, id));
  await logAudit(ctx, { entidad: "activo", entidadId: id, accion: "delete", resumen: "Equipo eliminado" });
  return Response.json({ ok: true });
};
