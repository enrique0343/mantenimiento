import type { APIRoute } from "astro";
import { eq, asc } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { tickets, ticketComentarios, usuarios } from "@/lib/schema";

export const prerender = false;

// GET publico: ver estado del ticket por tracking token
export const GET: APIRoute = async (ctx) => {
  const token = ctx.params.token;
  if (!token) return Response.json({ error: "Token requerido" }, { status: 400 });
  const db = getDb(ctx);
  const [t] = await db.select().from(tickets).where(eq(tickets.trackingToken, token)).limit(1);
  if (!t) return Response.json({ error: "Ticket no encontrado" }, { status: 404 });

  const coms = await db
    .select({ c: ticketComentarios, u: usuarios })
    .from(ticketComentarios)
    .leftJoin(usuarios, eq(usuarios.id, ticketComentarios.usuarioId))
    .where(eq(ticketComentarios.ticketId, t.id))
    .orderBy(asc(ticketComentarios.id));

  return Response.json({
    ticket: {
      id: t.id,
      asunto: t.asunto,
      descripcion: t.descripcion,
      estado: t.estado,
      prioridad: t.prioridad,
      vencimientoSla: t.vencimientoSla,
      resueltoEn: t.resueltoEn,
      resolucionNotas: t.resolucionNotas,
      createdAt: t.createdAt,
    },
    comentarios: coms
      .filter((r) => r.c.publico)
      .map((r) => ({
        id: r.c.id,
        texto: r.c.texto,
        autor: r.u?.nombre ?? r.c.autorExterno ?? "Solicitante",
        createdAt: r.c.createdAt,
      })),
  });
};

const comSchema = z.object({ texto: z.string().min(1) });

export const POST: APIRoute = async (ctx) => {
  const token = ctx.params.token;
  if (!token) return Response.json({ error: "Token requerido" }, { status: 400 });
  const body = await ctx.request.json().catch(() => null);
  const parsed = comSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Texto requerido" }, { status: 400 });

  const db = getDb(ctx);
  const [t] = await db.select().from(tickets).where(eq(tickets.trackingToken, token)).limit(1);
  if (!t) return Response.json({ error: "Ticket no encontrado" }, { status: 404 });

  await db.insert(ticketComentarios).values({
    ticketId: t.id,
    autorExterno: t.solicitanteNombre,
    texto: parsed.data.texto,
    publico: true,
  });
  return Response.json({ ok: true }, { status: 201 });
};
