import type { APIRoute } from "astro";
import { desc, eq, or, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tickets, usuarios, sucursales, activos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const db = getDb(ctx);

  // Técnicos: solo asignados a él o sin asignar (para triaje)
  const where = user.rol === "tecnico"
    ? or(eq(tickets.asignadoA, user.id), isNull(tickets.asignadoA))
    : undefined;

  const rows = await db
    .select({
      t: tickets,
      asignado: usuarios,
      suc: sucursales,
      act: activos,
    })
    .from(tickets)
    .leftJoin(usuarios, eq(usuarios.id, tickets.asignadoA))
    .leftJoin(sucursales, eq(sucursales.id, tickets.sucursalId))
    .leftJoin(activos, eq(activos.id, tickets.activoId))
    .where(where)
    .orderBy(desc(tickets.id));

  return Response.json({
    tickets: rows.map((r) => ({
      ...r.t,
      asignado: r.asignado ? { id: r.asignado.id, nombre: r.asignado.nombre } : null,
      sucursal: r.suc ? { id: r.suc.id, nombre: r.suc.nombre } : null,
      activo: r.act ? { id: r.act.id, codigo: r.act.codigo, nombre: r.act.nombre } : null,
    })),
  });
};
