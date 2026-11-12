// Fase 59 · WP-B · Metrología (requisitos 4, 5, 7 y 8).
// Reglas de las pantallas de Calibraciones: filtros, resumen, validación de una
// calibración, advertencias, acreditación del laboratorio, viñetas y CSV.
//
// Puro: importa solo biomedico.ts, rubros.ts e inventario-jci.ts. Lo usan las
// páginas, las APIs, el navegador (Proveedores) y las pruebas. La regla del estado
// de calibración vive en biomedico.ts (estadoCalibracion): aquí no se repite.
import {
  ESTADOS_CALIBRACION, ESTADO_CALIBRACION_LABEL, ESTADO_ACREDITACION_LABEL, MOTIVO_CRITICO_LABEL,
  acreditadoEn, diaSV, diasEntre, estaAlDia, estadoAcreditacion, esFechaISO, fechaCorta, horaSV,
  leerFechaEntrada, patronVigenteEn, sumarMeses, textoAcreditacion,
  type CalMin, type EstadoAcreditacion, type EstadoCalibracion, type MotivoCritico, type ProvAcredMin,
} from "./biomedico";
import { SUBCAT_KEYS, subcatLabel, type RubroKey } from "./rubros";
import { CRITICIDAD_LABEL, RESULTADO_CALIB_LABEL, type ResultadoCalibracion } from "./inventario-jci";

export type ResultadoCal = ResultadoCalibracion;
export const RESULTADOS_CAL: readonly ResultadoCal[] = ["conforme", "conforme_con_ajuste", "no_conforme"];
export const esResultadoCal = (v: unknown): v is ResultadoCal => (RESULTADOS_CAL as readonly unknown[]).includes(v);
const etiquetaResultado = (r: string | null | undefined) => (r && esResultadoCal(r) ? RESULTADO_CALIB_LABEL[r] : r ?? "");

// ═══ Áreas ═══════════════════════════════════════════════════════════════════
// El parámetro `area` solo admite claves de área (el middleware responde 400 a
// cualquier otro valor). Para «todas», se omite.

export const AREAS_CAL: ReadonlyArray<{ clave: RubroKey; etiqueta: string }> = [
  { clave: "biomedico", etiqueta: "Equipos biomédicos" },
  { clave: "equipo_general", etiqueta: "Equipos generales" },
  { clave: "aires", etiqueta: "Aire acondicionado" },
  { clave: "infraestructura", etiqueta: "Infraestructura" },
];
export const etiquetaAreaCal = (a: string | null | undefined): string => AREAS_CAL.find((x) => x.clave === a)?.etiqueta ?? "";

// ═══ Filtros de la pantalla, del CSV y de las viñetas ════════════════════════

export type EstadoFiltroCal = EstadoCalibracion | "al_dia" | "pendientes";
export type ClaseFiltroCal = "I" | "IIa" | "IIb" | "III" | "sin";
export const CLASES_FILTRO_CAL: readonly ClaseFiltroCal[] = ["I", "IIa", "IIb", "III", "sin"];
export interface FiltrosCal {
  sede: number | null;
  area: RubroKey | null;
  /** Clave de SUBCAT_KEYS o "sin" (sin segmentar). */
  subcategoria: string | null;
  criticidad: "alta" | "media" | "baja" | null;
  clase: ClaseFiltroCal | null;
  estado: EstadoFiltroCal | null;
  criticos: boolean;
}
export const FILTROS_CAL_VACIOS: FiltrosCal = { sede: null, area: null, subcategoria: null, criticidad: null, clase: null, estado: null, criticos: false };

/** Lee los filtros de la URL; un valor desconocido queda en null. */
export function leerFiltrosCal(q: URLSearchParams): FiltrosCal {
  const t = (k: string) => (q.get(k) ?? "").trim();
  const sedeTxt = t("sede");
  const area = t("area"), sub = t("subcategoria"), crit = t("criticidad"), clase = t("clase"), estado = t("estado");
  return {
    sede: /^\d{1,9}$/.test(sedeTxt) && Number(sedeTxt) > 0 ? Number(sedeTxt) : null,
    area: AREAS_CAL.some((a) => a.clave === area) ? (area as RubroKey) : null,
    subcategoria: sub === "sin" || (SUBCAT_KEYS as readonly string[]).includes(sub) ? sub : null,
    criticidad: crit === "alta" || crit === "media" || crit === "baja" ? crit : null,
    clase: (CLASES_FILTRO_CAL as readonly string[]).includes(clase) ? (clase as ClaseFiltroCal) : null,
    estado: estado === "al_dia" || estado === "pendientes" || (ESTADOS_CALIBRACION as readonly string[]).includes(estado)
      ? (estado as EstadoFiltroCal) : null,
    criticos: t("criticos") === "1",
  };
}

/** Los filtros como query string (sin «?»); solo lo que tiene valor. */
export function queryFiltrosCal(f: FiltrosCal): string {
  const p = new URLSearchParams();
  if (f.sede != null) p.set("sede", String(f.sede));
  if (f.area) p.set("area", f.area);
  if (f.subcategoria) p.set("subcategoria", f.subcategoria);
  if (f.criticidad) p.set("criticidad", f.criticidad);
  if (f.clase) p.set("clase", f.clase);
  if (f.estado) p.set("estado", f.estado);
  if (f.criticos) p.set("criticos", "1");
  return p.toString();
}

export const etiquetaEstadoFiltroCal = (e: EstadoFiltroCal): string =>
  e === "al_dia" ? "Al día" : e === "pendientes" ? "Pendientes" : ESTADO_CALIBRACION_LABEL[e];

/** Subtítulo del documento impreso: lo que se filtró, en palabras. */
export function describirFiltrosCal(f: FiltrosCal, nombreSede: string | null): string {
  const partes: string[] = [];
  if (f.sede != null) partes.push(`Sede: ${nombreSede ?? `#${f.sede}`}`);
  if (f.area) partes.push(`Área: ${etiquetaAreaCal(f.area)}`);
  if (f.subcategoria) partes.push(`Subcategoría: ${f.subcategoria === "sin" ? "Sin segmentar" : subcatLabel(f.subcategoria)}`);
  if (f.criticidad) partes.push(`Criticidad: ${CRITICIDAD_LABEL[f.criticidad]}`);
  if (f.clase) partes.push(`Clase: ${f.clase === "sin" ? "Sin clasificar" : f.clase}`);
  if (f.estado) partes.push(`Estado: ${etiquetaEstadoFiltroCal(f.estado)}`);
  if (f.criticos) partes.push("Solo críticos");
  return partes.length ? partes.join(" · ") : "Todos los equipos que requieren calibración";
}

// ═══ Filas de la pantalla ════════════════════════════════════════════════════

/** La última calibración del equipo, con lo que se muestra de ella. */
export interface CalResumen {
  id: number;
  fecha: string;
  proxima: string | null;
  numeroCertificado: string | null;
  tieneArchivo: boolean;
  /** Nombre del proveedor de la lista o el texto escrito a mano. */
  laboratorio: string | null;
  /** Copia guardada con la calibración: true, false o null (no consta). */
  labAcreditado: boolean | null;
  labAcreditacionRef: string | null;
  resultado: string;
  patronActivoId: number | null;
  patronCodigo: string | null;
  /** ¿El patrón de la lista estaba vigente en la fecha? null si no se eligió patrón de la lista. */
  patronVigente: boolean | null;
  patronTexto: string | null;
  incertidumbre: string | null;
  notas: string | null;
}

export interface FilaCal {
  activoId: number;
  codigo: string;
  nombre: string;
  marca: string | null;
  modelo: string | null;
  serial: string | null;
  area: RubroKey;
  esBio: boolean;
  esPatron: boolean;
  sedeId: number | null;
  sede: string | null;
  ubicacionId: number | null;
  ubicacion: string | null;
  subcategoria: string | null;
  criticidad: string | null;
  clase: string | null;
  motivos: MotivoCritico[];
  estado: EstadoCalibracion;
  ultima: string | null;
  proxima: string | null;
  dias: number | null;
  noAplicaMotivo: string | null;
  cal: CalResumen | null;
}

type FiltrableCal = Pick<FilaCal, "sedeId" | "area" | "subcategoria" | "criticidad" | "clase" | "motivos" | "estado">;

/**
 * ¿La fila pasa los filtros? Estado: null = todo menos «No requiere»; al_dia = vigente o
 * por vencer; pendientes = ni al día ni «No requiere». `ignorarEstado` sirve para las tarjetas.
 */
export function pasaFiltrosCal(f: FiltrableCal, filtros: FiltrosCal, ignorarEstado = false): boolean {
  if (filtros.sede != null && f.sedeId !== filtros.sede) return false;
  if (filtros.area && f.area !== filtros.area) return false;
  if (filtros.subcategoria && (filtros.subcategoria === "sin" ? !!f.subcategoria : f.subcategoria !== filtros.subcategoria)) return false;
  if (filtros.criticidad && f.criticidad !== filtros.criticidad) return false;
  if (filtros.clase && (filtros.clase === "sin" ? !!f.clase : f.clase !== filtros.clase)) return false;
  if (filtros.criticos && f.motivos.length === 0) return false;
  if (ignorarEstado) return true;
  const e = filtros.estado;
  if (e === null) return f.estado !== "no_aplica";
  if (e === "al_dia") return estaAlDia(f.estado);
  if (e === "pendientes") return !estaAlDia(f.estado) && f.estado !== "no_aplica";
  return f.estado === e;
}

const ORDEN_ESTADO = new Map<EstadoCalibracion, number>(ESTADOS_CALIBRACION.map((e, i) => [e, i]));
/** Lo más grave primero; luego la próxima más cercana (vacías al final); luego el código. */
export function ordenarFilasCal<T extends Pick<FilaCal, "estado" | "proxima" | "codigo">>(filas: readonly T[]): T[] {
  return [...filas].sort((a, b) =>
    (ORDEN_ESTADO.get(a.estado) ?? 99) - (ORDEN_ESTADO.get(b.estado) ?? 99)
    || (a.proxima === b.proxima ? 0 : a.proxima === null ? 1 : b.proxima === null ? -1 : a.proxima < b.proxima ? -1 : 1)
    || a.codigo.localeCompare(b.codigo, "es", { numeric: true }));
}

export interface ResumenCal { total: number; alDia: number; pct: number; porEstado: Record<EstadoCalibracion, number>; noAplica: number }
/** Total sin «No requiere»; % al día redondeado (0 si no hay equipos). */
export function resumenCal(filas: ReadonlyArray<Pick<FilaCal, "estado">>): ResumenCal {
  const porEstado = Object.fromEntries(ESTADOS_CALIBRACION.map((e) => [e, 0])) as Record<EstadoCalibracion, number>;
  for (const f of filas) porEstado[f.estado]++;
  const noAplica = porEstado.no_aplica;
  const total = filas.length - noAplica;
  const alDia = porEstado.vigente + porEstado.por_vencer;
  return { total, alDia, pct: total ? Math.round((alDia / total) * 100) : 0, porEstado, noAplica };
}

// ═══ Datos de una calibración ════════════════════════════════════════════════

export interface DatosCalibracion {
  fechaCalibracion: string | null;
  proximaCalibracion: string | null;
  laboratorioId: number | null;
  laboratorioExterno: string | null;
  numeroCertificado: string | null;
  patronActivoId: number | null;
  patronReferencia: string | null;
  /** Texto recibido; validarCalibracion comprueba que sea uno de RESULTADOS_CAL. */
  resultado: string;
  incertidumbre: string | null;
  realizadoPor: string | null;
  notas: string | null;
}
export const CAMPOS_CALIBRACION = [
  "fechaCalibracion", "proximaCalibracion", "laboratorioId", "laboratorioExterno", "numeroCertificado",
  "patronActivoId", "patronReferencia", "resultado", "incertidumbre", "realizadoPor", "notas",
] as const satisfies ReadonlyArray<keyof DatosCalibracion>;
const CAMPOS_ID = new Set<string>(["laboratorioId", "patronActivoId"]);
const CAMPOS_FECHA = new Set<string>(["fechaCalibracion", "proximaCalibracion"]);

type Fuente = FormData | Record<string, unknown>;
const esFormData = (f: Fuente): f is FormData => typeof FormData !== "undefined" && f instanceof FormData;

/** Texto recortado; vacío, archivo u otro tipo → null. Los números se pasan a texto. */
export function textoLimpio(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}
/** Entero positivo (número o texto de dígitos) o null. */
export function idLimpio(v: unknown): number | null {
  if (typeof v === "number") return Number.isInteger(v) && v > 0 ? v : null;
  const t = textoLimpio(v);
  return t && /^\d{1,12}$/.test(t) && Number(t) > 0 ? Number(t) : null;
}
/** Fecha escrita (AAAA-MM-DD o DD/MM/AAAA) → 'AAAA-MM-DD'; si no se entiende, el texto tal cual (la validación lo rechaza). */
function fechaLimpia(v: unknown): string | null {
  const t = textoLimpio(v);
  if (!t) return null;
  const r = leerFechaEntrada(t);
  return "valor" in r ? r.valor : t;
}

/**
 * Lee los campos de una calibración de un formulario (multipart) o de un JSON.
 * Recorta espacios; "" → null; ids a número. Con `parcial`, solo las claves que vinieron
 * (para corregir); si no, todas, con `resultado` «conforme» si no vino.
 */
export function leerDatosCalibracion(fuente: Fuente, parcial?: false): DatosCalibracion & { motivo?: string | null };
export function leerDatosCalibracion(fuente: Fuente, parcial: true): Partial<DatosCalibracion> & { motivo?: string | null };
export function leerDatosCalibracion(fuente: Fuente, parcial = false): Partial<DatosCalibracion> & { motivo?: string | null } {
  const tiene = (k: string) => (esFormData(fuente) ? fuente.has(k) : Object.prototype.hasOwnProperty.call(fuente, k) && fuente[k] !== undefined);
  const valor = (k: string): unknown => (esFormData(fuente) ? fuente.get(k) : fuente[k]);
  const out: Record<string, unknown> = {};
  for (const k of CAMPOS_CALIBRACION) {
    if (parcial && !tiene(k)) continue;
    const v = valor(k);
    if (CAMPOS_ID.has(k)) out[k] = idLimpio(v);
    else if (CAMPOS_FECHA.has(k)) out[k] = fechaLimpia(v);
    else out[k] = textoLimpio(v);
  }
  if (!parcial && !out.resultado) out.resultado = "conforme";
  if (parcial && "resultado" in out && out.resultado === null) out.resultado = "";
  if (tiene("motivo")) out.motivo = textoLimpio(valor("motivo"));
  return out as Partial<DatosCalibracion> & { motivo?: string | null };
}

/** Textos de error al registrar o corregir (en el orden en que se revisan). */
export const MENSAJES_CAL = {
  baja: "El equipo está dado de baja: no se registran calibraciones.",
  noRequiere: "Este equipo está marcado «No requiere calibración». Quita la marca en Calibraciones antes de registrar.",
  resultado: "Elige el resultado: conforme, conforme con ajuste o no conforme.",
  fecha: "Escribe la fecha de calibración.",
  fechaFutura: "La fecha de calibración no puede ser posterior a hoy.",
  proxima: "Escribe la fecha de la próxima calibración.",
  proximaAntes: "La próxima calibración debe ser posterior a la fecha de calibración.",
  proximaLejana: "La próxima calibración no puede pasar de 5 años después de la calibración.",
  laboratorio: "Elige el laboratorio de la lista o escribe su nombre.",
  notas: "Describe en las notas el ajuste o la falla.",
  propioPatron: "Un equipo no puede ser su propio patrón.",
  patronInvalido: "El patrón elegido no está en la lista de equipos patrón.",
} as const;

/**
 * Primer error de una calibración o null. Las dos primeras reglas (equipo de baja o
 * «no requiere») no se revisan al corregir (`correccion`). `patronValido`: null si no se
 * eligió patrón de la lista (o no cambió), false si no es un patrón vigente de la lista.
 */
export function validarCalibracion(
  d: DatosCalibracion,
  ctx: { hoy: string; equipo: { id: number; estado: string; calibracionNoAplica: boolean }; patronValido: boolean | null; correccion?: boolean },
): string | null {
  if (!ctx.correccion) {
    if (ctx.equipo.estado === "baja") return MENSAJES_CAL.baja;
    if (ctx.equipo.calibracionNoAplica) return MENSAJES_CAL.noRequiere;
  }
  if (!esResultadoCal(d.resultado)) return MENSAJES_CAL.resultado;
  if (!esFechaISO(d.fechaCalibracion)) return MENSAJES_CAL.fecha;
  if (d.fechaCalibracion > ctx.hoy) return MENSAJES_CAL.fechaFutura;
  const noConforme = d.resultado === "no_conforme";
  if (d.proximaCalibracion ? !esFechaISO(d.proximaCalibracion) : !noConforme) return MENSAJES_CAL.proxima;
  if (d.proximaCalibracion) {
    if (d.proximaCalibracion <= d.fechaCalibracion) return MENSAJES_CAL.proximaAntes;
    if (d.proximaCalibracion > sumarMeses(d.fechaCalibracion, 12 * 5)) return MENSAJES_CAL.proximaLejana;
  }
  if (!d.laboratorioId && !d.laboratorioExterno) return MENSAJES_CAL.laboratorio;
  if ((noConforme || d.resultado === "conforme_con_ajuste") && !d.notas) return MENSAJES_CAL.notas;
  if (d.patronActivoId != null && d.patronActivoId === ctx.equipo.id) return MENSAJES_CAL.propioPatron;
  if (ctx.patronValido === false) return MENSAJES_CAL.patronInvalido;
  return null;
}

/** Motivo de una corrección o de un borrado: 10 a 500 letras. */
export function errorMotivo(motivo: string | null | undefined, falta: string, max = 500): string | null {
  const t = (motivo ?? "").trim();
  if (t.length < 10) return falta;
  if (t.length > max) return `El motivo es muy largo (máx. ${max} caracteres).`;
  return null;
}

export type LabCal = ProvAcredMin & { nombre: string };

/** Copia de la acreditación del laboratorio en la fecha de la calibración (no cambia si renueva o vence). */
export function snapshotLaboratorio(lab: LabCal | null, fecha: string): { labAcreditado: boolean | null; labAcreditacionRef: string | null } {
  if (!lab) return { labAcreditado: null, labAcreditacionRef: null };
  return { labAcreditado: acreditadoEn(lab, fecha), labAcreditacionRef: textoAcreditacion(lab) };
}

/** Avisos que no impiden guardar; la ficha los muestra antes de recargar. */
export function advertenciasCalibracion(a: {
  fecha: string;
  lab: LabCal | null;
  externo: string | null;
  patron: { codigo: string; calibs: readonly CalMin[] } | null;
  patronTexto: string | null;
  tieneArchivo: boolean;
  numeroCertificado: string | null;
}): string[] {
  const avisos: string[] = [];
  if (a.lab && !a.lab.esLaboratorioAcreditado) {
    avisos.push("El laboratorio elegido no está acreditado. La calibración queda como «laboratorio no acreditado».");
  } else if (a.lab && !acreditadoEn(a.lab, a.fecha)) {
    avisos.push(`La acreditación del laboratorio no estaba vigente el ${fechaCorta(a.fecha)}.`);
  }
  if (!a.lab && a.externo) avisos.push("Laboratorio escrito a mano: no se puede comprobar su acreditación.");
  if (a.patron && !patronVigenteEn(a.patron.calibs, a.fecha).vigente) {
    avisos.push(`El patrón ${a.patron.codigo} no tenía calibración vigente el ${fechaCorta(a.fecha)}.`);
  }
  if (!a.patron && !a.patronTexto) avisos.push("No se indicó el patrón usado.");
  if (!a.tieneArchivo) avisos.push("Falta adjuntar el certificado: el equipo quedará «Sin certificado» hasta que se suba.");
  if (!a.numeroCertificado) avisos.push("Falta el número de certificado.");
  return avisos;
}

// ═══ Acreditación y datos del proveedor ══════════════════════════════════════

/** Un laboratorio acreditado necesita órgano, número y vigencia; la vigencia debe ser fecha. */
export function validarAcreditacion(p: {
  esLaboratorioAcreditado: boolean | null | undefined;
  acreditacionOrgano: string | null | undefined;
  acreditacionNumero: string | null | undefined;
  acreditacionVigencia: string | null | undefined;
}): string | null {
  const lleno = (s: string | null | undefined) => !!(s ?? "").trim();
  if (p.esLaboratorioAcreditado && (!lleno(p.acreditacionOrgano) || !lleno(p.acreditacionNumero) || !lleno(p.acreditacionVigencia))) {
    return "Para un laboratorio acreditado escribe el órgano, el número y la vigencia.";
  }
  if (lleno(p.acreditacionVigencia) && !esFechaISO(p.acreditacionVigencia)) return "La vigencia de la acreditación no es una fecha válida.";
  return null;
}

export interface DatosProveedor {
  nombre: string;
  nit: string | null;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  notas: string | null;
  activo: boolean;
  esLaboratorioAcreditado: boolean;
  acreditacionOrgano: string | null;
  acreditacionNumero: string | null;
  acreditacionAlcance: string | null;
  acreditacionVigencia: string | null;
}
// `largo`: la frase completa del error (concuerda en género y número: «Las notas son muy largas»).
const TEXTOS_PROVEEDOR: ReadonlyArray<{ clave: keyof DatosProveedor; largo: string; max: number }> = [
  { clave: "nit", largo: "El NIT es muy largo", max: 40 },
  { clave: "contacto", largo: "El contacto es muy largo", max: 200 },
  { clave: "telefono", largo: "El teléfono es muy largo", max: 60 },
  { clave: "notas", largo: "Las notas son muy largas", max: 2000 },
  { clave: "acreditacionOrgano", largo: "El órgano acreditador es muy largo", max: 200 },
  { clave: "acreditacionNumero", largo: "El número de acreditación es muy largo", max: 500 },
  { clave: "acreditacionAlcance", largo: "El alcance es muy largo", max: 500 },
];
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const booleano = (v: unknown): boolean | null =>
  v === true || v === 1 || v === "1" || v === "true" ? true : v === false || v === 0 || v === "0" || v === "false" || v === null ? false : null;

/**
 * Datos de un proveedor (JSON). Sin `parcial`, el nombre es obligatorio; con `parcial`
 * solo vienen las claves enviadas. Recorta espacios; "" → null; vigencia a 'AAAA-MM-DD'.
 * La acreditación completa se revisa después con validarAcreditacion (sobre lo guardado + lo nuevo).
 */
export function leerDatosProveedor(body: Record<string, unknown>, parcial: boolean):
  | { ok: true; datos: Partial<DatosProveedor> } | { ok: false; error: string } {
  const tiene = (k: string) => Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined;
  const datos: Partial<DatosProveedor> = {};
  if (!parcial || tiene("nombre")) {
    const nombre = textoLimpio(body.nombre);
    if (!nombre) return { ok: false, error: "Escribe el nombre del proveedor." };
    if (nombre.length > 200) return { ok: false, error: "El nombre es muy largo (máx. 200 caracteres)." };
    datos.nombre = nombre;
  }
  for (const c of TEXTOS_PROVEEDOR) {
    if (parcial && !tiene(c.clave)) continue;
    const t = textoLimpio(body[c.clave]);
    if (t && t.length > c.max) return { ok: false, error: `${c.largo} (máx. ${c.max} caracteres).` };
    (datos as Record<string, unknown>)[c.clave] = t;
  }
  if (!parcial || tiene("email")) {
    const email = textoLimpio(body.email);
    if (email && (email.length > 200 || !RE_EMAIL.test(email))) return { ok: false, error: "El email no es válido." };
    datos.email = email;
  }
  for (const clave of ["esLaboratorioAcreditado", "activo"] as const) {
    if (!tiene(clave)) continue;
    const b = booleano(body[clave]);
    if (b === null) return { ok: false, error: "Datos no válidos." };
    datos[clave] = b;
  }
  if (!parcial || tiene("acreditacionVigencia")) {
    const t = textoLimpio(body.acreditacionVigencia);
    if (t) {
      const r = leerFechaEntrada(t);
      if (!("valor" in r) || !r.valor) return { ok: false, error: "La vigencia de la acreditación no es una fecha válida." };
      datos.acreditacionVigencia = r.valor;
    } else datos.acreditacionVigencia = null;
  }
  return { ok: true, datos };
}

// ═══ Viñetas ═════════════════════════════════════════════════════════════════

/**
 * Reparte las viñetas en hojas. La primera hoja empieza con `saltar` huecos (para usar
 * una hoja ya empezada; se recorta a 0…porHoja−1). La última no se rellena. [] → [].
 */
export function paginarVinetas<T>(items: readonly T[], porHoja = 18, saltar = 0): (T | null)[][] {
  if (items.length === 0 || porHoja < 1) return [];
  const huecos = Math.min(Math.max(0, Math.trunc(Number.isFinite(saltar) ? saltar : 0)), porHoja - 1);
  const seq: (T | null)[] = [...Array<null>(huecos).fill(null), ...items];
  const hojas: (T | null)[][] = [];
  for (let i = 0; i < seq.length; i += porHoja) hojas.push(seq.slice(i, i + porHoja));
  return hojas;
}

/** Cabecera de la viñeta según el estado. */
export function tituloVineta(e: EstadoCalibracion): string {
  if (e === "vigente" || e === "por_vencer") return "Calibrado";
  if (e === "vencida") return "Calibración vencida";
  if (e === "no_conforme") return "No conforme";
  if (e === "sin_certificado") return "Certificado pendiente";
  return "";
}

/**
 * Opciones del filtro «Ubicación» de las viñetas: las ubicaciones con equipos con viñeta, de
 * la sede elegida si hay una («UCI · Central» si no se eligió sede), por nombre.
 */
export function opcionesUbicacionVinetas(
  filas: ReadonlyArray<Pick<FilaCal, "ubicacionId" | "ubicacion" | "sedeId" | "sede">>, sede: number | null,
): Array<[number, string]> {
  const m = new Map<number, string>();
  for (const f of filas) {
    if (f.ubicacionId === null || (sede !== null && f.sedeId !== sede) || m.has(f.ubicacionId)) continue;
    const nombre = f.ubicacion ?? `Ubicación ${f.ubicacionId}`;
    m.set(f.ubicacionId, sede === null && f.sede ? `${nombre} · ${f.sede}` : nombre);
  }
  return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "es", { numeric: true }));
}

/**
 * La ubicación pedida solo filtra si está entre las opciones. Al cambiar de sede, el formulario
 * reenvía la ubicación anterior: si es de otra sede se descarta (si no, la hoja saldría vacía
 * con «Todas» a la vista).
 */
export function ubicacionVinetas(opciones: ReadonlyArray<readonly [number, string]>, pedida: number | null): number | null {
  return pedida !== null && opciones.some(([id]) => id === pedida) ? pedida : null;
}

// ═══ Textos comunes ══════════════════════════════════════════════════════════

/** true → «Sí»; false → «No»; null → `nulo` («No consta»). */
export function siNo(v: boolean | null | undefined, nulo = "No consta"): string {
  return v === true ? "Sí" : v === false ? "No" : nulo;
}

/** Copia de la acreditación de una calibración: «Acreditado» / «No acreditado» / «No consta». */
export function etiquetaLabAcreditado(v: boolean | null | undefined): string {
  return v === true ? "Acreditado" : v === false ? "No acreditado" : "No consta";
}
export function colorLabAcreditado(v: boolean | null | undefined): string {
  return v === true ? "bg-emerald-100 text-emerald-700" : v === false ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600";
}

/** 'AAAA-MM-DD HH:MM' en hora de El Salvador (marca de tiempo) o 'AAAA-MM-DD' (fecha sola); ilegible → ''. */
export function marcaSV(valor: string | null | undefined): string {
  const dia = diaSV(valor);
  if (!dia) return "";
  const hora = horaSV(valor);
  return hora ? `${dia} ${hora}` : dia;
}

/** Texto de la vigencia de la acreditación para Proveedores y Laboratorios. */
export function textoVigenciaAcreditacion(estado: EstadoAcreditacion, vigencia: string | null): string {
  if (estado === "vigente") return `Acreditado hasta ${fechaCorta(vigencia)}`;
  if (estado === "por_vencer") return `Vence el ${fechaCorta(vigencia)}`;
  if (estado === "vencida") return `Vencida el ${fechaCorta(vigencia)}`;
  if (estado === "sin_vigencia") return "Acreditado sin vigencia";
  return "—";
}

// ═══ Patrones y laboratorios ═════════════════════════════════════════════════

export interface FilaPatron extends FilaCal {
  /** Calibraciones que lo citan como patrón. */
  usos: number;
  /** Sus propias calibraciones (para saber si estaba vigente en una fecha). */
  calibs: CalMin[];
}

export interface FilaLab {
  id: number;
  nombre: string;
  nit: string | null;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  notas: string | null;
  activo: boolean;
  esLaboratorioAcreditado: boolean;
  acreditacionOrgano: string | null;
  acreditacionNumero: string | null;
  acreditacionAlcance: string | null;
  acreditacionVigencia: string | null;
  tieneCertificado: boolean;
  estado: EstadoAcreditacion;
  /** Días hasta el vencimiento de la acreditación (negativo si ya venció); null sin fecha. */
  dias: number | null;
  calibraciones: number;
  ultimaCalibracion: string | null;
}

/** Estado y días de la acreditación de un proveedor hoy. */
export function acreditacionHoy(p: ProvAcredMin, hoy: string): { estado: EstadoAcreditacion; dias: number | null } {
  const estado = estadoAcreditacion(p, hoy);
  return { estado, dias: p.esLaboratorioAcreditado && esFechaISO(p.acreditacionVigencia) ? diasEntre(hoy, p.acreditacionVigencia) : null };
}

/** Historial de calibraciones (CSV «registros»). */
export interface RegistroCal {
  id: number;
  activoId: number;
  codigo: string;
  equipo: string;
  sede: string | null;
  fecha: string;
  proxima: string | null;
  resultado: string;
  numeroCertificado: string | null;
  tieneArchivo: boolean;
  laboratorio: string | null;
  labAcreditado: boolean | null;
  labAcreditacionRef: string | null;
  patronActivoId: number | null;
  patronCodigo: string | null;
  patronVigente: boolean | null;
  patronTexto: string | null;
  incertidumbre: string | null;
  realizadoPor: string | null;
  notas: string | null;
  registradoPor: string | null;
  registradoEn: string | null;
  corregidaEn: string | null;
  corregidaPor: string | null;
}

// ═══ CSV ═════════════════════════════════════════════════════════════════════
// Columnas para toCsv (src/lib/csv.ts). Fechas AAAA-MM-DD; Sí/No ya escritos (toCsv
// escribiría true/false); los valores vacíos van como ''.

type ColumnaCsv = { key: string; label: string };
type FilaCsv = Record<string, string | number>;
const columnas = (pares: ReadonlyArray<readonly [string, string]>): ColumnaCsv[] => pares.map(([key, label]) => ({ key, label }));
const iso = (f: string | null | undefined) => (esFechaISO(f) ? f : "");
const txt = (s: string | null | undefined) => s ?? "";

export const COLUMNAS_CSV_EQUIPOS: ColumnaCsv[] = columnas([
  ["codigo", "Código"], ["equipo", "Equipo"], ["marca", "Marca"], ["modelo", "Modelo"], ["serie", "Serie"], ["area", "Área"],
  ["patron", "Patrón"], ["sede", "Sede"], ["ubicacion", "Ubicación"], ["subcategoria", "Subcategoría"], ["criticidad", "Criticidad"],
  ["clase", "Clase de riesgo"], ["critico", "Crítico"], ["motivoCritico", "Motivo crítico"], ["estado", "Estado de calibración"],
  ["ultima", "Última calibración"], ["proxima", "Próxima calibración"], ["dias", "Días para vencer"], ["certificado", "N.º de certificado"],
  ["adjunto", "Certificado adjunto"], ["laboratorio", "Laboratorio"], ["labAcreditado", "Laboratorio acreditado"],
  ["labRef", "Acreditación del laboratorio"], ["resultado", "Resultado"], ["patronLista", "Patrón usado (lista)"],
  ["patronVigente", "Patrón vigente en esa fecha"], ["patronTexto", "Patrón (texto)"], ["incertidumbre", "Incertidumbre"],
  ["noAplica", "Motivo «No requiere»"],
]);

export function filaCsvEquipo(f: FilaCal): FilaCsv {
  const c = f.cal;
  return {
    codigo: f.codigo, equipo: f.nombre, marca: txt(f.marca), modelo: txt(f.modelo), serie: txt(f.serial), area: etiquetaAreaCal(f.area),
    patron: siNo(f.esPatron), sede: txt(f.sede), ubicacion: txt(f.ubicacion),
    subcategoria: f.subcategoria ? subcatLabel(f.subcategoria) : "",
    criticidad: f.criticidad && f.criticidad in CRITICIDAD_LABEL ? CRITICIDAD_LABEL[f.criticidad as keyof typeof CRITICIDAD_LABEL] : txt(f.criticidad),
    clase: txt(f.clase), critico: siNo(f.motivos.length > 0), motivoCritico: f.motivos.map((m) => MOTIVO_CRITICO_LABEL[m]).join(" · "),
    estado: ESTADO_CALIBRACION_LABEL[f.estado], ultima: iso(f.ultima), proxima: iso(f.proxima), dias: f.dias ?? "",
    certificado: txt(c?.numeroCertificado), adjunto: c ? siNo(c.tieneArchivo) : "", laboratorio: txt(c?.laboratorio),
    labAcreditado: c ? siNo(c.labAcreditado) : "", labRef: txt(c?.labAcreditacionRef), resultado: c ? etiquetaResultado(c.resultado) : "",
    patronLista: txt(c?.patronCodigo), patronVigente: c?.patronActivoId ? siNo(c.patronVigente) : "", patronTexto: txt(c?.patronTexto),
    incertidumbre: txt(c?.incertidumbre), noAplica: txt(f.noAplicaMotivo),
  };
}

export const COLUMNAS_CSV_REGISTROS: ColumnaCsv[] = columnas([
  ["codigo", "Código"], ["equipo", "Equipo"], ["sede", "Sede"], ["fecha", "Fecha de calibración"], ["proxima", "Próxima calibración"],
  ["resultado", "Resultado"], ["certificado", "N.º de certificado"], ["adjunto", "Certificado adjunto"], ["laboratorio", "Laboratorio"],
  ["labAcreditado", "Laboratorio acreditado"], ["labRef", "Acreditación del laboratorio"], ["patronLista", "Patrón usado (lista)"],
  ["patronVigente", "Patrón vigente en esa fecha"], ["patronTexto", "Patrón (texto)"], ["incertidumbre", "Incertidumbre"],
  ["realizadoPor", "Realizado por"], ["notas", "Notas"], ["registradoPor", "Registrado por"], ["registradoEn", "Registrado el"],
  ["corregidaEn", "Corregida el"], ["corregidaPor", "Corregida por"],
]);

export function filaCsvRegistro(r: RegistroCal): FilaCsv {
  return {
    codigo: r.codigo, equipo: r.equipo, sede: txt(r.sede), fecha: iso(r.fecha), proxima: iso(r.proxima), resultado: etiquetaResultado(r.resultado),
    certificado: txt(r.numeroCertificado), adjunto: siNo(r.tieneArchivo), laboratorio: txt(r.laboratorio), labAcreditado: siNo(r.labAcreditado),
    labRef: txt(r.labAcreditacionRef), patronLista: txt(r.patronCodigo), patronVigente: r.patronActivoId ? siNo(r.patronVigente) : "",
    patronTexto: txt(r.patronTexto), incertidumbre: txt(r.incertidumbre), realizadoPor: txt(r.realizadoPor), notas: txt(r.notas),
    registradoPor: txt(r.registradoPor), registradoEn: marcaSV(r.registradoEn), corregidaEn: marcaSV(r.corregidaEn), corregidaPor: txt(r.corregidaPor),
  };
}

export const COLUMNAS_CSV_PATRONES: ColumnaCsv[] = columnas([
  ["codigo", "Código"], ["instrumento", "Instrumento"], ["marca", "Marca"], ["modelo", "Modelo"], ["serie", "Serie"], ["sede", "Sede"],
  ["ubicacion", "Ubicación"], ["estado", "Estado de calibración"], ["ultima", "Última calibración"], ["proxima", "Próxima calibración"],
  ["certificado", "N.º de certificado"], ["adjunto", "Certificado adjunto"], ["laboratorio", "Laboratorio"],
  ["labAcreditado", "Laboratorio acreditado"], ["usos", "Calibraciones en que se usó"],
]);

export function filaCsvPatron(p: FilaPatron): FilaCsv {
  const c = p.cal;
  return {
    codigo: p.codigo, instrumento: p.nombre, marca: txt(p.marca), modelo: txt(p.modelo), serie: txt(p.serial), sede: txt(p.sede),
    ubicacion: txt(p.ubicacion), estado: ESTADO_CALIBRACION_LABEL[p.estado], ultima: iso(p.ultima), proxima: iso(p.proxima),
    certificado: txt(c?.numeroCertificado), adjunto: c ? siNo(c.tieneArchivo) : "", laboratorio: txt(c?.laboratorio),
    labAcreditado: c ? siNo(c.labAcreditado) : "", usos: p.usos,
  };
}

export const COLUMNAS_CSV_LABS: ColumnaCsv[] = columnas([
  ["laboratorio", "Laboratorio"], ["nit", "NIT"], ["contacto", "Contacto"], ["telefono", "Teléfono"], ["email", "Email"],
  ["acreditado", "Acreditado"], ["organo", "Órgano acreditador"], ["numero", "N.º de acreditación"], ["alcance", "Alcance"],
  ["vigencia", "Vigencia"], ["estado", "Estado de la acreditación"], ["certificado", "Certificado adjunto"],
  ["calibraciones", "Calibraciones registradas"], ["ultima", "Última calibración"], ["activo", "Activo"],
]);

export function filaCsvLab(l: FilaLab): FilaCsv {
  return {
    laboratorio: l.nombre, nit: txt(l.nit), contacto: txt(l.contacto), telefono: txt(l.telefono), email: txt(l.email),
    acreditado: siNo(l.esLaboratorioAcreditado), organo: txt(l.acreditacionOrgano), numero: txt(l.acreditacionNumero),
    alcance: txt(l.acreditacionAlcance), vigencia: iso(l.acreditacionVigencia), estado: ESTADO_ACREDITACION_LABEL[l.estado],
    certificado: l.esLaboratorioAcreditado ? siNo(l.tieneCertificado) : "", calibraciones: l.calibraciones,
    ultima: iso(l.ultimaCalibracion), activo: siNo(l.activo),
  };
}
