import type { APIRoute } from "astro";
import { z } from "zod";
import { inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tickets } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

const schema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
});

// Borrado masivo de tickets: solo admin
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;

  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  try {
    await db.delete(tickets).where(inArray(tickets.id, parsed.data.ids));
  } catch (e: any) {
    return Response.json({ error: `No se pudieron borrar: ${e?.message ?? e}` }, { status: 500 });
  }
  return Response.json({ ok: true, borrados: parsed.data.ids.length });
};
