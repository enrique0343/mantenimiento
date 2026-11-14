// Archivos de una capacitación: lista de asistencia firmada (puede ser varias fotos),
// constancias y material. Suben admin, jefe y técnico; eliminan admin y jefe. Fase 59 · WP-D.
import type { APIRoute } from "astro";
import { and, eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { capacitacionArchivos, capacitaciones } from "@/lib/schema";
import { logAudit } from "@/lib/audit";
import { ROLES_BIO_GESTIONAR, ROLES_BIO_REGISTRAR } from "@/lib/biomedico";
import { CATEGORIAS_ARCHIVO_CAPACITACION, codigoCapacitacion, esCategoriaArchivoCapacitacion } from "@/lib/capacitaciones";
import { borrarArchivoR2, errorJson, exigirRol, guardarArchivoR2, idPositivo, leerArchivoDelFormulario } from "@/lib/bio-archivos";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_REGISTRAR, "Solo el administrador, el jefe o el técnico suben archivos de capacitaciones.");
  if (!user) return response;
  const id = idPositivo(ctx.params.id);
  const db = getDb(ctx);
  const [cap] = id ? await db.select({ id: capacitaciones.id }).from(capacitaciones).where(eq(capacitaciones.id, id)).limit(1) : [];
  if (!cap) return errorJson(404, "Capacitación no encontrada");

  const form = await ctx.request.formData().catch(() => null);
  if (!form) return errorJson(400, "Elige un archivo.");
  const cat = form.get("categoria");
  const categoria = typeof cat === "string" && cat.trim() ? cat.trim() : "lista_firmada";
  if (!esCategoriaArchivoCapacitacion(categoria)) return errorJson(400, "Categoría no válida.");
  const archivo = await leerArchivoDelFormulario(form);
  if (!archivo.ok) return errorJson(archivo.status, archivo.error);

  const env = getEnv(ctx);
  let r2Key: string;
  try {
    r2Key = await guardarArchivoR2(env, `capacitaciones/${cap.id}`, archivo.nombre, archivo.datos, archivo.contentType);
  } catch {
    return errorJson(500, "No se pudo guardar el archivo. Intenta de nuevo.");
  }
  let fila;
  try {
    [fila] = await db.insert(capacitacionArchivos).values({
      capacitacionId: cap.id, nombre: archivo.nombre, contentType: archivo.contentType, tamano: archivo.tamano,
      r2Key, categoria, usuarioId: user.id,
    }).returning();
  } catch {
    await borrarArchivoR2(env, r2Key);
    return errorJson(500, "No se pudo guardar el archivo. Intenta de nuevo.");
  }
  await logAudit(ctx, {
    entidad: "capacitacion", entidadId: cap.id, accion: "update",
    resumen: `Archivo agregado a ${codigoCapacitacion(cap.id)}: ${archivo.nombre} (${CATEGORIAS_ARCHIVO_CAPACITACION[categoria]})`,
  });
  return Response.json({ archivo: fila }, { status: 201 });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_GESTIONAR, "Solo el jefe o el administrador eliminan archivos de capacitaciones.");
  if (!user) return response;
  const id = idPositivo(ctx.params.id);
  const archivoId = idPositivo(new URL(ctx.request.url).searchParams.get("archivoId"));
  if (!id || !archivoId) return errorJson(404, "Archivo no encontrado");
  const db = getDb(ctx);
  const [a] = await db.select({ id: capacitacionArchivos.id, nombre: capacitacionArchivos.nombre, r2Key: capacitacionArchivos.r2Key })
    .from(capacitacionArchivos)
    .where(and(eq(capacitacionArchivos.id, archivoId), eq(capacitacionArchivos.capacitacionId, id)))
    .limit(1);
  if (!a) return errorJson(404, "Archivo no encontrado");
  await db.delete(capacitacionArchivos).where(eq(capacitacionArchivos.id, a.id));
  await borrarArchivoR2(getEnv(ctx), a.r2Key);
  await logAudit(ctx, { entidad: "capacitacion", entidadId: id, accion: "update", resumen: `Archivo eliminado de ${codigoCapacitacion(id)}: ${a.nombre}` });
  return Response.json({ ok: true });
};
