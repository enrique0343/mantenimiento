import type { APIRoute } from "astro";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { raciProcesos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

const schema = z.object({
  nombre: z.string().min(1),
  descripcion: z.string().nullable().optional(),
  orden: z.number().int().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const [row] = await db.insert(raciProcesos).values(parsed.data).returning();
  return Response.json({ proceso: row }, { status: 201 });
};
