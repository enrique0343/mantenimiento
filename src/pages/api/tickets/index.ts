import { condicionSolicitudPropia } from "@/lib/ticket-acceso";
import type { APIRoute } from "astro";
import { desc, eq, or, isNull, and } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tickets, usuarios, sucursales, activos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

import { parseArea } from "@/lib/areas";
import { espacioDeLista, respuestaOtroEspacio, condicionTrabajoAreaEspacio } from "@/lib/espacio";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const db = getDb(ctx);

  const rawArea = new URL(ctx.request.url).searchParams.get("area");
  const area = parseArea(rawArea);
  if (rawArea !== null && !area) return Response.json({ error: "Área de mantenimiento inválida" }, { status: 400 });
  const { espacio, permitido } = espacioDeLista(ctx, user, area);
  if (!permitido && user.rol !== "solicitante") return respuestaOtroEspacio(espacio);

  // Técnicos: solo asignados a él o sin asignar (para triaje)
  const where = user.rol === "tecnico"
    ? or(eq(tickets.asignadoA, user.id), isNull(tickets.asignadoA))
    : undefined;

  const rows = await db
    .select({
      t: tickets,
      asignado: { id: usuarios.id, nombre: usuarios.nombre },
      suc: { id: sucursales.id, nombre: sucursales.nombre },
      act: { id: activos.id, codigo: activos.codigo, nombre: activos.nombre },
    })
    .from(tickets)
    .leftJoin(usuarios, eq(usuarios.id, tickets.asignadoA))
    .leftJoin(sucursales, eq(sucursales.id, tickets.sucursalId))
    .leftJoin(activos, eq(activos.id, tickets.activoId))
    .where(and(where, user.rol === "solicitante" ? condicionSolicitudPropia(user) : undefined,
      user.rol !== "solicitante" || area ? condicionTrabajoAreaEspacio(tickets.rubro, tickets.activoId, espacio, area) : undefined))
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
