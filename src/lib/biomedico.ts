// Fase 59 · Equipos biomédicos y evaluación JCI.
// Constantes y reglas que comparten los paquetes de esta fase (inventario,
// metrología, ficha, documentos, cumplimiento, seguridad eléctrica, incidentes).
// Una regla vive en un solo lugar: la pantalla, el CSV, la impresión y el aviso
// cuentan igual.
//
// Este archivo es puro: no importa base de datos, Drizzle, zod ni Astro (de
// schema.ts solo tipos). Lo empaquetan las pruebas con esbuild y lo importa el
// navegador (formulario de seguridad eléctrica).
//
// Fechas sin hora: se guardan como texto 'AAAA-MM-DD' y nunca pasan por
// new Date('AAAA-MM-DD'), que en El Salvador (UTC-6) muestra el día anterior.
import type { Rol } from "./schema";
import { rubroDeActivo } from "./rubros";
import { leerNumero } from "./numero";

// ═══ Fechas ═════════════════════════════════════════════════════════════════

const DIA_MS = 86_400_000;
/** El Salvador: UTC-6 todo el año (sin horario de verano). */
const DESFASE_SV_MS = 6 * 3_600_000;
const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_MARCA = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

const dosCifras = (n: number) => String(n).padStart(2, "0");
const diasDelMes = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();
const isoDeUTC = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function partesFecha(valor: string): [number, number, number] | null {
  const m = RE_FECHA.exec(valor);
  if (!m) return null;
  const anio = Number(m[1]), mes = Number(m[2]), dia = Number(m[3]);
  if (anio < 1900 || anio > 2999 || mes < 1 || mes > 12 || dia < 1 || dia > diasDelMes(anio, mes)) return null;
  return [anio, mes, dia];
}

/** 'AAAA-MM-DD' exacto y con fecha real del calendario. */
export function esFechaISO(valor: unknown): valor is string {
  return typeof valor === "string" && partesFecha(valor) !== null;
}

/** Hoy en El Salvador como 'AAAA-MM-DD'. Acepta Date o milisegundos. */
export function hoySV(ahora: Date | number = Date.now()): string {
  const ms = typeof ahora === "number" ? ahora : ahora.getTime();
  return isoDeUTC(ms - DESFASE_SV_MS);
}

/** Milisegundos UTC de una marca de tiempo; sin zona se toma como UTC (así guarda SQLite). */
function msDeMarca(valor: string): number | null {
  const m = RE_MARCA.exec(valor.trim());
  if (!m || !partesFecha(m[1])) return null;
  const zona = m[6] ? (m[6].toUpperCase() === "Z" ? "Z" : m[6].length === 5 ? `${m[6].slice(0, 3)}:${m[6].slice(3)}` : m[6]) : "Z";
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4] ?? "00"}${m[5] ?? ""}${zona}`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Día en El Salvador ('AAAA-MM-DD') de una fecha sola o de una marca de tiempo.
 * '2026-05-11 01:30:00' (UTC) → '2026-05-10'; '2026-05-10' → '2026-05-10'; ilegible → null.
 */
export function diaSV(valor: string | null | undefined): string | null {
  if (typeof valor !== "string" || !valor.trim()) return null;
  const v = valor.trim();
  if (RE_FECHA.test(v)) return partesFecha(v) ? v : null;
  const ms = msDeMarca(v);
  return ms === null ? null : isoDeUTC(ms - DESFASE_SV_MS);
}

/**
 * 'DD/MM/AAAA'. Una fecha sola se parte como texto; una marca de tiempo se pasa
 * al día de El Salvador. Vacío o ilegible → `vacio` ('—').
 */
export function fechaCorta(valor: string | null | undefined, vacio = "—"): string {
  const dia = diaSV(valor);
  if (!dia) return vacio;
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
}

/** 'HH:MM' en El Salvador de una marca de tiempo; '' si es fecha sola o no se lee. */
export function horaSV(valor: string | null | undefined): string {
  if (typeof valor !== "string" || RE_FECHA.test(valor.trim())) return "";
  const ms = msDeMarca(valor);
  if (ms === null) return "";
  const d = new Date(ms - DESFASE_SV_MS);
  return `${dosCifras(d.getUTCHours())}:${dosCifras(d.getUTCMinutes())}`;
}

/** 'DD/MM/AAAA HH:MM' en El Salvador; una fecha sola sale sin hora; ilegible → `vacio`. */
export function fechaHoraSV(valor: string | null | undefined, vacio = "—"): string {
  const fecha = fechaCorta(valor, "");
  if (!fecha) return vacio;
  const hora = horaSV(valor);
  return hora ? `${fecha} ${hora}` : fecha;
}

/**
 * Fecha escrita por una persona o en un CSV: AAAA-MM-DD, AAAA/MM/DD, DD/MM/AAAA,
 * D/M/AAAA, DD-MM-AAAA o DD.MM.AAAA. Vacío → { valor: null }.
 */
export function leerFechaEntrada(texto: unknown): { valor: string | null } | { error: string } {
  if (texto === null || texto === undefined) return { valor: null };
  const t = String(texto).trim();
  if (!t) return { valor: null };
  let anio: string | undefined, mes: string | undefined, dia: string | undefined;
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(t);
  if (m) [, anio, mes, dia] = m;
  else if ((m = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})$/.exec(t))) [, dia, , mes, anio] = m;
  const iso = anio ? `${anio}-${mes!.padStart(2, "0")}-${dia!.padStart(2, "0")}` : "";
  return esFechaISO(iso) ? { valor: iso } : { error: `Fecha «${t}» no válida. Usa DD/MM/AAAA.` };
}

/** Suma días con Date.UTC. Fecha no válida → ''. */
export function sumarDias(fecha: string, dias: number): string {
  const p = partesFecha(fecha);
  return p ? isoDeUTC(Date.UTC(p[0], p[1] - 1, p[2] + dias)) : "";
}

/** Suma meses; el día se recorta al fin de mes (31/01 + 1 → 28/02). Fecha no válida → ''. */
export function sumarMeses(fecha: string, meses: number): string {
  const p = partesFecha(fecha);
  if (!p) return "";
  const total = p[0] * 12 + (p[1] - 1) + meses;
  const anio = Math.floor(total / 12), mes = (total % 12) + 1;
  return `${anio}-${dosCifras(mes)}-${dosCifras(Math.min(p[2], diasDelMes(anio, mes)))}`;
}

/** hasta − desde, en días. Si alguna no es fecha válida → NaN. */
export function diasEntre(desde: string, hasta: string): number {
  const a = partesFecha(desde), b = partesFecha(hasta);
  if (!a || !b) return Number.NaN;
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / DIA_MS);
}

/** 'vence hoy' · 'vence mañana' · 'vence en N días' · 'venció ayer' · 'venció hace N días' · '' (null). */
export function textoVence(dias: number | null): string {
  if (dias === null || !Number.isFinite(dias)) return "";
  if (dias === 0) return "vence hoy";
  if (dias === 1) return "vence mañana";
  if (dias > 1) return `vence en ${dias} días`;
  if (dias === -1) return "venció ayer";
  return `venció hace ${-dias} días`;
}

const conMayuscula = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Minúsculas, sin tildes y con un solo espacio: '  Radiología  UCI ' → 'radiologia uci'. */
export function normalizarTexto(s: string | null | undefined): string {
  return String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

// ═══ Roles (regla 3) ════════════════════════════════════════════════════════
// Admin y jefe administran y autorizan; técnico registra; visualizador solo ve.
// Proveedor, solicitante y motorista no ven nada de lo biomédico. No se modifican.

export const ROLES_BIO_VER: Rol[] = ["admin", "jefe", "tecnico", "visualizador"];
export const ROLES_BIO_REGISTRAR: Rol[] = ["admin", "jefe", "tecnico"];
export const ROLES_BIO_GESTIONAR: Rol[] = ["admin", "jefe"];
const tieneRol = (lista: Rol[], rol: string | null | undefined) => !!rol && (lista as string[]).includes(rol);
export const puedeVerBio = (rol: string | null | undefined) => tieneRol(ROLES_BIO_VER, rol);
export const puedeRegistrarBio = (rol: string | null | undefined) => tieneRol(ROLES_BIO_REGISTRAR, rol);
export const puedeGestionarBio = (rol: string | null | undefined) => tieneRol(ROLES_BIO_GESTIONAR, rol);

// ═══ Vigencias ══════════════════════════════════════════════════════════════
// El día del vencimiento todavía vale: vence al día siguiente.

/** Días de anticipación con que algo pasa a «por vencer». Los usan pantallas, CSV y avisos. */
export const DIAS_AVISO = {
  calibracion: 30,
  seguridadElectrica: 30,
  documento: 30,
  acreditacion: 60,
  registroSanitario: 90,
  licencia: 90,
} as const;

export type EstadoVigencia = "sin_fecha" | "vencido" | "por_vencer" | "vigente";
export const VIGENCIA_LABEL: Record<EstadoVigencia, string> = {
  sin_fecha: "Sin fecha", vencido: "Vencido", por_vencer: "Por vencer", vigente: "Vigente",
};
export const VIGENCIA_COLOR: Record<EstadoVigencia, string> = {
  sin_fecha: "bg-slate-100 text-slate-700", vencido: "bg-red-100 text-red-700",
  por_vencer: "bg-amber-100 text-amber-700", vigente: "bg-emerald-100 text-emerald-700",
};

/** vencido si vence < hoy; por_vencer si faltan de 0 a `avisoDias`; vacío o inválido → sin_fecha. */
export function estadoVigencia(vence: string | null | undefined, hoy: string, avisoDias = 30): EstadoVigencia {
  if (!esFechaISO(vence)) return "sin_fecha";
  const dias = diasEntre(hoy, vence);
  if (dias < 0) return "vencido";
  return dias <= avisoDias ? "por_vencer" : "vigente";
}

export type TramoVigencia = "sin_fecha" | "vigente" | "vence_90" | "vence_60" | "vence_30" | "vencida";
export const TRAMO_VIGENCIA: Readonly<Record<TramoVigencia, { etiqueta: string; color: string }>> = {
  sin_fecha: { etiqueta: "Sin vencimiento", color: "bg-emerald-100 text-emerald-700" },
  vigente: { etiqueta: "Vigente", color: "bg-emerald-100 text-emerald-700" },
  vence_90: { etiqueta: "Vence en ≤ 90 días", color: "bg-amber-100 text-amber-700" },
  vence_60: { etiqueta: "Vence en ≤ 60 días", color: "bg-orange-100 text-orange-700" },
  vence_30: { etiqueta: "Vence en ≤ 30 días", color: "bg-red-100 text-red-700" },
  vencida: { etiqueta: "Vencida", color: "bg-red-600 text-white" },
};
export interface Vigencia { tramo: TramoVigencia; dias: number | null; texto: string }

/** Tramos de 90, 60 y 30 días (documentos y licencias). */
export function vigenciaDe(vencimiento: string | null | undefined, hoy: string): Vigencia {
  if (vencimiento === null || vencimiento === undefined || String(vencimiento).trim() === "") {
    return { tramo: "sin_fecha", dias: null, texto: "Sin vencimiento" };
  }
  if (!esFechaISO(vencimiento)) return { tramo: "sin_fecha", dias: null, texto: "Fecha no válida" };
  const dias = diasEntre(hoy, vencimiento);
  if (dias > 90) return { tramo: "vigente", dias, texto: `Vigente hasta ${fechaCorta(vencimiento)}` };
  const tramo: TramoVigencia = dias < 0 ? "vencida" : dias <= 30 ? "vence_30" : dias <= 60 ? "vence_60" : "vence_90";
  return { tramo, dias, texto: conMayuscula(textoVence(dias)) };
}

/** Tramo de aviso: 90, 60, 30, 0 (vencida) o null (más de 90 días o sin fecha). */
export function umbralAviso(dias: number | null): 90 | 60 | 30 | 0 | null {
  if (dias === null || !Number.isFinite(dias)) return null;
  if (dias < 0) return 0;
  if (dias <= 30) return 30;
  if (dias <= 60) return 60;
  return dias <= 90 ? 90 : null;
}

// ═══ Clase de riesgo (única definición de la escala) ════════════════════════

export const CLASES_RIESGO = [
  { valor: "I", etiqueta: "Clase I", descripcion: "riesgo bajo" },
  { valor: "IIa", etiqueta: "Clase IIa", descripcion: "riesgo moderado" },
  { valor: "IIb", etiqueta: "Clase IIb", descripcion: "riesgo moderado-alto" },
  { valor: "III", etiqueta: "Clase III", descripcion: "riesgo alto" },
] as const;
export type ClaseRiesgo = (typeof CLASES_RIESGO)[number]["valor"];
/** Para z.enum y el enum de schema.ts. */
export const CLASES_RIESGO_VALORES = CLASES_RIESGO.map((c) => c.valor) as [ClaseRiesgo, ...ClaseRiesgo[]];

/** 'IIa' → 'Clase IIa (riesgo moderado)'; null → 'Sin clasificar'; desconocido → tal cual. */
export function etiquetaClaseRiesgo(v: string | null | undefined): string {
  if (!v) return "Sin clasificar";
  const c = CLASES_RIESGO.find((x) => x.valor === v);
  return c ? `${c.etiqueta} (${c.descripcion})` : v;
}

const CLASE_POR_TEXTO: Record<string, ClaseRiesgo> = { i: "I", "1": "I", iia: "IIa", "2a": "IIa", iib: "IIb", "2b": "IIb", iii: "III", "3": "III" };
/** 'IIa', 'iia', '2a', ' Clase IIa ' → IIa; '' → null; 'IV' → error. */
export function leerClaseRiesgo(texto: unknown): { valor: ClaseRiesgo | null } | { error: string } {
  const t = String(texto ?? "").trim();
  if (!t) return { valor: null };
  const clave = t.toLowerCase().replace(/clase/g, "").replace(/[\s-]+/g, "");
  const valor = CLASE_POR_TEXTO[clave];
  return valor ? { valor } : { error: `Clase de riesgo «${t}» no válida. Usa I, IIa, IIb o III.` };
}

// ═══ Registro sanitario ═════════════════════════════════════════════════════

/** Opciones fijas del select; «Otra» se guarda como el texto escrito. */
export const ENTIDADES_REGISTRO = ["CSSP", "SRS", "DNM"] as const;
export type EstadoRegistro = "no_requiere" | "sin_registro" | "sin_vencimiento" | "vigente" | "por_vencer" | "vencido";
export const ESTADO_REGISTRO_LABEL: Record<EstadoRegistro, string> = {
  no_requiere: "No requiere", sin_registro: "Sin registro", sin_vencimiento: "Sin fecha de vencimiento",
  vigente: "Vigente", por_vencer: "Por vencer", vencido: "Vencido",
};
export const ESTADO_REGISTRO_COLOR: Record<EstadoRegistro, string> = {
  no_requiere: "bg-slate-100 text-slate-700", sin_registro: "bg-red-100 text-red-700",
  sin_vencimiento: "bg-amber-100 text-amber-700", vigente: "bg-emerald-100 text-emerald-700",
  por_vencer: "bg-amber-100 text-amber-700", vencido: "bg-red-100 text-red-700",
};

export function estadoRegistroSanitario(
  a: { registroSanitario?: string | null; registroSanitarioNoRequiere?: boolean | number | null; registroSanitarioVencimiento?: string | null },
  hoy: string,
  diasAviso: number = DIAS_AVISO.registroSanitario,
): EstadoRegistro {
  if (a.registroSanitarioNoRequiere) return "no_requiere";
  if (!String(a.registroSanitario ?? "").trim()) return "sin_registro";
  const v = estadoVigencia(a.registroSanitarioVencimiento, hoy, diasAviso);
  return v === "sin_fecha" ? "sin_vencimiento" : v;
}

// ═══ Estado del equipo y baja ═══════════════════════════════════════════════

export const ESTADOS_ACTIVO = ["operativo", "averiado", "mantenimiento", "baja"] as const;
export type EstadoActivo = (typeof ESTADOS_ACTIVO)[number];
export const ESTADO_ACTIVO_LABEL: Record<EstadoActivo, string> = {
  operativo: "Operativo", averiado: "Averiado", mantenimiento: "En mantenimiento", baja: "Dado de baja",
};
export const ESTADO_ACTIVO_COLOR: Record<EstadoActivo, string> = {
  operativo: "bg-emerald-100 text-emerald-700", averiado: "bg-red-100 text-red-700",
  mantenimiento: "bg-amber-100 text-amber-700", baja: "bg-slate-200 text-slate-600",
};

export const MOTIVOS_BAJA = {
  falla_irreparable: "Falla irreparable",
  obsolescencia: "Obsolescencia tecnológica",
  costo_reparacion: "Reparación no rentable",
  fin_vida_util: "Fin de vida útil",
  siniestro: "Siniestro, robo o pérdida",
  retiro_sanitario: "Retiro sanitario o alerta del fabricante",
  otro: "Otro",
} as const;
export const DESTINOS_BAJA = {
  descarte: "Descarte",
  donacion: "Donación",
  devolucion_proveedor: "Devolución al proveedor",
  venta: "Venta",
  otro: "Otro",
} as const;
export type MotivoBaja = keyof typeof MOTIVOS_BAJA;
export type DestinoBaja = keyof typeof DESTINOS_BAJA;
/** En estos destinos hay que escribir a quién o qué. */
export const DESTINOS_CON_DETALLE: readonly DestinoBaja[] = ["donacion", "venta", "otro"];

/** 7 → 'BAJA-0007'. */
export const folioActaBaja = (id: number): string => `BAJA-${String(id).padStart(4, "0")}`;

/** {codigo:'CC-01', nombre:'UCI ADULTOS'} → 'CC-01 · UCI ADULTOS'; null → 'Sin centro de costo'. */
export function etiquetaCentroCosto(c: { codigo: string; nombre: string } | null | undefined): string {
  return c ? `${c.codigo} · ${c.nombre}` : "Sin centro de costo";
}

/**
 * Registros que impiden eliminar un equipo: si tiene alguno, se da de baja.
 * Los nombres son constantes (se pueden pasar a sql.raw); el id va como parámetro.
 */
export const HISTORIAL_ACTIVO: ReadonlyArray<{ tabla: string; columna: string; etiqueta: string }> = [
  { tabla: "ordenes", columna: "activo_id", etiqueta: "órdenes de trabajo" },
  { tabla: "tickets", columna: "activo_id", etiqueta: "solicitudes" },
  { tabla: "calibraciones", columna: "activo_id", etiqueta: "calibraciones" },
  { tabla: "calibraciones", columna: "patron_activo_id", etiqueta: "calibraciones donde se usó como patrón" },
  { tabla: "activo_documentos", columna: "activo_id", etiqueta: "documentos" },
  { tabla: "activo_bajas", columna: "activo_id", etiqueta: "registros de baja" },
  { tabla: "alertas_equipo_activos", columna: "activo_id", etiqueta: "alertas o retiros" },
  { tabla: "contrato_equipos", columna: "activo_id", etiqueta: "contratos" },
  { tabla: "proyectos", columna: "activo_id", etiqueta: "proyectos" },
  { tabla: "aop_eventos", columna: "activo_id", etiqueta: "desviaciones (AOP)" },
  { tabla: "variables_predictivas", columna: "activo_id", etiqueta: "variables predictivas" },
  { tabla: "conjunto_componentes", columna: "activo_id", etiqueta: "conjuntos" },
  { tabla: "ronda_puntos", columna: "activo_id", etiqueta: "puntos de ronda" },
  { tabla: "subestaciones", columna: "activo_id", etiqueta: "subestaciones" },
  { tabla: "cargas_electricas", columna: "activo_id", etiqueta: "cargas eléctricas" },
  { tabla: "licencias", columna: "activo_id", etiqueta: "licencias o permisos" },
  { tabla: "capacitacion_equipos", columna: "activo_id", etiqueta: "capacitaciones" },
  { tabla: "pruebas_seguridad_electrica", columna: "activo_id", etiqueta: "pruebas de seguridad eléctrica" },
  { tabla: "pruebas_seguridad_electrica", columna: "analizador_activo_id", etiqueta: "pruebas donde se usó como analizador" },
];

/** Lo que le falta al registro de un biomédico, en este orden. Completo → []. */
export function faltantesInventarioBiomedico(a: {
  nombre: string; marca: string | null; modelo: string | null; serial: string | null;
  ubicacionId: number | null; centroCostoId: number | null; claseRiesgo: string | null;
  registroSanitario: string | null; registroSanitarioNoRequiere: boolean | number | null;
}): string[] {
  const vacio = (s: string | null | undefined) => !String(s ?? "").trim();
  const falta: string[] = [];
  if (normalizarTexto(a.nombre).includes("pendiente de identificar")) falta.push("identificación");
  if (vacio(a.marca)) falta.push("marca");
  if (vacio(a.modelo)) falta.push("modelo");
  if (vacio(a.serial)) falta.push("serie");
  if (a.ubicacionId == null) falta.push("ubicación");
  if (a.centroCostoId == null) falta.push("centro de costo");
  if (vacio(a.claseRiesgo)) falta.push("clase de riesgo");
  if (vacio(a.registroSanitario) && !a.registroSanitarioNoRequiere) falta.push("registro sanitario");
  return falta;
}

// ═══ Equipo crítico ═════════════════════════════════════════════════════════

export type MotivoCritico = "soporte_vida" | "criticidad_alta" | "clase_iii";
export const MOTIVO_CRITICO_LABEL: Record<MotivoCritico, string> = {
  soporte_vida: "Soporte de vida", criticidad_alta: "Criticidad alta", clase_iii: "Clase III",
};
/** Crítico = soporte de vida, criticidad operacional alta o clase de riesgo III. */
export function motivosCritico(a: { subcategoria?: string | null; criticidadOperacional?: string | null; claseRiesgo?: string | null }): MotivoCritico[] {
  const m: MotivoCritico[] = [];
  if (a.subcategoria === "soporte_vida") m.push("soporte_vida");
  if (a.criticidadOperacional === "alta") m.push("criticidad_alta");
  if (a.claseRiesgo === "III") m.push("clase_iii");
  return m;
}
export const esCritico = (a: Parameters<typeof motivosCritico>[0]): boolean => motivosCritico(a).length > 0;

// ═══ Calibración (regla única para Calibraciones, Cumplimiento y la ficha) ══

export type EstadoCalibracion = "no_aplica" | "sin_calibracion" | "no_conforme" | "vencida" | "sin_certificado" | "por_vencer" | "vigente";
/** En orden de gravedad. */
export const ESTADOS_CALIBRACION: readonly EstadoCalibracion[] = ["vencida", "no_conforme", "sin_certificado", "sin_calibracion", "por_vencer", "vigente", "no_aplica"];
export const ESTADO_CALIBRACION_LABEL: Record<EstadoCalibracion, string> = {
  vencida: "Vencida", no_conforme: "No conforme", sin_certificado: "Sin certificado", sin_calibracion: "Sin calibración",
  por_vencer: "Por vencer", vigente: "Vigente", no_aplica: "No requiere",
};
export const ESTADO_CALIBRACION_COLOR: Record<EstadoCalibracion, string> = {
  vencida: "bg-red-100 text-red-700", no_conforme: "bg-red-100 text-red-700", sin_certificado: "bg-orange-100 text-orange-700",
  sin_calibracion: "bg-slate-100 text-slate-700", por_vencer: "bg-amber-100 text-amber-700",
  vigente: "bg-emerald-100 text-emerald-700", no_aplica: "bg-slate-50 text-slate-500",
};
/** Al día = vigente o por vencer (con certificado y resultado conforme). */
export const estaAlDia = (e: EstadoCalibracion): boolean => e === "vigente" || e === "por_vencer";

export interface CalMin { id: number; fechaCalibracion: string; proximaCalibracion: string | null; resultado: string; certificadoR2Key: string | null }
export interface EquipoCalibracion {
  tipo: string | null; rubro?: string | null; estado?: string | null; requiereCalibracion: boolean | null;
  esPatron?: boolean | null; calibracionNoAplica?: boolean | null;
}

/** No de baja ni «no requiere», y además biomédico, patrón o con «Requiere calibración». */
export function aplicaCalibracion(e: EquipoCalibracion): boolean {
  if (e.estado === "baja" || e.calibracionNoAplica) return false;
  if (e.esPatron) return true;
  return rubroDeActivo(e.rubro, e.tipo) === "biomedico" || !!e.requiereCalibracion;
}

const masReciente = <T extends CalMin>(a: T, b: T) =>
  b.fechaCalibracion > a.fechaCalibracion || (b.fechaCalibracion === a.fechaCalibracion && b.id > a.id) ? b : a;

/** La de fecha mayor; si empatan, la de id mayor. [] → null. */
export function ultimaCalibracion<T extends CalMin>(calibs: readonly T[]): T | null {
  return calibs.length ? calibs.reduce((a, b) => masReciente(a, b)) : null;
}

/**
 * Orden: no aplica → sin registros → última no conforme → próxima vacía o pasada (vencida)
 * → sin certificado → 0 a 30 días (por vencer) → vigente.
 */
export function estadoCalibracion(e: EquipoCalibracion, calibs: readonly CalMin[], hoy: string): EstadoCalibracion {
  if (!aplicaCalibracion(e)) return "no_aplica";
  const u = ultimaCalibracion(calibs);
  if (!u) return "sin_calibracion";
  if (u.resultado === "no_conforme") return "no_conforme";
  if (!esFechaISO(u.proximaCalibracion) || u.proximaCalibracion < hoy) return "vencida";
  if (!u.certificadoR2Key) return "sin_certificado";
  return diasEntre(hoy, u.proximaCalibracion) <= DIAS_AVISO.calibracion ? "por_vencer" : "vigente";
}

export interface InfoCalibracion { estado: EstadoCalibracion; ultima: string | null; proxima: string | null; dias: number | null; calibracionId: number | null }
/** El estado más la última fecha, la próxima (null si fue no conforme), los días que faltan y el id. */
export function infoCalibracion(e: EquipoCalibracion, calibs: readonly CalMin[], hoy: string): InfoCalibracion {
  const u = ultimaCalibracion(calibs);
  const proxima = u && u.resultado !== "no_conforme" && esFechaISO(u.proximaCalibracion) ? u.proximaCalibracion : null;
  return {
    estado: estadoCalibracion(e, calibs, hoy),
    ultima: u?.fechaCalibracion ?? null,
    proxima,
    dias: proxima ? diasEntre(hoy, proxima) : null,
    calibracionId: u?.id ?? null,
  };
}

/** Copia que se guarda en activos.ultima_calibracion y activos.proxima_calibracion. */
export function fechasEquipoDesdeCalibraciones(calibs: readonly CalMin[]): { ultimaCalibracion: string | null; proximaCalibracion: string | null } {
  const u = ultimaCalibracion(calibs);
  return {
    ultimaCalibracion: u?.fechaCalibracion ?? null,
    proximaCalibracion: u && u.resultado !== "no_conforme" ? u.proximaCalibracion ?? null : null,
  };
}

/**
 * ¿El patrón estaba vigente en `fecha`? Mira su última calibración con fecha ≤ `fecha`:
 * vigente si es conforme, tiene certificado y su próxima ≥ `fecha`. `hasta` = esa próxima.
 */
export function patronVigenteEn(calibsPatron: readonly CalMin[], fecha: string): { vigente: boolean; hasta: string | null } {
  const u = ultimaCalibracion(calibsPatron.filter((c) => c.fechaCalibracion <= fecha));
  if (!u) return { vigente: false, hasta: null };
  const hasta = u.proximaCalibracion ?? null;
  const vigente = u.resultado !== "no_conforme" && esFechaISO(hasta) && hasta >= fecha && !!u.certificadoR2Key;
  return { vigente, hasta };
}

/** Por equipo, la fila de fecha mayor (empate: id mayor). Sirve para calibraciones y pruebas. */
export function ultimaPorEquipo<T extends { activoId: number; fecha: string; id: number }>(filas: readonly T[]): Map<number, T> {
  const m = new Map<number, T>();
  for (const f of filas) {
    const actual = m.get(f.activoId);
    if (!actual || f.fecha > actual.fecha || (f.fecha === actual.fecha && f.id > actual.id)) m.set(f.activoId, f);
  }
  return m;
}

// ═══ Acreditación del laboratorio ═══════════════════════════════════════════

export type EstadoAcreditacion = "no_acreditado" | "sin_vigencia" | "vencida" | "por_vencer" | "vigente";
export const ESTADO_ACREDITACION_LABEL: Record<EstadoAcreditacion, string> = {
  no_acreditado: "No acreditado", sin_vigencia: "Acreditado sin vigencia", vencida: "Acreditación vencida",
  por_vencer: "Acreditación por vencer", vigente: "Acreditado",
};
export const ESTADO_ACREDITACION_COLOR: Record<EstadoAcreditacion, string> = {
  no_acreditado: "bg-slate-100 text-slate-700", sin_vigencia: "bg-amber-100 text-amber-700",
  vencida: "bg-red-100 text-red-700", por_vencer: "bg-amber-100 text-amber-700", vigente: "bg-emerald-100 text-emerald-700",
};
export interface ProvAcredMin {
  esLaboratorioAcreditado: boolean; acreditacionVigencia: string | null;
  acreditacionOrgano?: string | null; acreditacionNumero?: string | null;
}

export function estadoAcreditacion(p: ProvAcredMin, fecha: string): EstadoAcreditacion {
  if (!p.esLaboratorioAcreditado) return "no_acreditado";
  const v = estadoVigencia(p.acreditacionVigencia, fecha, DIAS_AVISO.acreditacion);
  return v === "sin_fecha" ? "sin_vigencia" : v === "vencido" ? "vencida" : v;
}
/** Acreditado en esa fecha = vigente o por vencer. */
export function acreditadoEn(p: ProvAcredMin, fecha: string): boolean {
  const e = estadoAcreditacion(p, fecha);
  return e === "vigente" || e === "por_vencer";
}
/** 'OSA · N.º LC-012 · vigente hasta 31/01/2027'; sin la casilla → 'No acreditado'. */
export function textoAcreditacion(p: ProvAcredMin): string {
  if (!p.esLaboratorioAcreditado) return "No acreditado";
  const organo = p.acreditacionOrgano?.trim() || "Órgano sin indicar";
  const numero = p.acreditacionNumero?.trim() ? `N.º ${p.acreditacionNumero.trim()}` : "sin número";
  const vigencia = esFechaISO(p.acreditacionVigencia) ? `vigente hasta ${fechaCorta(p.acreditacionVigencia)}` : "sin vigencia";
  return `${organo} · ${numero} · ${vigencia}`;
}

export interface OpcionLab { id: number; nombre: string; estado: EstadoAcreditacion; etiqueta: string }
/** Laboratorios en tres grupos para el formulario de calibración, cada uno por nombre. */
export function opcionesLaboratorio(
  provs: ReadonlyArray<{ id: number; nombre: string } & ProvAcredMin>, hoy: string,
): { acreditados: OpcionLab[]; vencidos: OpcionLab[]; otros: OpcionLab[] } {
  const grupos = { acreditados: [] as OpcionLab[], vencidos: [] as OpcionLab[], otros: [] as OpcionLab[] };
  for (const p of provs) {
    const estado = estadoAcreditacion(p, hoy);
    const vig = fechaCorta(p.acreditacionVigencia);
    if (estado === "vigente" || estado === "por_vencer") grupos.acreditados.push({ id: p.id, nombre: p.nombre, estado, etiqueta: `${p.nombre} — acreditado hasta ${vig}` });
    else if (estado === "vencida") grupos.vencidos.push({ id: p.id, nombre: p.nombre, estado, etiqueta: `${p.nombre} — acreditación vencida el ${vig}` });
    else if (estado === "sin_vigencia") grupos.vencidos.push({ id: p.id, nombre: p.nombre, estado, etiqueta: `${p.nombre} — acreditación sin vigencia` });
    else grupos.otros.push({ id: p.id, nombre: p.nombre, estado, etiqueta: p.nombre });
  }
  const porNombre = (a: OpcionLab, b: OpcionLab) => a.nombre.localeCompare(b.nombre, "es");
  grupos.acreditados.sort(porNombre); grupos.vencidos.sort(porNombre); grupos.otros.sort(porNombre);
  return grupos;
}

// ═══ Documentos del equipo y expediente técnico ═════════════════════════════

export type CategoriaDocumento =
  | "manual_operacion" | "manual_mantenimiento" | "manual_servicio" | "ficha_tecnica" | "especificaciones"
  | "registro_sanitario" | "limpieza_desinfeccion" | "instalacion" | "garantia" | "seguridad_electrica"
  | "licencia" | "capacitacion" | "acta_baja" | "otro" | "manual";
/** En este orden. `soloBio`: solo se ofrece en biomédicos. `heredada`: se acepta, no se ofrece. */
export const CATEGORIAS_DOCUMENTO: ReadonlyArray<{ clave: CategoriaDocumento; etiqueta: string; soloBio: boolean; heredada: boolean }> = [
  { clave: "manual_operacion", etiqueta: "Manual de operación", soloBio: false, heredada: false },
  { clave: "manual_mantenimiento", etiqueta: "Manual de mantenimiento", soloBio: false, heredada: false },
  { clave: "manual_servicio", etiqueta: "Manual de servicio técnico", soloBio: false, heredada: false },
  { clave: "ficha_tecnica", etiqueta: "Ficha técnica", soloBio: false, heredada: false },
  { clave: "especificaciones", etiqueta: "Especificaciones del fabricante", soloBio: false, heredada: false },
  { clave: "registro_sanitario", etiqueta: "Registro sanitario o inscripción", soloBio: true, heredada: false },
  { clave: "limpieza_desinfeccion", etiqueta: "Protocolo de limpieza y desinfección del fabricante", soloBio: true, heredada: false },
  { clave: "instalacion", etiqueta: "Acta de instalación o aceptación", soloBio: false, heredada: false },
  { clave: "garantia", etiqueta: "Garantía", soloBio: false, heredada: false },
  { clave: "seguridad_electrica", etiqueta: "Informe de seguridad eléctrica", soloBio: true, heredada: false },
  { clave: "licencia", etiqueta: "Licencia o permiso", soloBio: false, heredada: false },
  { clave: "capacitacion", etiqueta: "Lista de capacitación", soloBio: true, heredada: false },
  { clave: "acta_baja", etiqueta: "Acta de baja firmada", soloBio: false, heredada: false },
  { clave: "otro", etiqueta: "Otro", soloBio: false, heredada: false },
  { clave: "manual", etiqueta: "Manual (sin clasificar)", soloBio: false, heredada: true },
];
export const esCategoriaDocumento = (valor: unknown): valor is CategoriaDocumento =>
  CATEGORIAS_DOCUMENTO.some((c) => c.clave === valor);
/** null → 'Otro'; clave desconocida → la misma clave. */
export function etiquetaCategoriaDocumento(clave: string | null | undefined): string {
  if (!clave) return "Otro";
  return CATEGORIAS_DOCUMENTO.find((c) => c.clave === clave)?.etiqueta ?? clave;
}
/** Las que ofrece el formulario: biomédico 14; otras áreas 10. */
export function categoriasDocumentoPara(area: string | null | undefined): ReadonlyArray<{ clave: CategoriaDocumento; etiqueta: string }> {
  return CATEGORIAS_DOCUMENTO.filter((c) => !c.heredada && (area === "biomedico" || !c.soloBio)).map(({ clave, etiqueta }) => ({ clave, etiqueta }));
}

export type RequisitoExpediente = "manual_operacion" | "manual_mantenimiento" | "especificaciones" | "registro_sanitario" | "aceptacion";
/** Expediente técnico completo = estos 5 requisitos (cada uno lo cumple cualquiera de sus categorías). */
export const REQUISITOS_EXPEDIENTE: ReadonlyArray<{ clave: RequisitoExpediente; etiqueta: string; corta: string; categorias: readonly CategoriaDocumento[] }> = [
  { clave: "manual_operacion", etiqueta: "Manual de operación", corta: "Manual de operación", categorias: ["manual_operacion"] },
  { clave: "manual_mantenimiento", etiqueta: "Manual de mantenimiento o de servicio técnico", corta: "Manual de mantenimiento o servicio", categorias: ["manual_mantenimiento", "manual_servicio"] },
  { clave: "especificaciones", etiqueta: "Ficha técnica o especificaciones del fabricante", corta: "Ficha técnica o especificaciones", categorias: ["ficha_tecnica", "especificaciones"] },
  { clave: "registro_sanitario", etiqueta: "Registro sanitario o inscripción", corta: "Registro sanitario", categorias: ["registro_sanitario"] },
  { clave: "aceptacion", etiqueta: "Acta de instalación o inspección de aceptación", corta: "Acta de instalación o aceptación", categorias: ["instalacion"] },
];
/** Se muestran, pero no restan. */
export const RECOMENDADOS_EXPEDIENTE: readonly CategoriaDocumento[] = ["limpieza_desinfeccion", "garantia"];
export const esRequisitoExpediente = (valor: unknown): valor is RequisitoExpediente =>
  REQUISITOS_EXPEDIENTE.some((r) => r.clave === valor);

export type EstadoRequisito = "con_documento" | "aceptacion_registrada" | "no_aplica" | "vencido" | "falta";
export interface CompletitudExpediente {
  completo: boolean; cumplidos: number; total: number; porcentaje: number;
  requisitos: Array<{ clave: RequisitoExpediente; etiqueta: string; corta: string; estado: EstadoRequisito; documentos: number; motivoNoAplica: string | null }>;
  /** `corta` de los requisitos que faltan o están vencidos. */
  faltan: string[];
  recomendados: Array<{ categoria: CategoriaDocumento; etiqueta: string; tiene: boolean }>;
  /** Documentos de categorías requeridas con vencimiento anterior a hoy. */
  documentosVencidos: number;
  /** Documentos con la categoría heredada «manual». */
  sinClasificar: number;
}

/**
 * Por requisito: documento sin vencer → con_documento; aceptación registrada en la ficha
 * (solo «aceptacion») → aceptacion_registrada; «No aplica» → no_aplica; solo vencidos → vencido;
 * nada → falta. Cumplen los tres primeros. Un documento sin vencimiento no vence.
 */
export function completitudExpediente(entrada: {
  documentos: ReadonlyArray<{ categoria: string | null; fechaVencimiento?: string | null }>;
  aceptacionFecha?: string | null;
  noAplica?: ReadonlyArray<{ requisito: string; motivo?: string | null }>;
  hoy: string;
}): CompletitudExpediente {
  const { documentos, hoy } = entrada;
  const vence = (d: { fechaVencimiento?: string | null }) => (esFechaISO(d.fechaVencimiento) ? d.fechaVencimiento : null);
  const sinVencer = (d: { fechaVencimiento?: string | null }) => { const v = vence(d); return v === null || v >= hoy; };
  const requisitos = REQUISITOS_EXPEDIENTE.map((r) => {
    const docs = documentos.filter((d) => (r.categorias as readonly string[]).includes(d.categoria ?? ""));
    const na = entrada.noAplica?.find((n) => n.requisito === r.clave);
    let estado: EstadoRequisito;
    if (docs.some(sinVencer)) estado = "con_documento";
    else if (r.clave === "aceptacion" && entrada.aceptacionFecha) estado = "aceptacion_registrada";
    else if (na) estado = "no_aplica";
    else estado = docs.length ? "vencido" : "falta";
    return { clave: r.clave, etiqueta: r.etiqueta, corta: r.corta, estado, documentos: docs.length, motivoNoAplica: na ? na.motivo ?? null : null };
  });
  const cumplidos = requisitos.filter((r) => r.estado === "con_documento" || r.estado === "aceptacion_registrada" || r.estado === "no_aplica").length;
  const total = REQUISITOS_EXPEDIENTE.length;
  const requeridas = new Set<string>(REQUISITOS_EXPEDIENTE.flatMap((r) => r.categorias));
  return {
    completo: cumplidos === total,
    cumplidos,
    total,
    porcentaje: Math.round((cumplidos / total) * 100),
    requisitos,
    faltan: requisitos.filter((r) => r.estado === "falta" || r.estado === "vencido").map((r) => r.corta),
    recomendados: RECOMENDADOS_EXPEDIENTE.map((categoria) => ({
      categoria,
      etiqueta: etiquetaCategoriaDocumento(categoria),
      tiene: documentos.some((d) => d.categoria === categoria && sinVencer(d)),
    })),
    documentosVencidos: documentos.filter((d) => requeridas.has(d.categoria ?? "") && !sinVencer(d)).length,
    sinClasificar: documentos.filter((d) => d.categoria === "manual").length,
  };
}

// ═══ Archivos (regla 6) ═════════════════════════════════════════════════════

export const ARCHIVO_MAX_BYTES = 15 * 1024 * 1024;
/** Para el atributo accept de los <input type="file">. */
export const ARCHIVO_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp";
export type TipoArchivo = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
const TIPOS_ARCHIVO: readonly TipoArchivo[] = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const EXTENSION: Record<TipoArchivo, "pdf" | "jpg" | "png" | "webp"> = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
};
export const esTipoArchivoPermitido = (ct: string | null | undefined): ct is TipoArchivo =>
  (TIPOS_ARCHIVO as readonly string[]).includes(String(ct ?? "").split(";")[0].trim().toLowerCase());

const empiezaCon = (b: Uint8Array, firma: readonly number[], desde = 0) =>
  b.length >= desde + firma.length && firma.every((x, i) => b[desde + i] === x);
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

/**
 * Tipo real por los primeros bytes (pasar hasta 1024): '%PDF-' en el primer KB; JPEG FF D8 FF;
 * PNG 89 50 4E 47 0D 0A 1A 0A; WEBP 'RIFF'…'WEBP'. Lo demás → null.
 */
export function detectarTipoArchivo(cabecera: Uint8Array): TipoArchivo | null {
  if (empiezaCon(cabecera, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (empiezaCon(cabecera, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (empiezaCon(cabecera, [0x52, 0x49, 0x46, 0x46]) && empiezaCon(cabecera, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  const limite = Math.min(cabecera.length, 1024) - PDF.length;
  for (let i = 0; i <= limite; i++) if (empiezaCon(cabecera, PDF, i)) return "application/pdf";
  return null;
}

/** Revisa tamaño y tipo real. Vacío → 400; más de 15 MB → 413; tipo no permitido → 415. */
export function validarArchivo(a: { tamano: number; cabecera: Uint8Array }):
  | { ok: true; contentType: TipoArchivo; extension: "pdf" | "jpg" | "png" | "webp" }
  | { ok: false; status: 400 | 413 | 415; error: string } {
  if (!(a.tamano > 0)) return { ok: false, status: 400, error: "El archivo está vacío." };
  if (a.tamano > ARCHIVO_MAX_BYTES) return { ok: false, status: 413, error: "El archivo pesa más de 15 MB. Comprímelo o divídelo en partes." };
  const tipo = detectarTipoArchivo(a.cabecera);
  if (!tipo) return { ok: false, status: 415, error: "Solo se aceptan archivos PDF o fotos (JPG, PNG o WEBP)." };
  return { ok: true, contentType: tipo, extension: EXTENSION[tipo] };
}

/**
 * Nombre para la llave de R2: sin tildes, cada tramo de caracteres raros pasa a '_',
 * sin '_' ni '.' en las puntas; vacío → 'archivo'; más de `max` → se corta conservando la extensión.
 */
export function nombreSeguroR2(nombre: string, max = 80): string {
  let s = String(nombre ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[_.]+|[_.]+$/g, "");
  if (!s) return "archivo";
  if (s.length > max) {
    const ext = /\.[A-Za-z0-9]{1,8}$/.exec(s)?.[0] ?? "";
    s = s.slice(0, Math.max(1, max - ext.length)) + ext;
  }
  return s;
}

/** Cabecera content-disposition con nombre ASCII de respaldo y el nombre real en UTF-8. */
export function contentDisposition(nombre: string, modo: "inline" | "attachment" = "inline"): string {
  const n = String(nombre ?? "") || "archivo";
  const ascii = n.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const utf8 = encodeURIComponent(n).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${modo}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

// ═══ Licencias y permisos ═══════════════════════════════════════════════════

export type SituacionLicencia = TramoVigencia | "en_tramite" | "reemplazada" | "anulada";
export const SITUACION_LICENCIA: Readonly<Record<SituacionLicencia, { etiqueta: string; color: string; orden: number }>> = {
  vencida: { ...TRAMO_VIGENCIA.vencida, orden: 1 },
  vence_30: { ...TRAMO_VIGENCIA.vence_30, orden: 2 },
  vence_60: { ...TRAMO_VIGENCIA.vence_60, orden: 3 },
  vence_90: { ...TRAMO_VIGENCIA.vence_90, orden: 4 },
  vigente: { ...TRAMO_VIGENCIA.vigente, orden: 5 },
  sin_fecha: { etiqueta: "No vence", color: TRAMO_VIGENCIA.sin_fecha.color, orden: 6 },
  en_tramite: { etiqueta: "En trámite", color: "bg-sky-100 text-sky-700", orden: 7 },
  reemplazada: { etiqueta: "Reemplazada", color: "bg-slate-100 text-slate-600", orden: 8 },
  anulada: { etiqueta: "Anulada", color: "bg-slate-100 text-slate-600", orden: 9 },
};

/** Situación de una licencia: su estado guardado y, si está activa, el tramo de su vencimiento. */
export function situacionLicencia(
  l: { estado: string; fechaVencimiento: string | null },
  hoy: string,
  opciones: { renovacionEnTramite?: boolean } = {},
): { clave: SituacionLicencia; etiqueta: string; color: string; dias: number | null; texto: string; vigente: boolean } {
  if (l.estado === "reemplazada" || l.estado === "anulada" || l.estado === "en_tramite") {
    const clave: SituacionLicencia = l.estado;
    const s = SITUACION_LICENCIA[clave];
    return { clave, etiqueta: s.etiqueta, color: s.color, dias: null, texto: s.etiqueta, vigente: false };
  }
  const v = vigenciaDe(l.fechaVencimiento, hoy);
  const s = SITUACION_LICENCIA[v.tramo];
  const base = v.tramo === "sin_fecha" && !l.fechaVencimiento ? "No vence" : v.texto;
  const texto = opciones.renovacionEnTramite ? `${base} · renovación en trámite` : base;
  return { clave: v.tramo, etiqueta: s.etiqueta, color: s.color, dias: v.dias, texto, vigente: v.tramo !== "vencida" };
}

// ═══ Seguridad eléctrica (IEC 62353) ════════════════════════════════════════

export const PLANTILLA_IEC62353 = "Seguridad eléctrica IEC 62353";
export const TIPOS_PRUEBA_ELECTRICA = ["aceptacion", "periodica", "post_reparacion"] as const;
export type TipoPruebaElectrica = (typeof TIPOS_PRUEBA_ELECTRICA)[number];
export const TIPO_PRUEBA_ELECTRICA_LABEL: Record<TipoPruebaElectrica, string> = {
  aceptacion: "Aceptación (equipo nuevo)", periodica: "Periódica", post_reparacion: "Después de reparación",
};
export const CLASES_PROTECCION = ["I", "II", "interna"] as const;
export type ClaseProteccion = (typeof CLASES_PROTECCION)[number];
export const CLASE_PROTECCION_LABEL: Record<ClaseProteccion, string> = {
  I: "Clase I (con tierra)", II: "Clase II (doble aislamiento)", interna: "Alimentación interna (batería)",
};
export const PARTES_APLICADAS = ["ninguna", "B", "BF", "CF"] as const;
export type ParteAplicada = (typeof PARTES_APLICADAS)[number];
export const PARTE_APLICADA_LABEL: Record<ParteAplicada, string> = {
  ninguna: "Sin parte aplicada", B: "Tipo B", BF: "Tipo BF", CF: "Tipo CF (cardíaca)",
};
export const METODOS_FUGA = ["directo", "alternativo"] as const;
export type MetodoFuga = (typeof METODOS_FUGA)[number];
export const METODO_FUGA_LABEL: Record<MetodoFuga, string> = { directo: "Directo o diferencial", alternativo: "Alternativo" };
export type Conformidad = "conforme" | "no_conforme";
export type ResultadoPruebaElectrica = "pasa" | "no_pasa";
export const RESULTADO_SE_LABEL: Record<ResultadoPruebaElectrica, string> = { pasa: "Pasa", no_pasa: "No pasa" };
export const RESULTADO_SE_COLOR: Record<ResultadoPruebaElectrica, string> = {
  pasa: "bg-emerald-100 text-emerald-700", no_pasa: "bg-red-100 text-red-700",
};

/** Límites de referencia IEC 62353:2014. null = no aplica. Tierra y fugas son máximos; aislamiento es mínimo. */
export type LimitesIec62353 = { tierraOhm: number | null; aislamientoMohm: number | null; fugaEquipoUa: number | null; fugaParteUa: number | null };
export function limitesIec62353(clase: ClaseProteccion, parte: ParteAplicada, metodo: MetodoFuga = "directo"): LimitesIec62353 {
  const alt = metodo === "alternativo";
  return {
    tierraOhm: clase === "I" ? 0.3 : null,
    aislamientoMohm: clase === "I" ? 2 : clase === "II" ? 7 : null,
    fugaEquipoUa: clase === "I" ? (alt ? 1000 : 500) : clase === "II" ? (alt ? 500 : 100) : null,
    fugaParteUa: parte === "BF" ? 5000 : parte === "CF" ? 50 : null,
  };
}

export type MedicionesIec62353 = {
  inspeccionVisual: Conformidad; pruebaFuncional: Conformidad;
  tierraOhm: number | null; aislamientoMohm: number | null; fugaEquipoUa: number | null; fugaParteUa: number | null;
};
export type EvaluacionIec62353 = {
  /** null = falta una lectura obligatoria. */
  resultado: ResultadoPruebaElectrica | null;
  faltan: string[]; fuera: string[];
  aplica: { tierra: boolean; aislamiento: boolean; fugaEquipo: boolean; fugaParte: boolean };
  limites: LimitesIec62353;
};
const ETQ_SE = {
  visual: "Inspección visual", tierra: "Resistencia de tierra (Ω)", aislamiento: "Resistencia de aislamiento (MΩ)",
  fugaEquipo: "Fuga del equipo (µA)", fugaParte: "Fuga de parte aplicada (µA)", funcional: "Prueba funcional",
} as const;

/**
 * Obligatorias: tierra y las dos fugas cuando aplican; el aislamiento se juzga solo si viene.
 * Fuera de límite: tierra > máx, aislamiento < mín, fuga > máx, inspección o funcional no conforme.
 * Los bordes cuentan como dentro.
 */
export function evaluarPruebaIec62353(m: MedicionesIec62353, clase: ClaseProteccion, parte: ParteAplicada, metodo: MetodoFuga = "directo"): EvaluacionIec62353 {
  const limites = limitesIec62353(clase, parte, metodo);
  const aplica = {
    tierra: limites.tierraOhm !== null, aislamiento: limites.aislamientoMohm !== null,
    fugaEquipo: limites.fugaEquipoUa !== null, fugaParte: limites.fugaParteUa !== null,
  };
  const faltan: string[] = [], fuera: string[] = [];
  const hay = (v: number | null) => v !== null && Number.isFinite(v);
  if (m.inspeccionVisual === "no_conforme") fuera.push(ETQ_SE.visual);
  if (aplica.tierra) {
    if (!hay(m.tierraOhm)) faltan.push(ETQ_SE.tierra);
    else if (m.tierraOhm! > limites.tierraOhm!) fuera.push(ETQ_SE.tierra);
  }
  if (aplica.aislamiento && hay(m.aislamientoMohm) && m.aislamientoMohm! < limites.aislamientoMohm!) fuera.push(ETQ_SE.aislamiento);
  if (aplica.fugaEquipo) {
    if (!hay(m.fugaEquipoUa)) faltan.push(ETQ_SE.fugaEquipo);
    else if (m.fugaEquipoUa! > limites.fugaEquipoUa!) fuera.push(ETQ_SE.fugaEquipo);
  }
  if (aplica.fugaParte) {
    if (!hay(m.fugaParteUa)) faltan.push(ETQ_SE.fugaParte);
    else if (m.fugaParteUa! > limites.fugaParteUa!) fuera.push(ETQ_SE.fugaParte);
  }
  if (m.pruebaFuncional === "no_conforme") fuera.push(ETQ_SE.funcional);
  const resultado: ResultadoPruebaElectrica | null = faltan.length ? null : fuera.length ? "no_pasa" : "pasa";
  return { resultado, faltan, fuera, aplica, limites };
}

/** No se confirma «Pasa» sobre un «No pasa» calculado; «No pasa» sobre «Pasa» exige motivo. */
export function validarResultadoConfirmado(calculado: ResultadoPruebaElectrica, confirmado: ResultadoPruebaElectrica, motivo?: string | null): { ok: true } | { ok: false; error: string } {
  if (calculado === "no_pasa" && confirmado === "pasa") return { ok: false, error: "Hay valores fuera de límite: la prueba no puede quedar como «Pasa»." };
  if (calculado === "pasa" && confirmado === "no_pasa" && String(motivo ?? "").trim().length < 10) return { ok: false, error: "Explica por qué no pasa (al menos 10 letras)." };
  return { ok: true };
}

export type EstadoSeguridadElectrica = "vigente" | "por_vencer" | "vencida" | "no_pasa" | "sin_prueba";
export const ESTADO_SEG_ELEC_LABEL: Record<EstadoSeguridadElectrica, string> = {
  vigente: "Vigente", por_vencer: "Por vencer", vencida: "Vencida", no_pasa: "No pasó", sin_prueba: "Sin prueba",
};
export const ESTADO_SEG_ELEC_COLOR: Record<EstadoSeguridadElectrica, string> = {
  vigente: "bg-emerald-100 text-emerald-700", por_vencer: "bg-amber-100 text-amber-700", vencida: "bg-red-100 text-red-700",
  no_pasa: "bg-red-100 text-red-700", sin_prueba: "bg-slate-100 text-slate-700",
};
/** Para listar: lo más grave primero. */
export const ESTADO_SEG_ELEC_ORDEN: Record<EstadoSeguridadElectrica, number> = { no_pasa: 0, vencida: 1, sin_prueba: 2, por_vencer: 3, vigente: 4 };
export const PERIODICIDAD_SEGURIDAD_ELECTRICA_MESES = 12;
export const CLAVE_PERIODICIDAD_SEGURIDAD_ELECTRICA = "bio.seguridad_electrica.meses";

/** Sobre la última prueba válida: sin prueba → no pasó → próxima pasada → 0 a 30 días → vigente. */
export function estadoSeguridadElectrica(
  ultima: { resultado: ResultadoPruebaElectrica | string; proximaFecha: string | null } | null,
  hoy: string,
  diasAviso: number = DIAS_AVISO.seguridadElectrica,
): EstadoSeguridadElectrica {
  if (!ultima) return "sin_prueba";
  if (ultima.resultado === "no_pasa") return "no_pasa";
  const v = estadoVigencia(ultima.proximaFecha, hoy, diasAviso);
  return v === "vigente" ? "vigente" : v === "por_vencer" ? "por_vencer" : "vencida";
}
/** «Al día» = vigente o por vencer. */
export const cumpleSeguridadElectrica = (estado: EstadoSeguridadElectrica): boolean => estado === "vigente" || estado === "por_vencer";

export type LecturasDeOrden = Partial<{
  inspeccionVisual: Conformidad; pruebaFuncional: Conformidad;
  tierraOhm: number; aislamientoMohm: number; fugaEquipoUa: number; fugaParteUa: number;
}>;
const PASOS_SE: ReadonlyArray<{ campo: keyof LecturasDeOrden; prueba: (t: string) => boolean }> = [
  { campo: "inspeccionVisual", prueba: (t) => t.includes("inspeccion visual") },
  { campo: "pruebaFuncional", prueba: (t) => t.includes("prueba funcional") },
  { campo: "tierraOhm", prueba: (t) => t.includes("tierra de proteccion") },
  { campo: "aislamientoMohm", prueba: (t) => t.includes("aislamiento") },
  { campo: "fugaParteUa", prueba: (t) => /fuga de partes? aplicadas?/.test(t) },
  { campo: "fugaEquipoUa", prueba: (t) => t.includes("fuga del equipo") },
];

/**
 * Lecturas de una orden hecha con la plantilla IEC 62353. Se reconoce cada paso por su texto;
 * gana el primer paso de cada lectura. Solo se copian números claros y ≥ 0; «No aplica»,
 * vacío, texto o un número ambiguo no se copian.
 */
export function lecturasDesdeChecklist(items: ReadonlyArray<{ texto: string; estado: string; valorMedido?: string | number | null }>): LecturasDeOrden {
  const r: LecturasDeOrden = {};
  for (const it of items) {
    const t = normalizarTexto(it.texto);
    const paso = PASOS_SE.find((p) => p.prueba(t));
    if (!paso || r[paso.campo] !== undefined) continue;
    if (paso.campo === "inspeccionVisual" || paso.campo === "pruebaFuncional") {
      if (it.estado === "ok") r[paso.campo] = "conforme";
      else if (it.estado === "desviacion") r[paso.campo] = "no_conforme";
      continue;
    }
    if (it.estado === "na") continue;
    const n = leerNumero(it.valorMedido);
    if (n.tipo === "numero" && n.valor >= 0) r[paso.campo] = n.valor;
  }
  return r;
}

// ═══ Capacitaciones ═════════════════════════════════════════════════════════

/** ¿Hay alguna capacitación en los últimos `meses` (24)? */
export function capacitacionVigente(fechas: readonly string[], hoy: string, meses = 24): boolean {
  const desde = sumarMeses(hoy, -meses);
  return !!desde && fechas.some((f) => esFechaISO(f) && f >= desde);
}

// ═══ Alertas y retiros ══════════════════════════════════════════════════════

export const TIPO_ALERTA_LABEL: Record<"retiro" | "alerta" | "aviso", string> = {
  retiro: "Retiro (recall)", alerta: "Alerta de seguridad", aviso: "Aviso",
};
export const FUENTE_ALERTA_LABEL: Record<"fabricante" | "regulador" | "proveedor" | "interna", string> = {
  fabricante: "Fabricante", regulador: "Regulador", proveedor: "Proveedor", interna: "Interna",
};
export const ESTADO_ALERTA_LABEL: Record<"abierta" | "en_proceso" | "cerrada", string> = {
  abierta: "Abierta", en_proceso: "En proceso", cerrada: "Cerrada",
};
export const APLICABILIDAD_LABEL: Record<"pendiente" | "aplica" | "no_aplica", string> = {
  pendiente: "Sin análisis", aplica: "Aplica", no_aplica: "No aplica",
};
/** Insignias por tipo, estado y aplicabilidad. */
export const ALERTA_BADGE: Record<string, string> = {
  retiro: "bg-red-100 text-red-700", alerta: "bg-amber-100 text-amber-700", aviso: "bg-blue-100 text-blue-700",
  abierta: "bg-red-100 text-red-700", en_proceso: "bg-amber-100 text-amber-700", cerrada: "bg-emerald-100 text-emerald-700",
  aplica: "bg-red-100 text-red-700", no_aplica: "bg-emerald-100 text-emerald-700", pendiente: "bg-slate-100 text-slate-700",
};

// ═══ Frecuencias de las rutinas de equipo ═══════════════════════════════════
// Las que ofrece el formulario de la ficha y acepta la API de rutinas. «Por turno»
// no: el generador corre una vez al día (lo de varias veces al día va en la ronda).

export const FRECUENCIAS_RUTINA_EQUIPO = ["diaria", "semanal", "quincenal", "mensual", "bimestral", "trimestral", "cuatrimestral", "semestral", "anual"] as const;
export type FrecuenciaRutinaEquipo = (typeof FRECUENCIAS_RUTINA_EQUIPO)[number];
const FRECUENCIA_LABEL: Record<string, string> = {
  turno: "Por turno", diaria: "Diaria", semanal: "Semanal", quincenal: "Quincenal", mensual: "Mensual",
  bimestral: "Bimestral", trimestral: "Trimestral", cuatrimestral: "Cuatrimestral", semestral: "Semestral", anual: "Anual",
};
/** Etiqueta corta: 'cuatrimestral' → 'Cuatrimestral'; null → '—'; desconocida → la misma. */
export function etiquetaFrecuencia(f: string | null | undefined): string {
  if (!f) return "—";
  return FRECUENCIA_LABEL[f] ?? f;
}
