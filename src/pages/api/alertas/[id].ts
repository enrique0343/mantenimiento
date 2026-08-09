import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { alertasEquipo, alertasEquipoActivos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

const patchSchema = z.object({
  tipo: z.enum(["retiro", "alerta", "aviso"]).optional(),
  fuente: z.enum(["fabricante", "regulador", "proveedor", "interna"]).optional(),
  titulo: z.string().min(1).optional(),
  descripcion: z.string().nullable().optional(),
  referencia: z.string().nullable().optional(),
  fechaAlerta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  estado: z.enum(["abierta", "en_proceso", "cerrada"]).optional(),
  accionTomada: z.string().nullable().optional(),
  activoIds: z.array(z.number().int().positive()).optional(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const { activoIds, ...datos } = parsed.data;
  const cambios: Record<string, unknown> = { ...datos };

  // Cerrar exige acción tomada documentada (evidencia FMS.07.1)
  if (datos.estado === "cerrada") {
    const [actual] = await db.select().from(alertasEquipo).where(eq(alertasEquipo.id, id));
    if (!actual) return Response.json({ error: "No encontrada" }, { status: 404 });
    const accion = (datos.accionTomada ?? actual.accionTomada ?? "").trim();
    if (!accion) {
      return Response.json({ error: "Para cerrar la alerta debes documentar la acción tomada" }, { status: 400 });
    }
    cambios.cerradaEn = new Date().toISOString();
    cambios.cerradaPor = user.id;
  }

  const [row] = await db.update(alertasEquipo).set(cambios).where(eq(alertasEquipo.id, id)).returning();
  if (!row) return Response.json({ error: "No encontrada" }, { status: 404 });

  if (activoIds) {
    await db.delete(alertasEquipoActivos).where(eq(alertasEquipoActivos.alertaId, id));
    if (activoIds.length > 0) {
      await db.insert(alertasEquipoActivos).values(activoIds.map((activoId) => ({ alertaId: id, activoId })));
    }
  }

  return Response.json({ alerta: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const db = getDb(ctx);
  const res = await db.delete(alertasEquipo).where(eq(alertasEquipo.id, id)).returning();
  if (!res.length) return Response.json({ error: "No encontrada" }, { status: 404 });
  return Response.json({ ok: true });
};
