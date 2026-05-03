import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { ordenes } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const ordenId = Number(ctx.params.ordenId);
  const rol = ctx.params.rol as "tecnico" | "jefe" | "solicitante";

  const db = getDb(ctx);
  const [o] = await db.select().from(ordenes).where(eq(ordenes.id, ordenId)).limit(1);
  if (!o) return new Response("No encontrado", { status: 404 });

  const key =
    rol === "tecnico" ? o.firmaTecnicoR2 :
    rol === "jefe" ? o.firmaJefeR2 :
    rol === "solicitante" ? o.firmaSolicitanteR2 : null;

  if (!key) return new Response("Sin firma", { status: 404 });
  const env = getEnv(ctx);
  const obj = await env.R2.get(key);
  if (!obj) return new Response("Archivo no disponible", { status: 410 });
  return new Response(obj.body, {
    headers: { "content-type": "image/png", "cache-control": "private, max-age=600" },
  });
};
