// Registrar una licencia o permiso, o la renovación de una (Fase 59 · WP-D).
// Renovar = licencia nueva con reemplaza_a_id; si nace «Activa», la anterior pasa a
// «Reemplazada» en el mismo lote. Solo admin y jefe. Un equipo dado de baja no recibe
// licencias nuevas, tampoco renovaciones (409).
import type { APIRoute } from "astro";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { licencias } from "@/lib/schema";
import { logAudit } from "@/lib/audit";
import { ROLES_BIO_GESTIONAR } from "@/lib/biomedico";
import { codigoLicencia, validarLicencia } from "@/lib/licencias";
import { completarReferenciasLicencia } from "@/lib/bio-consultas";
import { errorJson, exigirRol, idPositivo, leerJson } from "@/lib/bio-archivos";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_GESTIONAR, "Solo el jefe o el administrador registran licencias.");
  if (!user) return response;
  const body = await leerJson(ctx);
  if (!body) return errorJson(400, "Datos no válidos.");
  const v = validarLicencia(body, { modo: "crear" });
  if (!v.ok) return errorJson(400, v.error);
  const db = getDb(ctx);
  const ref = await completarReferenciasLicencia(db, v.datos);
  if (!ref.ok) return errorJson(ref.status, ref.error);
  const datos = ref.datos;

  let anterior: { id: number; estado: string; nombre: string } | null = null;
  const pideRenovar = body.reemplazaAId !== undefined && body.reemplazaAId !== null && body.reemplazaAId !== "";
  if (pideRenovar) {
    const reemplazaAId = idPositivo(body.reemplazaAId);
    const [l] = reemplazaAId
      ? await db.select({ id: licencias.id, estado: licencias.estado, nombre: licencias.nombre }).from(licencias).where(eq(licencias.id, reemplazaAId)).limit(1)
      : [];
    if (!l) return errorJson(404, "La licencia que renuevas no existe.");
    if (l.estado === "reemplazada" || l.estado === "anulada") return errorJson(409, "Esa licencia ya fue reemplazada o anulada.");
    if (l.estado !== "activa") return errorJson(409, "Solo se renueva una licencia activa.");
    const [enCurso] = await db.select({ id: licencias.id }).from(licencias)
      .where(and(eq(licencias.reemplazaAId, l.id), eq(licencias.estado, "en_tramite"))).limit(1);
    if (enCurso) return errorJson(409, "Ya hay una renovación en trámite: ábrela y complétala.");
    anterior = l;
  }

  const valores = { ...datos, reemplazaAId: anterior?.id ?? null, creadoPor: user.id };
  let licencia;
  let reemplazo = false;
  if (anterior && datos.estado === "activa") {
    const [insertadas, actualizadas] = await db.batch([
      db.insert(licencias).values(valores).returning(),
      db.update(licencias).set({ estado: "reemplazada", updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(licencias.id, anterior.id), eq(licencias.estado, "activa")))
        .returning({ id: licencias.id }),
    ]);
    licencia = insertadas[0];
    reemplazo = actualizadas.length > 0;
  } else {
    [licencia] = await db.insert(licencias).values(valores).returning();
  }

  const codigo = codigoLicencia(licencia.id);
  await logAudit(ctx, {
    entidad: "licencia", entidadId: licencia.id, accion: "create",
    resumen: `Licencia registrada: ${codigo} — ${licencia.nombre}${anterior ? ` (renovación de ${codigoLicencia(anterior.id)})` : ""}`,
  });
  if (anterior && reemplazo) {
    await logAudit(ctx, { entidad: "licencia", entidadId: anterior.id, accion: "estado", resumen: `Reemplazada por ${codigo}` });
  }
  return Response.json({ licencia }, { status: 201 });
};
