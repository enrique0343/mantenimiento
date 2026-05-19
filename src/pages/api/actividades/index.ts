import type { APIRoute } from "astro";
import { z } from "zod";
import { desc, eq, like } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { actividades, actividadCategorias, sucursales, usuarios } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeVerActividades, puedeAdministrarActividades } from "@/lib/actividades";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerActividades(user.rol)) return new Response("Sin permisos", { status: 403 });
  const db = getDb(ctx);
  const rows = await db
    .select({ a: actividades, c: actividadCategorias, s: sucursales, u: usuarios })
    .from(actividades)
    .leftJoin(actividadCategorias, eq(actividadCategorias.id, actividades.categoriaId))
    .leftJoin(sucursales, eq(sucursales.id, actividades.sucursalId))
    .leftJoin(usuarios, eq(usuarios.id, actividades.asignadoA))
    .orderBy(desc(actividades.id));
  return Response.json({
    actividades: rows.map((r) => ({
      ...r.a,
      categoria: r.c ? { id: r.c.id, nombre: r.c.nombre, icono: r.c.icono } : null,
      sucursal: r.s ? { id: r.s.id, nombre: r.s.nombre } : null,
      asignado: r.u ? { id: r.u.id, nombre: r.u.nombre } : null,
    })),
  });
};

const createSchema = z.object({
  codigo: z.string().min(1).optional(),
  titulo: z.string().min(1),
  descripcion: z.string().nullable().optional(),
  categoriaId: z.number().int().nullable().optional(),
  sucursalId: z.number().int().nullable().optional(),
  ubicacionId: z.number().int().nullable().optional(),
  ubicacionDetalle: z.string().nullable().optional(),
  frecuencia: z.enum(["diaria", "semanal", "quincenal", "mensual", "bimestral", "trimestral", "semestral", "anual"]),
  proximaFecha: z.string().min(1),
  alertaDiasAntes: z.number().int().nonnegative().default(7),
  prioridad: z.enum(["baja", "media", "alta", "urgente"]).default("media"),
  horasEstimadas: z.number().nullable().optional(),
  checklist: z.string().nullable().optional(),
  asignadoA: z.number().int().nullable().optional(),
  proveedorExternoId: z.number().int().nullable().optional(),
  notas: z.string().nullable().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarActividades(user.rol)) return new Response("Sin permisos", { status: 403 });
  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);

  // Auto-generar código ACT-XXXX si no viene en el payload
  let codigo = parsed.data.codigo;
  if (!codigo) {
    const ultimas = await db.select({ codigo: actividades.codigo }).from(actividades).where(like(actividades.codigo, "ACT-%"));
    let max = 0;
    for (const { codigo: c } of ultimas) {
      const m = c.match(/^ACT-(\d+)$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    codigo = `ACT-${String(max + 1).padStart(4, "0")}`;
  }

  try {
    const [row] = await db.insert(actividades).values({ ...parsed.data, codigo }).returning();
    return Response.json({ actividad: row }, { status: 201 });
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      return Response.json({ error: "Código ya existe" }, { status: 409 });
    }
    throw e;
  }
};
