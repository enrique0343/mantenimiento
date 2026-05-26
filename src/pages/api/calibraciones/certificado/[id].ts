import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { calibraciones } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;

  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  const [cal] = await db.select().from(calibraciones).where(eq(calibraciones.id, id)).limit(1);
  if (!cal?.certificadoR2Key) return new Response("No encontrado", { status: 404 });

  const env = getEnv(ctx);
  const obj = await env.R2.get(cal.certificadoR2Key);
  if (!obj) return new Response("No encontrado en R2", { status: 404 });

  const nombre = `certificado-calibracion-${cal.numeroCertificado ?? cal.id}`;
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "content-disposition": `inline; filename="${encodeURIComponent(nombre)}"`,
      "cache-control": "private, max-age=60",
    },
  });
};
