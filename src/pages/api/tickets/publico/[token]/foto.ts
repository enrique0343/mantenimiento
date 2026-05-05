import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { tickets, ticketAdjuntos } from "@/lib/schema";

export const prerender = false;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// Endpoint publico: el solicitante sube fotos al ticket usando su trackingToken
export const POST: APIRoute = async (ctx) => {
  const token = ctx.params.token!;
  const db = getDb(ctx);
  const env = getEnv(ctx);

  const [t] = await db.select().from(tickets).where(eq(tickets.trackingToken, token)).limit(1);
  if (!t) return Response.json({ error: "Token inválido" }, { status: 404 });

  const form = await ctx.request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Archivo requerido en campo 'file'" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return Response.json({ error: "Solo se aceptan imágenes" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "Archivo supera 10MB" }, { status: 413 });
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const r2Key = `tickets/${t.id}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  await env.R2.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });

  const [row] = await db.insert(ticketAdjuntos).values({
    ticketId: t.id,
    nombre: file.name,
    contentType: file.type,
    tamano: file.size,
    r2Key,
  }).returning();

  return Response.json({ adjunto: row }, { status: 201 });
};
