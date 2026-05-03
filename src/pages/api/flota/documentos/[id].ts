import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { vehiculoDocumentos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeAdministrarFlota } from "@/lib/flota";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  const [row] = await db.select().from(vehiculoDocumentos).where(eq(vehiculoDocumentos.id, id)).limit(1);
  if (!row || !row.r2Key) return new Response("Sin archivo", { status: 404 });
  const env = getEnv(ctx);
  const obj = await env.R2.get(row.r2Key);
  if (!obj) return new Response("No disponible", { status: 410 });
  return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream" } });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarFlota(user.rol)) return new Response("Sin permisos", { status: 403 });
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  const [row] = await db.select().from(vehiculoDocumentos).where(eq(vehiculoDocumentos.id, id)).limit(1);
  if (!row) return Response.json({ error: "No encontrado" }, { status: 404 });
  if (row.r2Key) {
    const env = getEnv(ctx);
    await env.R2.delete(row.r2Key).catch(() => {});
  }
  await db.delete(vehiculoDocumentos).where(eq(vehiculoDocumentos.id, id));
  return Response.json({ ok: true });
};
