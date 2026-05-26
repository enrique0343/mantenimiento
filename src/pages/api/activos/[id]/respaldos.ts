import type { APIRoute } from "astro";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { activoRespaldos, activos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const prerender = false;

const schema = z.object({ respaldoId: z.number().int().positive(), notas: z.string().nullable().optional() });

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const activoId = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  if (parsed.data.respaldoId === activoId) return Response.json({ error: "Un equipo no puede ser su propio respaldo" }, { status: 400 });

  const db = getDb(ctx);
  const [respaldo] = await db.select({ id: activos.id, codigo: activos.codigo }).from(activos).where(eq(activos.id, parsed.data.respaldoId)).limit(1);
  if (!respaldo) return Response.json({ error: "Equipo de respaldo no encontrado" }, { status: 404 });

  await db.insert(activoRespaldos).values({
    activoId, respaldoId: parsed.data.respaldoId, notas: parsed.data.notas ?? null,
  }).onConflictDoNothing();
  await logAudit(ctx, { entidad: "activo", entidadId: activoId, accion: "update", resumen: `Equipo de respaldo agregado: ${respaldo.codigo}` });
  return Response.json({ ok: true }, { status: 201 });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const activoId = Number(ctx.params.id);
  const respaldoId = Number(new URL(ctx.request.url).searchParams.get("respaldoId"));
  if (!respaldoId) return Response.json({ error: "respaldoId requerido" }, { status: 400 });
  const db = getDb(ctx);
  await db.delete(activoRespaldos).where(and(eq(activoRespaldos.activoId, activoId), eq(activoRespaldos.respaldoId, respaldoId)));
  await logAudit(ctx, { entidad: "activo", entidadId: activoId, accion: "update", resumen: "Equipo de respaldo quitado" });
  return Response.json({ ok: true });
};
