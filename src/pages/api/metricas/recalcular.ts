import type { APIRoute } from "astro";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { capturarSnapshot, ultimosPeriodos } from "@/lib/metricas";

export const prerender = false;

const schema = z.object({ meses: z.number().int().min(1).max(36).optional() });

// Recalcula (backfill) los últimos N meses de KPIs desde el historial de OTs.
// Útil al activar la función para tener tendencia inmediata. Solo admin.
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const meses = parsed.data.meses ?? 12;
  const periodos = ultimosPeriodos(meses);
  for (const p of periodos) await capturarSnapshot(ctx, p);

  return Response.json({ ok: true, periodos, mensaje: `✓ Recalculados ${periodos.length} meses (${periodos[0]} → ${periodos[periodos.length - 1]})` });
};
