import type { APIRoute } from "astro";
import { z } from "zod";
import { getDb, getEnv } from "@/lib/db";
import { vehiculoDocumentos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeAdministrarFlota } from "@/lib/flota";

export const prerender = false;

const schema = z.object({
  vehiculoId: z.number().int().positive(),
  tipo: z.enum(["tarjeta_circulacion", "seguro", "revision_tecnica", "otro"]),
  numero: z.string().nullable().optional(),
  vencimiento: z.string().nullable().optional(),
  notas: z.string().nullable().optional(),
  archivoBase64: z.string().nullable().optional(),
});

function dataUrlToBytes(dataUrl: string) {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, contentType: m[1] };
}

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarFlota(user.rol)) return new Response("Sin permisos", { status: 403 });
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const env = getEnv(ctx);
  const db = getDb(ctx);

  let r2Key: string | null = null;
  if (parsed.data.archivoBase64) {
    const r = dataUrlToBytes(parsed.data.archivoBase64);
    if (r) {
      const ext = (r.contentType.split("/")[1] ?? "bin").split("+")[0];
      r2Key = `flota/${parsed.data.vehiculoId}/docs/${parsed.data.tipo}-${Date.now()}.${ext}`;
      await env.R2.put(r2Key, r.bytes, { httpMetadata: { contentType: r.contentType } });
    }
  }

  const [row] = await db
    .insert(vehiculoDocumentos)
    .values({
      vehiculoId: parsed.data.vehiculoId,
      tipo: parsed.data.tipo,
      numero: parsed.data.numero ?? null,
      vencimiento: parsed.data.vencimiento ?? null,
      notas: parsed.data.notas ?? null,
      r2Key,
    })
    .returning();
  return Response.json({ documento: row }, { status: 201 });
};
