import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { encuestasSatisfaccion } from "@/lib/schema";

export const prerender = false;

const respondSchema = z.object({
  calificacion: z.number().int().min(1).max(5),
  comentario: z.string().nullable().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const token = ctx.params.token!;
  const body = await ctx.request.json().catch(() => null);
  const parsed = respondSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Datos inválidos" }, { status: 400 });

  const db = getDb(ctx);
  const [enc] = await db.select().from(encuestasSatisfaccion).where(eq(encuestasSatisfaccion.token, token)).limit(1);
  if (!enc) return Response.json({ error: "Encuesta no existe" }, { status: 404 });
  if (enc.respondidaEn) return Response.json({ error: "Esta encuesta ya fue respondida" }, { status: 400 });

  await db.update(encuestasSatisfaccion)
    .set({
      calificacion: parsed.data.calificacion,
      comentario: parsed.data.comentario ?? null,
      respondidaEn: new Date().toISOString(),
    })
    .where(eq(encuestasSatisfaccion.id, enc.id));

  return Response.json({ ok: true });
};
