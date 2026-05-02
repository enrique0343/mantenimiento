import type { APIRoute } from "astro";
import { eq, asc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { planesMantenimiento, activos, usuarios } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const db = getDb(ctx);
  const rows = await db
    .select({ p: planesMantenimiento, a: activos, u: usuarios })
    .from(planesMantenimiento)
    .leftJoin(activos, eq(activos.id, planesMantenimiento.activoId))
    .leftJoin(usuarios, eq(usuarios.id, planesMantenimiento.asignadoA))
    .where(eq(planesMantenimiento.activo, true))
    .orderBy(asc(planesMantenimiento.proximaFecha));
  return Response.json({
    planes: rows.map((r) => ({
      ...r.p,
      activo: r.a ? { id: r.a.id, codigo: r.a.codigo, nombre: r.a.nombre } : null,
      asignado: r.u ? { id: r.u.id, nombre: r.u.nombre } : null,
    })),
  });
};
