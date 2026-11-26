import type { APIRoute } from "astro";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { ticketComentarios, tickets } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { condicionTicketEspacio, puedeEntrar } from "@/lib/espacio";
import { espacioDeTrabajoGuardado } from "@/lib/espacio-db";
import { condicionSolicitudPropia, esSolicitudPropia } from "@/lib/ticket-acceso";

export const prerender = false;

const schema = z.object({
  texto: z.string().min(1),
  publico: z.boolean().default(true),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const ticketId = Number(ctx.params.id);
  if (!Number.isSafeInteger(ticketId) || ticketId <= 0) return Response.json({ error: "Solicitud inválida" }, { status: 400 });
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Texto requerido" }, { status: 400 });
  const db = getDb(ctx);
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!ticket) return Response.json({ error: "Solicitud no encontrada" }, { status: 404 });
  const espacio = await espacioDeTrabajoGuardado(db, ticket.rubro, ticket.activoId);
  const propio = user.rol === "solicitante";
  if (propio ? !esSolicitudPropia(user, ticket) : !puedeEntrar(user, espacio)) return Response.json({ error: "Sin permisos sobre esta solicitud" }, { status: 403 });
  // El middleware puede haber autorizado antes de una derivación concurrente.
  // La inserción confirma el mismo alcance y la misma versión en la escritura.
  const [row] = await db
    .insert(ticketComentarios)
    .select(db.select({
      id: sql<number>`null`.as("id"), ticketId: sql<number>`${ticketId}`.as("ticket_id"),
      usuarioId: sql<number>`${user.id}`.as("usuario_id"), autorExterno: sql<string | null>`null`.as("autor_externo"),
      texto: sql<string>`${parsed.data.texto}`.as("texto"), publico: sql<boolean>`${parsed.data.publico ? 1 : 0}`.as("publico"),
      createdAt: sql<string>`CURRENT_TIMESTAMP`.as("created_at"),
    }).from(tickets).where(and(eq(tickets.id, ticketId), eq(tickets.updatedAt, ticket.updatedAt),
      sql`${tickets.rubro} IS ${ticket.rubro}`, sql`${tickets.activoId} IS ${ticket.activoId}`,
      propio ? condicionSolicitudPropia(user) : condicionTicketEspacio(espacio),
      sql`EXISTS(SELECT 1 FROM usuarios actor WHERE actor.id=${user.id} AND actor.activo=1 AND actor.rol=${user.rol} AND actor.especialidad IS ${user.especialidad ?? null})`,
    )))
    .returning();
  if (!row) return Response.json({ error: "La solicitud cambió mientras enviabas el comentario. Actualiza la página." }, { status: 409 });
  return Response.json({ comentario: row }, { status: 201 });
};
