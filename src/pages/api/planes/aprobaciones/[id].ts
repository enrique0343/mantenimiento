import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { planAprobaciones } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { ROLES_BIO_GESTIONAR } from "@/lib/biomedico";

export const prerender = false;

/**
 * Anula una aprobación con motivo (admin y jefe). No se edita ni se borra: el
 * registro y el archivo firmado se conservan como evidencia.
 */
export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ROLES_BIO_GESTIONAR);
  if (!user) return response;
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Aprobación no válida." }, { status: 400 });
  const body = await ctx.request.json().catch(() => null) as { motivo?: unknown } | null;
  const db = getDb(ctx);
  const [actual] = await db.select({ id: planAprobaciones.id, anuladaEn: planAprobaciones.anuladaEn })
    .from(planAprobaciones).where(eq(planAprobaciones.id, id)).limit(1);
  if (!actual) return Response.json({ error: "Aprobación no encontrada." }, { status: 404 });
  if (actual.anuladaEn) return Response.json({ error: "Esta aprobación ya está anulada." }, { status: 409 });
  const motivo = typeof body?.motivo === "string" ? body.motivo.trim() : "";
  if (motivo.length < 10 || motivo.length > 500) {
    return Response.json({ error: "Escribe el motivo de la anulación (mínimo 10 caracteres)." }, { status: 400 });
  }
  const [aprobacion] = await db.update(planAprobaciones)
    .set({ anuladaEn: new Date().toISOString(), anuladaPor: user.id, motivoAnulacion: motivo })
    .where(eq(planAprobaciones.id, id)).returning();
  await logAudit(ctx, { entidad: "plan_aprobacion", entidadId: id, accion: "estado", resumen: `Aprobación anulada: ${motivo}` });
  return Response.json({ aprobacion });
};
