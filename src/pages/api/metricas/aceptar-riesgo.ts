import type { APIRoute } from "astro";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { ordenes } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const prerender = false;

// Escape 1 del volumen GO-GUI-011-2026: diferir una orden P1 vencida exige
// aceptar el riesgo POR ESCRITO. Al sellarlo, la OT sale del indicador de
// mantenimiento diferido (cap. 2.3) pero la aceptación queda trazada en la
// propia orden y en el audit log — nunca se borra.
const schema = z.object({
  ordenId: z.number().int().positive(),
  notas: z.string().trim().min(15, "Describe el riesgo aceptado y quién lo asume (mínimo 15 caracteres)."),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;

  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const { ordenId, notas } = parsed.data;

  const db = getDb(ctx);
  const [orden] = await db
    .select({
      id: ordenes.id,
      titulo: ordenes.titulo,
      estado: ordenes.estado,
      clasePrioridad: ordenes.clasePrioridad,
      vencimiento: ordenes.vencimiento,
      riesgoAceptadoPor: ordenes.riesgoAceptadoPor,
    })
    .from(ordenes)
    .where(eq(ordenes.id, ordenId))
    .limit(1);

  if (!orden) return Response.json({ error: "Orden no encontrada" }, { status: 404 });
  if (orden.clasePrioridad !== "P1") {
    return Response.json({ error: "El riesgo aceptado por escrito solo aplica a órdenes de clase P1." }, { status: 409 });
  }
  if (orden.estado === "cerrada" || orden.estado === "cancelada") {
    return Response.json({ error: "La orden ya está cerrada o cancelada: no hay mantenimiento que diferir." }, { status: 409 });
  }
  if (orden.riesgoAceptadoPor != null) {
    return Response.json({ error: "Esta orden ya tiene un riesgo aceptado registrado." }, { status: 409 });
  }

  const ahora = new Date().toISOString();
  const res = await db
    .update(ordenes)
    .set({ riesgoAceptadoPor: user.id, riesgoAceptadoEn: ahora, riesgoAceptadoNotas: notas })
    .where(and(eq(ordenes.id, ordenId), isNull(ordenes.riesgoAceptadoPor)))
    .returning({ id: ordenes.id });

  if (res.length === 0) {
    return Response.json({ error: "Esta orden ya tiene un riesgo aceptado registrado." }, { status: 409 });
  }

  await logAudit(ctx, {
    entidad: "orden",
    entidadId: ordenId,
    accion: "update",
    cambios: {
      riesgoAceptadoPor: { antes: null, despues: user.nombre },
      riesgoAceptadoEn: { antes: null, despues: ahora },
      riesgoAceptadoNotas: { antes: null, despues: notas },
    },
    resumen: `Riesgo aceptado por escrito (mantenimiento diferido P1) — ${user.nombre}`,
  });

  return Response.json({
    ok: true,
    ordenId,
    aceptadoEn: ahora,
    aceptadoPor: user.nombre,
    mensaje: `Riesgo aceptado por escrito en la OT #${ordenId}. Sale del indicador de mantenimiento diferido y queda trazada.`,
  });
};
