// Documentos del equipo (expediente técnico, manuales, actas…). Fase 59 · WP-D:
// el tipo se revisa por el contenido, se guardan versión, fecha, vencimiento y nota,
// y solo admin, jefe y técnico suben; borran admin y jefe.
import type { APIRoute } from "astro";
import { and, eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { activoDocumentos, activos } from "@/lib/schema";
import { logAudit } from "@/lib/audit";
import { ROLES_BIO_GESTIONAR, ROLES_BIO_REGISTRAR, etiquetaCategoriaDocumento } from "@/lib/biomedico";
import { leerMetadatosDocumento } from "@/lib/inventario-jci";
import { borrarArchivoR2, errorJson, exigirRol, guardarArchivoR2, idPositivo, leerArchivoDelFormulario } from "@/lib/bio-archivos";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_REGISTRAR, "Solo el administrador, el jefe o el técnico suben documentos.");
  if (!user) return response;

  const activoId = idPositivo(ctx.params.id);
  const db = getDb(ctx);
  const [equipo] = activoId
    ? await db.select({ id: activos.id }).from(activos).where(eq(activos.id, activoId)).limit(1)
    : [];
  if (!activoId || !equipo) return errorJson(404, "Equipo no encontrado");

  const form = await ctx.request.formData().catch(() => null);
  if (!form) return errorJson(400, "Elige un archivo.");
  const campo = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : undefined;
  };
  const meta = leerMetadatosDocumento(
    { categoria: campo("categoria"), version: campo("version"), fechaDocumento: campo("fechaDocumento"), fechaVencimiento: campo("fechaVencimiento"), nota: campo("nota") },
    { parcial: false },
  );
  if (!meta.ok) return errorJson(400, meta.error);
  const archivo = await leerArchivoDelFormulario(form);
  if (!archivo.ok) return errorJson(archivo.status, archivo.error);

  const env = getEnv(ctx);
  let r2Key: string;
  try {
    r2Key = await guardarArchivoR2(env, `activos/${activoId}/docs`, archivo.nombre, archivo.datos, archivo.contentType);
  } catch {
    return errorJson(500, "No se pudo guardar el archivo. Intenta de nuevo.");
  }
  const categoria = meta.datos.categoria!;
  let documento;
  try {
    [documento] = await db.insert(activoDocumentos).values({
      activoId,
      nombre: archivo.nombre,
      contentType: archivo.contentType,
      tamano: archivo.tamano,
      r2Key,
      categoria,
      version: meta.datos.version ?? null,
      fechaVersion: meta.datos.fechaVersion ?? null,
      fechaVencimiento: meta.datos.fechaVencimiento ?? null,
      nota: meta.datos.nota ?? null,
      usuarioId: user.id,
    }).returning();
  } catch {
    await borrarArchivoR2(env, r2Key);
    return errorJson(500, "No se pudo guardar el documento. Intenta de nuevo.");
  }
  await logAudit(ctx, {
    entidad: "activo", entidadId: activoId, accion: "update",
    resumen: `Documento agregado: ${archivo.nombre} (${etiquetaCategoriaDocumento(categoria)})`,
  });
  return Response.json({ documento }, { status: 201 });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_GESTIONAR, "Solo el jefe o el administrador eliminan documentos.");
  if (!user) return response;

  const activoId = idPositivo(ctx.params.id);
  const docId = idPositivo(new URL(ctx.request.url).searchParams.get("documentoId"));
  if (!activoId || !docId) return errorJson(404, "No encontrado");
  const db = getDb(ctx);
  const [doc] = await db
    .select({ id: activoDocumentos.id, nombre: activoDocumentos.nombre, r2Key: activoDocumentos.r2Key, categoria: activoDocumentos.categoria })
    .from(activoDocumentos)
    .where(and(eq(activoDocumentos.id, docId), eq(activoDocumentos.activoId, activoId)))
    .limit(1);
  if (!doc) return errorJson(404, "No encontrado");
  await db.delete(activoDocumentos).where(eq(activoDocumentos.id, doc.id));
  await borrarArchivoR2(getEnv(ctx), doc.r2Key);
  await logAudit(ctx, {
    entidad: "activo", entidadId: activoId, accion: "update",
    resumen: `Documento eliminado: ${doc.nombre} (${etiquetaCategoriaDocumento(doc.categoria)})`,
  });
  return Response.json({ ok: true });
};
