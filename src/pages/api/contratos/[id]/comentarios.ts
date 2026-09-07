import type { APIRoute } from "astro";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { contratoComentarios } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeVerContratos } from "@/lib/contratos";

export const prerender = false;

const schema = z.object({ texto: z.string().min(1).max(2000) });

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerContratos(user.rol)) return Response.json({ error: "Sin permisos" }, { status: 403 });

  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [c] = await db.insert(contratoComentarios).values({
    contratoId: id, usuarioId: user.id, texto: parsed.data.texto,
  }).returning();

  return Response.json({ comentario: c }, { status: 201 });
};
