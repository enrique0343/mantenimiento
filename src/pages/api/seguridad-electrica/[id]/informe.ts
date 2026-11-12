// Informe del analizador de una prueba de seguridad eléctrica.
// GET (ver): el archivo, en línea y con el tipo detectado al subirlo.
// POST (registrar): adjunta el informe que falta; nunca reemplaza uno existente.
import type { APIRoute } from "astro";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { activos, pruebasSeguridadElectrica } from "@/lib/schema";
import { logAuditLote } from "@/lib/audit";
import { ROLES_BIO_REGISTRAR, ROLES_BIO_VER, contentDisposition, fechaCorta, nombreSeguroR2, validarArchivo } from "@/lib/biomedico";
import { errorJson, exigirRol, idPositivo } from "@/lib/seguridad-electrica";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_VER);
  if (!user) return response;
  const id = idPositivo(ctx.params.id);
  if (!id) return errorJson(404, "Sin informe");
  const db = getDb(ctx);
  const [p] = await db
    .select({ r2Key: pruebasSeguridadElectrica.informeR2Key, nombre: pruebasSeguridadElectrica.informeNombre, tipo: pruebasSeguridadElectrica.informeTipo })
    .from(pruebasSeguridadElectrica)
    .where(eq(pruebasSeguridadElectrica.id, id))
    .limit(1);
  if (!p?.r2Key) return errorJson(404, "Sin informe");
  const obj = await getEnv(ctx).R2.get(p.r2Key);
  if (!obj) return errorJson(404, "Sin informe");
  return new Response(await obj.arrayBuffer(), {
    headers: {
      "content-type": p.tipo || "application/octet-stream",
      "content-disposition": contentDisposition(p.nombre || "informe"),
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
    },
  });
};

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_REGISTRAR);
  if (!user) return response;
  const id = idPositivo(ctx.params.id);
  if (!id) return errorJson(404, "Prueba no encontrada.");
  const db = getDb(ctx);
  const [p] = await db
    .select({ id: pruebasSeguridadElectrica.id, activoId: pruebasSeguridadElectrica.activoId, fecha: pruebasSeguridadElectrica.fecha, estado: pruebasSeguridadElectrica.estado, r2Key: pruebasSeguridadElectrica.informeR2Key, codigo: activos.codigo })
    .from(pruebasSeguridadElectrica)
    .innerJoin(activos, eq(activos.id, pruebasSeguridadElectrica.activoId))
    .where(eq(pruebasSeguridadElectrica.id, id))
    .limit(1);
  if (!p) return errorJson(404, "Prueba no encontrada.");
  if (p.estado === "anulada") return errorJson(409, "La prueba está anulada.");
  if (p.r2Key) return errorJson(409, "Esta prueba ya tiene informe.");

  const form = await ctx.request.formData().catch(() => null);
  const archivo = form?.get("informe");
  if (!(archivo instanceof File) || (archivo.size === 0 && archivo.name === "")) return errorJson(400, "Elige el archivo del informe (PDF o foto).");
  const bytes = await archivo.arrayBuffer();
  const revisado = validarArchivo({ tamano: archivo.size, cabecera: new Uint8Array(bytes).subarray(0, 1024) });
  if (!revisado.ok) return errorJson(revisado.status, revisado.error);

  const env = getEnv(ctx);
  const r2Key = `seguridad-electrica/${p.activoId}/${Date.now()}-${crypto.randomUUID()}-${nombreSeguroR2(archivo.name)}`;
  const nombre = (archivo.name || `informe.${revisado.extension}`).slice(0, 200);
  await env.R2.put(r2Key, bytes, { httpMetadata: { contentType: revisado.contentType } });
  let guardadas: { id: number }[];
  try {
    // Solo si sigue sin informe y válida: dos envíos a la vez no se pisan.
    guardadas = await db
      .update(pruebasSeguridadElectrica)
      .set({ informeR2Key: r2Key, informeNombre: nombre, informeTipo: revisado.contentType, informeTamano: archivo.size })
      .where(and(eq(pruebasSeguridadElectrica.id, id), isNull(pruebasSeguridadElectrica.informeR2Key), eq(pruebasSeguridadElectrica.estado, "valida")))
      .returning({ id: pruebasSeguridadElectrica.id });
  } catch {
    await env.R2.delete(r2Key).catch(() => {});
    return errorJson(500, "No se pudo guardar el informe. Intenta de nuevo.");
  }
  if (guardadas.length === 0) {
    await env.R2.delete(r2Key).catch(() => {});
    return errorJson(409, "Esta prueba ya tiene informe.");
  }

  const resumen = `Informe adjuntado a la prueba de seguridad eléctrica del ${fechaCorta(p.fecha)} (${p.codigo}): ${nombre}`;
  await logAuditLote(ctx, [
    { entidad: "prueba_electrica", entidadId: id, accion: "update", resumen },
    { entidad: "activo", entidadId: p.activoId, accion: "update", resumen },
  ]);
  return Response.json({ ok: true });
};
