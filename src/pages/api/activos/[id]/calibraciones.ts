// Calibraciones de un equipo (K-B1). GET: quien ve lo biomédico. POST: admin, jefe y
// técnico registran, con el certificado (PDF o foto) adjunto o sin él.
import type { APIRoute } from "astro";
import { desc, eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { calibraciones, type Calibracion } from "@/lib/schema";
import { logAudit } from "@/lib/audit";
import { ROLES_BIO_REGISTRAR, ROLES_BIO_VER, fechaCorta, hoySV, infoCalibracion } from "@/lib/biomedico";
import { RESULTADO_CALIB_LABEL } from "@/lib/inventario-jci";
import {
  MENSAJES_CAL, advertenciasCalibracion, leerDatosCalibracion, snapshotLaboratorio, validarCalibracion, type ResultadoCal,
} from "@/lib/metrologia";
import {
  borrarObjetoR2, calibracionesDe, equipoCalibracion, errorJson, exigirRol, guardarArchivoEvidencia, idDeRuta,
  laboratorioPorId, leerCuerpo, patronPorId, sincronizarFechasEquipo,
} from "@/lib/metrologia-db";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_VER);
  if (!user) return response;
  const activoId = idDeRuta(ctx.params.id);
  const db = getDb(ctx);
  const equipo = activoId ? await equipoCalibracion(db, activoId) : null;
  if (!equipo) return errorJson("Equipo no encontrado", 404);
  const rows = await db.select().from(calibraciones).where(eq(calibraciones.activoId, equipo.id))
    .orderBy(desc(calibraciones.fechaCalibracion), desc(calibraciones.id));
  return Response.json({ calibraciones: rows, estado: infoCalibracion(equipo, rows, hoySV()) });
};

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_REGISTRAR, "Solo el jefe, el administrador o el técnico registran calibraciones.");
  if (!user) return response;
  const activoId = idDeRuta(ctx.params.id);
  const db = getDb(ctx);
  const equipo = activoId ? await equipoCalibracion(db, activoId) : null;
  if (!equipo) return errorJson("Equipo no encontrado", 404);

  const cuerpo = await leerCuerpo(ctx.request);
  if (!cuerpo.ok) return errorJson(cuerpo.error, 400);
  const d = leerDatosCalibracion(cuerpo.fuente);
  const hoy = hoySV();

  // Patrón de la lista: debe estar marcado como patrón y no estar de baja.
  const patron = d.patronActivoId ? await patronPorId(db, d.patronActivoId) : null;
  const patronValido = d.patronActivoId ? !!patron && patron.esPatron && patron.estado !== "baja" : null;
  const lab = d.laboratorioId ? await laboratorioPorId(db, d.laboratorioId) : null;

  const error = validarCalibracion(d, {
    hoy, equipo: { id: equipo.id, estado: equipo.estado, calibracionNoAplica: equipo.calibracionNoAplica }, patronValido,
  });
  if (error) return errorJson(error, error === MENSAJES_CAL.baja || error === MENSAJES_CAL.noRequiere ? 409 : 400);
  if (d.laboratorioId && !lab) return errorJson(MENSAJES_CAL.laboratorio, 400);
  const fecha = d.fechaCalibracion!;
  const resultado = d.resultado as ResultadoCal;

  const env = getEnv(ctx);
  let archivo: { r2Key: string } | null = null;
  if (cuerpo.file) {
    const g = await guardarArchivoEvidencia(env, `calibraciones/${equipo.id}`, cuerpo.file);
    if (!g.ok) return errorJson(g.error, g.status);
    archivo = g;
  }

  const snap = snapshotLaboratorio(lab, fecha);
  let row: Calibracion | undefined;
  try {
    [row] = await db.insert(calibraciones).values({
      activoId: equipo.id,
      fechaCalibracion: fecha,
      proximaCalibracion: d.proximaCalibracion,
      laboratorioId: lab?.id ?? null,
      laboratorioExterno: d.laboratorioExterno,
      numeroCertificado: d.numeroCertificado,
      patronActivoId: patron?.id ?? null,
      patronReferencia: d.patronReferencia,
      resultado,
      incertidumbre: d.incertidumbre,
      realizadoPor: d.realizadoPor,
      notas: d.notas,
      certificadoR2Key: archivo?.r2Key ?? null,
      usuarioId: user.id,
      labAcreditado: snap.labAcreditado,
      labAcreditacionRef: snap.labAcreditacionRef,
    }).returning();
  } catch (e) {
    if (archivo) await borrarObjetoR2(env, archivo.r2Key);
    throw e;
  }

  const calibs = await sincronizarFechasEquipo(db, equipo.id);
  const laboratorio = lab?.nombre ?? d.laboratorioExterno ?? "sin indicar";
  await logAudit(ctx, {
    entidad: "activo", entidadId: equipo.id, accion: "create",
    resumen: `Calibración registrada: ${fechaCorta(fecha)}, ${RESULTADO_CALIB_LABEL[resultado]}, cert. ${d.numeroCertificado ?? "sin número"}, lab. ${laboratorio}`,
  });

  const advertencias = advertenciasCalibracion({
    fecha, lab, externo: d.laboratorioExterno,
    patron: patron ? { codigo: patron.codigo, calibs: await calibracionesDe(db, patron.id) } : null,
    patronTexto: d.patronReferencia, tieneArchivo: !!archivo, numeroCertificado: d.numeroCertificado,
  });
  return Response.json({ calibracion: row, estado: infoCalibracion(equipo, calibs, hoy), advertencias }, { status: 201 });
};
