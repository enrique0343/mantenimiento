import type { APIRoute } from "astro";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { proyectoComentarios } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

const schema = z.object({ texto: z.string().min(1) });

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const proyectoId = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [com] = await db.insert(proyectoComentarios).values({
    proyectoId, usuarioId: user.id, texto: parsed.data.texto,
  }).returning();
  return Response.json({ comentario: com }, { status: 201 });
};
