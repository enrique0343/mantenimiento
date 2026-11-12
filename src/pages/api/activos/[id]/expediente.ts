// «No aplica» de un requisito del expediente técnico (Fase 59 · WP-D). Solo equipos
// biomédicos; lo marcan y lo quitan admin y jefe, con motivo, y queda en la bitácora.
import type { APIRoute } from "astro";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { activoExpedienteNa, activos } from "@/lib/schema";
import { logAudit } from "@/lib/audit";
import { rubroDeActivo } from "@/lib/rubros";
import { REQUISITOS_EXPEDIENTE, ROLES_BIO_GESTIONAR, esRequisitoExpediente } from "@/lib/biomedico";
import { errorJson, exigirRol, idPositivo, leerJson } from "@/lib/bio-archivos";

export const prerender = false;

const SIN_PERMISO = "Solo el jefe o el administrador marcan «No aplica».";
const etiquetaRequisito = (clave: string) => REQUISITOS_EXPEDIENTE.find((r) => r.clave === clave)?.corta ?? clave;

type Equipo = { ok: true; db: ReturnType<typeof getDb>; activoId: number } | { ok: false; error: Response };

async function equipoBiomedico(ctx: Parameters<APIRoute>[0]): Promise<Equipo> {
  const activoId = idPositivo(ctx.params.id);
  if (!activoId) return { ok: false, error: errorJson(404, "Equipo no encontrado") };
  const db = getDb(ctx);
  const [a] = await db.select({ id: activos.id, rubro: activos.rubro, tipo: activos.tipo }).from(activos).where(eq(activos.id, activoId)).limit(1);
  if (!a) return { ok: false, error: errorJson(404, "Equipo no encontrado") };
  if (rubroDeActivo(a.rubro, a.tipo) !== "biomedico") return { ok: false, error: errorJson(400, "Solo aplica a equipos biomédicos.") };
  return { ok: true, db, activoId };
}

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_GESTIONAR, SIN_PERMISO);
  if (!user) return response;
  const eq_ = await equipoBiomedico(ctx);
  if (!eq_.ok) return eq_.error;
  const { db, activoId } = eq_;

  const body = await leerJson(ctx);
  const requisito = String(body?.requisito ?? "").trim();
  if (!esRequisitoExpediente(requisito)) return errorJson(400, "Requisito no válido.");
  const motivo = String(body?.motivo ?? "").replace(/\s+/g, " ").trim();
  if (motivo.length < 5) return errorJson(400, "Escribe el motivo (al menos 5 letras).");
  if (motivo.length > 300) return errorJson(400, "El motivo es muy largo (máx. 300 caracteres).");

  await db.insert(activoExpedienteNa)
    .values({ activoId, requisito, motivo, usuarioId: user.id })
    .onConflictDoUpdate({
      target: [activoExpedienteNa.activoId, activoExpedienteNa.requisito],
      set: { motivo, usuarioId: user.id, createdAt: sql`CURRENT_TIMESTAMP` },
    });
  await logAudit(ctx, {
    entidad: "activo", entidadId: activoId, accion: "update",
    resumen: `Expediente: «${etiquetaRequisito(requisito)}» no aplica — ${motivo}`,
  });
  return Response.json({ noAplica: { activoId, requisito, motivo } }, { status: 201 });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_GESTIONAR, SIN_PERMISO);
  if (!user) return response;
  const eq_ = await equipoBiomedico(ctx);
  if (!eq_.ok) return eq_.error;
  const { db, activoId } = eq_;

  const requisito = String(new URL(ctx.request.url).searchParams.get("requisito") ?? "").trim();
  if (!esRequisitoExpediente(requisito)) return errorJson(400, "Requisito no válido.");
  const borrados = await db.delete(activoExpedienteNa)
    .where(and(eq(activoExpedienteNa.activoId, activoId), eq(activoExpedienteNa.requisito, requisito)))
    .returning({ requisito: activoExpedienteNa.requisito });
  if (!borrados.length) return errorJson(404, "Ese requisito no estaba marcado como «No aplica».");
  await logAudit(ctx, {
    entidad: "activo", entidadId: activoId, accion: "update",
    resumen: `Expediente: «${etiquetaRequisito(requisito)}» vuelve a ser requerido`,
  });
  return Response.json({ ok: true });
};
