// Editar o anular una licencia (admin y jefe) y eliminarla (solo admin). Fase 59 · WP-D.
// Una reemplazada o anulada ya no se edita. Cuando una renovación en trámite pasa a
// «Activa», la anterior queda «Reemplazada» en el mismo lote.
import type { APIRoute } from "astro";
import { and, eq, sql } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { licenciaArchivos, licencias } from "@/lib/schema";
import { calcularDiff, logAudit, resumenCambios } from "@/lib/audit";
import { ROLES_BIO_GESTIONAR } from "@/lib/biomedico";
import { codigoLicencia, validarLicencia } from "@/lib/licencias";
import { completarReferenciasLicencia } from "@/lib/bio-consultas";
import { borrarArchivoR2, errorJson, exigirRol, idPositivo, leerJson } from "@/lib/bio-archivos";

export const prerender = false;

const columnas = {
  id: licencias.id, entidad: licencias.entidad, entidadOtra: licencias.entidadOtra, tipo: licencias.tipo, nombre: licencias.nombre,
  numero: licencias.numero, ambito: licencias.ambito, sucursalId: licencias.sucursalId, servicio: licencias.servicio,
  activoId: licencias.activoId, titular: licencias.titular, fechaEmision: licencias.fechaEmision,
  fechaVencimiento: licencias.fechaVencimiento, responsableId: licencias.responsableId, estado: licencias.estado,
  reemplazaAId: licencias.reemplazaAId, notas: licencias.notas,
};

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_GESTIONAR, "Solo el jefe o el administrador editan licencias.");
  if (!user) return response;
  const id = idPositivo(ctx.params.id);
  const db = getDb(ctx);
  const [actual] = id ? await db.select(columnas).from(licencias).where(eq(licencias.id, id)).limit(1) : [];
  if (!actual) return errorJson(404, "Licencia no encontrada");
  if (actual.estado === "reemplazada" || actual.estado === "anulada") return errorJson(409, "Esta licencia ya no se puede editar.");
  const body = await leerJson(ctx);
  if (!body) return errorJson(400, "Datos no válidos.");
  const codigo = codigoLicencia(actual.id);

  if (body.accion === "anular") {
    const motivo = String(body.motivo ?? "").replace(/\s+/g, " ").trim();
    if (motivo.length < 5) return errorJson(400, "Escribe el motivo (al menos 5 letras).");
    if (motivo.length > 300) return errorJson(400, "El motivo es muy largo (máx. 300 caracteres).");
    const [licencia] = await db.update(licencias)
      .set({ estado: "anulada", updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(licencias.id, actual.id)).returning();
    await logAudit(ctx, {
      entidad: "licencia", entidadId: actual.id, accion: "estado",
      cambios: { estado: { antes: actual.estado, despues: "anulada" } },
      resumen: `Licencia anulada: ${codigo} — ${motivo}`,
    });
    return Response.json({ licencia });
  }

  const v = validarLicencia(body, { modo: "editar", estadoActual: actual.estado });
  if (!v.ok) return errorJson(400, v.error);
  // El equipo que ya tenía vale aunque se haya dado de baja; cambiar a otro equipo de baja, no (409).
  const ref = await completarReferenciasLicencia(db, v.datos, actual.activoId);
  if (!ref.ok) return errorJson(ref.status, ref.error);
  const datos = ref.datos;

  const pasaAActiva = actual.estado === "en_tramite" && datos.estado === "activa";
  const [anterior] = pasaAActiva && actual.reemplazaAId
    ? await db.select({ id: licencias.id, estado: licencias.estado }).from(licencias).where(eq(licencias.id, actual.reemplazaAId)).limit(1)
    : [];
  const cambios = calcularDiff(actual, { ...datos });
  let licencia;
  let reemplazo = false;
  if (anterior && anterior.estado === "activa") {
    const [editadas, actualizadas] = await db.batch([
      db.update(licencias).set({ ...datos, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(licencias.id, actual.id)).returning(),
      db.update(licencias).set({ estado: "reemplazada", updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(licencias.id, anterior.id), eq(licencias.estado, "activa")))
        .returning({ id: licencias.id }),
    ]);
    licencia = editadas[0];
    reemplazo = actualizadas.length > 0;
  } else {
    [licencia] = await db.update(licencias).set({ ...datos, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(licencias.id, actual.id)).returning();
  }
  await logAudit(ctx, {
    entidad: "licencia", entidadId: actual.id, accion: "update", cambios,
    resumen: `Licencia modificada: ${codigo} — ${resumenCambios(cambios)}${pasaAActiva ? " · pasó a «Activa»" : ""}`,
  });
  if (anterior && reemplazo) {
    await logAudit(ctx, { entidad: "licencia", entidadId: anterior.id, accion: "estado", resumen: `Reemplazada por ${codigo}` });
  }
  return Response.json({ licencia });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ["admin"], "Solo el administrador elimina licencias.");
  if (!user) return response;
  const id = idPositivo(ctx.params.id);
  const db = getDb(ctx);
  const [actual] = id
    ? await db.select({ id: licencias.id, nombre: licencias.nombre, estado: licencias.estado, reemplazaAId: licencias.reemplazaAId })
      .from(licencias).where(eq(licencias.id, id)).limit(1)
    : [];
  if (!actual) return errorJson(404, "Licencia no encontrada");
  const archivos = await db.select({ r2Key: licenciaArchivos.r2Key }).from(licenciaArchivos).where(eq(licenciaArchivos.licenciaId, actual.id));
  const [anterior] = actual.estado === "activa" && actual.reemplazaAId
    ? await db.select({ id: licencias.id, estado: licencias.estado }).from(licencias).where(eq(licencias.id, actual.reemplazaAId)).limit(1)
    : [];
  const codigo = codigoLicencia(actual.id);
  const restaurar = anterior?.estado === "reemplazada";
  if (anterior && restaurar) {
    await db.batch([
      db.delete(licencias).where(eq(licencias.id, actual.id)),
      db.update(licencias).set({ estado: "activa", updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(licencias.id, anterior.id), eq(licencias.estado, "reemplazada"))),
    ]);
  } else {
    await db.delete(licencias).where(eq(licencias.id, actual.id));
  }
  const env = getEnv(ctx);
  for (const a of archivos) await borrarArchivoR2(env, a.r2Key);
  await logAudit(ctx, { entidad: "licencia", entidadId: actual.id, accion: "delete", resumen: `Licencia eliminada: ${codigo} — ${actual.nombre}` });
  if (anterior && restaurar) {
    await logAudit(ctx, { entidad: "licencia", entidadId: anterior.id, accion: "estado", resumen: `Vuelve a «Activa»: se eliminó su renovación ${codigo}` });
  }
  return Response.json({ ok: true });
};
