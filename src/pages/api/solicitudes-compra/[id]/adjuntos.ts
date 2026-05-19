import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { solicitudesCompra, solicitudCompraAdjuntos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  const [sol] = await db.select().from(solicitudesCompra).where(eq(solicitudesCompra.id, id)).limit(1);
  if (!sol) return Response.json({ error: "No encontrada" }, { status: 404 });
  if (sol.estado !== "borrador") {
    return Response.json({ error: "Solo se pueden subir archivos a solicitudes en borrador" }, { status: 400 });
  }

  const formData = await ctx.request.formData().catch(() => null);
  if (!formData) return Response.json({ error: "Datos inválidos" }, { status: 400 });
  const file = formData.get("file") as File | null;
  if (!file) return Response.json({ error: "Archivo requerido" }, { status: 400 });

  const env = getEnv(ctx);
  const r2Key = `sc/${id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await env.R2.put(r2Key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

  const [row] = await db.insert(solicitudCompraAdjuntos).values({
    solicitudId: id,
    nombre: file.name,
    contentType: file.type,
    tamano: file.size,
    r2Key,
  }).returning();

  return Response.json({ adjunto: row }, { status: 201 });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  // adjunto id is in query string: ?adjuntoId=X
  const adjId = Number(new URL(ctx.request.url).searchParams.get("adjuntoId"));
  if (!adjId) return Response.json({ error: "adjuntoId requerido" }, { status: 400 });
  const db = getDb(ctx);
  const [adj] = await db.select().from(solicitudCompraAdjuntos).where(eq(solicitudCompraAdjuntos.id, adjId)).limit(1);
  if (!adj) return Response.json({ error: "No encontrado" }, { status: 404 });
  const env = getEnv(ctx);
  await env.R2.delete(adj.r2Key);
  await db.delete(solicitudCompraAdjuntos).where(eq(solicitudCompraAdjuntos.id, adjId));
  return Response.json({ ok: true });
};
