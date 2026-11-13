import type { APIRoute } from "astro";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { planesMantenimiento, activos } from "@/lib/schema";
import { requireUserJson } from "@/lib/auth";
import { activarPlanes, eliminarPlanes, motivoValido, MENSAJE_MOTIVO } from "@/lib/preventivos";

import { parseArea, activoAreaCondition } from "@/lib/areas";
export const prerender = false;

const bulkSchema = z.object({
  accion: z.enum(["eliminar", "desactivar", "activar"]),
  ids: z.array(z.number().int().positive()).min(1).max(1000),
  // Obligatorio para desactivar o eliminar: cada plan queda con su registro.
  motivo: z.string().max(1000).nullable().optional(),
});

// POST /api/planes/bulk { accion, ids, motivo }
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUserJson(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const parsed = bulkSchema.safeParse(await ctx.request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Datos no válidos." }, { status: 400 });
  const { accion, motivo = null } = parsed.data;
  if (accion !== "activar" && !motivoValido(motivo)) return Response.json({ error: MENSAJE_MOTIVO }, { status: 400 });

  const areaParam = ctx.url.searchParams.get("area");
  const area = parseArea(areaParam);
  if (areaParam && !area) return Response.json({ error: "Área no válida" }, { status: 400 });
  const db = getDb(ctx);
  const ids = [...new Set(parsed.data.ids)];
  // La lista va en un solo parámetro (json_each): D1 no acepta más de 100 por consulta.
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(planesMantenimiento)
    .innerJoin(activos, eq(activos.id, planesMantenimiento.activoId))
    .where(and(sql`${planesMantenimiento.id} in (select value from json_each(${JSON.stringify(ids)}))`, area ? activoAreaCondition(area) : undefined));
  if (Number(n) !== ids.length) return Response.json({ error: "La selección incluye planes fuera de esta área o inexistentes" }, { status: 400 });

  if (accion === "eliminar") {
    const r = await eliminarPlanes(db, ids, user, motivo!);
    if (!r.ok) return Response.json({ error: r.error }, { status: 409 });
    return Response.json({ ok: true, afectados: r.n });
  }
  const afectados = await activarPlanes(db, ids, accion === "activar", user, motivo);
  return Response.json({ ok: true, afectados });
};
