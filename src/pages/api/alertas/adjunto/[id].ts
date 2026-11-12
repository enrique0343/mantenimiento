import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { alertaAdjuntos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { ROLES_BIO_VER, contentDisposition } from "@/lib/biomedico";

export const prerender = false;

/** Descarga un archivo de una alerta (admin, jefe, técnico, visualizador). */
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ROLES_BIO_VER);
  if (!user) return response;
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Archivo no válido." }, { status: 400 });
  const [adj] = await getDb(ctx).select({ nombre: alertaAdjuntos.nombre, contentType: alertaAdjuntos.contentType, r2Key: alertaAdjuntos.r2Key })
    .from(alertaAdjuntos).where(eq(alertaAdjuntos.id, id)).limit(1);
  if (!adj) return Response.json({ error: "No encontrado" }, { status: 404 });
  const obj = await getEnv(ctx).R2.get(adj.r2Key);
  if (!obj) return Response.json({ error: "No encontrado" }, { status: 404 });
  return new Response(await obj.arrayBuffer(), {
    headers: {
      "content-type": adj.contentType,
      "content-disposition": contentDisposition(adj.nombre),
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
    },
  });
};
