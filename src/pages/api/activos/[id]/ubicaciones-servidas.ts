// Mapa de distribución del SCP (Fase 47, GO-GUI-011-2026 cap. 03).
// «Un activo por manejadora con la lista de salas servidas»: una manejadora
// sirve varias salas, un tablero alimenta varios servicios. Esta relación es
// el mapa que pide FMS.08.00.
import type { APIRoute } from "astro";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { activoUbicacionesServidas, activos, ubicaciones } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { ROLES_UBICACION_SERVIDA } from "@/lib/jerarquia";

export const prerender = false;

const createSchema = z.object({
  ubicacionId: z.number().int().positive(),
  rol: z.enum(ROLES_UBICACION_SERVIDA).default("sirve"),
  notas: z.string().nullable().optional(),
});

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const activoId = Number(ctx.params.id);
  if (!Number.isFinite(activoId)) return Response.json({ error: "Activo inválido" }, { status: 400 });

  const db = getDb(ctx);
  const rows = await db
    .select({ rel: activoUbicacionesServidas, ubicacion: ubicaciones })
    .from(activoUbicacionesServidas)
    .innerJoin(ubicaciones, eq(ubicaciones.id, activoUbicacionesServidas.ubicacionId))
    .where(eq(activoUbicacionesServidas.activoId, activoId))
    .orderBy(asc(ubicaciones.nombre));
  return Response.json({ ubicacionesServidas: rows });
};

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const activoId = Number(ctx.params.id);
  if (!Number.isFinite(activoId)) return Response.json({ error: "Activo inválido" }, { status: 400 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [act] = await db.select({ id: activos.id }).from(activos).where(eq(activos.id, activoId)).limit(1);
  if (!act) return Response.json({ error: "Activo no encontrado" }, { status: 404 });

  const [ubic] = await db
    .select({ id: ubicaciones.id, nombre: ubicaciones.nombre })
    .from(ubicaciones).where(eq(ubicaciones.id, parsed.data.ubicacionId)).limit(1);
  if (!ubic) return Response.json({ error: "Ubicación no encontrada" }, { status: 404 });

  // Una misma sala no se lista dos veces con el mismo rol.
  const [yaExiste] = await db
    .select({ id: activoUbicacionesServidas.id })
    .from(activoUbicacionesServidas)
    .where(and(
      eq(activoUbicacionesServidas.activoId, activoId),
      eq(activoUbicacionesServidas.ubicacionId, parsed.data.ubicacionId),
      eq(activoUbicacionesServidas.rol, parsed.data.rol),
    ))
    .limit(1);
  if (yaExiste) return Response.json({ error: `${ubic.nombre} ya está en el mapa con ese rol.` }, { status: 409 });

  const [row] = await db.insert(activoUbicacionesServidas).values({
    activoId,
    ubicacionId: parsed.data.ubicacionId,
    rol: parsed.data.rol,
    notas: parsed.data.notas ?? null,
  }).returning();

  await logAudit(ctx, {
    entidad: "activo", entidadId: activoId, accion: "update",
    resumen: `Mapa de distribución: ${parsed.data.rol} ${ubic.nombre}`,
  });
  return Response.json({ ubicacionServida: row }, { status: 201 });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const activoId = Number(ctx.params.id);
  const relId = Number(new URL(ctx.request.url).searchParams.get("relId"));
  if (!Number.isFinite(activoId)) return Response.json({ error: "Activo inválido" }, { status: 400 });
  if (!relId) return Response.json({ error: "relId requerido" }, { status: 400 });

  const db = getDb(ctx);
  const [rel] = await db
    .select({ rel: activoUbicacionesServidas, nombre: ubicaciones.nombre })
    .from(activoUbicacionesServidas)
    .leftJoin(ubicaciones, eq(ubicaciones.id, activoUbicacionesServidas.ubicacionId))
    .where(and(eq(activoUbicacionesServidas.id, relId), eq(activoUbicacionesServidas.activoId, activoId)))
    .limit(1);
  if (!rel) return Response.json({ error: "No encontrado" }, { status: 404 });

  await db.delete(activoUbicacionesServidas).where(eq(activoUbicacionesServidas.id, relId));
  await logAudit(ctx, {
    entidad: "activo", entidadId: activoId, accion: "update",
    resumen: `Mapa de distribución: quitada ${rel.nombre ?? "ubicación"}`,
  });
  return Response.json({ ok: true });
};
