import type { APIRoute } from "astro";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { comentarios, ordenes } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { ErrorAlcanceOrden, leerOrdenConAlcance } from "@/lib/orden-alcance";

export const prerender = false;

const schema = z.object({ texto: z.string().min(1).max(2000) });

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const ordenId = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  let acceso;
  try { acceso = await leerOrdenConAlcance(db, ordenId, user); }
  catch (error) { if (error instanceof ErrorAlcanceOrden) return Response.json({ error: error.message }, { status: error.status }); throw error; }
  const [row] = await db
    .insert(comentarios)
    .select(db.select({
      id: sql<number>`null`.as("id"), ordenId: sql<number>`${ordenId}`.as("orden_id"),
      usuarioId: sql<number>`${user.id}`.as("usuario_id"), texto: sql<string>`${parsed.data.texto}`.as("texto"),
      createdAt: sql<string>`CURRENT_TIMESTAMP`.as("created_at"),
    }).from(ordenes).where(and(eq(ordenes.id, ordenId), acceso.guard)))
    .returning();
  if (!row) return Response.json({ error: "La orden cambió mientras enviabas el comentario. Actualiza la página." }, { status: 409 });
  return Response.json({ comentario: row }, { status: 201 });
};
