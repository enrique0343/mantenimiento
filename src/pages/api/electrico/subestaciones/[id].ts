import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { subestaciones } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeAdministrarElectrico } from "@/lib/electrico";

export const prerender = false;

const patchSchema = z.object({
  sucursalId: z.number().int().positive().optional(),
  nombre: z.string().min(1).optional(),
  codigo: z.string().nullable().optional(),
  capacidadKva: z.number().positive().optional(),
  voltaje: z.string().nullable().optional(),
  factorPotencia: z.number().min(0.1).max(1).optional(),
  factorSeguridad: z.number().min(0.1).max(1).optional(),
  ubicacionDetalle: z.string().nullable().optional(),
  activoId: z.number().int().positive().nullable().optional(),
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
  const [row] = await db.update(subestaciones).set(parsed.data).where(eq(subestaciones.id, id)).returning();
  if (!row) return Response.json({ error: "No encontrada" }, { status: 404 });
  return Response.json({ subestacion: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarElectrico(user.rol)) return new Response("Sin permisos", { status: 403 });

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) return Response.json({ error: "ID inválido" }, { status: 400 });

  // Baja lógica: conserva el historial de cargas asociadas.
  const db = getDb(ctx);
  const [row] = await db.update(subestaciones).set({ activa: false }).where(eq(subestaciones.id, id)).returning();
  if (!row) return Response.json({ error: "No encontrada" }, { status: 404 });
  return Response.json({ ok: true });
};
