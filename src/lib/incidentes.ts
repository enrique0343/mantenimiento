// Fase 59 · WP-G · Órdenes relacionadas con un incidente o evento adverso.
//
// La jefatura marca una orden cuando tiene que ver con un incidente que se avisó
// a Calidad. La marca vive en su propia tabla (orden_incidentes): no toca la
// orden, su estado, su checklist ni su verificación. El reporte de la orden es la
// evidencia técnica del caso; el detalle clínico está en el reporte de Calidad.
//
// Archivo puro: lo usan la API, la ficha de la orden, el listado /incidentes y
// las pruebas (esbuild, platform neutral). Solo importa reglas puras.
import { diaSV, esFechaISO, fechaCorta, horaSV, leerFechaEntrada } from "./biomedico";
import { etiquetaOT } from "./orden-codigo";
import type { DiffEntry } from "./audit";

export const MAX_NUMERO_REPORTE = 60;
export const MAX_NOTA_INCIDENTE = 1000;
export const MIN_MOTIVO_QUITAR = 10;
export const MAX_MOTIVO_QUITAR = 500;

/** Respuesta del borrado de una orden marcada (una sola orden). */
export const MENSAJE_ORDEN_MARCADA = "La orden está marcada como incidente. Quita la marca en su ficha antes de borrarla.";

export interface MarcaIncidente { numeroReporte: string | null; fechaNotificacion: string; nota: string | null }
export type Resultado<T> = { ok: true; valor: T } | { ok: false; error: string };

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const mal = (error: string): { ok: false; error: string } => ({ ok: false, error });

/**
 * Valida lo que manda la ficha. Orden: fecha de aviso (obligatoria, real y no
 * posterior a `hoy`), número de reporte (opcional, hasta 60) y nota (opcional,
 * hasta 1000). Un cuerpo que no es objeto se lee como vacío.
 */
export function validarMarcaIncidente(entrada: unknown, hoy: string): Resultado<MarcaIncidente> {
  const e = esObjeto(entrada) ? entrada : {};

  const fechaCruda = e.fechaNotificacion;
  const fecha = typeof fechaCruda === "string" ? fechaCruda.trim()
    : fechaCruda === null || fechaCruda === undefined ? "" : String(fechaCruda).trim();
  if (!fecha) return mal("Escribe la fecha en que se avisó a Calidad.");
  if (!esFechaISO(fecha)) return mal("La fecha de aviso a Calidad no es válida.");
  if (fecha > hoy) return mal("La fecha de aviso a Calidad no puede ser posterior a hoy.");

  const numCrudo = e.numeroReporte;
  let numeroReporte: string | null;
  if (numCrudo === null || numCrudo === undefined) numeroReporte = null;
  else if (typeof numCrudo === "number" && Number.isFinite(numCrudo)) numeroReporte = String(numCrudo);
  else if (typeof numCrudo === "string") numeroReporte = numCrudo.trim().replace(/\s+/g, " ") || null;
  else return mal("El número de reporte no es válido.");
  if (numeroReporte !== null && numeroReporte.length > MAX_NUMERO_REPORTE) {
    return mal(`El número de reporte admite hasta ${MAX_NUMERO_REPORTE} caracteres.`);
  }

  const notaCruda = e.nota;
  let nota: string | null;
  if (notaCruda === null || notaCruda === undefined) nota = null;
  else if (typeof notaCruda === "string") nota = notaCruda.trim() || null;
  else return mal("La nota no es válida.");
  if (nota !== null && nota.length > MAX_NOTA_INCIDENTE) return mal(`La nota admite hasta ${MAX_NOTA_INCIDENTE} caracteres.`);

  return { ok: true, valor: { numeroReporte, fechaNotificacion: fecha, nota } };
}

/** Quitar la marca exige motivo: de 10 a 500 caracteres (lee `entrada.motivo`). */
export function validarMotivoQuitar(entrada: unknown): Resultado<string> {
  const crudo = esObjeto(entrada) ? entrada.motivo : undefined;
  const motivo = typeof crudo === "string" ? crudo.trim() : "";
  if (motivo.length < MIN_MOTIVO_QUITAR) return mal(`Escribe por qué se quita la marca (mínimo ${MIN_MOTIVO_QUITAR} letras).`);
  if (motivo.length > MAX_MOTIVO_QUITAR) return mal(`El motivo admite hasta ${MAX_MOTIVO_QUITAR} caracteres.`);
  return { ok: true, valor: motivo };
}

const CAMPOS_MARCA: ReadonlyArray<{ clave: keyof MarcaIncidente; etiqueta: string }> = [
  { clave: "numeroReporte", etiqueta: "Reporte de Calidad" },
  { clave: "fechaNotificacion", etiqueta: "Aviso a Calidad" },
  { clave: "nota", etiqueta: "Nota" },
];

/** Lo que cambia entre dos marcas, con etiquetas legibles. Sin cambios → {}. */
export function cambiosMarca(
  antes: MarcaIncidente | null,
  despues: MarcaIncidente | null,
): Record<string, { antes: string | null; despues: string | null }> {
  const cambios: Record<string, { antes: string | null; despues: string | null }> = {};
  for (const { clave, etiqueta } of CAMPOS_MARCA) {
    const a = antes?.[clave] ?? null;
    const b = despues?.[clave] ?? null;
    if (a !== b) cambios[etiqueta] = { antes: a, despues: b };
  }
  return cambios;
}

/** Línea de la bitácora de la orden al marcar, editar o quitar la marca. */
export function resumenMarca(
  accion: "marcar" | "editar" | "quitar",
  m: MarcaIncidente,
  extra: { campos?: string[]; motivo?: string } = {},
): string {
  if (accion === "marcar") {
    return `Marcó la orden como incidente · reporte de Calidad ${m.numeroReporte ?? "pendiente"} · aviso a Calidad ${fechaCorta(m.fechaNotificacion)}`;
  }
  if (accion === "editar") {
    return extra.campos?.length ? `Editó la marca de incidente: ${extra.campos.join(", ")}` : "Editó la marca de incidente";
  }
  return `Quitó la marca de incidente (reporte ${m.numeroReporte ?? "sin número"}, aviso ${fechaCorta(m.fechaNotificacion)}). Motivo: ${extra.motivo ?? ""}`;
}

/** 409 del borrado en lote: nombra hasta 5 órdenes marcadas y luego «…». */
export function mensajeOrdenesMarcadas(etiquetas: string[]): string {
  if (etiquetas.length === 0) return "";
  const lista = etiquetas.length > 5 ? [...etiquetas.slice(0, 5), "…"] : etiquetas;
  if (etiquetas.length === 1) {
    return `La selección contiene una orden marcada como incidente (${lista[0]}). Quita la marca en su ficha antes de borrarla.`;
  }
  return `La selección contiene ${etiquetas.length} órdenes marcadas como incidente (${lista.join(", ")}). Quita la marca en la ficha de cada una antes de borrarlas.`;
}

/** Una línea de bitácora por orden borrada en lote, como el borrado de una sola orden. */
export function lineasBorradoLote(
  ots: ReadonlyArray<{ id: number; codigo: string | null; titulo: string; estado: string; tipo: string; activoId: number | null }>,
): Array<{ entidad: "orden"; entidadId: number; accion: "delete"; resumen: string; cambios: Record<string, DiffEntry> }> {
  const n = ots.length;
  return ots.map((o) => ({
    entidad: "orden" as const,
    entidadId: o.id,
    accion: "delete" as const,
    resumen: `OT eliminada en borrado por lote (${n}): ${etiquetaOT(o)} "${o.titulo}"`,
    cambios: {
      estado: { antes: o.estado, despues: null },
      tipo: { antes: o.tipo, despues: null },
      activoId: { antes: o.activoId, despues: null },
    },
  }));
}

// ─── Listado /incidentes ─────────────────────────────────────────────────────

export interface FiltrosIncidentes { desde: string | null; hasta: string | null; activoId: number | null }

/** Lee ?desde&hasta&activo. Una fecha mala queda en null y deja el error; `ok` = sin error. */
export function leerFiltrosIncidentes(q: URLSearchParams): { ok: boolean; error: string | null; filtros: FiltrosIncidentes } {
  // Acepta AAAA-MM-DD (lo que manda el formulario) y también DD/MM/AAAA escrito a mano.
  const leer = (clave: "desde" | "hasta"): { valor: string | null; mala: boolean } => {
    const r = leerFechaEntrada(q.get(clave) ?? "");
    return "error" in r ? { valor: null, mala: true } : { valor: r.valor, mala: false };
  };
  const d = leer("desde");
  const h = leer("hasta");
  const error = d.mala ? "La fecha «desde» no es válida."
    : h.mala ? "La fecha «hasta» no es válida."
    : d.valor && h.valor && d.valor > h.valor ? "La fecha «desde» es posterior a «hasta»."
    : null;
  const crudo = (q.get("activo") ?? "").trim();
  const n = /^\d+$/.test(crudo) ? Number(crudo) : Number.NaN;
  const activoId = Number.isSafeInteger(n) && n > 0 ? n : null;
  return { ok: error === null, error, filtros: { desde: d.valor, hasta: h.valor, activoId } };
}

/** «Del 01/01/2026 al 30/06/2026 · Equipo EQ-01 · Monitor», para la cabecera impresa. */
export function textoFiltros(f: FiltrosIncidentes, equipo?: string | null): string {
  const periodo = f.desde && f.hasta ? `Del ${fechaCorta(f.desde)} al ${fechaCorta(f.hasta)}`
    : f.desde ? `Desde el ${fechaCorta(f.desde)}`
    : f.hasta ? `Hasta el ${fechaCorta(f.hasta)}`
    : "Todas las fechas";
  const nombre = equipo?.trim();
  const equipoTxt = nombre ? `Equipo ${nombre}` : f.activoId ? `Equipo #${f.activoId}` : "todos los equipos";
  return `${periodo} · ${equipoTxt}`;
}

export interface FilaIncidente {
  ordenId: number; orden: string; ordenTitulo: string; tipoOrden: string; estadoOrden: string;
  numeroReporte: string | null; fechaNotificacion: string; nota: string | null;
  marcadoPor: string | null; marcadoEn: string;
  equipoCodigo: string | null; equipoNombre: string | null; equipoSerie: string | null;
  ubicacion: string | null; causaRaiz: string | null;
}

export const COLUMNAS_CSV_INCIDENTES: { key: string; label: string }[] = [
  { key: "fechaNotificacion", label: "Aviso a Calidad" },
  { key: "numeroReporte", label: "Reporte de Calidad" },
  { key: "orden", label: "Orden" },
  { key: "ordenTitulo", label: "Título de la orden" },
  { key: "tipoOrden", label: "Tipo de orden" },
  { key: "estadoOrden", label: "Estado de la orden" },
  { key: "equipoCodigo", label: "Código del equipo" },
  { key: "equipoNombre", label: "Equipo" },
  { key: "equipoSerie", label: "Serie" },
  { key: "ubicacion", label: "Ubicación" },
  { key: "causaRaiz", label: "Causa raíz" },
  { key: "nota", label: "Nota" },
  { key: "marcadoPor", label: "Marcó" },
  { key: "marcadoEn", label: "Marcado el" },
  { key: "reporte", label: "Reporte de la orden" },
];

/** 'AAAA-MM-DD HH:MM' en hora de El Salvador; una fecha sola sale sin hora; ilegible → ''. */
function marcaCsv(valor: string | null | undefined): string {
  const dia = diaSV(valor);
  if (!dia) return "";
  const hora = horaSV(valor);
  return hora ? `${dia} ${hora}` : dia;
}

/** Fila del CSV: fecha de aviso AAAA-MM-DD, marca 'AAAA-MM-DD HH:MM' de SV, número o «pendiente». */
export function filaCsvIncidente(f: FilaIncidente, origen: string): Record<string, string> {
  const txt = (v: string | null | undefined) => v ?? "";
  return {
    fechaNotificacion: diaSV(f.fechaNotificacion) ?? "",
    numeroReporte: f.numeroReporte ?? "pendiente",
    orden: f.orden,
    ordenTitulo: f.ordenTitulo,
    tipoOrden: f.tipoOrden,
    estadoOrden: f.estadoOrden,
    equipoCodigo: txt(f.equipoCodigo),
    equipoNombre: txt(f.equipoNombre),
    equipoSerie: txt(f.equipoSerie),
    ubicacion: txt(f.ubicacion),
    causaRaiz: txt(f.causaRaiz),
    nota: txt(f.nota),
    marcadoPor: txt(f.marcadoPor),
    marcadoEn: marcaCsv(f.marcadoEn),
    reporte: `${origen.replace(/\/+$/, "")}/ordenes/${f.ordenId}/reporte`,
  };
}

export function contarIncidentes(filas: ReadonlyArray<{ numeroReporte: string | null }>): { total: number; sinNumero: number } {
  return { total: filas.length, sinNumero: filas.filter((f) => !f.numeroReporte).length };
}

/** 'incidentes_20261112.csv' (convención de la fase: <modulo>_AAAAMMDD.csv). */
export function nombreCsvIncidentes(hoy: string): string {
  return `incidentes_${String(hoy).replace(/-/g, "")}.csv`;
}
