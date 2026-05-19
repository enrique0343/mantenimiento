// Servidor genérico de fotos de R2 dentro del módulo flota.
// La key se pasa URL-encoded para preservar slashes.
import type { APIRoute } from "astro";
import { getEnv } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { puedeVerFlota } from "@/lib/flota";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerFlota(user.rol)) return new Response("Sin permisos", { status: 403 });
  const key = decodeURIComponent(ctx.params.r2Key ?? "");
  if (!key.startsWith("flota/")) return new Response("Ruta inválida", { status: 400 });
  const env = getEnv(ctx);
  const obj = await env.R2.get(key);
  if (!obj) return new Response("No disponible", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "private, max-age=600",
    },
  });
};
