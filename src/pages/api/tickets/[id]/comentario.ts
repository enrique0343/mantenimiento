import type { APIRoute } from "astro";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { ticketComentarios } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

const schema = z.object({
  texto: z.string().min(1),
  publico: z.boolean().default(true),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const ticketId = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Texto requerido" }, { status: 400 });
  const db = getDb(ctx);
  const [row] = await db
    .insert(ticketComentarios)
    .values({ ticketId, usuarioId: user.id, texto: parsed.data.texto, publico: parsed.data.publico })
    .returning();
  return Response.json({ comentario: row }, { status: 201 });
};
