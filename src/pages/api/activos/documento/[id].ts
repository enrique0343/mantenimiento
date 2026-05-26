import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { activoDocumentos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;

  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  const [doc] = await db.select().from(activoDocumentos).where(eq(activoDocumentos.id, id)).limit(1);
  if (!doc) return new Response("No encontrado", { status: 404 });

  const env = getEnv(ctx);
  const obj = await env.R2.get(doc.r2Key);
  if (!obj) return new Response("No encontrado en R2", { status: 404 });

  return new Response(obj.body, {
    headers: {
      "content-type": doc.contentType,
      "content-disposition": `inline; filename="${encodeURIComponent(doc.nombre)}"`,
      "cache-control": "private, max-age=60",
    },
  });
};
