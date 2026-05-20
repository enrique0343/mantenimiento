import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contratoEquipos, contratosMantenimiento } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeGestionarContratos } from "@/lib/contratos";
import { logAudit } from "@/lib/audit";

export const prerender = false;

const schema = z.object({ activoId: z.number().int().positive() });

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeGestionarContratos(user.rol)) return Response.json({ error: "Sin permisos" }, { status: 403 });

  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [c] = await db.select({ id: contratosMantenimiento.id }).from(contratosMantenimiento)
    .where(eq(contratosMantenimiento.id, id)).limit(1);
  if (!c) return Response.json({ error: "Contrato no encontrado" }, { status: 404 });

  try {
    await db.insert(contratoEquipos).values({ contratoId: id, activoId: parsed.data.activoId });
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      return Response.json({ error: "Este equipo ya está vinculado" }, { status: 400 });
    }
    throw e;
  }

  await logAudit(ctx, {
    entidad: "contrato", entidadId: id, accion: "update",
    resumen: `Equipo ${parsed.data.activoId} vinculado al contrato`,
  });
  return Response.json({ ok: true });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeGestionarContratos(user.rol)) return Response.json({ error: "Sin permisos" }, { status: 403 });

  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  await db.delete(contratoEquipos)
    .where(and(eq(contratoEquipos.contratoId, id), eq(contratoEquipos.activoId, parsed.data.activoId)));

  await logAudit(ctx, {
    entidad: "contrato", entidadId: id, accion: "update",
    resumen: `Equipo ${parsed.data.activoId} desvinculado del contrato`,
  });
  return Response.json({ ok: true });
};
