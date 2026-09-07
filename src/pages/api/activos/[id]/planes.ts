import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, asc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { planesMantenimiento, usuarios, activos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

import { parseArea } from "@/lib/areas";
import { rubroDeActivo } from "@/lib/rubros";
export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const activoId = Number(ctx.params.id);
  const areaParam = ctx.url.searchParams.get("area");
  const area = parseArea(areaParam);
  if (areaParam && !area) return Response.json({ error: "Área no válida" }, { status: 400 });
  const db = getDb(ctx);
  const [activo] = await db.select().from(activos).where(eq(activos.id, activoId)).limit(1);
  if (!activo || (area && rubroDeActivo(activo.rubro, activo.tipo) !== area)) return Response.json({ error: "Activo no encontrado en esta área" }, { status: 404 });
  const rows = await db
    .select({ p: planesMantenimiento, u: usuarios })
    .from(planesMantenimiento)
    .leftJoin(usuarios, eq(usuarios.id, planesMantenimiento.asignadoA))
    .where(eq(planesMantenimiento.activoId, activoId))
    .orderBy(asc(planesMantenimiento.proximaFecha));
  return Response.json({
    planes: rows.map((r) => ({
      ...r.p,
      asignado: r.u ? { id: r.u.id, nombre: r.u.nombre } : null,
    })),
  });
};

const createSchema = z.object({
  titulo: z.string().min(1),
  descripcion: z.string().nullable().optional(),
  frecuencia: z.enum([
    "diaria",
    "semanal",
    "quincenal",
    "mensual",
    "bimestral",
    "trimestral",
    "semestral",
    "anual",
  ]),
  proximaFecha: z.string().min(8),
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
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const activoId = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const areaParam = ctx.url.searchParams.get("area");
  const area = parseArea(areaParam);
  if (areaParam && !area) return Response.json({ error: "Área no válida" }, { status: 400 });
  const db = getDb(ctx);
  const [activo] = await db.select().from(activos).where(eq(activos.id, activoId)).limit(1);
  if (!activo || (area && rubroDeActivo(activo.rubro, activo.tipo) !== area)) return Response.json({ error: "Activo no encontrado en esta área" }, { status: 404 });
  const [row] = await db
    .insert(planesMantenimiento)
    .values({
      activoId,
      titulo: parsed.data.titulo,
      descripcion: parsed.data.descripcion ?? null,
      frecuencia: parsed.data.frecuencia,
      proximaFecha: parsed.data.proximaFecha,
      alertaDiasAntes: parsed.data.alertaDiasAntes ?? 7,
      prioridad: parsed.data.prioridad ?? "media",
      horasEstimadas: parsed.data.horasEstimadas ?? null,
      checklist: parsed.data.checklist ? JSON.stringify(parsed.data.checklist) : null,
      asignadoA: parsed.data.asignadoA ?? null,
    })
    .returning();

  await logAudit(ctx, {
    entidad: "plan", entidadId: row.id, accion: "create",
    resumen: `Plan "${row.titulo}" creado (${row.frecuencia}, próx: ${row.proximaFecha})`,
  });
  await logAudit(ctx, {
    entidad: "activo", entidadId: activoId, accion: "create",
    resumen: `Plan "${row.titulo}" agregado al cronograma (${row.frecuencia})`,
  });

  return Response.json({ plan: row }, { status: 201 });
};
