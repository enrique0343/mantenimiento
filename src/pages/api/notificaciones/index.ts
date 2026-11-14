import type { APIRoute } from "astro";
import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { notificaciones } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { condicionLinkEspacio, espacioDelContexto } from "@/lib/espacio";

export const prerender = false;

// GET /api/notificaciones?solo_no_leidas=1
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const db = getDb(ctx);
  const url = new URL(ctx.request.url);
  const soloNoLeidas = url.searchParams.get("solo_no_leidas") === "1";

  // La campana del espacio: los avisos de sus registros y los comunes, no los del otro.
  const delEspacio = condicionLinkEspacio(notificaciones.link, espacioDelContexto(ctx, user));
  const conds = [eq(notificaciones.usuarioId, user.id), delEspacio];
  if (soloNoLeidas) conds.push(eq(notificaciones.leida, false));

  const rows = await db
    .select()
    .from(notificaciones)
    .where(and(...conds))
    .orderBy(desc(notificaciones.id))
    .limit(50);

  const [count] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(notificaciones)
    .where(and(eq(notificaciones.usuarioId, user.id), eq(notificaciones.leida, false), delEspacio));

  return Response.json({
    notificaciones: rows,
    noLeidas: Number(count?.n ?? 0),
  });
};

// POST /api/notificaciones { id?: marcar leida; o action: "marcar_todas_leidas" }
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => ({}));
  const db = getDb(ctx);

  if (body.action === "marcar_todas_leidas") {
    // «Marcar todas» marca las que se ven en este espacio.
    await db.update(notificaciones)
      .set({ leida: true })
      .where(and(eq(notificaciones.usuarioId, user.id), condicionLinkEspacio(notificaciones.link, espacioDelContexto(ctx, user))));
    return Response.json({ ok: true });
  }

  if (body.id) {
    await db.update(notificaciones)
      .set({ leida: true })
      .where(and(eq(notificaciones.id, Number(body.id)), eq(notificaciones.usuarioId, user.id)));
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Acción no válida" }, { status: 400 });
};
