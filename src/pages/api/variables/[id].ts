import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { variablesPredictivas, mediciones } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  const [v] = await db.select().from(variablesPredictivas).where(eq(variablesPredictivas.id, id)).limit(1);
  if (!v) return Response.json({ error: "No encontrada" }, { status: 404 });
  const meds = await db.select().from(mediciones).where(eq(mediciones.variableId, id)).orderBy(desc(mediciones.fecha)).limit(100);
  return Response.json({ variable: v, mediciones: meds });
};

const updateSchema = z.object({
  nombre: z.string().min(1).optional(),
  unidad: z.string().nullable().optional(),
  minCritico: z.number().nullable().optional(),
  minWarning: z.number().nullable().optional(),
  maxWarning: z.number().nullable().optional(),
  maxCritico: z.number().nullable().optional(),
  activo: z.boolean().optional(),
  notas: z.string().nullable().optional(),
  // ── Punto de ajuste del SCP (Fase 47, GO-GUI-011-2026 cap. 03) ──
  // «Los puntos de ajuste se cargan como atributos con valor normal, mínimo y
  // máximo». posicion_normal usa valorNominalTexto («selector en AUTO»).
  tipoAtributo: z.enum(["punto_ajuste", "posicion_normal", "predictiva"]).optional(),
  valorNominal: z.number().nullable().optional(),
  valorNominalTexto: z.string().nullable().optional(),
  fuente: z.string().nullable().optional(),
  fuenteReferencia: z.string().nullable().optional(),
  procedimientoId: z.number().int().positive().nullable().optional(),
  procedimientoVersion: z.string().nullable().optional(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const [row] = await db.update(variablesPredictivas).set(parsed.data).where(eq(variablesPredictivas.id, id)).returning();
  return Response.json({ variable: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  await db.delete(variablesPredictivas).where(eq(variablesPredictivas.id, id));
  return Response.json({ ok: true });
};
