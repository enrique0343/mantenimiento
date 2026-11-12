// Fase 59 · Carga masiva de equipos: lectura del CSV, columnas del inventario y
// plan fila por fila. Puro: sin base de datos ni bitácora (el servidor lee el
// contexto, llama a planificarImportacion y graba).
//
// Las etiquetas del CSV que se descarga y los nombres que acepta la carga salen
// de una sola tabla (COLUMNAS_INVENTARIO): lo descargado se corrige en Excel y se
// vuelve a cargar en «Actualizar equipos existentes».
import type { activos } from "./schema";
import { AREAS } from "./areas";
import { RUBROS, SUBCATS_BIOMEDICO, SUBCAT_KEYS, rubroDeActivo, type RubroKey, type SubcatKey } from "./rubros";
import {
  DESTINOS_BAJA, ESTADO_ACTIVO_LABEL, ESTADO_REGISTRO_LABEL, MOTIVOS_BAJA,
  esFechaISO, estadoRegistroSanitario, etiquetaCentroCosto, folioActaBaja, leerClaseRiesgo, leerFechaEntrada, normalizarTexto,
  type ClaseRiesgo, type EstadoActivo,
} from "./biomedico";
import { leerNumero, textoDeNumero } from "./numero";
import { datosTecnicosValidosParaArea, leerDatosTecnicos, serializarDatosTecnicos } from "./activo-area";
import { errorCodigoActivo, normalizarSerie, MENSAJE_SOLO_BIOMEDICOS } from "./registro-activos";

/** Filas de datos como máximo por archivo. */
export const MAX_FILAS_IMPORTACION = 3000;
/** Filas que el navegador manda por solicitud al grabar. */
export const TANDA_FILAS_IMPORTACION = 200;
/** Filas por db.batch en el servidor (equipo + bitácora = 2 sentencias por fila). */
export const LOTE_FILAS_IMPORTACION = 20;

export type Separador = "," | ";" | "\t";
export type ModoImportacion = "crear" | "actualizar";

// ═══ CSV ═════════════════════════════════════════════════════════════════════

/** Separador más frecuente fuera de comillas en la primera línea (coma si no hay). */
function detectarSeparador(t: string): Separador {
  const cuenta: Record<Separador, number> = { ",": 0, ";": 0, "\t": 0 };
  let enComillas = false;
  for (const c of t) {
    if (c === '"') enComillas = !enComillas;
    else if (!enComillas && (c === "\n" || c === "\r")) break;
    else if (!enComillas && (c === "," || c === ";" || c === "\t")) cuenta[c]++;
  }
  let mejor: Separador = ",";
  for (const s of [";", "\t"] as const) if (cuenta[s] > cuenta[mejor]) mejor = s;
  return mejor;
}

/**
 * CSV a registros: quita el BOM, respeta comillas, "" y saltos de línea dentro de
 * comillas, y acepta CRLF. Una línea vacía queda como [""] para no correr la
 * numeración de las filas.
 */
export function parsearCsv(texto: string, separadorFijo?: Separador): { separador: Separador; registros: string[][] } {
  const t = texto.replace(/^\uFEFF/, "");
  const separador = separadorFijo ?? detectarSeparador(t);
  const registros: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let enComillas = false;
  let inicioCampo = true;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (enComillas) {
      if (c === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; }
        else enComillas = false;
      } else campo += c;
      continue;
    }
    if (c === '"' && inicioCampo) { enComillas = true; inicioCampo = false; continue; }
    if (c === separador) { fila.push(campo); campo = ""; inicioCampo = true; continue; }
    if (c === "\r" || c === "\n") {
      fila.push(campo);
      registros.push(fila);
      fila = []; campo = ""; inicioCampo = true;
      if (c === "\r" && t[i + 1] === "\n") i++;
      continue;
    }
    campo += c;
    inicioCampo = false;
  }
  if (campo !== "" || fila.length > 0 || !inicioCampo) { fila.push(campo); registros.push(fila); }
  return { separador, registros };
}

/** 'Vida útil (años)' → 'vida_util_anos'; 'N.º de serie' → 'n_de_serie'. */
export function normalizarEncabezado(h: string | null | undefined): string {
  return String(h ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// ═══ Columnas del inventario ═════════════════════════════════════════════════

export interface ColumnaInventario {
  /** Clave interna; también se acepta como encabezado. */
  clave: string;
  /** Encabezado en la plantilla; null = no va en la plantilla. */
  plantilla: string | null;
  /** Encabezado en el CSV que se descarga; null = no se descarga. */
  etiquetaExportacion: string | null;
  /** Otros encabezados aceptados (ya normalizados). */
  alias: readonly string[];
  /** false = solo se descarga: al cargar se ignora sin error. */
  importable: boolean;
  /** Áreas donde aplica (null = todas). */
  areas: readonly RubroKey[] | null;
  obligatoria?: string;
  ayuda: string;
  ejemplo: string;
}

const col = (c: Partial<ColumnaInventario> & Pick<ColumnaInventario, "clave">): ColumnaInventario => ({
  plantilla: c.clave, etiquetaExportacion: null, alias: [], importable: true, areas: null, ayuda: "", ejemplo: "", ...c,
});
const BIO: readonly RubroKey[] = ["biomedico"];
const soloDescarga = (clave: string, etiquetaExportacion: string) =>
  col({ clave, plantilla: null, etiquetaExportacion, importable: false, ayuda: "Solo se descarga; al cargar se ignora." });

/** En el orden del CSV que se descarga; las que solo se cargan van junto a su grupo. */
export const COLUMNAS_INVENTARIO: readonly ColumnaInventario[] = [
  col({ clave: "codigo", etiquetaExportacion: "Código", alias: ["codigo_institucional", "cod"], obligatoria: "Siempre",
    ayuda: "Código institucional del equipo. Es la llave: no se cambia por carga masiva.", ejemplo: "BIO-0001" }),
  col({ clave: "numero_activo", etiquetaExportacion: "Número de activo", alias: ["n_de_activo", "no_de_activo", "numero_de_activo", "activo_fijo"],
    ayuda: "Número de activo fijo. Si ya está en otro equipo, la fila sale con aviso.", ejemplo: "AF-2024-0153" }),
  col({ clave: "nombre", etiquetaExportacion: "Nombre", alias: ["equipo"], obligatoria: "Al agregar",
    ayuda: "Nombre del equipo.", ejemplo: "MONITOR DE SIGNOS VITALES" }),
  col({ clave: "rubro", plantilla: "area", etiquetaExportacion: "Área", alias: ["area_de_mantenimiento"],
    ayuda: "aires, infraestructura, equipo_general o biomedico (o su nombre). Vacía: el área de esta página.", ejemplo: "biomedico" }),
  col({ clave: "tipo", plantilla: null, ayuda: "Archivos anteriores: general o biomedico.", ejemplo: "biomedico" }),
  col({ clave: "categoria", etiquetaExportacion: "Categoría", ayuda: "Familia del equipo.", ejemplo: "MONITORES DE SIGNOS VITALES" }),
  col({ clave: "subcategoria", etiquetaExportacion: "Subcategoría", alias: ["subcategoria_clinica"], areas: BIO,
    ayuda: "soporte_vida, diagnostico, tratamiento, esterilizacion, cadena_frio, imagenologia o apoyo (o su nombre).", ejemplo: "diagnostico" }),
  col({ clave: "marca", etiquetaExportacion: "Marca", alias: ["fabricante"], ayuda: "Marca o fabricante.", ejemplo: "MINDRAY" }),
  col({ clave: "modelo", etiquetaExportacion: "Modelo", ayuda: "Modelo.", ejemplo: "UMEC10" }),
  col({ clave: "serial", plantilla: "serie", etiquetaExportacion: "Serie", alias: ["numero_de_serie", "n_de_serie"],
    ayuda: "Número de serie. Si ya está en otro equipo, la fila sale con aviso.", ejemplo: "DY-12345" }),
  col({ clave: "anio", etiquetaExportacion: "Año", alias: ["ano"], ayuda: "Año de fabricación (1900 a 2100).", ejemplo: "2022" }),
  col({ clave: "centro_costo", etiquetaExportacion: "Centro de costo (código)", alias: ["centro_de_costo", "centro_de_costo_codigo", "cc"],
    ayuda: "Código o nombre de un centro de costo del catálogo.", ejemplo: "CC-01" }),
  soloDescarga("centro_costo_nombre", "Centro de costo (nombre)"),
  col({ clave: "sucursal", etiquetaExportacion: "Sucursal", alias: ["sucursal_nombre", "sede"],
    ayuda: "Nombre o código de la sede.", ejemplo: "SEDE CENTRAL" }),
  col({ clave: "ubicacion", etiquetaExportacion: "Ubicación", alias: ["ubicacion_nombre"],
    ayuda: "Nombre de la ubicación dentro de la sede (Administración → Ubicaciones).", ejemplo: "UCI ADULTOS" }),
  col({ clave: "ubicacion_detalle", etiquetaExportacion: "Detalle de ubicación", alias: ["detalle_de_ubicacion"],
    ayuda: "Texto libre: sala, cama, cubículo.", ejemplo: "CUBÍCULO 3" }),
  col({ clave: "servicio", etiquetaExportacion: "Servicio", alias: ["servicio_funcion"], areas: ["equipo_general", "biomedico"],
    ayuda: "Servicio al que está asignado (hasta 200 caracteres).", ejemplo: "CUIDADOS INTENSIVOS" }),
  col({ clave: "descripcion", ayuda: "Descripción del equipo y su función.", ejemplo: "" }),
  col({ clave: "clase_riesgo", etiquetaExportacion: "Clase de riesgo", alias: ["clase", "clase_de_riesgo"], areas: BIO, obligatoria: "Biomédicos, al agregar",
    ayuda: "I, IIa, IIb o III (también 1, 2a, 2b o 3).", ejemplo: "IIa" }),
  col({ clave: "criticidad", etiquetaExportacion: "Criticidad", alias: ["criticidad_operacional"],
    ayuda: "alta, media o baja. Al agregar, media si queda vacía.", ejemplo: "alta" }),
  col({ clave: "registro_sanitario", etiquetaExportacion: "Registro sanitario", alias: ["numero_de_registro"], areas: BIO,
    ayuda: "Número del registro sanitario.", ejemplo: "DNM-12345" }),
  col({ clave: "registro_entidad", etiquetaExportacion: "Entidad del registro", alias: ["entidad_del_registro"], areas: BIO,
    ayuda: "CSSP, SRS, DNM u otra.", ejemplo: "DNM" }),
  col({ clave: "registro_emision", etiquetaExportacion: "Emisión del registro", alias: ["emision_del_registro"], areas: BIO,
    ayuda: "Fecha de emisión: DD/MM/AAAA o AAAA-MM-DD.", ejemplo: "15/01/2024" }),
  col({ clave: "registro_vencimiento", etiquetaExportacion: "Vencimiento del registro", alias: ["vencimiento_del_registro"], areas: BIO,
    ayuda: "Fecha de vencimiento: DD/MM/AAAA o AAAA-MM-DD.", ejemplo: "15/01/2029" }),
  col({ clave: "registro_no_requiere", etiquetaExportacion: "No requiere registro", alias: ["no_requiere_registro"], areas: BIO,
    ayuda: "«sí» si el equipo no requiere registro sanitario; vacío o «no» si lo requiere.", ejemplo: "no" }),
  soloDescarga("registro_estado", "Estado del registro"),
  col({ clave: "estado", etiquetaExportacion: "Estado",
    ayuda: "operativo, averiado o en mantenimiento. Las bajas se registran en la ficha del equipo.", ejemplo: "operativo" }),
  col({ clave: "fecha_adquisicion", etiquetaExportacion: "Fecha de adquisición", alias: ["fecha_de_adquisicion"],
    ayuda: "DD/MM/AAAA o AAAA-MM-DD; no puede ser futura.", ejemplo: "01/03/2022" }),
  col({ clave: "vida_util_anios", etiquetaExportacion: "Vida útil (años)", alias: ["vida_util", "vida_util_anos"],
    ayuda: "Años enteros de 0 a 100.", ejemplo: "10" }),
  col({ clave: "valor_adquisicion", etiquetaExportacion: "Valor de adquisición", alias: ["valor_de_adquisicion"],
    ayuda: "Número sin separador de miles, con punto o coma decimal.", ejemplo: "12500.50" }),
  col({ clave: "proveedor", etiquetaExportacion: "Proveedor", alias: ["proveedor_fabricante"],
    ayuda: "Nombre de un proveedor registrado.", ejemplo: "" }),
  col({ clave: "tipo_unidad", areas: ["aires"], ayuda: "Tipo de unidad: mini split, cassette, central…", ejemplo: "MINI SPLIT" }),
  col({ clave: "capacidad_btu_h", areas: ["aires"], ayuda: "Capacidad en BTU/h.", ejemplo: "12000" }),
  col({ clave: "refrigerante", areas: ["aires"], ayuda: "Refrigerante.", ejemplo: "R-410A" }),
  col({ clave: "tipo_instalacion", areas: ["infraestructura"], ayuda: "Tipo de instalación.", ejemplo: "RED HIDRÁULICA" }),
  col({ clave: "sector", areas: ["infraestructura"], ayuda: "Sector.", ejemplo: "EDIFICIO A" }),
  soloDescarga("ultima_calibracion", "Última calibración"),
  soloDescarga("proxima_calibracion", "Próxima calibración"),
  soloDescarga("fecha_baja", "Fecha de baja"),
  soloDescarga("motivo_baja", "Motivo de baja"),
  soloDescarga("destino_final", "Destino final"),
  soloDescarga("acta_baja", "Acta de baja"),
  soloDescarga("sla_urgente_h", "SLA Urgente (h)"),
  soloDescarga("sla_alta_h", "SLA Alta (h)"),
  soloDescarga("sla_media_h", "SLA Media (h)"),
  soloDescarga("sla_baja_h", "SLA Baja (h)"),
];

/** Encabezado normalizado → columna (clave, plantilla, etiqueta de descarga y alias). */
const COLUMNA_POR_ENCABEZADO = (() => {
  const m = new Map<string, ColumnaInventario>();
  for (const c of COLUMNAS_INVENTARIO) {
    for (const h of [c.clave, c.plantilla, c.etiquetaExportacion, ...c.alias]) {
      const n = normalizarEncabezado(h);
      if (n && !m.has(n)) m.set(n, c);
    }
  }
  return m;
})();

/** Columna que corresponde a un encabezado del archivo, o null si no se conoce. */
export const columnaDeEncabezado = (h: string): ColumnaInventario | null => COLUMNA_POR_ENCABEZADO.get(normalizarEncabezado(h)) ?? null;

/** Columnas que se cargan en un área (null = todas), en el orden de la tabla. */
export function columnasPlantilla(area: RubroKey | null): ColumnaInventario[] {
  return COLUMNAS_INVENTARIO.filter((c) => c.importable && c.plantilla && (!area || !c.areas || c.areas.includes(area)));
}

/** BOM más el encabezado de las columnas que se cargan en el área. */
export function plantillaCsv(area: RubroKey | null): string {
  return "\uFEFF" + columnasPlantilla(area).map((c) => c.plantilla).join(",") + "\r\n";
}

/** Columnas del CSV de equipos para toCsv, en orden. */
export function columnasExportacion(): { key: string; label: string }[] {
  return COLUMNAS_INVENTARIO.filter((c) => c.etiquetaExportacion).map((c) => ({ key: c.clave, label: c.etiquetaExportacion! }));
}

// ═══ Descarga ════════════════════════════════════════════════════════════════

export interface EquipoExportacion {
  codigo: string; numeroActivo: string | null; nombre: string; rubro: string | null; tipo: string;
  categoria: string | null; subcategoria: string | null; marca: string | null; modelo: string | null; serial: string | null; anio: number | null;
  centroCodigo: string | null; centroNombre: string | null; sucursal: string | null; ubicacionNombre: string | null; ubicacionDetalle: string | null;
  datosTecnicos: string | null; claseRiesgo: string | null; criticidadOperacional: string | null;
  registroSanitario: string | null; registroSanitarioEntidad: string | null; registroSanitarioEmision: string | null;
  registroSanitarioVencimiento: string | null; registroSanitarioNoRequiere: boolean | number | null;
  estado: string; fechaAdquisicion: string | null; vidaUtilAnios: number | null; valorAdquisicion: number | null; proveedor: string | null;
  ultimaCalibracion: string | null; proximaCalibracion: string | null;
  bajaId: number | null; bajaFecha: string | null; bajaMotivo: string | null; bajaDestino: string | null;
  slaUrgenteHoras: number | null; slaAltaHoras: number | null; slaMediaHoras: number | null; slaBajaHoras: number | null;
}

const soloFecha = (v: string | null | undefined) => (esFechaISO(v) ? v : v ?? "");

/**
 * Una fila del CSV de equipos: etiquetas en español, fechas AAAA-MM-DD y Sí/No.
 * Subcategoría, clase y registro sanitario solo van en biomédicos (como en la
 * impresión): un dato viejo en un equipo que pasó a otra área (Clasificar no borra el
 * registro) haría fallar esa fila al volver a cargar el CSV en «Actualizar».
 */
export function filaExportacion(e: EquipoExportacion, hoy: string): Record<string, string | number> {
  const area = rubroDeActivo(e.rubro, e.tipo);
  const bio = area === "biomedico";
  const tecnicos = leerDatosTecnicos(e.datosTecnicos);
  const soloBio = (v: string | number): string | number => (bio ? v : "");
  return {
    codigo: e.codigo,
    numero_activo: e.numeroActivo ?? "",
    nombre: e.nombre,
    rubro: AREAS[area].label,
    categoria: e.categoria ?? "",
    subcategoria: soloBio(e.subcategoria ? (SUBCATS_BIOMEDICO[e.subcategoria as SubcatKey]?.label ?? e.subcategoria) : ""),
    marca: e.marca ?? "",
    modelo: e.modelo ?? "",
    serial: e.serial ?? "",
    anio: e.anio ?? "",
    centro_costo: e.centroCodigo ?? "",
    centro_costo_nombre: e.centroNombre ?? "",
    sucursal: e.sucursal ?? "",
    ubicacion: e.ubicacionNombre ?? "",
    ubicacion_detalle: e.ubicacionDetalle ?? "",
    servicio: tecnicos.servicio ?? "",
    clase_riesgo: soloBio(e.claseRiesgo ?? ""),
    criticidad: e.criticidadOperacional ? conMayuscula(e.criticidadOperacional) : "",
    registro_sanitario: soloBio(e.registroSanitario ?? ""),
    registro_entidad: soloBio(e.registroSanitarioEntidad ?? ""),
    registro_emision: soloBio(soloFecha(e.registroSanitarioEmision)),
    registro_vencimiento: soloBio(soloFecha(e.registroSanitarioVencimiento)),
    registro_no_requiere: bio ? (e.registroSanitarioNoRequiere ? "Sí" : "No") : "",
    registro_estado: bio ? ESTADO_REGISTRO_LABEL[estadoRegistroSanitario(e, hoy)] : "",
    estado: ESTADO_ACTIVO_LABEL[e.estado as EstadoActivo] ?? e.estado,
    fecha_adquisicion: soloFecha(e.fechaAdquisicion),
    vida_util_anios: e.vidaUtilAnios ?? "",
    valor_adquisicion: e.valorAdquisicion == null ? "" : textoDeNumero(e.valorAdquisicion),
    proveedor: e.proveedor ?? "",
    ultima_calibracion: soloFecha(e.ultimaCalibracion),
    proxima_calibracion: soloFecha(e.proximaCalibracion),
    fecha_baja: soloFecha(e.bajaFecha),
    motivo_baja: e.bajaMotivo ? (MOTIVOS_BAJA[e.bajaMotivo as keyof typeof MOTIVOS_BAJA] ?? e.bajaMotivo) : "",
    destino_final: e.bajaDestino ? (DESTINOS_BAJA[e.bajaDestino as keyof typeof DESTINOS_BAJA] ?? e.bajaDestino) : "",
    acta_baja: e.bajaId ? folioActaBaja(e.bajaId) : "",
    sla_urgente_h: e.slaUrgenteHoras ?? "",
    sla_alta_h: e.slaAltaHoras ?? "",
    sla_media_h: e.slaMediaHoras ?? "",
    sla_baja_h: e.slaBajaHoras ?? "",
  };
}

const conMayuscula = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ═══ Plan de la carga ════════════════════════════════════════════════════════

export interface ActivoExistente {
  id: number; codigo: string; nombre: string; numeroActivo: string | null; serial: string | null;
  estado: string; rubro: string | null; tipo: string;
  categoria: string | null; subcategoria: string | null; marca: string | null; modelo: string | null; descripcion: string | null;
  anio: number | null; criticidadOperacional: string | null; claseRiesgo: string | null;
  centroCostoId: number | null; ubicacionId: number | null; ubicacion: string | null;
  registroSanitario: string | null; registroSanitarioEntidad: string | null; registroSanitarioEmision: string | null;
  registroSanitarioVencimiento: string | null; registroSanitarioNoRequiere: boolean | null;
  fechaAdquisicion: string | null; vidaUtilAnios: number | null; valorAdquisicion: number | null; proveedorId: number | null;
  datosTecnicos: string | null;
}
export interface UbicacionImportacion { id: number; nombre: string; sucursalId: number; activa: boolean }
export interface SucursalImportacion { id: number; nombre: string; codigo: string | null }
export interface CentroImportacion { id: number; codigo: string; nombre: string; sucursalId: number | null; activo: boolean }
export interface ProveedorImportacion { id: number; nombre: string; activo: boolean }

export interface ContextoImportacion {
  modo: ModoImportacion;
  /** Área de la página; null = todas. */
  area: RubroKey | null;
  /** Hoy en El Salvador ('AAAA-MM-DD'). */
  hoy: string;
  activos: readonly ActivoExistente[];
  ubicaciones: readonly UbicacionImportacion[];
  sucursales: readonly SucursalImportacion[];
  centros: readonly CentroImportacion[];
  proveedores: readonly ProveedorImportacion[];
}

export type Cambio = { antes: unknown; despues: unknown };
export type NuevoActivo = typeof activos.$inferInsert;

export interface ResultadoFila {
  /** Número de fila como lo muestra Excel (el encabezado es la 1). */
  fila: number;
  codigo: string;
  accion: "crear" | "actualizar" | "sin_cambios" | "error";
  detalle: string[];
  avisos: string[];
  nuevo?: NuevoActivo;
  /** Valores que se escriben (para update). */
  cambios?: Record<string, Cambio>;
  /** Lo mismo para la bitácora: el centro de costo con código y nombre. */
  cambiosBitacora?: Record<string, Cambio>;
  cambiosLegibles?: string[];
  activoId?: number;
}

export interface PlanImportacion {
  error?: string;
  /** Filas de datos con algo escrito. */
  filas: number;
  separador: Separador;
  columnasIgnoradas: string[];
  notas: string[];
  resultados: ResultadoFila[];
}

const ETIQUETA_CAMPO: Record<string, string> = {
  nombre: "Nombre", numeroActivo: "Número de activo", categoria: "Categoría", subcategoria: "Subcategoría",
  marca: "Marca", modelo: "Modelo", serial: "Serie", anio: "Año", descripcion: "Descripción",
  ubicacion: "Detalle de ubicación", ubicacionId: "Ubicación", estado: "Estado", criticidadOperacional: "Criticidad",
  claseRiesgo: "Clase de riesgo", centroCostoId: "Centro de costo", registroSanitario: "Registro sanitario",
  registroSanitarioEntidad: "Entidad del registro", registroSanitarioEmision: "Emisión del registro",
  registroSanitarioVencimiento: "Vencimiento del registro", registroSanitarioNoRequiere: "No requiere registro",
  fechaAdquisicion: "Fecha de adquisición", vidaUtilAnios: "Vida útil", valorAdquisicion: "Valor de adquisición",
  proveedorId: "Proveedor", datosTecnicos: "Datos técnicos",
};

export const NOTA_CALIBRACION = "Las fechas de calibración no se cargan aquí: se registran en Calibraciones.";

/** Área escrita como clave o como nombre ('Equipos biomédicos', 'Equipo biomédico'). */
function leerArea(texto: string): RubroKey | null {
  const n = normalizarTexto(texto).replace(/_/g, " ");
  for (const k of Object.keys(RUBROS) as RubroKey[]) {
    if (n === k.replace(/_/g, " ") || n === normalizarTexto(RUBROS[k].label) || n === normalizarTexto(AREAS[k].label)) return k;
  }
  return null;
}

function leerSubcategoria(texto: string): SubcatKey | null {
  const n = normalizarTexto(texto).replace(/_/g, " ");
  for (const k of SUBCAT_KEYS) {
    const etiqueta = normalizarTexto(SUBCATS_BIOMEDICO[k].label);
    if (n === k.replace(/_/g, " ") || n === etiqueta || n === etiqueta.replace(/\s*\(.*\)$/, "")) return k;
  }
  return null;
}

function leerEstado(texto: string): EstadoActivo | null {
  const n = normalizarTexto(texto).replace(/_/g, " ");
  if (n === "operativo" || n === "operativa") return "operativo";
  if (n === "averiado" || n === "averiada") return "averiado";
  if (n === "mantenimiento" || n === "en mantenimiento") return "mantenimiento";
  if (n === "baja" || n === "de baja" || n === "dado de baja" || n === "dada de baja") return "baja";
  return null;
}

function leerSiNo(texto: string): boolean | null {
  const n = normalizarTexto(texto);
  if (["si", "s", "x", "1", "true", "verdadero", "yes", "y"].includes(n)) return true;
  if (["no", "n", "0", "false", "falso"].includes(n)) return false;
  return null;
}

const igual = (a: unknown, b: unknown) => {
  if (typeof a === "boolean" || typeof b === "boolean") return !!a === !!b;
  return (a ?? null) === (b ?? null);
};

/** Mismos datos técnicos aunque el JSON guardado tenga otro orden de llaves. */
function mismosDatosTecnicos(a: string | null, b: string | null): boolean {
  const ordenado = (s: string | null) => JSON.stringify(Object.entries(leerDatosTecnicos(s)).filter(([, v]) => v != null && v !== "").sort(([x], [y]) => x.localeCompare(y)));
  return ordenado(a) === ordenado(b);
}

/** Lee el archivo completo y decide qué pasa con cada fila. No escribe nada. */
export function planificarImportacion(texto: string, ctx: ContextoImportacion): PlanImportacion {
  const { separador, registros } = parsearCsv(texto);
  const plan: PlanImportacion = { filas: 0, separador, columnasIgnoradas: [], notas: [], resultados: [] };
  if (!registros.length || registros[0].every((c) => !c.trim())) return { ...plan, error: "El archivo está vacío." };

  // ── Encabezados ──
  const indice: Record<string, number> = {};
  const indiceSoloDescarga: Record<string, number> = {};
  for (const [i, h] of registros[0].entries()) {
    if (!normalizarEncabezado(h)) continue;
    const c = columnaDeEncabezado(h);
    if (!c) { plan.columnasIgnoradas.push(h.trim()); continue; }
    if (!c.importable) { indiceSoloDescarga[c.clave] ??= i; continue; }
    if (indice[c.clave] !== undefined) return { ...plan, error: `La columna «${h.trim()}» aparece dos veces.` };
    indice[c.clave] = i;
  }
  if (indice.codigo === undefined) return { ...plan, error: "Falta la columna «codigo»." };

  const datos = registros.slice(1).map((celdas, i) => ({ fila: i + 2, celdas })).filter((r) => r.celdas.some((c) => c.trim()));
  plan.filas = datos.length;
  if (!datos.length) return { ...plan, error: "El archivo está vacío." };
  if (datos.length > MAX_FILAS_IMPORTACION) {
    return { ...plan, error: `El archivo tiene ${datos.length} filas; el máximo es ${MAX_FILAS_IMPORTACION}. Divídelo en partes.` };
  }

  // ── Búsquedas (se arman una vez: el archivo puede traer 3000 filas) ──
  const agrupar = <T>(lista: readonly T[], clave: (x: T) => string | null | undefined) => {
    const m = new Map<string, T[]>();
    for (const x of lista) {
      const k = clave(x);
      if (!k) continue;
      const grupo = m.get(k);
      if (grupo) grupo.push(x); else m.set(k, [x]);
    }
    return m;
  };
  const porCodigo = new Map<string, ActivoExistente>(ctx.activos.map((a) => [a.codigo.trim().toUpperCase(), a]));
  const porSerie = agrupar(ctx.activos, (a) => normalizarSerie(a.serial));
  const porNumeroActivo = agrupar(ctx.activos, (a) => a.numeroActivo?.trim().toUpperCase());
  const sedes = new Map(ctx.sucursales.map((s) => [s.id, s]));
  const nombreSede = (id: number | null | undefined) => (id != null ? sedes.get(id)?.nombre ?? `#${id}` : "sin sede");
  const ubicacionesPorId = new Map(ctx.ubicaciones.map((u) => [u.id, u]));
  const ubicacionesPorNombre = agrupar(ctx.ubicaciones, (u) => normalizarTexto(u.nombre));
  const centrosPorId = new Map(ctx.centros.map((c) => [c.id, c]));
  const centrosPorCodigo = agrupar(ctx.centros, (c) => normalizarTexto(c.codigo));
  const centrosPorNombre = agrupar(ctx.centros, (c) => normalizarTexto(c.nombre));
  const sedesPorNombre = agrupar(ctx.sucursales, (s) => normalizarTexto(s.nombre));
  const sedesPorCodigo = agrupar(ctx.sucursales, (s) => normalizarTexto(s.codigo));
  const proveedoresPorNombre = agrupar(ctx.proveedores, (p) => normalizarTexto(p.nombre));
  const buscarSucursal = (t: string) => {
    const n = normalizarTexto(t);
    return sedesPorNombre.get(n)?.[0] ?? sedesPorCodigo.get(n)?.[0] ?? null;
  };
  const buscarCentro = (t: string): CentroImportacion | CentroImportacion[] | null => {
    const n = normalizarTexto(t);
    const porCod = centrosPorCodigo.get(n)?.[0];
    if (porCod) return porCod;
    const porNombre = centrosPorNombre.get(n) ?? [];
    return porNombre.length === 1 ? porNombre[0] : porNombre.length > 1 ? porNombre : null;
  };
  const buscarProveedor = (t: string) => {
    const todos = proveedoresPorNombre.get(normalizarTexto(t)) ?? [];
    return todos.find((p) => p.activo) ?? todos[0] ?? null;
  };

  const codigosVistos = new Map<string, number>();
  const seriesVistas = new Map<string, number>();
  let hayCalibraciones = false;

  for (const { fila, celdas } of datos) {
    const dato = (clave: string): string | undefined => {
      const i = indice[clave];
      if (i === undefined) return undefined;
      const v = (celdas[i] ?? "").trim();
      return v ? v : undefined;
    };
    const resultado = (codigo: string, accion: ResultadoFila["accion"], detalle: string[], avisos: string[] = []): ResultadoFila =>
      ({ fila, codigo, accion, detalle, avisos });

    // ── Código: la llave ──
    const codigoTxt = dato("codigo");
    if (!codigoTxt) { plan.resultados.push(resultado("", "error", ["Falta el código."])); continue; }
    const codigo = codigoTxt.toUpperCase();
    const errCodigo = errorCodigoActivo(codigo);
    if (errCodigo) { plan.resultados.push(resultado(codigo, "error", [errCodigo])); continue; }
    const filaPrevia = codigosVistos.get(codigo);
    if (filaPrevia !== undefined) {
      plan.resultados.push(resultado(codigo, "error", [`Código repetido en el archivo (también en la fila ${filaPrevia}).`]));
      continue;
    }
    codigosVistos.set(codigo, fila);
    const existente = porCodigo.get(codigo) ?? null;

    // ── Área ──
    const areaTxt = dato("rubro");
    const areaFila = areaTxt ? leerArea(areaTxt) : null;
    if (areaTxt && !areaFila) {
      plan.resultados.push(resultado(codigo, "error", [`Área «${areaTxt}» no válida. Usa aires, infraestructura, equipo_general o biomedico.`]));
      continue;
    }
    const tipoTxt = dato("tipo");
    const tipoFila = tipoTxt ? normalizarTexto(tipoTxt) : null;
    if (tipoFila && tipoFila !== "general" && tipoFila !== "biomedico") {
      plan.resultados.push(resultado(codigo, "error", [`Tipo «${tipoTxt}» no válido. Usa general o biomedico.`]));
      continue;
    }
    let area: RubroKey;
    if (ctx.modo === "crear") {
      if (existente) {
        plan.resultados.push(resultado(codigo, "error", [`El código ya existe (${existente.codigo} · ${existente.nombre}). Para cambiar sus datos usa «Actualizar equipos existentes».`]));
        continue;
      }
      area = areaFila ?? ctx.area ?? (tipoFila === "biomedico" ? "biomedico" : "equipo_general");
      if (ctx.area && area !== ctx.area) { plan.resultados.push(resultado(codigo, "error", ["El área de la fila no corresponde a este inventario."])); continue; }
      if (tipoFila && tipoFila !== (area === "biomedico" ? "biomedico" : "general")) {
        plan.resultados.push(resultado(codigo, "error", ["El tipo no corresponde al área de la fila."]));
        continue;
      }
    } else {
      if (!existente) { plan.resultados.push(resultado(codigo, "error", ["No existe un equipo con ese código."])); continue; }
      area = rubroDeActivo(existente.rubro, existente.tipo);
      const otraArea = (ctx.area && area !== ctx.area) || (areaFila && areaFila !== area)
        || (tipoFila && tipoFila !== (area === "biomedico" ? "biomedico" : "general"));
      if (otraArea) { plan.resultados.push(resultado(codigo, "error", [`El equipo es de otra área (${AREAS[area].label}).`])); continue; }
    }
    const crear = ctx.modo === "crear";
    const bio = area === "biomedico";
    const errores: string[] = [];
    const avisos: string[] = [];
    const v: Partial<Record<keyof ActivoExistente, unknown>> = {};

    // ── Textos (en mayúsculas, como en la pantalla) ──
    const textos: [string, keyof ActivoExistente][] = [
      ["nombre", "nombre"], ["numero_activo", "numeroActivo"], ["categoria", "categoria"], ["marca", "marca"],
      ["modelo", "modelo"], ["serial", "serial"], ["descripcion", "descripcion"], ["ubicacion_detalle", "ubicacion"],
    ];
    for (const [clave, campo] of textos) { const d = dato(clave); if (d) v[campo] = d.toUpperCase(); }
    if (crear && !v.nombre) errores.push("Falta el nombre.");

    // ── Estado (la baja no se carga) ──
    const estadoTxt = dato("estado");
    if (estadoTxt) {
      const e = leerEstado(estadoTxt);
      if (!e) errores.push(`Estado «${estadoTxt}» no válido. Usa operativo, averiado o en mantenimiento.`);
      else if (e === "baja") { if (crear || existente!.estado !== "baja") errores.push("Para dar de baja un equipo usa «Dar de baja» en su ficha."); }
      else if (!crear && existente!.estado === "baja") errores.push("El equipo está dado de baja. Para devolverlo al servicio usa «Revertir baja» en su ficha.");
      else v.estado = e;
    }

    const critTxt = dato("criticidad");
    if (critTxt) {
      const c = normalizarTexto(critTxt);
      if (c === "alta" || c === "media" || c === "baja") v.criticidadOperacional = c;
      else errores.push(`Criticidad «${critTxt}» no válida. Usa alta, media o baja.`);
    }

    const anioTxt = dato("anio");
    if (anioTxt) {
      const n = /^\d{4}$/.test(anioTxt) ? Number(anioTxt) : NaN;
      if (n >= 1900 && n <= 2100) v.anio = n;
      else errores.push(`Año «${anioTxt}» no válido.`);
    }

    // ── Clase, subcategoría y registro sanitario (solo biomédicos) ──
    let clase: ClaseRiesgo | null = null;
    const claseTxt = dato("clase_riesgo");
    if (claseTxt) {
      const r = leerClaseRiesgo(claseTxt);
      if ("error" in r) errores.push(r.error);
      else clase = r.valor;
    }
    let subcat: SubcatKey | null = null;
    const subcatTxt = dato("subcategoria");
    if (subcatTxt) {
      subcat = leerSubcategoria(subcatTxt);
      if (!subcat) errores.push(`Subcategoría «${subcatTxt}» no válida.`);
    }
    const fecha = (clave: string, nombre: string): string | null => {
      const d = dato(clave);
      if (!d) return null;
      const r = leerFechaEntrada(d);
      if ("error" in r) { errores.push(`${nombre}: ${r.error}`); return null; }
      return r.valor;
    };
    const regNumero = dato("registro_sanitario")?.toUpperCase() ?? null;
    const regEntidad = dato("registro_entidad")?.toUpperCase() ?? null;
    if (regEntidad && regEntidad.length > 60) errores.push("La entidad del registro no puede pasar de 60 caracteres.");
    const regEmision = fecha("registro_emision", "Emisión del registro");
    const regVencimiento = fecha("registro_vencimiento", "Vencimiento del registro");
    let regNoRequiere: boolean | null = null;
    const noReqTxt = dato("registro_no_requiere");
    if (noReqTxt) {
      regNoRequiere = leerSiNo(noReqTxt);
      if (regNoRequiere === null) errores.push(`Valor «${noReqTxt}» no válido en «no requiere registro». Usa sí o no.`);
    }
    if (!bio) {
      if (clase || subcat || regNumero || regEntidad || regEmision || regVencimiento || regNoRequiere) errores.push(MENSAJE_SOLO_BIOMEDICOS);
    } else {
      if (clase) v.claseRiesgo = clase;
      else if (crear && !claseTxt) errores.push("Falta la clase de riesgo (I, IIa, IIb o III).");
      else if (!crear && !claseTxt && !existente!.claseRiesgo) avisos.push("Sigue sin clase de riesgo.");
      if (subcat) v.subcategoria = subcat;
      if (regNoRequiere && (regNumero || regEntidad || regEmision || regVencimiento)) {
        errores.push("Marca «no requiere registro» o escribe el número, no ambos.");
      } else if (regNoRequiere) {
        v.registroSanitarioNoRequiere = true;
        v.registroSanitario = null; v.registroSanitarioEntidad = null;
        v.registroSanitarioEmision = null; v.registroSanitarioVencimiento = null;
      } else {
        if (regNumero) v.registroSanitario = regNumero;
        if (regEntidad) v.registroSanitarioEntidad = regEntidad;
        if (regEmision) v.registroSanitarioEmision = regEmision;
        if (regVencimiento) v.registroSanitarioVencimiento = regVencimiento;
        // Escribir el número quiere decir que sí lo requiere.
        if (regNoRequiere === false || regNumero) v.registroSanitarioNoRequiere = false;
        const emision = (v.registroSanitarioEmision as string | undefined) ?? (crear ? null : existente!.registroSanitarioEmision);
        const vence = (v.registroSanitarioVencimiento as string | undefined) ?? (crear ? null : existente!.registroSanitarioVencimiento);
        if ((regEmision || regVencimiento) && emision && vence && vence < emision) errores.push("El vencimiento del registro es anterior a su emisión.");
      }
    }

    // ── Sede y ubicación ──
    const sucTxt = dato("sucursal");
    const ubTxt = dato("ubicacion");
    let sede: SucursalImportacion | null = null;
    if (sucTxt) {
      sede = buscarSucursal(sucTxt);
      if (!sede) errores.push(`La sucursal «${sucTxt}» no existe.`);
    }
    let ubicacion: UbicacionImportacion | undefined;
    if (ubTxt && !(sucTxt && !sede)) {
      const candidatas = (ubicacionesPorNombre.get(normalizarTexto(ubTxt)) ?? []).filter((u) => !sede || u.sucursalId === sede.id);
      // Al actualizar, si el nombre coincide con la ubicación que ya tiene el equipo, se queda esa.
      const laDelEquipo = !crear ? candidatas.find((u) => u.id === existente!.ubicacionId) : undefined;
      const activas = candidatas.filter((u) => u.activa);
      const elegibles = laDelEquipo ? [laDelEquipo] : activas.length ? activas : candidatas;
      if (!candidatas.length) {
        errores.push(sede ? `La ubicación «${ubTxt}» no existe en la sucursal «${sede.nombre}».` : `La ubicación «${ubTxt}» no existe.`);
      } else if (elegibles.length > 1) {
        const enSedes = new Set(elegibles.map((u) => u.sucursalId));
        errores.push(enSedes.size > 1
          ? `Hay ${elegibles.length} ubicaciones «${ubTxt}» en distintas sedes: agrega la columna sucursal.`
          : `Hay ${elegibles.length} ubicaciones «${ubTxt}» en la sede «${nombreSede(elegibles[0].sucursalId)}»: usa un nombre único.`);
      } else if (!elegibles[0].activa && elegibles[0] !== laDelEquipo) {
        errores.push(`La ubicación «${ubTxt}» está desactivada.`);
      } else {
        ubicacion = elegibles[0];
        v.ubicacionId = ubicacion.id;
      }
    } else if (crear && !ubTxt) {
      avisos.push("Sin ubicación: el equipo no quedará en ninguna sede.");
    }

    // ── Centro de costo ──
    const ccTxt = dato("centro_costo");
    let centro: CentroImportacion | undefined;
    if (ccTxt) {
      const c = buscarCentro(ccTxt);
      if (!c) errores.push(`El centro de costo «${ccTxt}» no existe en el catálogo.`);
      else if (Array.isArray(c)) errores.push(`Hay ${c.length} centros de costo «${ccTxt}»: usa el código.`);
      else if (!c.activo && (crear || existente!.centroCostoId !== c.id)) errores.push(`El centro de costo «${ccTxt}» está desactivado.`);
      else { centro = c; v.centroCostoId = c.id; }
    }
    const centroFinal = centro ?? (!crear && existente!.centroCostoId != null ? centrosPorId.get(existente!.centroCostoId) : undefined);
    const ubicacionFinal = ubicacion ?? (!crear && existente!.ubicacionId != null ? ubicacionesPorId.get(existente!.ubicacionId) : undefined);
    if ((centro || ubicacion) && centroFinal?.sucursalId != null && ubicacionFinal && ubicacionFinal.sucursalId !== centroFinal.sucursalId) {
      errores.push(`El centro de costo «${centroFinal.codigo}» es de la sede «${nombreSede(centroFinal.sucursalId)}» y el equipo está en «${nombreSede(ubicacionFinal.sucursalId)}».`);
    }

    // ── Datos patrimoniales ──
    const fechaAdq = fecha("fecha_adquisicion", "Fecha de adquisición");
    if (fechaAdq) {
      if (fechaAdq > ctx.hoy) errores.push("La fecha de adquisición no puede ser futura.");
      else v.fechaAdquisicion = fechaAdq;
    }
    const vidaTxt = dato("vida_util_anios");
    if (vidaTxt) {
      const n = /^\d{1,3}$/.test(vidaTxt) ? Number(vidaTxt) : NaN;
      if (n >= 0 && n <= 100) v.vidaUtilAnios = n;
      else errores.push(`Vida útil «${vidaTxt}» no válida: usa años enteros de 0 a 100.`);
    }
    const valorTxt = dato("valor_adquisicion");
    if (valorTxt) {
      const r = leerNumero(valorTxt.replace(/^\$\s*/, ""));
      if (r.tipo === "numero" && r.valor >= 0) v.valorAdquisicion = r.valor;
      else if (r.tipo === "ambiguo") errores.push(`Valor de adquisición: ${r.mensaje}`);
      else errores.push(`Valor de adquisición «${valorTxt}» no válido.`);
    }
    const provTxt = dato("proveedor");
    if (provTxt) {
      const p = buscarProveedor(provTxt);
      if (p) v.proveedorId = p.id;
      else avisos.push(`Proveedor «${provTxt}» no registrado: se deja sin proveedor.`);
    }

    // ── Datos técnicos del área (servicio, aires, infraestructura) ──
    const tecnicos: Record<string, string | number> = {};
    for (const clave of ["servicio", "tipo_unidad", "refrigerante", "tipo_instalacion", "sector"] as const) {
      const d = dato(clave);
      if (!d) continue;
      const campo = clave === "tipo_unidad" ? "tipoUnidad" : clave === "tipo_instalacion" ? "tipoInstalacion" : clave;
      const valor = d.toUpperCase();
      if (valor.length > 200) errores.push(`«${clave}» no puede pasar de 200 caracteres.`);
      else tecnicos[campo] = valor;
    }
    const capTxt = dato("capacidad_btu_h");
    if (capTxt) {
      const r = leerNumero(capTxt);
      if (r.tipo === "numero" && r.valor > 0 && r.valor <= 10_000_000) tecnicos.capacidadBtuH = r.valor;
      else errores.push(r.tipo === "ambiguo" ? `Capacidad: ${r.mensaje}` : `Capacidad «${capTxt}» no válida.`);
    }
    if (Object.keys(tecnicos).length && !datosTecnicosValidosParaArea(area, tecnicos)) errores.push("Los datos técnicos no corresponden al área de la fila.");

    // ── Avisos de serie y número de activo repetidos ──
    const serie = normalizarSerie(v.serial as string | undefined);
    if (serie) {
      const otro = (porSerie.get(serie) ?? []).find((a) => a.id !== existente?.id);
      if (otro) avisos.push(`La serie ya está registrada en ${otro.codigo} · ${otro.nombre}.`);
      const previa = seriesVistas.get(serie);
      if (previa !== undefined) avisos.push(`Serie repetida en el archivo (fila ${previa}).`);
      else seriesVistas.set(serie, fila);
    }
    const numActivo = (v.numeroActivo as string | undefined)?.trim().toUpperCase();
    if (numActivo) {
      const otro = (porNumeroActivo.get(numActivo) ?? []).find((a) => a.id !== existente?.id);
      if (otro) avisos.push(`El número de activo ya está registrado en ${otro.codigo}.`);
    }

    // Las fechas de calibración solo se descargan: si traen dato, se avisa que no se cargan.
    const detalle: string[] = [];
    for (const clave of ["ultima_calibracion", "proxima_calibracion"]) {
      const i = indiceSoloDescarga[clave];
      if (i !== undefined && (celdas[i] ?? "").trim()) { hayCalibraciones = true; if (!detalle.includes(NOTA_CALIBRACION)) detalle.push(NOTA_CALIBRACION); }
    }

    if (errores.length) { plan.resultados.push(resultado(codigo, "error", errores, avisos)); continue; }

    if (crear) {
      const tipo = bio ? "biomedico" : "general";
      const nuevo: NuevoActivo = {
        codigo, nombre: v.nombre as string, rubro: area, tipo,
        numeroActivo: (v.numeroActivo as string) ?? null, categoria: (v.categoria as string) ?? null,
        subcategoria: (v.subcategoria as string) ?? null, marca: (v.marca as string) ?? null, modelo: (v.modelo as string) ?? null,
        serial: (v.serial as string) ?? null, anio: (v.anio as number) ?? null, descripcion: (v.descripcion as string) ?? null,
        ubicacion: (v.ubicacion as string) ?? null, ubicacionId: (v.ubicacionId as number) ?? null,
        estado: (v.estado as EstadoActivo) ?? "operativo",
        criticidadOperacional: (v.criticidadOperacional as "alta" | "media" | "baja") ?? "media",
        claseRiesgo: (v.claseRiesgo as ClaseRiesgo) ?? null, centroCostoId: (v.centroCostoId as number) ?? null,
        registroSanitario: (v.registroSanitario as string) ?? null, registroSanitarioEntidad: (v.registroSanitarioEntidad as string) ?? null,
        registroSanitarioEmision: (v.registroSanitarioEmision as string) ?? null,
        registroSanitarioVencimiento: (v.registroSanitarioVencimiento as string) ?? null,
        registroSanitarioNoRequiere: v.registroSanitarioNoRequiere === true,
        fechaAdquisicion: (v.fechaAdquisicion as string) ?? null, vidaUtilAnios: (v.vidaUtilAnios as number) ?? null,
        valorAdquisicion: (v.valorAdquisicion as number) ?? null, proveedorId: (v.proveedorId as number) ?? null,
        datosTecnicos: serializarDatosTecnicos(area, tecnicos), qrCode: `QR-${codigo}`,
      };
      const partes = [nuevo.nombre, clase ? `Clase ${clase}` : null, ubicacion?.nombre ?? null].filter(Boolean);
      plan.resultados.push({ ...resultado(codigo, "crear", [`Se agregará: ${partes.join(" · ")}`, ...detalle], avisos), nuevo });
      continue;
    }

    // ── Actualizar: solo lo que trae dato y es distinto ──
    const a = existente!;
    if (Object.keys(tecnicos).length) {
      const mezcla = serializarDatosTecnicos(area, { ...leerDatosTecnicos(a.datosTecnicos), ...tecnicos });
      v.datosTecnicos = mezcla;
    }
    const cambios: Record<string, Cambio> = {};
    for (const [campo, despues] of Object.entries(v) as [keyof ActivoExistente, unknown][]) {
      if (despues === undefined) continue;
      const antes = a[campo] ?? null;
      // Los datos técnicos se comparan por su contenido, no por el orden del JSON guardado.
      if (campo === "datosTecnicos" && mismosDatosTecnicos(a.datosTecnicos, despues as string | null)) continue;
      if (!igual(antes, despues)) cambios[campo] = { antes, despues };
    }
    if (!Object.keys(cambios).length) {
      plan.resultados.push(resultado(codigo, "sin_cambios", ["Sin cambios", ...detalle], avisos));
      continue;
    }
    const cambiosBitacora: Record<string, Cambio> = { ...cambios };
    if (cambios.centroCostoId) {
      const antes = centrosPorId.get(cambios.centroCostoId.antes as number) ?? null;
      const despues = centrosPorId.get(cambios.centroCostoId.despues as number) ?? null;
      cambiosBitacora.centroCostoId = { antes: etiquetaCentroCosto(antes), despues: etiquetaCentroCosto(despues) };
    }
    const cambiosLegibles = Object.keys(cambios).map((k) => ETIQUETA_CAMPO[k] ?? k);
    plan.resultados.push({
      ...resultado(codigo, "actualizar", [`Cambia: ${cambiosLegibles.join(", ")}`, ...detalle], avisos),
      cambios, cambiosBitacora, cambiosLegibles, activoId: a.id,
    });
  }
  if (hayCalibraciones) plan.notas.push(NOTA_CALIBRACION);
  return plan;
}

/** Resumen de la bitácora para un alta por carga masiva. */
export const resumenAltaCarga = (archivo?: string | null): string =>
  archivo ? `Alta por carga masiva (archivo «${archivo}»)` : "Alta por carga masiva";

/** Resumen de la bitácora para una actualización por carga masiva. */
export const resumenActualizacionCarga = (etiquetas: readonly string[]): string =>
  `Actualizado por carga masiva: ${etiquetas.join(", ")}`;
