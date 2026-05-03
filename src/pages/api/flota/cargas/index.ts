import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { cargasCombustible, vehiculos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeVerFlota } from "@/lib/flota";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerFlota(user.rol)) return new Response("Sin permisos", { status: 403 });
  const db = getDb(ctx);
  const url = new URL(ctx.request.url);
  const vehiculoId = url.searchParams.get("vehiculo_id");
  const rows = vehiculoId
    ? await db.select().from(cargasCombustible).where(eq(cargasCombustible.vehiculoId, Number(vehiculoId))).orderBy(desc(cargasCombustible.id))
    : await db.select().from(cargasCombustible).orderBy(desc(cargasCombustible.id)).limit(100);
  return Response.json({ cargas: rows });
};

const createSchema = z.object({
  vehiculoId: z.number().int().positive(),
  litros: z.number().positive(),
  monto: z.number().nonnegative(),
  kmAlCargar: z.number().nonnegative().nullable().optional(),
  estacion: z.string().nullable().optional(),
  notas: z.string().nullable().optional(),
  reciboBase64: z.string().optional().nullable(),
});

function dataUrlToBytes(dataUrl: string) {
  const m = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, contentType: m[1] };
}

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerFlota(user.rol)) return new Response("Sin permisos", { status: 403 });
  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const env = getEnv(ctx);
  const db = getDb(ctx);

  let reciboKey: string | null = null;
  if (parsed.data.reciboBase64) {
    const r = dataUrlToBytes(parsed.data.reciboBase64);
    if (r) {
      reciboKey = `flota/${parsed.data.vehiculoId}/recibos/${Date.now()}.${r.contentType.split("/")[1] ?? "png"}`;
      await env.R2.put(reciboKey, r.bytes, { httpMetadata: { contentType: r.contentType } });
    }
  }

  const precioLitro = parsed.data.litros > 0 ? parsed.data.monto / parsed.data.litros : null;

  const [row] = await db
    .insert(cargasCombustible)
    .values({
      vehiculoId: parsed.data.vehiculoId,
      motoristaId: user.id,
      litros: parsed.data.litros,
      monto: parsed.data.monto,
      precioLitro,
      kmAlCargar: parsed.data.kmAlCargar ?? null,
      estacion: parsed.data.estacion ?? null,
      reciboR2: reciboKey,
      notas: parsed.data.notas ?? null,
    })
    .returning();
  return Response.json({ carga: row }, { status: 201 });
};
