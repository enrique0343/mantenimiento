import type { APIRoute } from "astro";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { gastosMantenimiento } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { RUBROS } from "@/lib/rubros";

export const prerender = false;

const schema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rubro: z.string().refine((r) => r in RUBROS, "Rubro inválido"),
  sucursalId: z.number().int().positive().nullable().optional(),
  descripcion: z.string().min(1),
  monto: z.number().positive(),
  referencia: z.string().nullable().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;

  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [row] = await db
    .insert(gastosMantenimiento)
    .values({ ...parsed.data, creadoPor: user.id })
    .returning();
  return Response.json({ gasto: row }, { status: 201 });
};
