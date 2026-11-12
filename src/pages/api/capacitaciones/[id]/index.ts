// Editar una capacitación (admin, jefe y técnico) y eliminarla (admin y jefe).
// Fase 59 · WP-D. La edición reemplaza asistentes y equipos en un solo lote.
import type { APIRoute } from "astro";
import { eq, sql } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { capacitacionArchivos, capacitacionAsistentes, capacitacionEquipos, capacitaciones } from "@/lib/schema";
import { calcularDiff, logAudit, resumenCambios } from "@/lib/audit";
import { ROLES_BIO_GESTIONAR, ROLES_BIO_REGISTRAR } from "@/lib/biomedico";
import { codigoCapacitacion, validarCapacitacion } from "@/lib/capacitaciones";
import { insercionesCapacitacion, revisarReferenciasCapacitacion } from "@/lib/bio-consultas";
import { borrarArchivoR2, errorJson, exigirRol, idPositivo, leerJson } from "@/lib/bio-archivos";

export const prerender = false;

const columnas = {
  id: capacitaciones.id, fecha: capacitaciones.fecha, tema: capacitaciones.tema, tipo: capacitaciones.tipo,
  instructorTipo: capacitaciones.instructorTipo, instructorNombre: capacitaciones.instructorNombre,
  proveedorId: capacitaciones.proveedorId, instructorEntidad: capacitaciones.instructorEntidad,
  modeloCubierto: capacitaciones.modeloCubierto, duracionMinutos: capacitaciones.duracionMinutos,
  sucursalId: capacitaciones.sucursalId, lugar: capacitaciones.lugar, servicio: capacitaciones.servicio, notas: capacitaciones.notas,
  asistentes: sql<number>`(SELECT COUNT(*) FROM capacitacion_asistentes a WHERE a.capacitacion_id = ${capacitaciones.id})`,
  equipos: sql<number>`(SELECT COUNT(*) FROM capacitacion_equipos e WHERE e.capacitacion_id = ${capacitaciones.id})`,
};

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_REGISTRAR, "Solo el administrador, el jefe o el técnico editan capacitaciones.");
  if (!user) return response;
  const id = idPositivo(ctx.params.id);
  const db = getDb(ctx);
  const [actual] = id ? await db.select(columnas).from(capacitaciones).where(eq(capacitaciones.id, id)).limit(1) : [];
  if (!actual) return errorJson(404, "Capacitación no encontrada");
  const body = await leerJson(ctx);
  if (!body) return errorJson(400, "Datos no válidos.");
  const v = validarCapacitacion(body);
  if (!v.ok) return Response.json({ error: v.error, ...(v.errores ? { errores: v.errores } : {}) }, { status: 400 });
  // Los equipos que ya estaban enlazados valen aunque después se hayan pasado a otra área o se
  // hayan dado de baja; sumar un equipo de baja que no estaba, no (409).
  const ref = await revisarReferenciasCapacitacion(db, v.datos, v.equipoIds, actual.id);
  if (ref) return errorJson(ref.status, ref.error);

  await db.batch([
    db.update(capacitaciones).set({ ...v.datos, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(capacitaciones.id, actual.id)),
    db.delete(capacitacionAsistentes).where(eq(capacitacionAsistentes.capacitacionId, actual.id)),
    db.delete(capacitacionEquipos).where(eq(capacitacionEquipos.capacitacionId, actual.id)),
    ...insercionesCapacitacion(db, actual.id, v.asistentes, v.equipoIds),
  ] as [any, ...any[]]);

  const { asistentes: antesAsistentes, equipos: antesEquipos, ...antes } = actual;
  const cambios = calcularDiff(antes, { ...v.datos });
  const partes = [resumenCambios(cambios)];
  if (Number(antesAsistentes) !== v.asistentes.length) partes.push(`Asistentes: ${Number(antesAsistentes)} → ${v.asistentes.length}`);
  if (Number(antesEquipos) !== v.equipoIds.length) partes.push(`Equipos: ${Number(antesEquipos)} → ${v.equipoIds.length}`);
  await logAudit(ctx, {
    entidad: "capacitacion", entidadId: actual.id, accion: "update", cambios,
    resumen: `Capacitación modificada: ${codigoCapacitacion(actual.id)} — ${partes.join(" · ")}`,
  });
  return Response.json({ capacitacion: { id: actual.id } });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_GESTIONAR, "Solo el jefe o el administrador eliminan capacitaciones.");
  if (!user) return response;
  const id = idPositivo(ctx.params.id);
  const db = getDb(ctx);
  const [actual] = id
    ? await db.select({ id: capacitaciones.id, tema: capacitaciones.tema, fecha: capacitaciones.fecha }).from(capacitaciones).where(eq(capacitaciones.id, id)).limit(1)
    : [];
  if (!actual) return errorJson(404, "Capacitación no encontrada");
  const archivos = await db.select({ r2Key: capacitacionArchivos.r2Key }).from(capacitacionArchivos).where(eq(capacitacionArchivos.capacitacionId, actual.id));
  await db.delete(capacitaciones).where(eq(capacitaciones.id, actual.id));
  const env = getEnv(ctx);
  for (const a of archivos) await borrarArchivoR2(env, a.r2Key);
  await logAudit(ctx, {
    entidad: "capacitacion", entidadId: actual.id, accion: "delete",
    resumen: `Capacitación eliminada: ${codigoCapacitacion(actual.id)} — ${actual.tema} (${actual.fecha})`,
  });
  return Response.json({ ok: true });
};
