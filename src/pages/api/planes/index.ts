import type { APIRoute } from "astro";
import { eq, asc, and } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { planesMantenimiento, activos, usuarios } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

import { parseArea, activoAreaCondition } from "@/lib/areas";
export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const areaParam = ctx.url.searchParams.get("area");
  const area = parseArea(areaParam);
  if (areaParam && !area) return Response.json({ error: "Área no válida" }, { status: 400 });
  const db = getDb(ctx);
  const rows = await db
    .select({ p: planesMantenimiento, a: activos, u: usuarios })
    .from(planesMantenimiento)
    .leftJoin(activos, eq(activos.id, planesMantenimiento.activoId))
    .leftJoin(usuarios, eq(usuarios.id, planesMantenimiento.asignadoA))
    .where(and(eq(planesMantenimiento.activo, true), area ? activoAreaCondition(area) : undefined))
    .orderBy(asc(planesMantenimiento.proximaFecha));
  return Response.json({
    planes: rows.map((r) => ({
      ...r.p,
      activo: r.a ? { id: r.a.id, codigo: r.a.codigo, nombre: r.a.nombre, rubro: r.a.rubro } : null,
      asignado: r.u ? { id: r.u.id, nombre: r.u.nombre } : null,
    })),
  });
};
