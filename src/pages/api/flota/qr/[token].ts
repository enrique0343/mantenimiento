import type { APIRoute } from "astro";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { vehiculos, viajes, usuarios, viajePropositos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeVerFlota } from "@/lib/flota";

export const prerender = false;

// Resuelve un token de QR a info del vehiculo + viaje activo si existe
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerFlota(user.rol)) return new Response("Sin permisos", { status: 403 });

  const token = ctx.params.token;
  if (!token) return Response.json({ error: "Token requerido" }, { status: 400 });
  const db = getDb(ctx);

  const [v] = await db.select().from(vehiculos).where(eq(vehiculos.qrToken, token)).limit(1);
  if (!v) return Response.json({ error: "Vehículo no encontrado" }, { status: 404 });

  // Viaje en curso (si existe)
  const [activo] = await db
    .select({ viaje: viajes, motorista: usuarios, proposito: viajePropositos })
    .from(viajes)
    .leftJoin(usuarios, eq(usuarios.id, viajes.motoristaId))
    .leftJoin(viajePropositos, eq(viajePropositos.id, viajes.propositoId))
    .where(and(eq(viajes.vehiculoId, v.id), eq(viajes.estado, "en_curso")))
    .limit(1);

  // Lista de propositos para el form
  const propositos = await db
    .select()
    .from(viajePropositos)
    .where(eq(viajePropositos.activo, true))
    .orderBy(viajePropositos.orden);

  // ¿Hay otro viaje en curso del mismo motorista en otro vehiculo?
  const [otroViajeMio] = await db
    .select()
    .from(viajes)
    .where(and(eq(viajes.motoristaId, user.id), eq(viajes.estado, "en_curso")))
    .limit(1);

  const esMioElViaje = activo?.viaje && activo.viaje.motoristaId === user.id;

  return Response.json({
    vehiculo: v,
    viajeActivo: activo
      ? {
          ...activo.viaje,
          motorista: activo.motorista ? { id: activo.motorista.id, nombre: activo.motorista.nombre } : null,
          proposito: activo.proposito?.nombre ?? null,
          esMio: !!esMioElViaje,
        }
      : null,
    propositos,
    bloqueoOtroVehiculo: otroViajeMio && otroViajeMio.vehiculoId !== v.id ? otroViajeMio.vehiculoId : null,
  });
};
