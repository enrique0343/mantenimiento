// Corregir o eliminar una calibración ya registrada (K-B2). Solo jefe y administrador,
// siempre con motivo. La bitácora del equipo guarda antes y después; el archivo
// reemplazado o de una calibración borrada no se elimina de R2 (su clave queda anotada).
import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { calibraciones, type Calibracion } from "@/lib/schema";
import { calcularDiff, logAudit } from "@/lib/audit";
import { ROLES_BIO_GESTIONAR, fechaCorta, hoySV, infoCalibracion } from "@/lib/biomedico";
import {
  CAMPOS_CALIBRACION, MENSAJES_CAL, advertenciasCalibracion, errorMotivo, leerDatosCalibracion, snapshotLaboratorio,
  textoLimpio, validarCalibracion, type DatosCalibracion,
} from "@/lib/metrologia";
import {
  borrarObjetoR2, calibracionesDe, equipoCalibracion, errorJson, exigirRol, guardarArchivoEvidencia, idDeRuta,
  laboratorioPorId, leerCuerpo, patronPorId, sincronizarFechasEquipo,
} from "@/lib/metrologia-db";

export const prerender = false;

async function calibracionPorId(db: ReturnType<typeof getDb>, valor: string | undefined): Promise<Calibracion | null> {
  const id = idDeRuta(valor);
  if (!id) return null;
  const [c] = await db.select().from(calibraciones).where(eq(calibraciones.id, id)).limit(1);
  return c ?? null;
}

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_GESTIONAR, "Solo el jefe o el administrador corrigen calibraciones.");
  if (!user) return response;
  const db = getDb(ctx);
  const actual = await calibracionPorId(db, ctx.params.id);
  if (!actual) return errorJson("Calibración no encontrada", 404);

  const cuerpo = await leerCuerpo(ctx.request);
  if (!cuerpo.ok) return errorJson(cuerpo.error, 400);
  const parcial = leerDatosCalibracion(cuerpo.fuente, true);
  const errMotivo = errorMotivo(parcial.motivo, "Escribe el motivo de la corrección (al menos 10 letras).");
  if (errMotivo) return errorJson(errMotivo, 400);
  const motivo = (parcial.motivo ?? "").trim();

  // Solo cuenta lo que cambia de verdad.
  const antes: DatosCalibracion = {
    fechaCalibracion: actual.fechaCalibracion, proximaCalibracion: actual.proximaCalibracion,
    laboratorioId: actual.laboratorioId, laboratorioExterno: actual.laboratorioExterno, numeroCertificado: actual.numeroCertificado,
    patronActivoId: actual.patronActivoId, patronReferencia: actual.patronReferencia, resultado: actual.resultado,
    incertidumbre: actual.incertidumbre, realizadoPor: actual.realizadoPor, notas: actual.notas,
  };
  const cambios: Record<string, unknown> = {};
  for (const k of CAMPOS_CALIBRACION) {
    if (parcial[k] !== undefined && parcial[k] !== antes[k]) cambios[k] = parcial[k];
  }
  if (Object.keys(cambios).length === 0 && !cuerpo.file) return errorJson("No hay cambios que guardar.", 400);
  const nuevo = { ...antes, ...cambios } as DatosCalibracion;

  const equipo = await equipoCalibracion(db, actual.activoId);
  if (!equipo) return errorJson("Equipo no encontrado", 404);
  const patron = nuevo.patronActivoId ? await patronPorId(db, nuevo.patronActivoId) : null;
  // El patrón se revisa solo si se cambia: uno que ya no está en la lista se conserva al corregir otra cosa.
  const patronValido = cambios.patronActivoId != null ? !!patron && patron.esPatron && patron.estado !== "baja" : null;
  const lab = nuevo.laboratorioId ? await laboratorioPorId(db, nuevo.laboratorioId) : null;
  const hoy = hoySV();
  const error = validarCalibracion(nuevo, {
    hoy, equipo: { id: equipo.id, estado: equipo.estado, calibracionNoAplica: equipo.calibracionNoAplica }, patronValido, correccion: true,
  });
  if (error) return errorJson(error, 400);
  if (nuevo.laboratorioId && !lab) return errorJson(MENSAJES_CAL.laboratorio, 400);
  const fecha = nuevo.fechaCalibracion!;

  const env = getEnv(ctx);
  let archivo: { r2Key: string } | null = null;
  if (cuerpo.file) {
    const g = await guardarArchivoEvidencia(env, `calibraciones/${actual.activoId}`, cuerpo.file);
    if (!g.ok) return errorJson(g.error, g.status);
    archivo = g;
  }

  const aplicar: Record<string, unknown> = { ...cambios };
  if (archivo) aplicar.certificadoR2Key = archivo.r2Key;
  // La copia de la acreditación se recalcula solo si cambia el laboratorio o la fecha.
  if ("laboratorioId" in cambios || "laboratorioExterno" in cambios || "fechaCalibracion" in cambios) {
    Object.assign(aplicar, snapshotLaboratorio(lab, fecha));
  }
  const diff = calcularDiff(actual as unknown as Record<string, unknown>, aplicar);

  let row: Calibracion | undefined;
  try {
    [row] = await db.update(calibraciones)
      .set({ ...(aplicar as Partial<Calibracion>), corregidaEn: new Date().toISOString(), corregidaPor: user.id })
      .where(eq(calibraciones.id, actual.id)).returning();
  } catch (e) {
    if (archivo) await borrarObjetoR2(env, archivo.r2Key);
    throw e;
  }

  const calibs = await sincronizarFechasEquipo(db, actual.activoId);
  await logAudit(ctx, {
    entidad: "activo", entidadId: actual.activoId, accion: "update", cambios: diff,
    resumen: `Calibración del ${fechaCorta(actual.fechaCalibracion)} corregida — ${motivo}`,
  });

  const advertencias = advertenciasCalibracion({
    fecha, lab, externo: nuevo.laboratorioExterno,
    patron: patron ? { codigo: patron.codigo, calibs: await calibracionesDe(db, patron.id) } : null,
    patronTexto: nuevo.patronReferencia, tieneArchivo: !!(archivo || actual.certificadoR2Key), numeroCertificado: nuevo.numeroCertificado,
  });
  return Response.json({ calibracion: row, estado: infoCalibracion(equipo, calibs, hoy), advertencias });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_GESTIONAR, "Solo el jefe o el administrador eliminan calibraciones.");
  if (!user) return response;
  const db = getDb(ctx);
  const actual = await calibracionPorId(db, ctx.params.id);
  if (!actual) return errorJson("Calibración no encontrada", 404);

  const body = (await ctx.request.json().catch(() => null)) as { motivo?: unknown } | null;
  const motivo = textoLimpio(body?.motivo) ?? textoLimpio(ctx.url.searchParams.get("motivo"));
  const errMotivo = errorMotivo(motivo, "Escribe el motivo para eliminar la calibración (al menos 10 letras).");
  if (errMotivo) return errorJson(errMotivo, 400);

  await db.delete(calibraciones).where(eq(calibraciones.id, actual.id));
  const calibs = await sincronizarFechasEquipo(db, actual.activoId);
  // Copia completa en la bitácora (el certificado sigue en R2 con esta clave).
  const copia = Object.fromEntries(
    Object.entries(actual)
      .filter(([k, v]) => k !== "activoId" && v !== null && v !== undefined && v !== "")
      .map(([k, v]) => [k, { antes: v, despues: null }]),
  );
  await logAudit(ctx, {
    entidad: "activo", entidadId: actual.activoId, accion: "delete", cambios: copia,
    resumen: `Calibración del ${fechaCorta(actual.fechaCalibracion)} eliminada — ${motivo}`,
  });
  const equipo = await equipoCalibracion(db, actual.activoId);
  return Response.json({ ok: true, estado: equipo ? infoCalibracion(equipo, calibs, hoySV()) : null });
};
