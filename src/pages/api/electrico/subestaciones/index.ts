import type { APIRoute } from "astro";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { subestaciones } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeAdministrarElectrico } from "@/lib/electrico";

export const prerender = false;

const createSchema = z.object({
  sucursalId: z.number().int().positive(),
  nombre: z.string().min(1),
  codigo: z.string().nullable().optional(),
  capacidadKva: z.number().positive(),
  voltaje: z.string().nullable().optional(),
  factorPotencia: z.number().min(0.1).max(1).default(0.9),
  factorSeguridad: z.number().min(0.1).max(1).default(0.8),
  ubicacionDetalle: z.string().nullable().optional(),
  activoId: z.number().int().positive().nullable().optional(),
  notas: z.string().nullable().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarElectrico(user.rol)) return new Response("Sin permisos", { status: 403 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [row] = await db.insert(subestaciones).values(parsed.data).returning();
  return Response.json({ subestacion: row }, { status: 201 });
};
