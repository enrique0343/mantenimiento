import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { cargasElectricas } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeAdministrarElectrico } from "@/lib/electrico";

export const prerender = false;

const patchSchema = z.object({
  nombre: z.string().min(1).optional(),
  activoId: z.number().int().positive().nullable().optional(),
  tablero: z.string().nullable().optional(),
  potenciaKw: z.number().positive().nullable().optional(),
  amperaje: z.number().positive().nullable().optional(),
  voltajeCarga: z.number().positive().nullable().optional(),
  fases: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  notas: z.string().nullable().optional(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarElectrico(user.rol)) return new Response("Sin permisos", { status: 403 });

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [row] = await db.update(cargasElectricas).set(parsed.data).where(eq(cargasElectricas.id, id)).returning();
  if (!row) return Response.json({ error: "No encontrada" }, { status: 404 });
  return Response.json({ carga: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarElectrico(user.rol)) return new Response("Sin permisos", { status: 403 });

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const db = getDb(ctx);
  const res = await db.delete(cargasElectricas).where(eq(cargasElectricas.id, id)).returning();
  if (!res.length) return Response.json({ error: "No encontrada" }, { status: 404 });
  return Response.json({ ok: true });
};
