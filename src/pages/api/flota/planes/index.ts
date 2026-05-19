import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { planesVehiculo, vehiculos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeAdministrarFlota, puedeVerFlota } from "@/lib/flota";

export const prerender = false;

const createSchema = z.object({
  vehiculoId: z.number().int().positive(),
  titulo: z.string().min(1),
  descripcion: z.string().nullable().optional(),
  kmIntervalo: z.number().positive().nullable().optional(),
  frecuenciaMeses: z.number().int().positive().nullable().optional(),
  proximaFecha: z.string().nullable().optional(),
  prioridad: z.enum(["baja", "media", "alta", "urgente"]).default("media"),
  asignadoA: z.number().int().nullable().optional(),
});

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerFlota(user.rol)) return new Response("Sin permisos", { status: 403 });
  const db = getDb(ctx);
  const url = new URL(ctx.request.url);
  const vehiculoId = url.searchParams.get("vehiculo_id");
  const rows = vehiculoId
    ? await db.select().from(planesVehiculo).where(eq(planesVehiculo.vehiculoId, Number(vehiculoId)))
    : await db.select().from(planesVehiculo);
  return Response.json({ planes: rows });
};

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarFlota(user.rol)) return new Response("Sin permisos", { status: 403 });
  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  if (!parsed.data.kmIntervalo && !parsed.data.frecuenciaMeses) {
    return Response.json({ error: "Debes definir intervalo por km y/o por meses" }, { status: 400 });
  }

  const db = getDb(ctx);
  const [v] = await db.select().from(vehiculos).where(eq(vehiculos.id, parsed.data.vehiculoId)).limit(1);
  if (!v) return Response.json({ error: "Vehículo no existe" }, { status: 404 });

  // Calcula proximo km y proxima fecha
  const kmProximo = parsed.data.kmIntervalo ? v.kilometrajeActual + parsed.data.kmIntervalo : null;
  let proximaFecha = parsed.data.proximaFecha ?? null;
  if (!proximaFecha && parsed.data.frecuenciaMeses) {
    const d = new Date();
    d.setMonth(d.getMonth() + parsed.data.frecuenciaMeses);
    proximaFecha = d.toISOString().slice(0, 10);
  }

  const [row] = await db
    .insert(planesVehiculo)
    .values({
      vehiculoId: parsed.data.vehiculoId,
      titulo: parsed.data.titulo,
      descripcion: parsed.data.descripcion ?? null,
      kmIntervalo: parsed.data.kmIntervalo ?? null,
      kmProximo,
      frecuenciaMeses: parsed.data.frecuenciaMeses ?? null,
      proximaFecha,
      prioridad: parsed.data.prioridad,
      asignadoA: parsed.data.asignadoA ?? null,
    })
    .returning();
  return Response.json({ plan: row }, { status: 201 });
};
