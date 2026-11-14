import type { APIRoute } from "astro";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireUserJson } from "@/lib/auth";
import { asignarPreventivos, ROLES_TABLERO } from "@/lib/preventivos";

export const prerender = false;

const schema = z.object({
  planIds: z.array(z.number().int().positive()).min(1, "Elige al menos un preventivo.").max(500, "Asigna como máximo 500 preventivos a la vez."),
  tecnicoId: z.number().int().positive().nullable(),
  motivo: z.string().max(1000).nullable().optional(),
});

// POST /api/preventivos/asignar { planIds, tecnicoId | null, motivo? }
// El técnico queda en cada plan (próximas OT) y en su OT abierta, si la tiene.
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUserJson(ctx, [...ROLES_TABLERO]);
  if (!user) return response;
  const parsed = schema.safeParse(await ctx.request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Datos no válidos." }, { status: 400 });
  const r = await asignarPreventivos(ctx, getDb(ctx), user, parsed.data.planIds, parsed.data.tecnicoId, parsed.data.motivo ?? null);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json(r);
};
