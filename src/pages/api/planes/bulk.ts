import type { APIRoute } from "astro";
import { z } from "zod";
import { inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { planesMantenimiento } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

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

  const db = getDb(ctx);
  const { accion, ids } = parsed.data;

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
