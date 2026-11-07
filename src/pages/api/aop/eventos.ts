// AOP · episodios de desviación: listar los abiertos y abrir uno a mano.
// Cuando hay sensor la lectura abre el episodio sola; cuando no lo hay, lo abre
// el técnico desde la ronda (capítulo 07 de GO-GUI-011-2026).
import type { APIRoute } from "astro";
import { z } from "zod";
import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  abrirEvento,
  ESTADOS_AOP_ABIERTOS,
  cronometro,
  normalizarMomento,
  puedeOperarAop,
  puedeVerAop,
  registrarAccion,
} from "@/lib/aop";
import { aopEventos, activos, procedimientos, ubicaciones, variablesPredictivas } from "@/lib/schema";

export const prerender = false;

const crearSchema = z
  .object({
    umbralId: z.number().int().positive().nullable().optional(),
    procedimientoId: z.number().int().positive().nullable().optional(),
    variableId: z.number().int().positive().nullable().optional(),
    activoId: z.number().int().positive().nullable().optional(),
    ubicacionId: z.number().int().positive().nullable().optional(),
    valorDetectado: z.number().nullable().optional(),
    unidad: z.string().max(20).nullable().optional(),
    detectadoEn: z.string().min(10).nullable().optional(),
    origen: z.enum(["ronda", "sensor", "manual"]).default("ronda"),
    minutosParaActuar: z.number().int().min(0).max(100_000).nullable().optional(),
    minutosParaEscalar: z.number().int().min(0).max(100_000).nullable().optional(),
    /** Lo que vio quien la detectó; queda como primera línea de la bitácora. */
    nota: z.string().max(1000).nullable().optional(),
  })
  .refine((d) => d.umbralId != null || d.procedimientoId != null || d.variableId != null, {
    message: "Indica el umbral del AOP, el procedimiento o la variable que se desvió",
  });

/** Tablero en JSON: los episodios con el reloj corriendo. */
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerAop(user.rol)) return new Response("Sin permisos", { status: 403 });

  const db = getDb(ctx);
  const rows = await db
    .select({
      e: aopEventos,
      codigoAop: procedimientos.codigoCorto,
      tituloAop: procedimientos.titulo,
      variable: variablesPredictivas.nombre,
      unidadVariable: variablesPredictivas.unidad,
      minAlertaVar: variablesPredictivas.minWarning,
      maxAlertaVar: variablesPredictivas.maxWarning,
      sala: ubicaciones.nombre,
      equipo: activos.nombre,
    })
    .from(aopEventos)
    .leftJoin(procedimientos, eq(procedimientos.id, aopEventos.procedimientoId))
    .leftJoin(variablesPredictivas, eq(variablesPredictivas.id, aopEventos.variableId))
    .leftJoin(ubicaciones, eq(ubicaciones.id, aopEventos.ubicacionId))
    .leftJoin(activos, eq(activos.id, aopEventos.activoId))
    .where(inArray(aopEventos.estado, ESTADOS_AOP_ABIERTOS))
    .orderBy(desc(aopEventos.detectadoEn));

  const eventos = rows
    .map((r) => ({ ...r, cron: cronometro(r.e) }))
    .sort((a, b) => a.cron.urgencia - b.cron.urgencia);

  return Response.json({ eventos, total: eventos.length });
};

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  if (!puedeOperarAop(user.rol)) return new Response("Sin permisos", { status: 403 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = crearSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;

  const db = getDb(ctx);
  const { evento, yaExistia } = await abrirEvento(db, {
    umbralId: d.umbralId ?? null,
    procedimientoId: d.procedimientoId ?? null,
    variableId: d.variableId ?? null,
    activoId: d.activoId ?? null,
    ubicacionId: d.ubicacionId ?? null,
    valorDetectado: d.valorDetectado ?? null,
    unidad: d.unidad ?? null,
    detectadoEn: normalizarMomento(d.detectadoEn),
    detectadoPor: user.id,
    origen: d.origen,
    minutosParaActuar: d.minutosParaActuar ?? null,
    minutosParaEscalar: d.minutosParaEscalar ?? null,
  });

  if (yaExistia) {
    return Response.json(
      { evento, yaExistia: true, aviso: "Ya hay un episodio abierto para esa variable en esa sala." },
      { status: 200 },
    );
  }

  if (d.nota?.trim()) {
    await registrarAccion(db, evento.id, "Desviación registrada en la ronda", d.nota.trim(), user.id);
  }

  return Response.json({ evento, yaExistia: false }, { status: 201 });
};
