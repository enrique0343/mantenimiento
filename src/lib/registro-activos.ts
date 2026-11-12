import { z } from "zod";
import type { RubroKey } from "./rubros";

// Only descriptive fields use this schema; enums, URLs and credentials retain
// their original representation.
export const textoRegistro = z.string().trim().toUpperCase().nullable().optional();

const prefijos: Record<RubroKey, string> = {
  biomedico: "BIO", equipo_general: "EQ", aires: "AC", infraestructura: "INF",
};

export function generarCodigoActivo(area: RubroKey): string {
  // No shared counters or MAX+1 reads: concurrent requests can allocate codes
  // independently. The database unique constraint is the final guard.
  return `${prefijos[area]}-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}

export function nombrePendienteActivo(area: RubroKey): string {
  const tipo = area === "aires" ? "UNIDAD DE AIRE" : area === "infraestructura" ? "INSTALACIÓN" : area === "biomedico" ? "EQUIPO BIOMÉDICO" : "EQUIPO";
  return `${tipo} PENDIENTE DE IDENTIFICAR`;
}

export function esCodigoDuplicado(error: unknown): boolean {
  // Drizzle wraps D1's error in `cause`.
  for (let current: unknown = error, depth = 0; current && depth < 5; depth++) {
    if (/UNIQUE constraint failed: activos\.(codigo|qr_code)/i.test(String((current as Error).message ?? current))) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

// ── Fase 59: código escrito a mano y serie repetida ──────────────────────────

/** Largo máximo del código institucional (ya en mayúsculas). */
export const CODIGO_MAX = 60;

/** Error del código escrito (ya recortado y en mayúsculas) o null si sirve. */
export function errorCodigoActivo(codigo: string): string | null {
  if (codigo.length > CODIGO_MAX) return `El código no puede tener más de ${CODIGO_MAX} caracteres.`;
  // Tabuladores, saltos de línea y demás caracteres de control rompen etiquetas y CSV.
  if (/[\u0000-\u001f\u007f]/.test(codigo)) return "El código no puede tener tabuladores ni saltos de línea.";
  return null;
}

export const mensajeCodigoDuplicado = (codigo: string): string => `El código «${codigo}» ya está en uso en otro equipo.`;

export const MENSAJE_SOLO_BIOMEDICOS = "La clase de riesgo, la subcategoría y el registro sanitario solo aplican a equipos biomédicos.";

/** Requisito 16: la clase de riesgo es obligatoria en biomédicos (también por la API). */
export const MENSAJE_CLASE_OBLIGATORIA = "Elige la clase de riesgo (I, IIa, IIb o III).";

// Lo que se escribe cuando el equipo no tiene serie: no cuenta como repetida.
const SERIES_VACIAS = new Set([
  "NA", "ND", "SN", "SS", "SINSERIE", "SINNUMERO", "NOTIENE", "NOAPLICA", "NOVISIBLE", "ILEGIBLE", "DESCONOCIDO", "PENDIENTE",
]);

const ETIQUETA_DATO: Record<string, string> = {
  codigo: "código", nombre: "nombre", descripcion: "descripción", ubicacion: "detalle de ubicación", estado: "estado",
  tipo: "tipo", rubro: "área", datosTecnicos: "datos técnicos", categoria: "categoría", numeroActivo: "número de activo",
  marca: "marca", modelo: "modelo", serial: "serie", anio: "año", registroSanitario: "registro sanitario",
  registroSanitarioEntidad: "entidad del registro sanitario", registroSanitarioEmision: "emisión del registro sanitario",
  registroSanitarioVencimiento: "vencimiento del registro sanitario", registroSanitarioNoRequiere: "no requiere registro sanitario",
  claseRiesgo: "clase de riesgo", subcategoria: "subcategoría", centroCostoId: "centro de costo",
  fechaAdquisicion: "fecha de adquisición", vidaUtilAnios: "vida útil", valorAdquisicion: "valor de adquisición",
  responsableId: "responsable", criticidadOperacional: "criticidad", requiereCalibracion: "requiere calibración",
  ubicacionId: "ubicación", proveedorId: "proveedor", slaUrgenteHoras: "SLA urgente", slaAltaHoras: "SLA alta",
  slaMediaHoras: "SLA media", slaBajaHoras: "SLA baja", mantenimientoFrecuencia: "frecuencia del mantenimiento",
  mantenimientoProximaFecha: "fecha del mantenimiento", mantenimientoTitulo: "título del plan", mantenimientoPrioridad: "prioridad del plan",
  modeloAireId: "ficha de aire", modeloAireVersion: "versión de la ficha", modeloAireSnapshot: "ficha de aire",
  aceptacionFecha: "fecha de aceptación", aceptacionResultado: "resultado de aceptación", aceptacionNotas: "notas de aceptación",
  padreId: "equipo padre", nivelJerarquia: "nivel", scpProcedimientoId: "procedimiento SCP", scpVersionRef: "versión del SCP",
};

/** Error de zod como texto en español (nunca el objeto de zod). */
export function errorDeDatos(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Datos no válidos.";
  if (issue.code === "custom" && issue.message) return issue.message;
  const campo = issue.path.length ? String(issue.path[0]) : "";
  // Una clase que no es de la escala («IV», «2a» escrito a mano): el mismo texto que cuando falta.
  if (campo === "claseRiesgo") return MENSAJE_CLASE_OBLIGATORIA;
  return campo ? `Revisa el dato «${ETIQUETA_DATO[campo] ?? campo}».` : "Datos no válidos.";
}

/**
 * Regla del centro de costo de un equipo: debe existir y estar activo (uno
 * inactivo que el equipo ya tenía puede quedarse) y, si tiene sede, ser la misma
 * sede de la ubicación del equipo. null = sirve.
 */
export function errorCentroCostoEquipo(
  centro: { id: number; codigo: string; activo: boolean; sucursalId: number | null; sedeNombre: string | null } | null | undefined,
  ubicacion: { sucursalId: number; sedeNombre: string | null } | null | undefined,
  centroAnteriorId: number | null,
): string | null {
  if (!centro || (!centro.activo && centro.id !== centroAnteriorId)) return "El centro de costo no existe o está desactivado.";
  if (centro.sucursalId != null && ubicacion && ubicacion.sucursalId !== centro.sucursalId) {
    return `El centro de costo «${centro.codigo}» es de la sede «${centro.sedeNombre ?? "sin nombre"}» y el equipo está en «${ubicacion.sedeNombre ?? "sin nombre"}».`;
  }
  return null;
}

// ── Centros de costo (catálogo de Administración) ──
/** Código del centro: recortado y en mayúsculas. */
export const normalizarCodigoCentro = (codigo: unknown): string => String(codigo ?? "").trim().replace(/\s+/g, " ").toUpperCase();
/** Nombre del centro: recortado, un espacio y en mayúsculas. */
export const normalizarNombreCentro = (nombre: unknown): string => String(nombre ?? "").trim().replace(/\s+/g, " ").toUpperCase();
export function errorCodigoCentro(codigo: string): string | null {
  return codigo.length >= 1 && codigo.length <= 20 && /^[\p{L}\p{N} ._/-]+$/u.test(codigo)
    ? null
    : "El código del centro lleva de 1 a 20 caracteres: letras, números, espacio, guion, guion bajo, punto o barra.";
}
export function errorNombreCentro(nombre: string): string | null {
  return nombre.length >= 2 && nombre.length <= 120 ? null : "El nombre del centro lleva de 2 a 120 caracteres.";
}

/**
 * Serie para comparar: mayúsculas, sin acentos, solo A-Z y 0-9. «sn 123» y
 * «SN-123» son la misma. null si no sirve para comparar (menos de 3 caracteres,
 * solo ceros o solo X, o «S/N», «N/A», «sin serie»…).
 */
export function normalizarSerie(s: string | null | undefined): string | null {
  const t = String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (t.length < 3 || /^0+$/.test(t) || /^X+$/.test(t) || SERIES_VACIAS.has(t)) return null;
  return t;
}
