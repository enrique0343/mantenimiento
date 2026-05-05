import type { APIRoute } from "astro";
import { sql, like, or, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { ordenes, activos, tickets, items, requisiciones } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

// Búsqueda global. Devuelve top resultados por entidad.
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const url = new URL(ctx.request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q || q.length < 2) {
    return Response.json({ resultados: { ordenes: [], equipos: [], tickets: [], items: [], requisiciones: [] } });
  }
  const db = getDb(ctx);
  const pat = `%${q}%`;
  const N = 6;

  // OTs por id (si es número) o por título
  const idNum = Number(q);
  const otsList = await db
    .select({ id: ordenes.id, titulo: ordenes.titulo, estado: ordenes.estado, tipo: ordenes.tipo })
    .from(ordenes)
    .where(Number.isFinite(idNum) ? or(eq(ordenes.id, idNum), like(ordenes.titulo, pat)) : like(ordenes.titulo, pat))
    .limit(N);

  const equiposList = await db
    .select({ id: activos.id, codigo: activos.codigo, nombre: activos.nombre, tipo: activos.tipo, estado: activos.estado })
    .from(activos)
    .where(or(like(activos.codigo, pat), like(activos.nombre, pat), like(activos.serial, pat), like(activos.marca, pat), like(activos.modelo, pat)))
    .limit(N);

  const ticketsList = await db
    .select({ id: tickets.id, asunto: tickets.asunto, estado: tickets.estado, trackingToken: tickets.trackingToken })
    .from(tickets)
    .where(Number.isFinite(idNum)
      ? or(eq(tickets.id, idNum), like(tickets.asunto, pat), like(tickets.solicitanteNombre, pat))
      : or(like(tickets.asunto, pat), like(tickets.solicitanteNombre, pat), like(tickets.trackingToken, pat))
    )
    .limit(N);

  const itemsList = await db
    .select({ id: items.id, codigo: items.codigo, nombre: items.nombre, unidad: items.unidad })
    .from(items)
    .where(or(like(items.codigo, pat), like(items.nombre, pat), like(items.descripcion, pat)))
    .limit(N);

  const requisicionesList = await db
    .select({ id: requisiciones.id, numero: requisiciones.numero, estado: requisiciones.estado })
    .from(requisiciones)
    .where(or(like(requisiciones.numero, pat), like(requisiciones.notas, pat)))
    .limit(N);

  return Response.json({
    resultados: {
      ordenes: otsList,
      equipos: equiposList,
      tickets: ticketsList,
      items: itemsList,
      requisiciones: requisicionesList,
    },
  });
};
