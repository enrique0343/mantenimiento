// Plantillas de checklist (Fase 59 · seguridad eléctrica): una sola definición de
// paso para crear y para reemplazar pasos por la API.
//
// La plantilla «Seguridad eléctrica IEC 62353» se perdió porque borrar una
// plantilla la borraba con sus pasos y sin constancia. Desde esta fase borrar la
// desactiva, y reemplazar los pasos conserva lo que pide lectura, su unidad y su
// rango: un paso que llega sin esos datos los toma del paso anterior con el mismo
// texto. Los pasos ligados a variables, procedimientos AOP, equipos o ubicaciones
// no se reemplazan por la API (esos vínculos no viajan en ella).
//
// Puro: solo zod y tipos. Lo usan las dos rutas de /api/checklist-plantillas.
import { z } from "zod";
import type { ChecklistPlantillaItem } from "./schema";

const MSG = {
  texto: "Escribe el texto de cada paso.",
  nombre: "Escribe el nombre de la plantilla.",
  unidad: "La unidad tiene como máximo 12 letras.",
  rango: "El mínimo no puede ser mayor que el máximo",
  minutos: "Los minutos estimados son un número entero mayor que cero.",
  numero: "El mínimo y el máximo son números.",
  muchos: "Una plantilla tiene como máximo 200 pasos.",
} as const;
const PROPIOS = new Set<string>(Object.values(MSG));

const pasoObjeto = z
  .object({
    texto: z.string({ invalid_type_error: MSG.texto, required_error: MSG.texto }).trim().min(1, MSG.texto),
    criterioAceptacion: z.string().nullable().optional(),
    bloqueante: z.boolean().optional(),
    minutosEstimados: z.number({ invalid_type_error: MSG.minutos }).int(MSG.minutos).positive(MSG.minutos).nullable().optional(),
    materiales: z.string().nullable().optional(),
    requiereValor: z.boolean().optional(),
    unidad: z.string().trim().max(12, MSG.unidad).nullable().optional(),
    valorEsperadoMin: z.number({ invalid_type_error: MSG.numero }).finite(MSG.numero).nullable().optional(),
    valorEsperadoMax: z.number({ invalid_type_error: MSG.numero }).finite(MSG.numero).nullable().optional(),
  })
  .refine((p) => p.valorEsperadoMin == null || p.valorEsperadoMax == null || p.valorEsperadoMin <= p.valorEsperadoMax, {
    message: MSG.rango,
    path: ["valorEsperadoMax"],
  });

/** Un paso: texto simple (compatibilidad) u objeto con criterio, lectura, unidad y rango. */
export const itemPlantillaSchema = z.preprocess((v) => (typeof v === "string" ? { texto: v } : v), pasoObjeto);
export type ItemPlantilla = z.infer<typeof pasoObjeto>;

const listaPasos = z.array(itemPlantillaSchema).max(200, MSG.muchos);

export const crearPlantillaSchema = z.object({
  nombre: z.string({ invalid_type_error: MSG.nombre, required_error: MSG.nombre }).trim().min(1, MSG.nombre),
  descripcion: z.string().nullable().optional(),
  items: listaPasos.default([]),
});

export const editarPlantillaSchema = z.object({
  nombre: z.string({ invalid_type_error: MSG.nombre }).trim().min(1, MSG.nombre).optional(),
  descripcion: z.string().nullable().optional(),
  activa: z.boolean().optional(),
  items: listaPasos.optional(),
});

/** El primer problema de la validación, en español, para responder { error }. */
export function mensajeErrorPlantilla(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Revisa los datos de la plantilla.";
  const texto = PROPIOS.has(issue.message) ? issue.message.replace(/\.?$/, ".") : "Revisa los datos de la plantilla.";
  const [campo, indice] = issue.path;
  return campo === "items" && typeof indice === "number" ? `Paso ${indice + 1}: ${texto}` : texto;
}

/** Lo que se conserva de un paso guardado cuando llega sin esos datos. */
export type PasoAnterior = Pick<
  ChecklistPlantillaItem,
  "texto" | "criterioAceptacion" | "bloqueante" | "minutosEstimados" | "materiales" | "requiereValor" | "unidad" | "valorEsperadoMin" | "valorEsperadoMax"
>;

const textoClave = (s: string) => s.trim().replace(/\s+/g, " ");
const vacioANull = (s: string | null | undefined) => {
  const t = s?.trim();
  return t ? t : null;
};

/**
 * La fila para guardar un paso. Lo que el paso no trae (undefined) se toma del
 * paso anterior con el mismo texto; sin paso anterior: sin criterio, no crítico,
 * sin lectura, sin unidad y sin rango. Un null explícito borra el dato.
 */
export function normalizarItemPlantilla(raw: ItemPlantilla | string, orden: number, plantillaId: number, anterior?: PasoAnterior | null) {
  const it: ItemPlantilla = typeof raw === "string" ? { texto: raw.trim() } : raw;
  const tomar = <T>(valor: T | undefined, previo: T | null | undefined, porDefecto: T): T =>
    valor !== undefined ? valor : previo !== undefined && previo !== null ? previo : porDefecto;
  return {
    plantillaId,
    texto: it.texto,
    criterioAceptacion: vacioANull(tomar(it.criterioAceptacion, anterior?.criterioAceptacion, null)),
    bloqueante: tomar(it.bloqueante, anterior?.bloqueante, false),
    minutosEstimados: tomar(it.minutosEstimados, anterior?.minutosEstimados, null),
    materiales: vacioANull(tomar(it.materiales, anterior?.materiales, null)),
    requiereValor: tomar(it.requiereValor, anterior?.requiereValor, false),
    unidad: vacioANull(tomar(it.unidad, anterior?.unidad, null)),
    valorEsperadoMin: tomar(it.valorEsperadoMin, anterior?.valorEsperadoMin, null),
    valorEsperadoMax: tomar(it.valorEsperadoMax, anterior?.valorEsperadoMax, null),
    orden,
  };
}
export type FilaPasoPlantilla = ReturnType<typeof normalizarItemPlantilla>;

/**
 * Las filas que reemplazan los pasos de una plantilla, en orden (1, 2, 3…). Cada
 * paso nuevo se empareja con el primer paso guardado del mismo texto que no se
 * haya usado, para conservar su lectura, unidad y rango.
 */
export function filasDeReemplazo(items: ReadonlyArray<ItemPlantilla | string>, actuales: ReadonlyArray<PasoAnterior>, plantillaId: number): FilaPasoPlantilla[] {
  const libres = [...actuales];
  return items.map((raw, i) => {
    const texto = textoClave(typeof raw === "string" ? raw : raw.texto);
    const j = libres.findIndex((p) => textoClave(p.texto) === texto);
    const anterior = j >= 0 ? libres.splice(j, 1)[0] : null;
    return normalizarItemPlantilla(raw, i + 1, plantillaId, anterior);
  });
}

/** true si algún paso está ligado a una variable, un AOP, un equipo, una ubicación o una acción si no cumple. */
export function tieneVinculos(items: ReadonlyArray<Partial<Pick<ChecklistPlantillaItem, "variableId" | "aopProcedimientoId" | "activoId" | "ubicacionId" | "accionSiNoCumple">>>): boolean {
  return items.some((p) =>
    p.variableId != null || p.aopProcedimientoId != null || p.activoId != null || p.ubicacionId != null || !!String(p.accionSiNoCumple ?? "").trim());
}

/**
 * Tandas de filas para INSERT: D1 acepta hasta 100 parámetros por consulta y cada
 * paso usa uno por campo (11). Se dejan tandas de 90 parámetros como mucho.
 */
export function tandasDeFilas<T extends Record<string, unknown>>(filas: readonly T[], maxParametros = 90): T[][] {
  if (!filas.length) return [];
  const porFila = Math.max(1, Object.keys(filas[0]).length);
  const tam = Math.max(1, Math.floor(maxParametros / porFila));
  const out: T[][] = [];
  for (let i = 0; i < filas.length; i += tam) out.push(filas.slice(i, i + tam));
  return out;
}
