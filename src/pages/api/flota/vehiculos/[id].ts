import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  vehiculos, vehiculoDocumentos, viajes, cargasCombustible, planesVehiculo, usuarios,
} from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeVerFlota, puedeAdministrarFlota } from "@/lib/flota";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerFlota(user.rol)) return new Response("Sin permisos", { status: 403 });
  const id = Number(ctx.params.id);
  const db = getDb(ctx);

  const [v] = await db.select().from(vehiculos).where(eq(vehiculos.id, id)).limit(1);
  if (!v) return Response.json({ error: "No encontrado" }, { status: 404 });

  const docs = await db.select().from(vehiculoDocumentos).where(eq(vehiculoDocumentos.vehiculoId, id));
  const ultimosViajes = await db
    .select({ v: viajes, m: usuarios })
    .from(viajes)
    .leftJoin(usuarios, eq(usuarios.id, viajes.motoristaId))
    .where(eq(viajes.vehiculoId, id))
    .orderBy(desc(viajes.id))
    .limit(20);
  const ultimasCargas = await db
    .select({ c: cargasCombustible, m: usuarios })
    .from(cargasCombustible)
    .leftJoin(usuarios, eq(usuarios.id, cargasCombustible.motoristaId))
    .where(eq(cargasCombustible.vehiculoId, id))
    .orderBy(desc(cargasCombustible.id))
    .limit(20);
  const planes = await db.select().from(planesVehiculo).where(eq(planesVehiculo.vehiculoId, id));

  return Response.json({
    vehiculo: v,
    documentos: docs,
    viajes: ultimosViajes.map((r) => ({ ...r.v, motorista: r.m ? { id: r.m.id, nombre: r.m.nombre } : null })),
    cargas: ultimasCargas.map((r) => ({ ...r.c, motorista: r.m ? { id: r.m.id, nombre: r.m.nombre } : null })),
    planes,
  });
};

const updateSchema = z.object({
  codigo: z.string().min(1).optional(),
  placa: z.string().min(1).optional(),
  marca: z.string().min(1).optional(),
  modelo: z.string().min(1).optional(),
  anio: z.number().int().nullable().optional(),
  color: z.string().nullable().optional(),
  vin: z.string().nullable().optional(),
  tipo: z.enum(["carro", "pickup", "moto", "camion", "microbus", "otro"]).optional(),
  combustible: z.enum(["gasolina", "diesel", "electrico", "hibrido"]).optional(),
  capacidadTanque: z.number().nullable().optional(),
  kilometrajeActual: z.number().nonnegative().optional(),
  estado: z.enum(["disponible", "en_viaje", "mantenimiento", "baja"]).optional(),
  notas: z.string().nullable().optional(),
  activo: z.boolean().optional(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarFlota(user.rol)) return new Response("Sin permisos", { status: 403 });
  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const [row] = await db.update(vehiculos).set(parsed.data).where(eq(vehiculos.id, id)).returning();
  return Response.json({ vehiculo: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  // Soft delete
  await db.update(vehiculos).set({ activo: false, estado: "baja" }).where(eq(vehiculos.id, id));
  return Response.json({ ok: true });
};
