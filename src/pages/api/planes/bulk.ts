import type { APIRoute } from "astro";
import { z } from "zod";
import { inArray, and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { planesMantenimiento, activos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

import { parseArea, activoAreaCondition } from "@/lib/areas";
export const prerender = false;

const bulkSchema = z.object({
  accion: z.enum(["eliminar", "desactivar", "activar"]),
  ids: z.array(z.number().int().positive()).min(1),
});

// POST /api/planes/bulk { accion, ids }
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const areaParam = ctx.url.searchParams.get("area");
  const area = parseArea(areaParam);
  if (areaParam && !area) return Response.json({ error: "Área no válida" }, { status: 400 });
  const db = getDb(ctx);
  const { accion } = parsed.data;
  const ids = [...new Set(parsed.data.ids)];
  const selected = await db.select({ id: planesMantenimiento.id }).from(planesMantenimiento)
    .innerJoin(activos, eq(activos.id, planesMantenimiento.activoId))
    .where(and(inArray(planesMantenimiento.id, ids), area ? activoAreaCondition(area) : undefined));
  if (selected.length !== ids.length) return Response.json({ error: "La selección incluye planes fuera de esta área o inexistentes" }, { status: 400 });

  if (accion === "eliminar") {
    await db.delete(planesMantenimiento).where(inArray(planesMantenimiento.id, ids));
    await logAudit(ctx, { entidad: "plan", entidadId: 0, accion: "delete", resumen: `Bulk: ${ids.length} planes eliminados` });
  } else if (accion === "desactivar") {
    await db.update(planesMantenimiento).set({ activo: false }).where(inArray(planesMantenimiento.id, ids));
    await logAudit(ctx, { entidad: "plan", entidadId: 0, accion: "update", resumen: `Bulk: ${ids.length} planes desactivados` });
  } else if (accion === "activar") {
    await db.update(planesMantenimiento).set({ activo: true }).where(inArray(planesMantenimiento.id, ids));
    await logAudit(ctx, { entidad: "plan", entidadId: 0, accion: "update", resumen: `Bulk: ${ids.length} planes activados` });
  }

  return Response.json({ ok: true, afectados: ids.length });
};
