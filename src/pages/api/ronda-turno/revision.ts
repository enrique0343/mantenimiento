// Ronda de turno · la revisión semanal de la jefatura (SOP-MG-01, Registro).
import type { APIRoute } from "astro";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { firmarRevision } from "@/lib/ronda-turno";
import { lunesDe } from "@/lib/turnos";

export const prerender = false;
const schema = z.object({
  sucursalId: z.number().int().positive(),
  semana: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  observaciones: z.string().trim().max(4000).nullable().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const parsed = schema.safeParse(await ctx.request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Datos inválidos" }, { status: 400 });
  const { sucursalId, semana, observaciones } = parsed.data;
  const r = await firmarRevision(getDb(ctx), user, sucursalId, lunesDe(semana), observaciones?.trim() || null);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  await logAudit(ctx, { entidad: "ronda", entidadId: r.id, accion: "create", resumen: `Revisión semanal firmada: sede ${sucursalId}, semana del ${lunesDe(semana)}` });
  return Response.json({ ok: true, id: r.id });
};
