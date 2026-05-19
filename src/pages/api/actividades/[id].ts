import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { actividades, actividadCategorias, sucursales, ubicaciones, usuarios, proveedores, ordenes } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeVerActividades, puedeAdministrarActividades } from "@/lib/actividades";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerActividades(user.rol)) return new Response("Sin permisos", { status: 403 });
  const id = Number(ctx.params.id);
  const db = getDb(ctx);

  const [r] = await db
    .select({ a: actividades, c: actividadCategorias, s: sucursales, u: ubicaciones, asignado: usuarios, prov: proveedores })
    .from(actividades)
    .leftJoin(actividadCategorias, eq(actividadCategorias.id, actividades.categoriaId))
    .leftJoin(sucursales, eq(sucursales.id, actividades.sucursalId))
    .leftJoin(ubicaciones, eq(ubicaciones.id, actividades.ubicacionId))
    .leftJoin(usuarios, eq(usuarios.id, actividades.asignadoA))
    .leftJoin(proveedores, eq(proveedores.id, actividades.proveedorExternoId))
    .where(eq(actividades.id, id))
    .limit(1);
  if (!r) return Response.json({ error: "No encontrado" }, { status: 404 });

  const ots = await db
    .select()
    .from(ordenes)
    .where(eq(ordenes.actividadId, id))
    .orderBy(desc(ordenes.id))
    .limit(20);

  return Response.json({
    actividad: {
      ...r.a,
      categoria: r.c ? { id: r.c.id, nombre: r.c.nombre, icono: r.c.icono } : null,
      sucursal: r.s ? { id: r.s.id, nombre: r.s.nombre } : null,
      ubicacion: r.u ? { id: r.u.id, nombre: r.u.nombre, tipo: r.u.tipo } : null,
      asignado: r.asignado ? { id: r.asignado.id, nombre: r.asignado.nombre } : null,
      proveedorExterno: r.prov ? { id: r.prov.id, nombre: r.prov.nombre } : null,
    },
    ordenes: ots,
  });
};

const updateSchema = z.object({
  codigo: z.string().min(1).optional(),
  titulo: z.string().min(1).optional(),
  descripcion: z.string().nullable().optional(),
  categoriaId: z.number().int().nullable().optional(),
  sucursalId: z.number().int().nullable().optional(),
  ubicacionId: z.number().int().nullable().optional(),
  ubicacionDetalle: z.string().nullable().optional(),
  frecuencia: z.enum(["diaria", "semanal", "quincenal", "mensual", "bimestral", "trimestral", "semestral", "anual"]).optional(),
  proximaFecha: z.string().min(1).optional(),
  alertaDiasAntes: z.number().int().nonnegative().optional(),
  prioridad: z.enum(["baja", "media", "alta", "urgente"]).optional(),
  horasEstimadas: z.number().nullable().optional(),
  checklist: z.string().nullable().optional(),
  asignadoA: z.number().int().nullable().optional(),
  proveedorExternoId: z.number().int().nullable().optional(),
  notas: z.string().nullable().optional(),
  activo: z.boolean().optional(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarActividades(user.rol)) return new Response("Sin permisos", { status: 403 });
  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const [row] = await db.update(actividades).set(parsed.data).where(eq(actividades.id, id)).returning();
  return Response.json({ actividad: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  await db.update(actividades).set({ activo: false }).where(eq(actividades.id, id));
  return Response.json({ ok: true });
};
