// Anular una prueba de seguridad eléctrica mal registrada (admin y jefe, con
// motivo). La fila y su informe se conservan: la prueba sale de «última» y del
// tablero, y sigue tachada en el equipo y en la bitácora.
import type { APIRoute } from "astro";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { activos, pruebasSeguridadElectrica } from "@/lib/schema";
import { logAuditLote } from "@/lib/audit";
import { ROLES_BIO_GESTIONAR, fechaCorta } from "@/lib/biomedico";
import { errorJson, exigirRol, idPositivo } from "@/lib/seguridad-electrica";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_GESTIONAR);
  if (!user) return response;
  const id = idPositivo(ctx.params.id);
  if (!id) return errorJson(404, "Prueba no encontrada.");

  const body = (await ctx.request.json().catch(() => null)) as { motivo?: unknown } | null;
  const motivo = typeof body?.motivo === "string" ? body.motivo.trim() : "";
  if (motivo.length < 10) return errorJson(400, "Escribe el motivo (al menos 10 letras).");
  if (motivo.length > 1000) return errorJson(400, "El motivo tiene como máximo 1000 letras.");

  const db = getDb(ctx);
  const [prueba] = await db
    .select({ id: pruebasSeguridadElectrica.id, activoId: pruebasSeguridadElectrica.activoId, fecha: pruebasSeguridadElectrica.fecha, estado: pruebasSeguridadElectrica.estado, codigo: activos.codigo })
    .from(pruebasSeguridadElectrica)
    .innerJoin(activos, eq(activos.id, pruebasSeguridadElectrica.activoId))
    .where(eq(pruebasSeguridadElectrica.id, id))
    .limit(1);
  if (!prueba) return errorJson(404, "Prueba no encontrada.");
  if (prueba.estado === "anulada") return errorJson(409, "Esta prueba ya está anulada.");

  // Solo si sigue válida: dos anulaciones a la vez no se pisan.
  const hechas = await db
    .update(pruebasSeguridadElectrica)
    .set({ estado: "anulada", anuladaPor: user.id, anuladaEn: new Date().toISOString(), motivoAnulacion: motivo })
    .where(and(eq(pruebasSeguridadElectrica.id, id), eq(pruebasSeguridadElectrica.estado, "valida")))
    .returning({ id: pruebasSeguridadElectrica.id });
  if (hechas.length === 0) return errorJson(409, "Esta prueba ya está anulada.");

  const motivoCorto = motivo.length > 200 ? `${motivo.slice(0, 199)}…` : motivo;
  const resumen = `Prueba de seguridad eléctrica del ${fechaCorta(prueba.fecha)} anulada en ${prueba.codigo}. Motivo: ${motivoCorto}`;
  await logAuditLote(ctx, [
    { entidad: "prueba_electrica", entidadId: id, accion: "estado", cambios: { estado: { antes: "valida", despues: "anulada" } }, resumen },
    { entidad: "activo", entidadId: prueba.activoId, accion: "update", resumen },
  ]);
  return Response.json({ ok: true });
};
