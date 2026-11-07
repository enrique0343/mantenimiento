import type { APIRoute } from "astro";
import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { variablesPredictivas } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const db = getDb(ctx);
  const url = new URL(ctx.request.url);
  const activoId = url.searchParams.get("activo_id");
  const tipoAtributo = url.searchParams.get("tipo_atributo");
  const filtros = [
    activoId ? eq(variablesPredictivas.activoId, Number(activoId)) : undefined,
    tipoAtributo ? eq(variablesPredictivas.tipoAtributo, tipoAtributo as any) : undefined,
  ].filter(Boolean) as any[];
  const rows = filtros.length > 0
    ? await db.select().from(variablesPredictivas).where(and(...filtros)).orderBy(variablesPredictivas.nombre)
    : await db.select().from(variablesPredictivas).orderBy(desc(variablesPredictivas.id));
  return Response.json({ variables: rows });
};

const createSchema = z.object({
  activoId: z.number().int().positive(),
  nombre: z.string().min(1),
  unidad: z.string().nullable().optional(),
  minCritico: z.number().nullable().optional(),
  minWarning: z.number().nullable().optional(),
  maxWarning: z.number().nullable().optional(),
  maxCritico: z.number().nullable().optional(),
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

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const [row] = await db.insert(variablesPredictivas).values(parsed.data).returning();
  return Response.json({ variable: row }, { status: 201 });
};
