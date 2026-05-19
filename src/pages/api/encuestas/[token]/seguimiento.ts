import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { encuestasSatisfaccion } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

const schema = z.object({
  leida: z.boolean().optional(),
  respuestaJefe: z.string().nullable().optional(),
});

// PATCH: marcar encuesta como leida y/o agregar respuesta del jefe
export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;

  const token = ctx.params.token!;
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [enc] = await db.select().from(encuestasSatisfaccion)
    .where(eq(encuestasSatisfaccion.token, token)).limit(1);
  if (!enc) return Response.json({ error: "No encontrada" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (parsed.data.leida === true && !enc.leidaEn) {
    data.leidaPor = user.id;
    data.leidaEn = new Date().toISOString();
  } else if (parsed.data.leida === false) {
    data.leidaPor = null;
    data.leidaEn = null;
  }
  if (parsed.data.respuestaJefe !== undefined) {
    data.respuestaJefe = parsed.data.respuestaJefe;
    if (parsed.data.respuestaJefe && !enc.leidaEn) {
      data.leidaPor = user.id;
      data.leidaEn = new Date().toISOString();
    }
  }

  if (Object.keys(data).length === 0) return Response.json({ ok: true });

  const [row] = await db.update(encuestasSatisfaccion).set(data)
    .where(eq(encuestasSatisfaccion.id, enc.id)).returning();
  return Response.json({ encuesta: row });
};
