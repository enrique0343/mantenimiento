import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { proyectoPresupuestoItems } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

const schema = z.object({
  descripcion: z.string().min(1).optional(),
  categoria: z.string().nullable().optional(),
  cantidad: z.number().positive().optional(),
  unidad: z.string().nullable().optional(),
  precioEstimado: z.number().min(0).optional(),
  precioReal: z.number().min(0).nullable().optional(),
  proveedorId: z.number().int().positive().nullable().optional(),
  notas: z.string().nullable().optional(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const itemId = Number(ctx.params.itemId);
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const [row] = await db.update(proyectoPresupuestoItems).set(parsed.data).where(eq(proyectoPresupuestoItems.id, itemId)).returning();
  if (!row) return Response.json({ error: "No encontrado" }, { status: 404 });
  return Response.json({ item: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const itemId = Number(ctx.params.itemId);
  const db = getDb(ctx);
  await db.delete(proyectoPresupuestoItems).where(eq(proyectoPresupuestoItems.id, itemId));
  return Response.json({ ok: true });
};
