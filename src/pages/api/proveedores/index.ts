import type { APIRoute } from "astro";
import { z } from "zod";
import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { proveedores } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const db = getDb(ctx);
  const rows = await db.select().from(proveedores).orderBy(desc(proveedores.id));
  return Response.json({ proveedores: rows });
};

const createSchema = z.object({
  nombre: z.string().min(1),
  nit: z.string().nullable().optional(),
  contacto: z.string().nullable().optional(),
  telefono: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  notas: z.string().nullable().optional(),
  esLaboratorioAcreditado: z.boolean().optional(),
  acreditacionOrgano: z.string().nullable().optional(),
  acreditacionVigencia: z.string().nullable().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const [row] = await db.insert(proveedores).values(parsed.data).returning();
  return Response.json({ proveedor: row }, { status: 201 });
};
