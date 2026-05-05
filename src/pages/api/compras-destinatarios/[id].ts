import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { comprasDestinatarios } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

const patchSchema = z.object({
  nombre: z.string().min(1).optional(),
  email: z.string().email().optional(),
  telefono: z.string().nullable().optional(),
  cargo: z.string().nullable().optional(),
  activo: z.boolean().optional(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const [row] = await db.update(comprasDestinatarios).set(parsed.data).where(eq(comprasDestinatarios.id, id)).returning();
  if (!row) return Response.json({ error: "No encontrado" }, { status: 404 });
  return Response.json({ destinatario: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  await db.delete(comprasDestinatarios).where(eq(comprasDestinatarios.id, id));
  return Response.json({ ok: true });
};
