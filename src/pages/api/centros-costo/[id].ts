import type { APIRoute } from "astro";
import { z } from "zod";
import { and, eq, ne, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { activos, centrosCosto, sucursales, ubicaciones } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { calcularDiff, logAudit } from "@/lib/audit";
import { ROLES_BIO_GESTIONAR, etiquetaCentroCosto } from "@/lib/biomedico";
import { errorCodigoCentro, errorNombreCentro, normalizarCodigoCentro, normalizarNombreCentro } from "@/lib/registro-activos";

export const prerender = false;

const patchSchema = z.object({
  codigo: z.string().optional(),
  nombre: z.string().optional(),
  sucursalId: z.number().int().positive().nullable().optional(),
  activo: z.boolean().optional(),
});

const equiposDelCentro = async (db: ReturnType<typeof getDb>, id: number) =>
  Number((await db.select({ n: sql<number>`count(*)` }).from(activos).where(eq(activos.centroCostoId, id)))[0]?.n ?? 0);

/** PATCH { codigo?, nombre?, sucursalId?, activo? } (admin y jefe). */
export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ROLES_BIO_GESTIONAR);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const parsed = patchSchema.safeParse(await ctx.request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Datos del centro no válidos." }, { status: 400 });
  const db = getDb(ctx);
  const [actual] = await db.select().from(centrosCosto).where(eq(centrosCosto.id, id)).limit(1);
  if (!actual) return Response.json({ error: "El centro de costo no existe." }, { status: 404 });

  const cambios: Partial<typeof centrosCosto.$inferInsert> = {};
  if (parsed.data.codigo !== undefined) {
    const codigo = normalizarCodigoCentro(parsed.data.codigo);
    const error = errorCodigoCentro(codigo);
    if (error) return Response.json({ error }, { status: 400 });
    if (codigo !== actual.codigo) {
      const [otro] = await db.select({ id: centrosCosto.id }).from(centrosCosto).where(and(eq(centrosCosto.codigo, codigo), ne(centrosCosto.id, id))).limit(1);
      if (otro) return Response.json({ error: `El código «${codigo}» ya existe.` }, { status: 409 });
      cambios.codigo = codigo;
    }
  }
  if (parsed.data.nombre !== undefined) {
    const nombre = normalizarNombreCentro(parsed.data.nombre);
    const error = errorNombreCentro(nombre);
    if (error) return Response.json({ error }, { status: 400 });
    if (nombre !== actual.nombre) cambios.nombre = nombre;
  }
  if (parsed.data.sucursalId !== undefined && parsed.data.sucursalId !== actual.sucursalId) {
    const sede = parsed.data.sucursalId;
    if (sede != null) {
      const [existe] = await db.select({ id: sucursales.id }).from(sucursales).where(eq(sucursales.id, sede)).limit(1);
      if (!existe) return Response.json({ error: "La sede no existe." }, { status: 400 });
      // Los equipos del centro deben estar en la sede nueva.
      const [fuera] = await db.select({ n: sql<number>`count(*)` }).from(activos)
        .innerJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId))
        .where(and(eq(activos.centroCostoId, id), ne(ubicaciones.sucursalId, sede)));
      const n = Number(fuera?.n ?? 0);
      if (n > 0) return Response.json({ error: `Hay ${n} ${n === 1 ? "equipo" : "equipos"} de este centro en otras sedes; cámbialos primero.` }, { status: 409 });
    }
    cambios.sucursalId = sede;
  }
  if (parsed.data.activo !== undefined && parsed.data.activo !== actual.activo) cambios.activo = parsed.data.activo;
  if (!Object.keys(cambios).length) return Response.json({ centro: actual });

  let centro: typeof centrosCosto.$inferSelect | undefined;
  try {
    [centro] = await db.update(centrosCosto).set({ ...cambios, updatedAt: new Date().toISOString() }).where(eq(centrosCosto.id, id)).returning();
  } catch (error) {
    if (/UNIQUE constraint failed: centros_costo\.codigo/i.test(String((error as Error)?.message ?? error) + String((error as { cause?: Error })?.cause?.message ?? ""))) {
      return Response.json({ error: `El código «${cambios.codigo}» ya existe.` }, { status: 409 });
    }
    throw error;
  }
  const resumen = cambios.activo === false ? `Centro de costo desactivado: ${etiquetaCentroCosto(centro!)}`
    : cambios.activo === true ? `Centro de costo activado: ${etiquetaCentroCosto(centro!)}`
    : undefined;
  await logAudit(ctx, { entidad: "centro_costo", entidadId: id, accion: cambios.activo !== undefined ? "estado" : "update", cambios: calcularDiff(actual as any, cambios as any), resumen });
  return Response.json({ centro });
};

/** DELETE (admin y jefe): solo un centro sin equipos. */
export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ROLES_BIO_GESTIONAR);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  const [actual] = await db.select().from(centrosCosto).where(eq(centrosCosto.id, id)).limit(1);
  if (!actual) return Response.json({ error: "El centro de costo no existe." }, { status: 404 });
  const tiene = async () => {
    const n = await equiposDelCentro(db, id);
    return n > 0 ? Response.json({ error: `Tiene ${n} ${n === 1 ? "equipo" : "equipos"}: desactívalo en lugar de borrarlo.` }, { status: 409 }) : null;
  };
  const enUso = await tiene();
  if (enUso) return enUso;
  try {
    await db.delete(centrosCosto).where(eq(centrosCosto.id, id));
  } catch (error) {
    // Un equipo se asignó al centro entre la revisión y el borrado.
    const ahora = await tiene();
    if (ahora) return ahora;
    throw error;
  }
  await logAudit(ctx, { entidad: "centro_costo", entidadId: id, accion: "delete", resumen: `Centro de costo eliminado: ${etiquetaCentroCosto(actual)}` });
  return Response.json({ ok: true });
};
