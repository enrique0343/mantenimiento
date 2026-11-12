// Certificado de una calibración (K-B3). GET: lo ve quien ve lo biomédico, en línea y sin
// que el navegador adivine el tipo. POST: admin, jefe o técnico adjuntan el que falta; uno
// que ya existe solo lo cambia el jefe con «Corregir».
import type { APIRoute } from "astro";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { calibraciones } from "@/lib/schema";
import { logAudit } from "@/lib/audit";
import { ROLES_BIO_REGISTRAR, ROLES_BIO_VER, fechaCorta, hoySV, infoCalibracion, nombreSeguroR2 } from "@/lib/biomedico";
import {
  borrarObjetoR2, equipoCalibracion, errorJson, exigirRol, guardarArchivoEvidencia, idDeRuta, leerCuerpo,
  respuestaArchivoR2, sincronizarFechasEquipo,
} from "@/lib/metrologia-db";

export const prerender = false;

const YA_TIENE = "Esta calibración ya tiene certificado. Para cambiarlo, el jefe usa «Corregir».";

async function calibracion(db: ReturnType<typeof getDb>, valor: string | undefined) {
  const id = idDeRuta(valor);
  if (!id) return null;
  const [c] = await db.select({
    id: calibraciones.id, activoId: calibraciones.activoId, fechaCalibracion: calibraciones.fechaCalibracion,
    numeroCertificado: calibraciones.numeroCertificado, certificadoR2Key: calibraciones.certificadoR2Key,
  }).from(calibraciones).where(eq(calibraciones.id, id)).limit(1);
  return c ?? null;
}

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_VER);
  if (!user) return response;
  const cal = await calibracion(getDb(ctx), ctx.params.id);
  if (!cal?.certificadoR2Key) return errorJson("Certificado no encontrado", 404);
  // certificado-calibracion-{número o id}; la extensión la pone el tipo guardado.
  const numero = cal.numeroCertificado?.trim() ? nombreSeguroR2(cal.numeroCertificado, 60) : String(cal.id);
  return respuestaArchivoR2(getEnv(ctx), cal.certificadoR2Key, `certificado-calibracion-${numero}`);
};

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_REGISTRAR, "Solo el jefe, el administrador o el técnico adjuntan certificados.");
  if (!user) return response;
  const db = getDb(ctx);
  const cal = await calibracion(db, ctx.params.id);
  if (!cal) return errorJson("Calibración no encontrada", 404);
  if (cal.certificadoR2Key) return errorJson(YA_TIENE, 409);

  const cuerpo = await leerCuerpo(ctx.request);
  if (!cuerpo.ok) return errorJson(cuerpo.error, 400);
  if (!cuerpo.file) return errorJson("Elige el archivo del certificado (PDF o foto).", 400);
  const env = getEnv(ctx);
  const g = await guardarArchivoEvidencia(env, `calibraciones/${cal.activoId}`, cuerpo.file);
  if (!g.ok) return errorJson(g.error, g.status);

  // Solo si sigue sin certificado: dos personas adjuntando a la vez no se pisan.
  let actualizadas: unknown[] = [];
  try {
    actualizadas = await db.update(calibraciones).set({ certificadoR2Key: g.r2Key })
      .where(and(eq(calibraciones.id, cal.id), isNull(calibraciones.certificadoR2Key)))
      .returning({ id: calibraciones.id });
  } catch (e) {
    await borrarObjetoR2(env, g.r2Key);
    throw e;
  }
  if (actualizadas.length === 0) {
    await borrarObjetoR2(env, g.r2Key);
    return errorJson(YA_TIENE, 409);
  }

  const calibs = await sincronizarFechasEquipo(db, cal.activoId);
  await logAudit(ctx, {
    entidad: "activo", entidadId: cal.activoId, accion: "update",
    cambios: { certificadoR2Key: { antes: null, despues: g.r2Key } },
    resumen: `Certificado adjuntado a la calibración del ${fechaCorta(cal.fechaCalibracion)} (${g.nombre})`,
  });
  const equipo = await equipoCalibracion(db, cal.activoId);
  return Response.json({ ok: true, estado: equipo ? infoCalibracion(equipo, calibs, hoySV()) : null }, { status: 201 });
};
