// Ronda de turno · anotar un punto.
// Si la lectura se sale del valor normal, aquí mismo se abre el episodio del
// AOP que rige el punto y se devuelven sus primeras acciones: el técnico no
// tiene que ir a buscar el documento.
import type { APIRoute } from "astro";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { cronometro, fmtCuentaRegresiva } from "@/lib/aop";
import { puedeEjecutarRonda, registrarLectura } from "@/lib/rondas";
import { aopAcciones, aopEventos, rondaEjecuciones, rondaPuntos } from "@/lib/schema";

export const prerender = false;

const schema = z.object({
  puntoId: z.number().int().positive(),
  resultado: z.enum(["ok", "fuera", "no_verificado"]),
  valor: z.number().finite().nullable().optional(),
  valorTexto: z.string().max(300).nullable().optional(),
  nota: z.string().max(1000).nullable().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  if (!puedeEjecutarRonda(user.rol)) return new Response("Sin permisos", { status: 403 });

  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) return new Response("Ronda inválida", { status: 400 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [ejec] = await db.select().from(rondaEjecuciones).where(eq(rondaEjecuciones.id, id)).limit(1);
  if (!ejec) return Response.json({ error: "La ronda no existe" }, { status: 404 });
  if (ejec.estado === "completada") {
    return Response.json({ error: "Esta ronda ya está cerrada. Abre la del turno siguiente." }, { status: 400 });
  }

  // El punto tiene que pertenecer a la ronda que se está ejecutando.
  const [punto] = await db
    .select()
    .from(rondaPuntos)
    .where(and(eq(rondaPuntos.id, parsed.data.puntoId), eq(rondaPuntos.rondaId, ejec.rondaId)))
    .limit(1);
  if (!punto) return Response.json({ error: "Ese punto no es de esta ronda" }, { status: 400 });

  const r = await registrarLectura(db, {
    ejecucionId: id,
    puntoId: parsed.data.puntoId,
    resultado: parsed.data.resultado,
    valor: parsed.data.valor ?? null,
    valorTexto: parsed.data.valorTexto ?? null,
    nota: parsed.data.nota ?? null,
    usuarioId: user.id,
  });

  // Lo que sigue, para pintarlo al lado del punto sin recargar.
  let acciones: Array<{ orden: number; accion: string; resultadoEsperado: string | null }> = [];
  let reloj: { actuar: string | null; escalar: string | null } = { actuar: null, escalar: null };
  if (r.fuera && punto.aopProcedimientoId) {
    const filas = await db
      .select({ orden: aopAcciones.orden, accion: aopAcciones.accion, resultadoEsperado: aopAcciones.resultadoEsperado })
      .from(aopAcciones)
      .where(eq(aopAcciones.procedimientoId, punto.aopProcedimientoId))
      .orderBy(asc(aopAcciones.orden))
      .limit(3);
    acciones = filas;
  }
  if (r.eventoId) {
    const [ev] = await db.select().from(aopEventos).where(eq(aopEventos.id, r.eventoId)).limit(1);
    if (ev) {
      const c = cronometro(ev);
      reloj = {
        actuar: c.minutosParaActuar != null ? fmtCuentaRegresiva(c.minutosParaActuar) : null,
        escalar: c.minutosParaEscalar != null ? fmtCuentaRegresiva(c.minutosParaEscalar) : null,
      };
    }
  }

  const [actualizada] = await db.select().from(rondaEjecuciones).where(eq(rondaEjecuciones.id, id)).limit(1);

  return Response.json({
    ok: true,
    resultado: r.lectura.resultado,
    fuera: r.fuera,
    mensaje: r.mensaje,
    aop: r.aopCodigo ? { codigo: r.aopCodigo, titulo: r.aopTitulo, acciones, reloj } : null,
    eventoId: r.eventoId,
    avance: actualizada
      ? {
          total: actualizada.puntosTotal,
          ok: actualizada.puntosOk,
          fuera: actualizada.puntosFuera,
          pendientes: actualizada.puntosNoVerificados,
        }
      : null,
  });
};
