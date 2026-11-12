// Fase 59 · WP-E: validación común de las API de rutinas, alertas y plan anual.
// Los errores salen como { error: "texto en español", detalle } y nunca como el
// objeto de zod (contrato §c).
import { z } from "zod";
import { FRECUENCIAS_RUTINA_EQUIPO, esFechaISO } from "./biomedico";
import { MENSAJE_FRECUENCIA_TURNO } from "./frecuencias";

/**
 * Para los campos que el esquema no rotula con su propio mensaje. En zod 3 el mapa
 * que se pasa a safeParse manda sobre el del campo (z.enum(…, { errorMap })): por eso,
 * si el mensaje que llega no es el de zod por defecto, es el del campo y se respeta.
 */
export const errorMapEs: z.ZodErrorMap = (issue, ctx) => {
  const deZod = z.defaultErrorMap(issue, { data: ctx.data, defaultError: "" }).message;
  if (ctx.defaultError && ctx.defaultError !== deZod) return { message: ctx.defaultError };
  const campo = issue.path.length ? `«${issue.path.join(".")}»` : "los datos enviados";
  if (issue.code === z.ZodIssueCode.invalid_type && issue.received === "undefined") return { message: `Falta ${campo}.` };
  return { message: `Revisa ${campo}: el valor no es válido.` };
};

/** 400 con el primer mensaje como texto y el detalle de zod aparte. */
export function respuestaZod(error: z.ZodError): Response {
  return Response.json({ error: error.issues[0]?.message ?? "Datos no válidos.", detalle: error.flatten() }, { status: 400 });
}

export const MENSAJE_FRECUENCIA_LISTA = "Elige una frecuencia de la lista.";

/** K-E1: las nueve frecuencias de rutina de equipo; «turno» responde con su mensaje propio. */
export const frecuenciaRutinaSchema = z.enum(FRECUENCIAS_RUTINA_EQUIPO, {
  errorMap: (_issue, ctx) => ({ message: ctx.data === "turno" ? MENSAJE_FRECUENCIA_TURNO : MENSAJE_FRECUENCIA_LISTA }),
});

/** Fecha 'AAAA-MM-DD' real. */
export const fechaIsoSchema = (mensaje = "Fecha no válida.") =>
  z.string({ errorMap: () => ({ message: mensaje }) }).refine((v) => esFechaISO(v), mensaje);

/** Parte una lista en tandas (D1 acepta hasta 100 parámetros por consulta). */
export function enTandas<T>(lista: readonly T[], tamano: number): T[][] {
  const tandas: T[][] = [];
  for (let i = 0; i < lista.length; i += tamano) tandas.push(lista.slice(i, i + tamano));
  return tandas;
}
