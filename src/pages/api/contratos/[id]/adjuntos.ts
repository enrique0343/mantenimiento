import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { contratoAdjuntos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeGestionarContratos } from "@/lib/contratos";

export const prerender = false;

const MAX_BYTES = 15 * 1024 * 1024;

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeGestionarContratos(user.rol)) return Response.json({ error: "Sin permisos" }, { status: 403 });

  const contratoId = Number(ctx.params.id);
  const form = await ctx.request.formData().catch(() => null);
  const file = form?.get("file");
  const categoria = String(form?.get("categoria") ?? "contrato");
  if (!(file instanceof File)) return Response.json({ error: "Archivo requerido" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "Archivo supera 15MB" }, { status: 413 });

  const env = getEnv(ctx);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const r2Key = `contratos/${contratoId}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  await env.R2.put(r2Key, file.stream(), { httpMetadata: { contentType: file.type } });

  const db = getDb(ctx);
  const [row] = await db.insert(contratoAdjuntos).values({
    contratoId,
    nombre: file.name,
    contentType: file.type || "application/octet-stream",
    tamano: file.size,
    r2Key,
    categoria,
    usuarioId: user.id,
  }).returning();
  return Response.json({ adjunto: row }, { status: 201 });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeGestionarContratos(user.rol)) return Response.json({ error: "Sin permisos" }, { status: 403 });

  const adjId = Number(new URL(ctx.request.url).searchParams.get("adjuntoId"));
  if (!adjId) return Response.json({ error: "adjuntoId requerido" }, { status: 400 });
  const db = getDb(ctx);
  const [adj] = await db.select().from(contratoAdjuntos).where(eq(contratoAdjuntos.id, adjId)).limit(1);
  if (!adj) return Response.json({ error: "No encontrado" }, { status: 404 });
  const env = getEnv(ctx);
  await env.R2.delete(adj.r2Key);
  await db.delete(contratoAdjuntos).where(eq(contratoAdjuntos.id, adjId));
  return Response.json({ ok: true });
};
