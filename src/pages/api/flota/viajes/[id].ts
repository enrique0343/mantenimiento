import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, and, lte, isNotNull } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { vehiculos, viajes, planesVehiculo, ordenes } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { haversineKm } from "@/lib/flota";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  const [v] = await db.select().from(viajes).where(eq(viajes.id, id)).limit(1);
  if (!v) return Response.json({ error: "No encontrado" }, { status: 404 });
  return Response.json({ viaje: v });
};

const finalizarSchema = z.object({
  kmFinal: z.number().nonnegative(),
  finLat: z.number().nullable().optional(),
  finLng: z.number().nullable().optional(),
  fotoOdometroBase64: z.string().min(20),
});

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const m = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!m) throw new Error("Foto invalida");
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, contentType: m[1] };
}

// PATCH: finalizar viaje
export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const env = getEnv(ctx);
  const db = getDb(ctx);

  const [viaje] = await db.select().from(viajes).where(eq(viajes.id, id)).limit(1);
  if (!viaje) return Response.json({ error: "No encontrado" }, { status: 404 });
  if (viaje.estado !== "en_curso") return Response.json({ error: "Viaje no está en curso" }, { status: 400 });

  // Solo el motorista del viaje (o admin/jefe) puede finalizarlo
  if (viaje.motoristaId !== user.id && user.rol !== "admin" && user.rol !== "jefe") {
    return Response.json({ error: "Solo el motorista del viaje o un admin puede finalizarlo" }, { status: 403 });
  }

  const body = await ctx.request.json().catch(() => null);
  const parsed = finalizarSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  if (parsed.data.kmFinal < viaje.kmInicial) {
    return Response.json(
      { error: `Km final (${parsed.data.kmFinal}) no puede ser menor al km inicial (${viaje.kmInicial})` },
      { status: 400 }
    );
  }

  // Sube foto fin
  let fotoR2Key: string | null = null;
  try {
    const { bytes, contentType } = dataUrlToBytes(parsed.data.fotoOdometroBase64);
    fotoR2Key = `flota/${viaje.vehiculoId}/odometro/${Date.now()}-fin.${contentType.split("/")[1] ?? "png"}`;
    await env.R2.put(fotoR2Key, bytes, { httpMetadata: { contentType } });
  } catch {
    return Response.json({ error: "Foto del odómetro inválida" }, { status: 400 });
  }

  // Calculos
  const ahora = new Date();
  const inicio = new Date(viaje.inicio);
  const duracionMin = Math.max(0, Math.round((ahora.getTime() - inicio.getTime()) / 60000));
  const kmRecorrido = parsed.data.kmFinal - viaje.kmInicial;
  let distanciaGps: number | null = null;
  if (viaje.inicioLat != null && viaje.inicioLng != null && parsed.data.finLat != null && parsed.data.finLng != null) {
    distanciaGps = haversineKm(viaje.inicioLat, viaje.inicioLng, parsed.data.finLat, parsed.data.finLng);
  }

  // Cierra viaje
  await db
    .update(viajes)
    .set({
      kmFinal: parsed.data.kmFinal,
      kmRecorrido,
      fin: ahora.toISOString(),
      duracionMin,
      finLat: parsed.data.finLat ?? null,
      finLng: parsed.data.finLng ?? null,
      distanciaGpsKm: distanciaGps,
      fotoOdometroFinR2: fotoR2Key,
      estado: "finalizado",
    })
    .where(eq(viajes.id, id));

  // Actualiza vehiculo
  await db
    .update(vehiculos)
    .set({ estado: "disponible", kilometrajeActual: parsed.data.kmFinal })
    .where(eq(vehiculos.id, viaje.vehiculoId));

  // Revisa planes por km que se hayan disparado
  const planes = await db
    .select()
    .from(planesVehiculo)
    .where(
      and(
        eq(planesVehiculo.vehiculoId, viaje.vehiculoId),
        eq(planesVehiculo.activo, true),
        isNotNull(planesVehiculo.kmProximo),
        lte(planesVehiculo.kmProximo, parsed.data.kmFinal)
      )
    );

  const otsGeneradas: number[] = [];
  for (const p of planes) {
    const [veh] = await db.select().from(vehiculos).where(eq(vehiculos.id, viaje.vehiculoId)).limit(1);
    const titulo = `[Preventivo · ${veh?.placa ?? veh?.codigo ?? "Vehículo"}] ${p.titulo}`;
    const desc = `${p.descripcion ?? ""}\nGenerada automáticamente al alcanzar ${parsed.data.kmFinal} km.`.trim();
    const [orden] = await db
      .insert(ordenes)
      .values({
        titulo,
        descripcion: desc,
        tipo: "preventivo",
        prioridad: p.prioridad,
        estado: "abierta",
        vehiculoId: viaje.vehiculoId,
        asignadoA: p.asignadoA,
        creadoPor: user.id,
      })
      .returning({ id: ordenes.id });
    otsGeneradas.push(orden.id);
    // Avanza km_proximo
    const nuevoKmProximo = p.kmIntervalo ? parsed.data.kmFinal + p.kmIntervalo : null;
    await db
      .update(planesVehiculo)
      .set({ kmProximo: nuevoKmProximo, ultimaGeneracion: ahora.toISOString() })
      .where(eq(planesVehiculo.id, p.id));
  }

  return Response.json({
    ok: true,
    kmRecorrido,
    duracionMin,
    distanciaGpsKm: distanciaGps,
    ordenesGeneradas: otsGeneradas,
  });
};

// DELETE: cancelar viaje
export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);

  const [viaje] = await db.select().from(viajes).where(eq(viajes.id, id)).limit(1);
  if (!viaje) return Response.json({ error: "No encontrado" }, { status: 404 });
  if (viaje.estado !== "en_curso") return Response.json({ error: "Viaje no está en curso" }, { status: 400 });
  if (viaje.motoristaId !== user.id && user.rol !== "admin" && user.rol !== "jefe") {
    return Response.json({ error: "Sin permisos" }, { status: 403 });
  }

  await db.update(viajes).set({ estado: "cancelado", fin: new Date().toISOString() }).where(eq(viajes.id, id));
  await db.update(vehiculos).set({ estado: "disponible" }).where(eq(vehiculos.id, viaje.vehiculoId));
  return Response.json({ ok: true });
};
