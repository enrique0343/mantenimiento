import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { proveedores } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  const [row] = await db.select().from(proveedores).where(eq(proveedores.id, id)).limit(1);
  if (!row) return Response.json({ error: "No encontrado" }, { status: 404 });
  return Response.json({ proveedor: row });
};

const updateSchema = z.object({
  nombre: z.string().min(1).optional(),
  nit: z.string().nullable().optional(),
  contacto: z.string().nullable().optional(),
  telefono: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  notas: z.string().nullable().optional(),
  activo: z.boolean().optional(),
  esLaboratorioAcreditado: z.boolean().optional(),
  acreditacionOrgano: z.string().nullable().optional(),
  acreditacionVigencia: z.string().nullable().optional(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const [row] = await db.update(proveedores).set(parsed.data).where(eq(proveedores.id, id)).returning();
  if (!row) return Response.json({ error: "No encontrado" }, { status: 404 });
  return Response.json({ proveedor: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  await db.update(proveedores).set({ activo: false }).where(eq(proveedores.id, id));
  return Response.json({ ok: true });
};
