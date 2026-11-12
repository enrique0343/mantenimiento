import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { planAprobaciones } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { ROLES_BIO_VER, contentDisposition } from "@/lib/biomedico";

export const prerender = false;

/** El plan firmado de una aprobación (admin, jefe, técnico, visualizador). */
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ROLES_BIO_VER);
  if (!user) return response;
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Aprobación no válida." }, { status: 400 });
  const [ap] = await getDb(ctx).select({ nombre: planAprobaciones.nombreArchivo, contentType: planAprobaciones.contentType, r2Key: planAprobaciones.r2Key })
    .from(planAprobaciones).where(eq(planAprobaciones.id, id)).limit(1);
  if (!ap) return Response.json({ error: "No encontrado" }, { status: 404 });
  const obj = await getEnv(ctx).R2.get(ap.r2Key);
  if (!obj) return Response.json({ error: "No encontrado" }, { status: 404 });
  return new Response(await obj.arrayBuffer(), {
    headers: {
      "content-type": ap.contentType,
      "content-disposition": contentDisposition(ap.nombre),
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
    },
  });
};
