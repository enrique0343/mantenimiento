// Modo técnico · una foto, una sola vez aunque la red obligue a reintentar.
import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { puedeUsarCampo } from "@/lib/campo";
import { adjuntos, campoOperaciones, ordenes, ordenVerificacion } from "@/lib/schema";
import { esRevisorOrden, horaDeAdjunto } from "@/lib/orden-verificacion";

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
  if (previa) return Response.json({ ok: previa.resultado === "ok", repetida: true, error: previa.resultado === "ok" ? undefined : previa.detalle });

  const recibido = new Date().toISOString();
  const rechazar = async (mensaje: string, status: number) => {
    await db.insert(campoOperaciones).values({ opId, usuarioId: user.id, tipo: "foto", ordenId: Number.isInteger(ordenId) ? ordenId : null, capturadoEn: at || recibido, recibidoEn: recibido, resultado: "rechazada", detalle: mensaje }).onConflictDoNothing();
    return Response.json({ ok: false, error: mensaje }, { status });
  };
  if (!Number.isInteger(ordenId) || ordenId <= 0) return rechazar("Orden inválida.", 400);
  if (!(file instanceof File)) return rechazar("Falta la foto.", 400);
  if (file.size > MAX_BYTES) return rechazar("La foto supera 10 MB.", 413);
  const [order] = await db.select().from(ordenes).where(eq(ordenes.id, ordenId)).limit(1);
  if (!order) return rechazar("La orden ya no existe.", 404);
  if (["cerrada", "cancelada"].includes(order.estado)) return rechazar("La orden ya está cerrada: la foto no se agregó.", 409);
  const [control] = await db.select().from(ordenVerificacion).where(eq(ordenVerificacion.ordenId, ordenId)).limit(1);
  const revisor = esRevisorOrden(user, control);
  if (user.rol === "tecnico" && order.asignadoA && order.asignadoA !== user.id && !revisor) return rechazar("Esta orden está asignada a otra persona.", 403);
  if (["completada", "verificada"].includes(order.estado) && !revisor) return rechazar("La ejecución ya se envió a verificación: la foto no se agregó.", 409);

  const seguro = (file.name || "foto.jpg").replace(/[^a-zA-Z0-9._-]/g, "_");
  const r2Key = `ordenes/${ordenId}/${categoria}/${Date.now()}-${crypto.randomUUID()}-${seguro}`;
  await getEnv(ctx).R2.put(r2Key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || "image/jpeg" } });
  const [fila] = await db.insert(adjuntos).values({ ordenId, usuarioId: user.id, nombre: file.name || "foto.jpg", contentType: file.type || "image/jpeg", tamano: file.size, r2Key, categoria, createdAt: horaDeAdjunto() }).returning();
  await db.insert(campoOperaciones).values({ opId, usuarioId: user.id, tipo: "foto", ordenId, capturadoEn: at || recibido, recibidoEn: recibido, resultado: "ok", detalle: JSON.stringify({ adjuntoId: fila.id }) }).onConflictDoNothing();
  return Response.json({ ok: true, adjuntoId: fila.id }, { status: 201 });
};
