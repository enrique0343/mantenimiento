import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { comprasDestinatarios } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const db = getDb(ctx);
  const rows = await db.select().from(comprasDestinatarios).orderBy(comprasDestinatarios.nombre);
  return Response.json({ destinatarios: rows });
};

const createSchema = z.object({
  nombre: z.string().min(1),
  email: z.string().email(),
  telefono: z.string().nullable().optional(),
  cargo: z.string().nullable().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const [row] = await db.insert(comprasDestinatarios).values(parsed.data).returning();
  return Response.json({ destinatario: row }, { status: 201 });
};
