import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { appConfig } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

// Solo se aceptan claves del documento del plan anual (prefijo "plan.")
const schema = z.object({
  valores: z.record(z.string().regex(/^plan\.[a-zA-Z0-9_.]+$/), z.string()),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;

  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const now = new Date().toISOString();
  for (const [clave, valor] of Object.entries(parsed.data.valores)) {
    const [existente] = await db.select().from(appConfig).where(eq(appConfig.clave, clave));
    if (existente) {
      await db.update(appConfig).set({ valor, updatedAt: now }).where(eq(appConfig.clave, clave));
    } else {
      await db.insert(appConfig).values({ clave, valor, updatedAt: now });
    }
  }
  return Response.json({ ok: true });
};
