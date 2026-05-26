import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { activoDocumentos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const prerender = false;

const MAX_BYTES = 15 * 1024 * 1024;
const CATEGORIAS = ["ficha_tecnica", "manual", "garantia", "instalacion", "otro"];

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;

  const activoId = Number(ctx.params.id);
  const form = await ctx.request.formData().catch(() => null);
  const file = form?.get("file");
  let categoria = String(form?.get("categoria") ?? "ficha_tecnica");
  if (!CATEGORIAS.includes(categoria)) categoria = "otro";
  if (!(file instanceof File)) return Response.json({ error: "Archivo requerido" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "Archivo supera 15MB" }, { status: 413 });

  const env = getEnv(ctx);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const r2Key = `activos/${activoId}/docs/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  await env.R2.put(r2Key, file.stream(), { httpMetadata: { contentType: file.type } });

  const db = getDb(ctx);
  const [row] = await db.insert(activoDocumentos).values({
    activoId,
    nombre: file.name,
    contentType: file.type || "application/octet-stream",
    tamano: file.size,
    r2Key,
    categoria,
    usuarioId: user.id,
  }).returning();
  await logAudit(ctx, { entidad: "activo", entidadId: activoId, accion: "update", resumen: `Documento agregado: ${file.name}` });
  return Response.json({ documento: row }, { status: 201 });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;

  const activoId = Number(ctx.params.id);
  const docId = Number(new URL(ctx.request.url).searchParams.get("documentoId"));
  if (!docId) return Response.json({ error: "documentoId requerido" }, { status: 400 });
  const db = getDb(ctx);
  const [doc] = await db.select().from(activoDocumentos).where(eq(activoDocumentos.id, docId)).limit(1);
  if (!doc) return Response.json({ error: "No encontrado" }, { status: 404 });
  const env = getEnv(ctx);
  await env.R2.delete(doc.r2Key).catch(() => {});
  await db.delete(activoDocumentos).where(eq(activoDocumentos.id, docId));
  await logAudit(ctx, { entidad: "activo", entidadId: activoId, accion: "update", resumen: `Documento eliminado: ${doc.nombre}` });
  return Response.json({ ok: true });
};
