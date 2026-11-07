// Ronda de turno · configurar las paradas del recorrido.
// Los valores normales salen de la norma, pero varios son de cada sede y el
// volumen los deja "en azul": esto es donde la jefatura los fija.
import type { APIRoute } from "astro";
import { z } from "zod";
import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { puedeConfigurarRondas } from "@/lib/rondas";
import { procedimientos, rondaPuntos, rondas } from "@/lib/schema";

export const prerender = false;

const editarSchema = z.object({
  id: z.number().int().positive(),
  minEsperado: z.number().finite().nullable().optional(),
  maxEsperado: z.number().finite().nullable().optional(),
  valorEsperadoTexto: z.string().max(300).nullable().optional(),
  instruccion: z.string().max(1000).nullable().optional(),
  critico: z.boolean().optional(),
  activo: z.boolean().optional(),
});

const crearSchema = z.object({
  rondaId: z.number().int().positive(),
  sistema: z.enum(["electrico", "hvac", "gases", "agua", "incendios", "ascensores", "otro"]),
  etiqueta: z.string().min(3).max(200),
  instruccion: z.string().max(1000).nullable().optional(),
  requiereValor: z.boolean().default(false),
  unidad: z.string().max(20).nullable().optional(),
  minEsperado: z.number().finite().nullable().optional(),
  maxEsperado: z.number().finite().nullable().optional(),
  valorEsperadoTexto: z.string().max(300).nullable().optional(),
  aopProcedimientoId: z.number().int().positive().nullable().optional(),
  critico: z.boolean().default(false),
});

/** Cambia el valor normal de una parada. */
export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  if (!puedeConfigurarRondas(user.rol)) return new Response("Sin permisos", { status: 403 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = editarSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const { id, ...campos } = parsed.data;

  const db = getDb(ctx);
  const [antes] = await db.select().from(rondaPuntos).where(eq(rondaPuntos.id, id)).limit(1);
  if (!antes) return Response.json({ error: "La parada no existe" }, { status: 404 });

  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(campos)) if (v !== undefined) data[k] = v;
  if (Object.keys(data).length === 0) return Response.json({ ok: true, punto: antes });

  // Un rango invertido no avisa nunca: se rechaza antes de guardarlo.
  const min = (data.minEsperado as number | null | undefined) ?? antes.minEsperado;
  const max = (data.maxEsperado as number | null | undefined) ?? antes.maxEsperado;
  if (min != null && max != null && min > max) {
    return Response.json({ error: "El mínimo no puede ser mayor que el máximo" }, { status: 400 });
  }

  const [row] = await db.update(rondaPuntos).set(data).where(eq(rondaPuntos.id, id)).returning();
  await logAudit(ctx, {
    entidad: "ronda_punto", entidadId: id, accion: "update",
    resumen: `Parada «${antes.etiqueta}» ajustada`,
    cambios: Object.fromEntries(
      Object.keys(data).map((k) => [k, { antes: (antes as any)[k], despues: (row as any)[k] }]),
    ),
  });
  return Response.json({ ok: true, punto: row });
};

/** Agrega una parada al recorrido. */
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  if (!puedeConfigurarRondas(user.rol)) return new Response("Sin permisos", { status: 403 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = crearSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;

  const db = getDb(ctx);
  const [ronda] = await db.select().from(rondas).where(eq(rondas.id, d.rondaId)).limit(1);
  if (!ronda) return Response.json({ error: "La ronda no existe" }, { status: 404 });
  if (d.minEsperado != null && d.maxEsperado != null && d.minEsperado > d.maxEsperado) {
    return Response.json({ error: "El mínimo no puede ser mayor que el máximo" }, { status: 400 });
  }
  if (d.aopProcedimientoId) {
    const [p] = await db.select({ id: procedimientos.id }).from(procedimientos).where(eq(procedimientos.id, d.aopProcedimientoId)).limit(1);
    if (!p) return Response.json({ error: "El AOP indicado no existe" }, { status: 400 });
  }

  const [{ max }] = await db
    .select({ max: sql<number>`COALESCE(MAX(${rondaPuntos.orden}), 0)` })
    .from(rondaPuntos)
    .where(eq(rondaPuntos.rondaId, d.rondaId));

  const [row] = await db
    .insert(rondaPuntos)
    .values({
      rondaId: d.rondaId,
      orden: Number(max) + 1,
      sistema: d.sistema,
      etiqueta: d.etiqueta,
      instruccion: d.instruccion ?? null,
      requiereValor: d.requiereValor,
      unidad: d.unidad ?? null,
      minEsperado: d.minEsperado ?? null,
      maxEsperado: d.maxEsperado ?? null,
      valorEsperadoTexto: d.valorEsperadoTexto ?? null,
      aopProcedimientoId: d.aopProcedimientoId ?? null,
      critico: d.critico,
    })
    .returning();

  await logAudit(ctx, {
    entidad: "ronda_punto", entidadId: row.id, accion: "create",
    resumen: `Parada agregada al recorrido: «${row.etiqueta}»`,
  });
  return Response.json({ ok: true, punto: row });
};

/** Listado para la pantalla de configuración. */
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const db = getDb(ctx);
  const url = new URL(ctx.request.url);
  const rondaId = Number(url.searchParams.get("rondaId") ?? "");
  if (!Number.isFinite(rondaId)) return Response.json({ error: "Falta rondaId" }, { status: 400 });
  const puntos = await db
    .select()
    .from(rondaPuntos)
    .where(eq(rondaPuntos.rondaId, rondaId))
    .orderBy(asc(rondaPuntos.orden));
  return Response.json({ puntos });
};
