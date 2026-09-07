import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { raciAsignaciones } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

const schema = z.object({
  procesoId: z.number().int().positive(),
  actor: z.string().min(1),
  responsabilidad: z.enum(["R", "A", "C", "I"]),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const [row] = await db.insert(raciAsignaciones).values(parsed.data).returning();
  return Response.json({ asignacion: row }, { status: 201 });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const id = Number(new URL(ctx.request.url).searchParams.get("id"));
  if (!id) return Response.json({ error: "id requerido" }, { status: 400 });
  const db = getDb(ctx);
  await db.delete(raciAsignaciones).where(eq(raciAsignaciones.id, id));
  return Response.json({ ok: true });
};
