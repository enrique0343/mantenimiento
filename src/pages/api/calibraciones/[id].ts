import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { calibraciones, activos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const prerender = false;

async function resyncActivo(db: ReturnType<typeof getDb>, activoId: number) {
  const [ultima] = await db
    .select()
    .from(calibraciones)
    .where(eq(calibraciones.activoId, activoId))
    .orderBy(desc(calibraciones.fechaCalibracion))
    .limit(1);
  await db.update(activos).set({
    ultimaCalibracion: ultima?.fechaCalibracion ?? null,
    proximaCalibracion: ultima?.proximaCalibracion ?? null,
  }).where(eq(activos.id, activoId));
}

const updateSchema = z.object({
  fechaCalibracion: z.string().min(1).optional(),
  proximaCalibracion: z.string().nullable().optional(),
  laboratorioId: z.number().int().nullable().optional(),
  laboratorioExterno: z.string().nullable().optional(),
  numeroCertificado: z.string().nullable().optional(),
  patronReferencia: z.string().nullable().optional(),
  resultado: z.enum(["conforme", "conforme_con_ajuste", "no_conforme"]).optional(),
  incertidumbre: z.string().nullable().optional(),
  realizadoPor: z.string().nullable().optional(),
  notas: z.string().nullable().optional(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);

  const [actual] = await db.select().from(calibraciones).where(eq(calibraciones.id, id)).limit(1);
  if (!actual) return Response.json({ error: "No encontrada" }, { status: 404 });

  const [row] = await db.update(calibraciones).set(parsed.data).where(eq(calibraciones.id, id)).returning();
  await resyncActivo(db, actual.activoId);
  await logAudit(ctx, { entidad: "activo", entidadId: actual.activoId, accion: "update", resumen: "Calibración editada" });

  return Response.json({ calibracion: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);

  const [actual] = await db.select().from(calibraciones).where(eq(calibraciones.id, id)).limit(1);
  if (!actual) return Response.json({ error: "No encontrada" }, { status: 404 });

  if (actual.certificadoR2Key) {
    const env = getEnv(ctx);
    await env.R2.delete(actual.certificadoR2Key).catch(() => {});
  }
  await db.delete(calibraciones).where(eq(calibraciones.id, id));
  await resyncActivo(db, actual.activoId);
  await logAudit(ctx, { entidad: "activo", entidadId: actual.activoId, accion: "delete", resumen: "Calibración eliminada" });

  return Response.json({ ok: true });
};
