import type { APIRoute } from "astro";
import { getDb, getEnv } from "@/lib/db";
import { adjuntos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const ordenId = Number(ctx.params.id);
  const env = getEnv(ctx);

  const form = await ctx.request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Archivo requerido en campo 'file'" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "Archivo supera 10MB" }, { status: 413 });
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const r2Key = `ordenes/${ordenId}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  await env.R2.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });

  const db = getDb(ctx);
  const [row] = await db
    .insert(adjuntos)
    .values({
      ordenId,
      usuarioId: user.id,
      nombre: file.name,
      contentType: file.type || "application/octet-stream",
      tamano: file.size,
      r2Key,
    })
    .returning();
  return Response.json({ adjunto: row }, { status: 201 });
};
