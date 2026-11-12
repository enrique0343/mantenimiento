// Periodicidad de la prueba de seguridad eléctrica (meses). La ven quienes ven lo
// biomédico; la cambian admin y jefe. Vale para las pruebas que se registren desde
// ahora: las registradas conservan su próxima fecha.
import type { APIRoute } from "astro";
import { getDb } from "@/lib/db";
import { appConfig } from "@/lib/schema";
import { logAudit } from "@/lib/audit";
import { CLAVE_PERIODICIDAD_SEGURIDAD_ELECTRICA, ROLES_BIO_GESTIONAR, ROLES_BIO_VER } from "@/lib/biomedico";
import { errorJson, exigirRol, mesesValidos, periodicidadSeguridadElectrica } from "@/lib/seguridad-electrica";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_VER);
  if (!user) return response;
  return Response.json({ meses: await periodicidadSeguridadElectrica(getDb(ctx)) });
};

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_GESTIONAR);
  if (!user) return response;
  const body = (await ctx.request.json().catch(() => null)) as { meses?: unknown } | null;
  const meses = mesesValidos(body?.meses);
  if (meses === null) return errorJson(400, "Escribe un número de meses entre 1 y 60.");

  const db = getDb(ctx);
  const antes = await periodicidadSeguridadElectrica(db);
  const ahora = new Date().toISOString();
  await db
    .insert(appConfig)
    .values({ clave: CLAVE_PERIODICIDAD_SEGURIDAD_ELECTRICA, valor: String(meses), updatedAt: ahora })
    .onConflictDoUpdate({ target: appConfig.clave, set: { valor: String(meses), updatedAt: ahora } });
  if (antes !== meses) {
    await logAudit(ctx, {
      entidad: "configuracion",
      entidadId: 0,
      accion: "update",
      cambios: { [CLAVE_PERIODICIDAD_SEGURIDAD_ELECTRICA]: { antes, despues: meses } },
      resumen: `Periodicidad de seguridad eléctrica: ${antes} → ${meses} meses`,
    });
  }
  return Response.json({ ok: true, meses });
};
