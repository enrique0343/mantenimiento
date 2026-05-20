import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contratosMantenimiento } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeGestionarContratos } from "@/lib/contratos";
import { logAudit } from "@/lib/audit";

export const prerender = false;

const schema = z.object({
  notasCancelacion: z.string().min(3, "Indica el motivo de la cancelación"),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeGestionarContratos(user.rol)) return Response.json({ error: "Sin permisos" }, { status: 403 });

  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [actual] = await db.select().from(contratosMantenimiento).where(eq(contratosMantenimiento.id, id)).limit(1);
  if (!actual) return Response.json({ error: "No encontrado" }, { status: 404 });

  if (!["vigente", "por_vencer"].includes(actual.estado)) {
    return Response.json({ error: `No se puede cancelar un contrato en estado '${actual.estado}'` }, { status: 400 });
  }

  await db.update(contratosMantenimiento).set({
    estado: "cancelado",
    notasCancelacion: parsed.data.notasCancelacion,
    updatedAt: new Date().toISOString(),
  }).where(eq(contratosMantenimiento.id, id));

  await logAudit(ctx, {
    entidad: "contrato", entidadId: id, accion: "estado",
    resumen: `Contrato cancelado: ${parsed.data.notasCancelacion}`,
    cambios: { estado: { antes: actual.estado, despues: "cancelado" } },
  });

  return Response.json({ ok: true });
};
