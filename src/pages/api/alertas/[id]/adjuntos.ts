import type { APIRoute } from "astro";
import { and, eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { alertaAdjuntos, alertasEquipo } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { ROLES_BIO_GESTIONAR, ROLES_BIO_REGISTRAR, nombreSeguroR2, validarArchivo } from "@/lib/biomedico";
import { CATEGORIAS_ADJUNTO_ALERTA, CATEGORIA_ADJUNTO_ALERTA_LABEL, type CategoriaAdjuntoAlerta } from "@/lib/alertas";

export const prerender = false;

const idDe = (v: string | null | undefined) => {
  const id = Number(v);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/**
 * Sube el boletín, la evaluación o la evidencia de la acción (admin, jefe, técnico).
 * Multipart: `archivo` y `categoria`. El tipo se detecta por los primeros bytes.
 */
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ROLES_BIO_REGISTRAR);
  if (!user) return response;
  const id = idDe(ctx.params.id);
  if (!id) return Response.json({ error: "Alerta no válida." }, { status: 400 });
  const db = getDb(ctx);
  const [alerta] = await db.select({ id: alertasEquipo.id, estado: alertasEquipo.estado }).from(alertasEquipo).where(eq(alertasEquipo.id, id)).limit(1);
  if (!alerta) return Response.json({ error: "Alerta no encontrada." }, { status: 404 });
  if (alerta.estado === "cerrada") return Response.json({ error: "La alerta está cerrada: reábrela para agregar archivos." }, { status: 409 });

  const form = await ctx.request.formData().catch(() => null);
  if (!form) return Response.json({ error: "Adjunta el archivo." }, { status: 400 });
  const categoria = String(form.get("categoria") ?? "boletin");
  if (!(CATEGORIAS_ADJUNTO_ALERTA as readonly string[]).includes(categoria)) return Response.json({ error: "Categoría no válida." }, { status: 400 });
  const archivo = form.get("archivo") ?? form.get("file");
  if (!archivo || typeof archivo === "string") return Response.json({ error: "Adjunta el archivo." }, { status: 400 });
  const file = archivo as File;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const v = validarArchivo({ tamano: file.size, cabecera: bytes.subarray(0, 1024) });
  if (!v.ok) return Response.json({ error: v.error }, { status: v.status });

  const nombre = (file.name || `archivo.${v.extension}`).slice(0, 200);
  const r2Key = `alertas/${id}/${Date.now()}-${crypto.randomUUID()}-${nombreSeguroR2(nombre)}`;
  const env = getEnv(ctx);
  await env.R2.put(r2Key, bytes, { httpMetadata: { contentType: v.contentType } });
  let adjunto;
  try {
    [adjunto] = await db.insert(alertaAdjuntos).values({
      alertaId: id, categoria: categoria as CategoriaAdjuntoAlerta, nombre, contentType: v.contentType,
      tamano: file.size, r2Key, usuarioId: user.id,
    }).returning();
  } catch (e) {
    console.error("alerta: adjunto", e);
    await env.R2.delete(r2Key).catch(() => {});
    return Response.json({ error: "No se pudo guardar el archivo. Intenta de nuevo." }, { status: 500 });
  }
  await logAudit(ctx, {
    entidad: "alerta", entidadId: id, accion: "update",
    resumen: `Archivo agregado: ${nombre} (${CATEGORIA_ADJUNTO_ALERTA_LABEL[categoria as CategoriaAdjuntoAlerta]})`,
  });
  return Response.json({ adjunto }, { status: 201 });
};

/** Quita un archivo (?adjuntoId=) de una alerta no cerrada (admin, jefe). */
export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ROLES_BIO_GESTIONAR);
  if (!user) return response;
  const id = idDe(ctx.params.id);
  const adjuntoId = idDe(ctx.url.searchParams.get("adjuntoId"));
  if (!id || !adjuntoId) return Response.json({ error: "Archivo no válido." }, { status: 400 });
  const db = getDb(ctx);
  const [alerta] = await db.select({ estado: alertasEquipo.estado }).from(alertasEquipo).where(eq(alertasEquipo.id, id)).limit(1);
  if (!alerta) return Response.json({ error: "Alerta no encontrada." }, { status: 404 });
  if (alerta.estado === "cerrada") return Response.json({ error: "La alerta está cerrada: reábrela para quitar archivos." }, { status: 409 });
  const [adj] = await db.select({ id: alertaAdjuntos.id, nombre: alertaAdjuntos.nombre, r2Key: alertaAdjuntos.r2Key })
    .from(alertaAdjuntos).where(and(eq(alertaAdjuntos.id, adjuntoId), eq(alertaAdjuntos.alertaId, id))).limit(1);
  if (!adj) return Response.json({ error: "Archivo no encontrado." }, { status: 404 });
  await db.delete(alertaAdjuntos).where(eq(alertaAdjuntos.id, adj.id));
  try { await getEnv(ctx).R2.delete(adj.r2Key); } catch (e) { console.error("alerta: R2", adj.r2Key, e); }
  await logAudit(ctx, { entidad: "alerta", entidadId: id, accion: "update", resumen: `Archivo quitado: ${adj.nombre}` });
  return Response.json({ ok: true });
};
