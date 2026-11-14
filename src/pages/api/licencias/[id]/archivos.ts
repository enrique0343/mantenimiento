// Archivos de una licencia: la licencia o resolución, la constancia de trámite u otro
// (PDF o foto). Suben y eliminan admin y jefe. Fase 59 · WP-D.
import type { APIRoute } from "astro";
import { and, eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { licenciaArchivos, licencias } from "@/lib/schema";
import { logAudit } from "@/lib/audit";
import { ROLES_BIO_GESTIONAR } from "@/lib/biomedico";
import { CATEGORIAS_ARCHIVO_LICENCIA, codigoLicencia, esCategoriaArchivoLicencia } from "@/lib/licencias";
import { borrarArchivoR2, errorJson, exigirRol, guardarArchivoR2, idPositivo, leerArchivoDelFormulario } from "@/lib/bio-archivos";

export const prerender = false;

const SIN_PERMISO = "Solo el jefe o el administrador cambian los archivos de una licencia.";

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_GESTIONAR, SIN_PERMISO);
  if (!user) return response;
  const id = idPositivo(ctx.params.id);
  const db = getDb(ctx);
  const [lic] = id ? await db.select({ id: licencias.id }).from(licencias).where(eq(licencias.id, id)).limit(1) : [];
  if (!lic) return errorJson(404, "Licencia no encontrada");

  const form = await ctx.request.formData().catch(() => null);
  if (!form) return errorJson(400, "Elige un archivo.");
  const cat = form.get("categoria");
  const categoria = typeof cat === "string" && cat.trim() ? cat.trim() : "licencia";
  if (!esCategoriaArchivoLicencia(categoria)) return errorJson(400, "Categoría no válida.");
  const archivo = await leerArchivoDelFormulario(form);
  if (!archivo.ok) return errorJson(archivo.status, archivo.error);

  const env = getEnv(ctx);
  let r2Key: string;
  try {
    r2Key = await guardarArchivoR2(env, `licencias/${lic.id}`, archivo.nombre, archivo.datos, archivo.contentType);
  } catch {
    return errorJson(500, "No se pudo guardar el archivo. Intenta de nuevo.");
  }
  let fila;
  try {
    [fila] = await db.insert(licenciaArchivos).values({
      licenciaId: lic.id, nombre: archivo.nombre, contentType: archivo.contentType, tamano: archivo.tamano,
      r2Key, categoria, usuarioId: user.id,
    }).returning();
  } catch {
    await borrarArchivoR2(env, r2Key);
    return errorJson(500, "No se pudo guardar el archivo. Intenta de nuevo.");
  }
  await logAudit(ctx, {
    entidad: "licencia", entidadId: lic.id, accion: "update",
    resumen: `Archivo agregado a ${codigoLicencia(lic.id)}: ${archivo.nombre} (${CATEGORIAS_ARCHIVO_LICENCIA[categoria]})`,
  });
  return Response.json({ archivo: fila }, { status: 201 });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_GESTIONAR, SIN_PERMISO);
  if (!user) return response;
  const id = idPositivo(ctx.params.id);
  const archivoId = idPositivo(new URL(ctx.request.url).searchParams.get("archivoId"));
  if (!id || !archivoId) return errorJson(404, "Archivo no encontrado");
  const db = getDb(ctx);
  const [a] = await db.select({ id: licenciaArchivos.id, nombre: licenciaArchivos.nombre, r2Key: licenciaArchivos.r2Key })
    .from(licenciaArchivos)
    .where(and(eq(licenciaArchivos.id, archivoId), eq(licenciaArchivos.licenciaId, id)))
    .limit(1);
  if (!a) return errorJson(404, "Archivo no encontrado");
  await db.delete(licenciaArchivos).where(eq(licenciaArchivos.id, a.id));
  await borrarArchivoR2(getEnv(ctx), a.r2Key);
  await logAudit(ctx, { entidad: "licencia", entidadId: id, accion: "update", resumen: `Archivo eliminado de ${codigoLicencia(id)}: ${a.nombre}` });
  return Response.json({ ok: true });
};
