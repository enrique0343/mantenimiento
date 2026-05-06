import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { empresa } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

// GET: sirve el logo (público — para que el formulario /soporte pueda mostrarlo)
export const GET: APIRoute = async (ctx) => {
  const db = getDb(ctx);
  const [emp] = await db.select().from(empresa).limit(1);
  if (!emp?.logoR2Key) return new Response("Sin logo", { status: 404 });
  const env = getEnv(ctx);
  const obj = await env.R2.get(emp.logoR2Key);
  if (!obj) return new Response("No disponible", { status: 410 });
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "image/png",
      "cache-control": "public, max-age=3600",
    },
  });
};

// POST: sube/reemplaza el logo (solo admin)
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;

  const form = await ctx.request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Archivo requerido" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return Response.json({ error: "Solo imágenes (PNG, JPG, SVG, WEBP)" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "Archivo supera 2MB" }, { status: 413 });
  }

  const db = getDb(ctx);
  const env = getEnv(ctx);

  // Borrar logo anterior si existe
  const [actual] = await db.select().from(empresa).limit(1);
  if (actual?.logoR2Key) {
    await env.R2.delete(actual.logoR2Key).catch(() => {});
  }

  const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const r2Key = `empresa/logo-${Date.now()}.${ext}`;
  await env.R2.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });

  await db.update(empresa).set({ logoR2Key: r2Key }).where(eq(empresa.id, 1));
  return Response.json({ ok: true, logoR2Key: r2Key });
};

// DELETE: elimina el logo (solo admin)
export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const db = getDb(ctx);
  const env = getEnv(ctx);
  const [actual] = await db.select().from(empresa).limit(1);
  if (actual?.logoR2Key) await env.R2.delete(actual.logoR2Key).catch(() => {});
  await db.update(empresa).set({ logoR2Key: null }).where(eq(empresa.id, 1));
  return Response.json({ ok: true });
};
