// Ronda de turno · abrir la ronda del turno y consultar el tablero.
// Primer paso de la cadena del volumen GO-GUI-011-2026.
import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  abrirEjecucion,
  parsearTurnos,
  puedeEjecutarRonda,
  puedeVerRondas,
  rondaDeSede,
  resumenTablero,
  tableroRondas,
  turnoActual,
} from "@/lib/rondas";
import { rondas, usuarios } from "@/lib/schema";

export const prerender = false;

const abrirSchema = z.object({
  sucursalId: z.number().int().positive(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  turno: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

/** Tablero del turno vigente: qué sede hizo su ronda y qué sede no. */
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerRondas(user.rol)) return new Response("Sin permisos", { status: 403 });

  const db = getDb(ctx);
  const [modelo] = await db.select().from(rondas).where(eq(rondas.activa, true)).limit(1);
  const t = turnoActual(parsearTurnos(modelo?.turnos));
  const url = new URL(ctx.request.url);
  const fecha = url.searchParams.get("fecha") ?? t.fecha;
  const turno = url.searchParams.get("turno") ?? t.turno;

  const filas = await tableroRondas(db, fecha, turno);
  return Response.json({ fecha, turno, etiqueta: t.etiqueta, filas, resumen: resumenTablero(filas) });
};

/** Abre (o recupera) la ronda del turno de una sede y devuelve a dónde ir. */
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  if (!puedeEjecutarRonda(user.rol)) return new Response("Sin permisos", { status: 403 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = abrirSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const ronda = await rondaDeSede(db, parsed.data.sucursalId);
  if (!ronda) {
    return Response.json(
      { error: "Esta sede no tiene una ronda configurada. Configúrala en Ronda de turno → Puntos del recorrido." },
      { status: 400 },
    );
  }
  const t = turnoActual(parsearTurnos(ronda.turnos));
  const fecha = parsed.data.fecha ?? t.fecha;
  const turno = parsed.data.turno ?? t.turno;

  const { ejecucion, yaExistia } = await abrirEjecucion(db, {
    rondaId: ronda.id,
    sucursalId: parsed.data.sucursalId,
    fecha,
    turno,
    usuarioId: user.id,
  });

  return Response.json({
    ok: true,
    yaExistia,
    ejecucionId: ejecucion.id,
    url: `/ronda/${ejecucion.id}`,
    fecha,
    turno,
  });
};
