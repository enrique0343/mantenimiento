import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { gastosMantenimiento } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const db = getDb(ctx);
  const res = await db.delete(gastosMantenimiento).where(eq(gastosMantenimiento.id, id)).returning();
  if (!res.length) return Response.json({ error: "No encontrado" }, { status: 404 });
  return Response.json({ ok: true });
};
