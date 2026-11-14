// Descargar un archivo de licencia (admin, jefe, técnico y visualizador). Fase 59 · WP-D.
import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { licenciaArchivos } from "@/lib/schema";
import { ROLES_BIO_VER } from "@/lib/biomedico";
import { errorJson, exigirRol, idPositivo, respuestaArchivo } from "@/lib/bio-archivos";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_VER);
  if (!user) return response;
  const id = idPositivo(ctx.params.id);
  const [a] = id
    ? await getDb(ctx).select({ r2Key: licenciaArchivos.r2Key, nombre: licenciaArchivos.nombre, contentType: licenciaArchivos.contentType })
      .from(licenciaArchivos).where(eq(licenciaArchivos.id, id)).limit(1)
    : [];
  if (!a) return errorJson(404, "Archivo no encontrado");
  return respuestaArchivo(getEnv(ctx), a);
};
