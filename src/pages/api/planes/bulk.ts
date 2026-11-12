import type { APIRoute } from "astro";
import { z } from "zod";
import { inArray, and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { planesMantenimiento, activos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

import { parseArea, activoAreaCondition } from "@/lib/areas";
import { enTandas, errorMapEs, respuestaZod } from "@/lib/validacion-api";
export const prerender = false;

const bulkSchema = z.object({
  accion: z.enum(["eliminar", "desactivar", "activar"], { errorMap: () => ({ message: "Acción no válida." }) }),
  ids: z.array(z.number().int().positive()).min(1, "Elige al menos una rutina."),
});

// D1 acepta hasta 100 parámetros por consulta: los ids van en tandas de 90.
const TANDA = 90;

// POST /api/planes/bulk { accion, ids }
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body, { errorMap: errorMapEs });
  if (!parsed.success) return respuestaZod(parsed.error);

  const areaParam = ctx.url.searchParams.get("area");
  const area = parseArea(areaParam);
  if (areaParam && !area) return Response.json({ error: "Área no válida" }, { status: 400 });
  const db = getDb(ctx);
  const { accion } = parsed.data;
  const ids = [...new Set(parsed.data.ids)];
  const seleccion: { id: number; estadoEquipo: string }[] = [];
  for (const tanda of enTandas(ids, TANDA)) {
    seleccion.push(...await db.select({ id: planesMantenimiento.id, estadoEquipo: activos.estado }).from(planesMantenimiento)
      .innerJoin(activos, eq(activos.id, planesMantenimiento.activoId))
      .where(and(inArray(planesMantenimiento.id, tanda), area ? activoAreaCondition(area) : undefined)));
  }
  if (seleccion.length !== ids.length) return Response.json({ error: "La selección incluye planes fuera de esta área o inexistentes" }, { status: 400 });

  if (accion === "eliminar") {
    for (const tanda of enTandas(ids, TANDA)) await db.delete(planesMantenimiento).where(inArray(planesMantenimiento.id, tanda));
    await logAudit(ctx, { entidad: "plan", entidadId: 0, accion: "delete", resumen: `Bulk: ${ids.length} planes eliminados` });
    return Response.json({ ok: true, afectados: ids.length, omitidos: 0 });
  }
  if (accion === "desactivar") {
    for (const tanda of enTandas(ids, TANDA)) await db.update(planesMantenimiento).set({ activo: false }).where(inArray(planesMantenimiento.id, tanda));
    await logAudit(ctx, { entidad: "plan", entidadId: 0, accion: "update", resumen: `Bulk: ${ids.length} planes desactivados` });
    return Response.json({ ok: true, afectados: ids.length, omitidos: 0 });
  }

  // Activar: una rutina de un equipo dado de baja no se activa (contrato K-E1 y §e.4: 409).
  const deBaja = seleccion.filter((s) => s.estadoEquipo === "baja").length;
  if (deBaja > 0) {
    return Response.json({
      error: `${deBaja} rutina(s) de la selección son de equipos dados de baja y no se pueden activar. Quítalas de la selección.`,
    }, { status: 409 });
  }
  for (const tanda of enTandas(ids, TANDA)) await db.update(planesMantenimiento).set({ activo: true }).where(inArray(planesMantenimiento.id, tanda));
  await logAudit(ctx, { entidad: "plan", entidadId: 0, accion: "update", resumen: `Bulk: ${ids.length} planes activados` });
  return Response.json({ ok: true, afectados: ids.length, omitidos: 0 });
};
