import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { adjuntos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  const [row] = await db.select().from(adjuntos).where(eq(adjuntos.id, id)).limit(1);
  if (!row) return new Response("No encontrado", { status: 404 });

  const env = getEnv(ctx);
  const obj = await env.R2.get(row.r2Key);
  if (!obj) return new Response("Archivo no disponible", { status: 410 });

  return new Response(obj.body, {
    headers: {
      "content-type": row.contentType,
      "content-disposition": `inline; filename="${encodeURIComponent(row.nombre)}"`,
      "cache-control": "private, max-age=300",
    },
  });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "tecnico"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  const [row] = await db.select().from(adjuntos).where(eq(adjuntos.id, id)).limit(1);
  if (!row) return Response.json({ error: "No encontrado" }, { status: 404 });
  const env = getEnv(ctx);
  await env.R2.delete(row.r2Key);
  await db.delete(adjuntos).where(eq(adjuntos.id, id));
  return Response.json({ ok: true });
};
