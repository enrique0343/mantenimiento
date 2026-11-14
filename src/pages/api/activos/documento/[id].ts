// Un documento del equipo: descargarlo (admin, jefe, técnico y visualizador) y
// corregir sus datos (admin, jefe y técnico). Fase 59 · WP-D.
import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { activoDocumentos } from "@/lib/schema";
import { calcularDiff, logAudit, resumenCambios } from "@/lib/audit";
import { ROLES_BIO_REGISTRAR, ROLES_BIO_VER } from "@/lib/biomedico";
import { leerMetadatosDocumento } from "@/lib/inventario-jci";
import { errorJson, exigirRol, idPositivo, leerJson, respuestaArchivo } from "@/lib/bio-archivos";
import { bloqueoEspacio, espacioDeActivoId } from "@/lib/espacio-db";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_VER);
  if (!user) return response;

  const id = idPositivo(ctx.params.id);
  const db = getDb(ctx);
  const [doc] = id
    ? await db.select({ r2Key: activoDocumentos.r2Key, nombre: activoDocumentos.nombre, contentType: activoDocumentos.contentType, activoId: activoDocumentos.activoId })
      .from(activoDocumentos).where(eq(activoDocumentos.id, id)).limit(1)
    : [];
  if (!doc) return errorJson(404, "No encontrado");
  // El documento es del equipo: quien está atado al otro espacio no lo descarga.
  const otro = bloqueoEspacio(user, await espacioDeActivoId(db, doc.activoId));
  if (otro) return otro;
  return respuestaArchivo(getEnv(ctx), doc);
};

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_REGISTRAR, "Solo el administrador, el jefe o el técnico corrigen documentos.");
  if (!user) return response;

  const id = idPositivo(ctx.params.id);
  const db = getDb(ctx);
  const [actual] = id
    ? await db.select({
      id: activoDocumentos.id, activoId: activoDocumentos.activoId, nombre: activoDocumentos.nombre, categoria: activoDocumentos.categoria,
      version: activoDocumentos.version, fechaVersion: activoDocumentos.fechaVersion, fechaVencimiento: activoDocumentos.fechaVencimiento,
      nota: activoDocumentos.nota,
    }).from(activoDocumentos).where(eq(activoDocumentos.id, id)).limit(1)
    : [];
  if (!actual) return errorJson(404, "No encontrado");
  const otro = bloqueoEspacio(user, await espacioDeActivoId(db, actual.activoId));
  if (otro) return otro;

  const body = await leerJson(ctx);
  if (!body) return errorJson(400, "Datos no válidos.");
  const meta = leerMetadatosDocumento(body, { parcial: true, actual });
  if (!meta.ok) return errorJson(400, meta.error);
  const cambios = calcularDiff(actual, { ...meta.datos });
  if (Object.keys(meta.datos).length === 0 || Object.keys(cambios).length === 0) {
    const [documento] = await db.select().from(activoDocumentos).where(eq(activoDocumentos.id, actual.id)).limit(1);
    return Response.json({ documento });
  }
  const [documento] = await db.update(activoDocumentos).set(meta.datos).where(eq(activoDocumentos.id, actual.id)).returning();
  await logAudit(ctx, {
    entidad: "activo", entidadId: actual.activoId, accion: "update", cambios,
    resumen: `Documento modificado: ${actual.nombre} — ${resumenCambios(cambios)}`,
  });
  return Response.json({ documento });
};
