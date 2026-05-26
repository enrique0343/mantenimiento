import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { activos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit, calcularDiff } from "@/lib/audit";

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
  criticidadOperacional: z.enum(["alta", "media", "baja"]).nullable().optional(),
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

  const [row] = await db.update(activos).set(parsed.data).where(eq(activos.id, id)).returning();

  // Audit
  const diff = calcularDiff(actual as any, parsed.data as any);
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
