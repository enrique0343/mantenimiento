import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { contratoAdjuntos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeVerContratos } from "@/lib/contratos";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerContratos(user.rol)) return Response.json({ error: "Sin permisos" }, { status: 403 });

  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  const [adj] = await db.select().from(contratoAdjuntos).where(eq(contratoAdjuntos.id, id)).limit(1);
  if (!adj) return new Response("No encontrado", { status: 404 });

  const env = getEnv(ctx);
  const obj = await env.R2.get(adj.r2Key);
  if (!obj) return new Response("No encontrado en R2", { status: 404 });

  return new Response(obj.body, {
    headers: {
      "content-type": adj.contentType,
      "content-disposition": `inline; filename="${encodeURIComponent(adj.nombre)}"`,
      "cache-control": "private, max-age=60",
    },
  });
};
