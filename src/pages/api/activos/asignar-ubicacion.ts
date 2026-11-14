import type { APIRoute } from "astro";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireUserJson } from "@/lib/auth";
import { asignarUbicacionPendiente, MAX_EQUIPOS_UBICACION, ROLES_UBICACION } from "@/lib/tablero-bio";

export const prerender = false;

const schema = z.object({
  activoIds: z.array(z.number().int().positive()).min(1, "Elige al menos un equipo.").max(MAX_EQUIPOS_UBICACION, `Asigna como máximo ${MAX_EQUIPOS_UBICACION} equipos a la vez.`),
  ubicacionId: z.number({ invalid_type_error: "Elige la ubicación.", required_error: "Elige la ubicación." }).int().positive("Elige la ubicación."),
});

// POST /api/activos/asignar-ubicacion { activoIds, ubicacionId } — la ubicación de
// equipos pendientes (sin ubicación), uno o en lote, todo o nada (admin y jefe).
// Cada equipo queda en su historial con quién, cuándo, antes y después.
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUserJson(ctx, [...ROLES_UBICACION]);
  if (!user) return response;
  const parsed = schema.safeParse(await ctx.request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Datos no válidos." }, { status: 400 });
  const r = await asignarUbicacionPendiente(getDb(ctx), user, parsed.data.activoIds, parsed.data.ubicacionId);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json(r);
};
