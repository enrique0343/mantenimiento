import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { vehiculos, viajes, usuarios } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeVerFlota } from "@/lib/flota";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerFlota(user.rol)) return new Response("Sin permisos", { status: 403 });
  const db = getDb(ctx);
  const url = new URL(ctx.request.url);
  const motoristaQuery = url.searchParams.get("motorista");
  const motoristaId = motoristaQuery === "me" ? user.id : motoristaQuery ? Number(motoristaQuery) : null;
  const rows = motoristaId
    ? await db
        .select({ v: viajes, veh: vehiculos })
        .from(viajes)
        .leftJoin(vehiculos, eq(vehiculos.id, viajes.vehiculoId))
        .where(eq(viajes.motoristaId, motoristaId))
        .orderBy(desc(viajes.id))
        .limit(100)
    : await db
        .select({ v: viajes, veh: vehiculos })
        .from(viajes)
        .leftJoin(vehiculos, eq(vehiculos.id, viajes.vehiculoId))
        .orderBy(desc(viajes.id))
        .limit(100);
  return Response.json({
    viajes: rows.map((r) => ({
      ...r.v,
      vehiculo: r.veh ? { id: r.veh.id, codigo: r.veh.codigo, placa: r.veh.placa, marca: r.veh.marca, modelo: r.veh.modelo } : null,
    })),
  });
};

const iniciarSchema = z.object({
  vehiculoId: z.number().int().positive(),
  propositoId: z.number().int().nullable().optional(),
  destino: z.string().min(1),
  notas: z.string().nullable().optional(),
  kmInicial: z.number().nonnegative(),
  inicioLat: z.number().nullable().optional(),
  inicioLng: z.number().nullable().optional(),
  fotoOdometroBase64: z.string().min(20), // dataURL de la foto del odometro (obligatorio)
});

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const m = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!m) throw new Error("Foto invalida");
  const ct = m[1];
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, contentType: ct };
}

// POST: iniciar viaje
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerFlota(user.rol)) return new Response("Sin permisos", { status: 403 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = iniciarSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const env = getEnv(ctx);
  const db = getDb(ctx);

  // Validaciones
  const [v] = await db.select().from(vehiculos).where(eq(vehiculos.id, parsed.data.vehiculoId)).limit(1);
  if (!v) return Response.json({ error: "Vehículo no existe" }, { status: 404 });
  if (v.estado !== "disponible") {
    return Response.json({ error: `Vehículo no disponible (estado: ${v.estado})` }, { status: 409 });
  }
  if (parsed.data.kmInicial < v.kilometrajeActual) {
    return Response.json(
      { error: `Km inicial (${parsed.data.kmInicial}) menor al kilometraje registrado (${v.kilometrajeActual})` },
      { status: 400 }
    );
  }

  // Verifica que el motorista no tenga otro viaje en curso
  const [otro] = await db
    .select()
    .from(viajes)
    .where(and(eq(viajes.motoristaId, user.id), eq(viajes.estado, "en_curso")))
    .limit(1);
  if (otro) {
    return Response.json({ error: `Ya tienes un viaje en curso (vehículo #${otro.vehiculoId})` }, { status: 409 });
  }

  // Sube foto del odometro a R2 (obligatorio)
  let fotoR2Key: string | null = null;
  try {
    const { bytes, contentType } = dataUrlToBytes(parsed.data.fotoOdometroBase64);
    fotoR2Key = `flota/${v.id}/odometro/${Date.now()}-inicio.${contentType.split("/")[1] ?? "png"}`;
    await env.R2.put(fotoR2Key, bytes, { httpMetadata: { contentType } });
  } catch {
    return Response.json({ error: "Foto del odómetro inválida" }, { status: 400 });
  }

  const [viaje] = await db
    .insert(viajes)
    .values({
      vehiculoId: v.id,
      motoristaId: user.id,
      propositoId: parsed.data.propositoId ?? null,
      destino: parsed.data.destino,
      notas: parsed.data.notas ?? null,
      kmInicial: parsed.data.kmInicial,
      inicioLat: parsed.data.inicioLat ?? null,
      inicioLng: parsed.data.inicioLng ?? null,
      fotoOdometroInicioR2: fotoR2Key,
    })
    .returning();

  // Pasa vehiculo a en_viaje
  await db.update(vehiculos).set({ estado: "en_viaje", kilometrajeActual: parsed.data.kmInicial }).where(eq(vehiculos.id, v.id));

  return Response.json({ viaje }, { status: 201 });
};
