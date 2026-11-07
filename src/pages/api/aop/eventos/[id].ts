// AOP · un episodio: registrar acciones (POST) y mover el reloj (PATCH).
// Normalizar, escalar y pasar a EOP son las tres salidas que el AOP admite.
import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  ahoraISO,
  cerrarEvento,
  evaluarLectura,
  fmtRango,
  puedeOperarAop,
  registrarAccion,
} from "@/lib/aop";
import { aopEventos, aopUmbrales, variablesPredictivas } from "@/lib/schema";

export const prerender = false;

const accionSchema = z.object({
  accion: z.string().min(1).max(500),
  resultado: z.string().max(1000).nullable().optional(),
  /** Relectura: si viene, se evalúa contra el umbral y se anota la banda. */
  valorReleido: z.number().nullable().optional(),
});

const patchSchema = z.discriminatedUnion("operacion", [
  z.object({ operacion: z.literal("en_correccion") }),
  z.object({
    operacion: z.literal("normalizar"),
    valorFinal: z.number().nullable().optional(),
    evaluacionRiesgo: z.string().max(4000).nullable().optional(),
  }),
  z.object({
    operacion: z.literal("escalar"),
    motivo: z.string().max(1000).nullable().optional(),
  }),
  z.object({
    operacion: z.literal("paso_a_eop"),
    motivo: z.string().max(1000).nullable().optional(),
  }),
  z.object({
    operacion: z.literal("evaluacion_riesgo"),
    evaluacionRiesgo: z.string().max(4000).nullable(),
  }),
]);

/** Deja constancia de una acción inmediata con su hora. */
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  if (!puedeOperarAop(user.rol)) return new Response("Sin permisos", { status: 403 });

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = accionSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [evento] = await db.select().from(aopEventos).where(eq(aopEventos.id, id)).limit(1);
  if (!evento) return Response.json({ error: "Episodio no encontrado" }, { status: 404 });

  let resultado = parsed.data.resultado?.trim() || null;

  // Relectura: la evaluamos con el mismo motor que abrió el episodio.
  if (parsed.data.valorReleido != null) {
    const [variable] = evento.variableId
      ? await db.select().from(variablesPredictivas).where(eq(variablesPredictivas.id, evento.variableId)).limit(1)
      : [];
    const [umbral] = evento.umbralId
      ? await db.select().from(aopUmbrales).where(eq(aopUmbrales.id, evento.umbralId)).limit(1)
      : [];
    const lectura = evaluarLectura(variable ?? null, parsed.data.valorReleido, umbral ?? null);
    const unidad = evento.unidad ?? variable?.unidad ?? "";
    const etiqueta = lectura.fuera
      ? `fuera del rango ${fmtRango(lectura.minAlerta, lectura.maxAlerta, unidad)}`
      : `dentro del rango ${fmtRango(lectura.minAlerta, lectura.maxAlerta, unidad)}`;
    const texto = `Relectura ${parsed.data.valorReleido}${unidad ? ` ${unidad}` : ""} · ${etiqueta}`;
    resultado = resultado ? `${texto}. ${resultado}` : texto;
  }

  const row = await registrarAccion(db, id, parsed.data.accion.trim(), resultado, user.id);

  // La primera acción mueve el episodio a "en corrección" sin pedirlo aparte.
  if (evento.estado === "abierto") {
    await db.update(aopEventos).set({ estado: "en_correccion" }).where(eq(aopEventos.id, id));
  }

  return Response.json({ accion: row }, { status: 201 });
};

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  if (!puedeOperarAop(user.rol)) return new Response("Sin permisos", { status: 403 });

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;

  const db = getDb(ctx);
  const [evento] = await db.select().from(aopEventos).where(eq(aopEventos.id, id)).limit(1);
  if (!evento) return Response.json({ error: "Episodio no encontrado" }, { status: 404 });

  // Un episodio ya terminado no se vuelve a cerrar ni a escalar: recalcular los
  // minutos fuera de rango contra "ahora" inflaria el indicador 8. La evaluacion
  // de riesgo si se puede completar despues, que suele escribirse al final.
  const terminado = evento.estado === "cerrado" || evento.estado === "paso_a_eop";
  if (terminado && d.operacion !== "evaluacion_riesgo") {
    return Response.json(
      { error: `El episodio ya está ${evento.estado === "cerrado" ? "normalizado" : "en manos del EOP"}` },
      { status: 409 },
    );
  }

  if (d.operacion === "normalizar") {
    const row = await cerrarEvento(db, id, d.valorFinal ?? null, user.id, {
      ...(d.evaluacionRiesgo !== undefined ? { evaluacionRiesgo: d.evaluacionRiesgo } : {}),
    });
    if (!row) return Response.json({ error: "Episodio no encontrado" }, { status: 404 });
    await registrarAccion(
      db,
      id,
      "Normalizado",
      d.valorFinal != null
        ? `Valor final ${d.valorFinal}${row.unidad ? ` ${row.unidad}` : ""} · ${row.minutosFuera ?? 0} min fuera de rango`
        : `${row.minutosFuera ?? 0} min fuera de rango`,
      user.id,
    );
    return Response.json({ evento: row });
  }

  if (d.operacion === "escalar") {
    const ahora = ahoraISO();
    const [row] = await db
      .update(aopEventos)
      .set({ estado: "escalado", escaladoEn: evento.escaladoEn ?? ahora })
      .where(eq(aopEventos.id, id))
      .returning();
    await registrarAccion(db, id, "Escalado al nivel superior", d.motivo?.trim() || null, user.id);
    return Response.json({ evento: row });
  }

  if (d.operacion === "paso_a_eop") {
    const [row] = await db
      .update(aopEventos)
      .set({ estado: "paso_a_eop", escaladoEn: evento.escaladoEn ?? ahoraISO() })
      .where(eq(aopEventos.id, id))
      .returning();
    await registrarAccion(db, id, "Pasó a EOP", d.motivo?.trim() || null, user.id);
    return Response.json({ evento: row });
  }

  if (d.operacion === "evaluacion_riesgo") {
    const [row] = await db
      .update(aopEventos)
      .set({ evaluacionRiesgo: d.evaluacionRiesgo })
      .where(eq(aopEventos.id, id))
      .returning();
    return Response.json({ evento: row });
  }

  // en_correccion
  const [row] = await db
    .update(aopEventos)
    .set({ estado: "en_correccion" })
    .where(eq(aopEventos.id, id))
    .returning();
  return Response.json({ evento: row });
};
