// AOP · umbrales: el rango de alerta que vive sobre el activo.
// "Los AOP no ocupan filas del plan; viven como umbrales sobre los activos."
// De aquí salen los minutos del reloj de cada episodio.
import type { APIRoute } from "astro";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { puedeAdministrarAop, puedeVerAop } from "@/lib/aop";
import { aopUmbrales, procedimientos } from "@/lib/schema";

export const prerender = false;

const baseSchema = z.object({
  procedimientoId: z.number().int().positive(),
  variableId: z.number().int().positive().nullable().optional(),
  activoId: z.number().int().positive().nullable().optional(),
  ubicacionId: z.number().int().positive().nullable().optional(),
  minAlerta: z.number().nullable().optional(),
  maxAlerta: z.number().nullable().optional(),
  minutosParaActuar: z.number().int().min(0).max(100_000).nullable().optional(),
  minutosParaEscalar: z.number().int().min(0).max(100_000).nullable().optional(),
  minutosEventoPersistente: z.number().int().min(0).max(100_000).nullable().optional(),
  eopProcedimientoId: z.number().int().positive().nullable().optional(),
});

const crearSchema = baseSchema
  .refine((d) => d.variableId != null || d.activoId != null || d.ubicacionId != null, {
    message: "El umbral tiene que colgar de una variable, un activo o una sala",
  })
  .refine((d) => d.minAlerta != null || d.maxAlerta != null, {
    message: "Define al menos un extremo de la banda de alerta",
  })
  .refine((d) => d.minAlerta == null || d.maxAlerta == null || d.minAlerta <= d.maxAlerta, {
    message: "El mínimo de alerta no puede ser mayor que el máximo",
  });

const editarSchema = baseSchema.partial().extend({
  id: z.number().int().positive(),
  activo: z.boolean().optional(),
});

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerAop(user.rol)) return new Response("Sin permisos", { status: 403 });

  const db = getDb(ctx);
  const umbrales = await db
    .select({ u: aopUmbrales, codigoAop: procedimientos.codigoCorto, tituloAop: procedimientos.titulo })
    .from(aopUmbrales)
    .leftJoin(procedimientos, eq(procedimientos.id, aopUmbrales.procedimientoId))
    .where(eq(aopUmbrales.activo, true))
    .orderBy(asc(aopUmbrales.procedimientoId), asc(aopUmbrales.id));
  return Response.json({ umbrales });
};

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  if (!puedeAdministrarAop(user.rol)) return new Response("Sin permisos", { status: 403 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = crearSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [proc] = await db
    .select({ id: procedimientos.id, tipo: procedimientos.tipo })
    .from(procedimientos)
    .where(and(eq(procedimientos.id, parsed.data.procedimientoId), eq(procedimientos.activo, true)))
    .limit(1);
  if (!proc) return Response.json({ error: "Procedimiento no encontrado" }, { status: 404 });
  if (proc.tipo !== "aop") {
    return Response.json({ error: "El umbral sólo cuelga de un procedimiento tipo AOP" }, { status: 400 });
  }

  const [row] = await db.insert(aopUmbrales).values(parsed.data).returning();
  return Response.json({ umbral: row }, { status: 201 });
};

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  if (!puedeAdministrarAop(user.rol)) return new Response("Sin permisos", { status: 403 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = editarSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const { id, ...cambios } = parsed.data;
  if (Object.keys(cambios).length === 0) {
    return Response.json({ error: "Nada que cambiar" }, { status: 400 });
  }
  if (cambios.minAlerta != null && cambios.maxAlerta != null && cambios.minAlerta > cambios.maxAlerta) {
    return Response.json({ error: "El mínimo de alerta no puede ser mayor que el máximo" }, { status: 400 });
  }

  const db = getDb(ctx);
  const [row] = await db.update(aopUmbrales).set(cambios).where(eq(aopUmbrales.id, id)).returning();
  if (!row) return Response.json({ error: "Umbral no encontrado" }, { status: 404 });
  return Response.json({ umbral: row });
};

/** Baja lógica: los episodios ya abiertos conservan su referencia. */
export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  if (!puedeAdministrarAop(user.rol)) return new Response("Sin permisos", { status: 403 });

  const id = Number(new URL(ctx.request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "ID inválido" }, { status: 400 });

  const db = getDb(ctx);
  const [row] = await db.update(aopUmbrales).set({ activo: false }).where(eq(aopUmbrales.id, id)).returning();
  if (!row) return Response.json({ error: "Umbral no encontrado" }, { status: 404 });
  return Response.json({ ok: true });
};
