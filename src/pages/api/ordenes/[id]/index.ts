import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { ordenes, activos, usuarios, comentarios, adjuntos, planesMantenimiento, tickets, actividades, movimientosInventario, extintorEventos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { aplicarCambioOrden } from "@/lib/orden-cambio";
import { leerVerificacionOrden, leerOrigenesRondaOrden } from "@/lib/orden-verificacion";
import { logAudit } from "@/lib/audit";
import { validarContextoArea } from "@/lib/ordenes";
import { ordenesTienenConjunto, MENSAJE_ORDEN_TRAZADA } from "@/lib/trazabilidad-conjuntos";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);

  // D1 corta el resultado a 100 columnas: ordenes(62) + activos(45) se pasa.
  const [row] = await db
    .select({ orden: ordenes, activo: { id: activos.id, codigo: activos.codigo, nombre: activos.nombre }, asignado: { id: usuarios.id, nombre: usuarios.nombre } })
    .from(ordenes)
    .leftJoin(activos, eq(activos.id, ordenes.activoId))
    .leftJoin(usuarios, eq(usuarios.id, ordenes.asignadoA))
    .where(eq(ordenes.id, id))
    .limit(1);
  if (!row) return Response.json({ error: "No encontrado" }, { status: 404 });

  const contextError = validarContextoArea(ctx.request, row.orden.rubro);
  if (contextError) return contextError;

  const coms = await db
    .select({ c: comentarios, u: { id: usuarios.id, nombre: usuarios.nombre } })
    .from(comentarios)
    .leftJoin(usuarios, eq(usuarios.id, comentarios.usuarioId))
    .where(eq(comentarios.ordenId, id))
    .orderBy(comentarios.id);

  const adjs = await db.select().from(adjuntos).where(eq(adjuntos.ordenId, id));

  const verificacion = await leerVerificacionOrden(db, id);
  const roundsOrigins = await leerOrigenesRondaOrden(db, id);
  const [plan] = row.orden.planId ? await db.select().from(planesMantenimiento).where(eq(planesMantenimiento.id, row.orden.planId)).limit(1) : [];
  const scheduledPM = plan ? { id: plan.id, assetId: plan.activoId, title: plan.titulo, frequency: plan.frecuencia, nextDate: plan.proximaFecha, href: `/activos/${plan.activoId}#plan-${plan.id}` } : null;
  return Response.json({
    verificacion, roundsOrigins, scheduledPM,
    orden: {
      ...row.orden,
      activo: row.activo ? { id: row.activo.id, codigo: row.activo.codigo, nombre: row.activo.nombre } : null,
      asignado: row.asignado ? { id: row.asignado.id, nombre: row.asignado.nombre } : null,
    },
    comentarios: coms.map((r) => ({
      ...r.c,
      autor: r.u ? { id: r.u.id, nombre: r.u.nombre } : null,
    })),
    adjuntos: adjs,
  });
};

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  return aplicarCambioOrden(ctx, user, id, body);
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  const env = (ctx.locals as any).runtime?.env;
  const [ot] = await db.select().from(ordenes).where(eq(ordenes.id, id)).limit(1);
  if (!ot) return Response.json({ error: "No encontrada" }, { status: 404 });

  const contextError = validarContextoArea(ctx.request, ot.rubro);
  if (contextError) return contextError;

  if (await ordenesTienenConjunto(ctx, [id])) {
    return Response.json({ error: MENSAJE_ORDEN_TRAZADA }, { status: 409 });
  }

  // Los archivos se retiran únicamente después de que la base confirme el
  // borrado. Una asociación concurrente a un conjunto debe preservar todo.
  const historial = await leerVerificacionOrden(db, id);
  if (historial.eventos.length) return Response.json({ error: "La orden conserva evidencia de ejecución/verificación. Cancélala con motivo; no se puede eliminar su historial." }, { status: 409 });
  const adjs = await db.select().from(adjuntos).where(eq(adjuntos.ordenId, id));
  try {
    await db.batch([
      db.update(tickets).set({ otId: null }).where(eq(tickets.otId, id)),
      db.update(movimientosInventario).set({ ordenId: null }).where(eq(movimientosInventario.ordenId, id)),
      db.update(extintorEventos).set({ otId: null }).where(eq(extintorEventos.otId, id)),
      db.delete(ordenes).where(eq(ordenes.id, id)),
    ]);
  } catch (e: any) {
    if (await ordenesTienenConjunto(ctx, [id])) return Response.json({ error: MENSAJE_ORDEN_TRAZADA }, { status: 409 });
    return Response.json({ error: `No se pudo borrar: ${e?.message ?? e}` }, { status: 500 });
  }

  if (adjs.length && env?.R2) await Promise.allSettled(adjs.map((a) => env.R2.delete(a.r2Key)));
  await logAudit(ctx, { entidad: "orden", entidadId: id, accion: "delete", resumen: `OT eliminada: "${ot.titulo}"` });

  if (ot.planId) {
    try { await db.update(planesMantenimiento).set({ ultimaGeneracion: null }).where(eq(planesMantenimiento.id, ot.planId)); } catch {}
  }
  if (ot.actividadId) {
    try { await db.update(actividades).set({ ultimaGeneracion: null }).where(eq(actividades.id, ot.actividadId)); } catch {}
  }
  return Response.json({ ok: true });
};
