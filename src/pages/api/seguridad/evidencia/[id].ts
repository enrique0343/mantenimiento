import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { extintorEventos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeVerSeguridad } from "@/lib/extintores";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerSeguridad(user.rol)) return new Response("Sin permisos", { status: 403 });
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  const [r] = await db.select().from(extintorEventos).where(eq(extintorEventos.id, id)).limit(1);
  if (!r || !r.evidenciaR2) return new Response("No encontrado", { status: 404 });
  const env = getEnv(ctx);
  const obj = await env.R2.get(r.evidenciaR2);
  if (!obj) return new Response("No disponible", { status: 410 });
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "private, max-age=600",
    },
  });
};
