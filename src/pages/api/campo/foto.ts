// Modo técnico · una foto, una sola vez aunque la red obligue a reintentar.
import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { puedeUsarCampo } from "@/lib/campo";
import { campoOperaciones, ordenVerificacion } from "@/lib/schema";
import { esRevisorOrden, horaDeAdjunto } from "@/lib/orden-verificacion";
import { ErrorAlcanceOrden, guardAlcanceD1, leerOrdenConAlcance } from "@/lib/orden-alcance";

export const prerender = false;

const MAX_BYTES = 10 * 1024 * 1024;

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeUsarCampo(user.rol)) return new Response("Sin permisos", { status: 403 });
  const form = await ctx.request.formData().catch(() => null);
  if (!form) return Response.json({ ok: false, error: "Datos inválidos" }, { status: 400 });
  const opId = String(form.get("opId") ?? "");
  const ordenId = Number(form.get("ordenId"));
  const file = form.get("file");
  const categoriaRaw = String(form.get("categoria") ?? "general");
  const categoria = (["antes", "despues", "general"] as const).find((c) => c === categoriaRaw) ?? "general";
  const at = String(form.get("at") ?? "").slice(0, 40);
  if (opId.length < 8 || opId.length > 80) return Response.json({ ok: false, error: "Operación sin identificador" }, { status: 400 });

  const db = getDb(ctx);
  const [previa] = await db.select().from(campoOperaciones).where(eq(campoOperaciones.opId, opId)).limit(1);
  if (previa) {
    if (previa.usuarioId !== user.id) return Response.json({ ok: false, error: "Identificador de operación no disponible." }, { status: 409 });
    return Response.json({ ok: previa.resultado === "ok", repetida: true, error: previa.resultado === "ok" ? undefined : previa.detalle });
  }

  const recibido = new Date().toISOString();
  const rechazar = async (mensaje: string, status: number) => {
    // El rechazo pertenece a la cola del usuario; no agrega evidencia a una
    // orden que pudo cambiar de espacio mientras se enviaba la foto.
    await db.insert(campoOperaciones).values({ opId, usuarioId: user.id, tipo: "foto", ordenId: null, capturadoEn: at || recibido, recibidoEn: recibido, resultado: "rechazada", detalle: mensaje }).onConflictDoNothing();
    return Response.json({ ok: false, error: mensaje }, { status });
  };
  if (!Number.isInteger(ordenId) || ordenId <= 0) return rechazar("Orden inválida.", 400);
  if (!(file instanceof File)) return rechazar("Falta la foto.", 400);
  if (file.size > MAX_BYTES) return rechazar("La foto supera 10 MB.", 413);
  let acceso: Awaited<ReturnType<typeof leerOrdenConAlcance>>;
  try { acceso = await leerOrdenConAlcance(db, ordenId, user); }
  catch (error) {
    if (error instanceof ErrorAlcanceOrden) return rechazar(error.message, error.status);
    throw error;
  }
  const order = acceso.orden;
  if (["cerrada", "cancelada"].includes(order.estado)) return rechazar("La orden ya está cerrada: la foto no se agregó.", 409);
  const [control] = await db.select().from(ordenVerificacion).where(eq(ordenVerificacion.ordenId, ordenId)).limit(1);
  const revisor = esRevisorOrden(user, control);
  if (user.rol === "tecnico" && order.asignadoA && order.asignadoA !== user.id && !revisor) return rechazar("Esta orden está asignada a otra persona.", 403);
  if (["completada", "verificada"].includes(order.estado) && !revisor) return rechazar("La ejecución ya se envió a verificación: la foto no se agregó.", 409);

  const seguro = (file.name || "foto.jpg").replace(/[^a-zA-Z0-9._-]/g, "_");
  const r2Key = `ordenes/${ordenId}/${categoria}/${Date.now()}-${crypto.randomUUID()}-${seguro}`;
  const env = getEnv(ctx);
  await env.R2.put(r2Key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || "image/jpeg" } });
  try {
    const vigente = guardAlcanceD1(db, acceso.guard);
    const resultado = await env.DB.batch([
      env.DB.prepare(`INSERT INTO adjuntos(orden_id,usuario_id,nombre,content_type,tamano,r2_key,categoria,created_at)
        SELECT ?,?,?,?,?,?,?,? WHERE (${vigente.sql})
        AND NOT EXISTS(SELECT 1 FROM campo_operaciones WHERE op_id=?) RETURNING id`)
        .bind(ordenId,user.id,file.name || "foto.jpg",file.type || "image/jpeg",file.size,r2Key,categoria,horaDeAdjunto(),...vigente.params,opId),
      env.DB.prepare(`INSERT INTO campo_operaciones(op_id,usuario_id,tipo,orden_id,capturado_en,recibido_en,resultado,detalle)
        SELECT ?,?,'foto',?,?,?,'ok',json_object('adjuntoId',id) FROM adjuntos WHERE r2_key=? AND changes()=1`)
        .bind(opId,user.id,ordenId,at || recibido,recibido,r2Key),
    ]);
    const fila = resultado[0].results[0] as { id: number } | undefined;
    if (!fila) {
      await env.R2.delete(r2Key).catch(() => {});
      const [confirmada] = await db.select().from(campoOperaciones).where(eq(campoOperaciones.opId, opId)).limit(1);
      if (confirmada?.usuarioId === user.id && confirmada.ordenId === ordenId && confirmada.resultado === "ok") {
        return Response.json({ ok: true, repetida: true });
      }
      return rechazar("La orden cambió mientras se enviaba la foto. Actualiza la ficha.", 409);
    }
    return Response.json({ ok: true, adjuntoId: fila.id }, { status: 201 });
  } catch {
    await env.R2.delete(r2Key).catch(() => {});
    return Response.json({ ok: false, error: "No se pudo guardar la foto. Intenta de nuevo." }, { status: 500 });
  }
};
