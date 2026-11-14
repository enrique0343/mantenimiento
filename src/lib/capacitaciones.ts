// Fase 59 · WP-D: capacitaciones al personal sobre el uso de los equipos (requisito 19).
// Puro: el mismo lector de asistentes corre en el formulario (vista previa) y en el
// servidor; lo usan también la lista, el CSV y las pruebas.
import { leerFechaEntrada, normalizarTexto, sumarDias } from "./biomedico";

export const TIPOS_CAPACITACION = {
  induccion: "Inducción",
  uso_seguro: "Uso seguro del equipo",
  actualizacion: "Actualización",
  limpieza_desinfeccion: "Limpieza y desinfección",
  otro: "Otro",
} as const;
export type TipoCapacitacion = keyof typeof TIPOS_CAPACITACION;
export const INSTRUCTOR_TIPO = { interno: "Interno", externo: "Externo" } as const;
export type InstructorTipo = keyof typeof INSTRUCTOR_TIPO;
export const CATEGORIAS_ARCHIVO_CAPACITACION = {
  lista_firmada: "Lista de asistencia firmada",
  constancia: "Constancia o certificado",
  material: "Material o presentación",
  otro: "Otro",
} as const;
export type CategoriaArchivoCapacitacion = keyof typeof CATEGORIAS_ARCHIVO_CAPACITACION;
export const MAX_ASISTENTES = 300;
export const MAX_EQUIPOS = 500;

const tiene = <T extends object>(obj: T, k: unknown): k is keyof T => typeof k === "string" && Object.prototype.hasOwnProperty.call(obj, k);
export const esTipoCapacitacion = (v: unknown): v is TipoCapacitacion => tiene(TIPOS_CAPACITACION, v);
export const esCategoriaArchivoCapacitacion = (v: unknown): v is CategoriaArchivoCapacitacion => tiene(CATEGORIAS_ARCHIVO_CAPACITACION, v);
export const etiquetaTipoCapacitacion = (t: string | null | undefined): string => (esTipoCapacitacion(t) ? TIPOS_CAPACITACION[t] : t ?? "—");

/** 12 → 'CAP-0012'. */
export const codigoCapacitacion = (id: number): string => `CAP-${String(id).padStart(4, "0")}`;

// ═══ Asistentes ═════════════════════════════════════════════════════════════

export interface Asistente { nombre: string; cargo: string | null; servicio: string | null }

/**
 * Una persona por línea: «Nombre; Cargo; Servicio», o las columnas pegadas desde Excel
 * (tabulador). Separa el tabulador; si no hay, «;»; si no, «|». La coma no separa
 * («Pérez, Ana» es un nombre). Se ignoran las líneas vacías y un encabezado que empiece
 * por «nombre».
 */
export function leerAsistentes(texto: string | null | undefined): { asistentes: Asistente[]; errores: string[] } {
  const asistentes: Asistente[] = [];
  const errores: string[] = [];
  const vistos = new Set<string>();
  let primera = true;
  String(texto ?? "").split(/\r\n|\r|\n/).forEach((linea, i) => {
    const n = i + 1;
    if (!linea.trim()) return;
    if (primera) {
      primera = false;
      if (normalizarTexto(linea).startsWith("nombre")) return;
    }
    const sep = linea.includes("\t") ? "\t" : linea.includes(";") ? ";" : linea.includes("|") ? "|" : null;
    const datos = (sep ? linea.split(sep) : [linea]).map((d) => d.replace(/[\t;|]/g, " ").replace(/\s+/g, " ").trim());
    while (datos.length && !datos[datos.length - 1]) datos.pop();
    if (datos.length > 3) { errores.push(`Línea ${n}: usa Nombre; Cargo; Servicio.`); return; }
    const [nombre = "", cargo = "", servicio = ""] = datos;
    if (nombre.length < 3 || !/\p{L}/u.test(nombre)) { errores.push(`Línea ${n}: falta el nombre.`); return; }
    if (nombre.length > 120 || cargo.length > 80 || servicio.length > 80) { errores.push(`Línea ${n}: el dato es muy largo.`); return; }
    const clave = normalizarTexto(nombre);
    if (vistos.has(clave)) { errores.push(`Línea ${n}: «${nombre}» ya está en la lista.`); return; }
    vistos.add(clave);
    asistentes.push({ nombre, cargo: cargo || null, servicio: servicio || null });
  });
  if (asistentes.length > MAX_ASISTENTES) errores.push(`Máximo ${MAX_ASISTENTES} asistentes por capacitación.`);
  return { asistentes, errores };
}

/** Texto para el formulario: una línea «nombre; cargo; servicio» por persona, sin «;» de sobra al final. */
export function textoDeAsistentes(lista: ReadonlyArray<{ nombre: string; cargo?: string | null; servicio?: string | null }>): string {
  return lista.map((a) => {
    const datos = [a.nombre, a.cargo ?? "", a.servicio ?? ""];
    while (datos.length > 1 && !datos[datos.length - 1]) datos.pop();
    return datos.join("; ");
  }).join("\n");
}

/** 45 → '45 min'; 60 → '1 h'; 90 → '1 h 30 min'; null → '—'. */
export function textoDuracion(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min) || min <= 0) return "—";
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// ═══ Evidencia ══════════════════════════════════════════════════════════════

export type EvidenciaCapacitacion = "programada" | "completa" | "falta_lista" | "faltan_asistentes" | "sin_evidencia";
export const EVIDENCIA_CAPACITACION: Readonly<Record<EvidenciaCapacitacion, { etiqueta: string; color: string }>> = {
  programada: { etiqueta: "Programada", color: "bg-sky-100 text-sky-700" },
  completa: { etiqueta: "Completa", color: "bg-emerald-100 text-emerald-700" },
  falta_lista: { etiqueta: "Falta lista firmada", color: "bg-amber-100 text-amber-700" },
  faltan_asistentes: { etiqueta: "Faltan los asistentes", color: "bg-amber-100 text-amber-700" },
  sin_evidencia: { etiqueta: "Sin asistentes ni lista", color: "bg-red-100 text-red-700" },
};

/** Fecha futura → programada; con asistentes y lista firmada → completa; si falta algo, lo dice. */
export function evidenciaCapacitacion(c: { fecha: string; asistentes: number; listasFirmadas: number }, hoy: string): EvidenciaCapacitacion {
  if (c.fecha > hoy) return "programada";
  if (c.asistentes > 0 && c.listasFirmadas > 0) return "completa";
  if (c.asistentes > 0) return "falta_lista";
  if (c.listasFirmadas > 0) return "faltan_asistentes";
  return "sin_evidencia";
}

// ═══ Validación ═════════════════════════════════════════════════════════════

export interface DatosCapacitacion {
  fecha: string; tema: string; tipo: TipoCapacitacion; instructorTipo: InstructorTipo; instructorNombre: string;
  proveedorId: number | null; instructorEntidad: string | null; modeloCubierto: string | null; duracionMinutos: number | null;
  sucursalId: number | null; lugar: string | null; servicio: string | null; notas: string | null;
}

const texto = (v: unknown): string => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());
const id = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Revisa una capacitación y devuelve los datos limpios, los asistentes leídos y los equipos
 * sin repetir. Un instructor interno no lleva proveedor ni empresa.
 */
export function validarCapacitacion(entrada: Record<string, unknown>):
  | { ok: true; datos: DatosCapacitacion; asistentes: Asistente[]; equipoIds: number[] }
  | { ok: false; error: string; errores?: string[] } {
  const falla = (error: string) => ({ ok: false as const, error });
  const fecha = leerFechaEntrada(entrada.fecha);
  if ("error" in fecha || !fecha.valor) return falla("Escribe una fecha válida.");
  const tema = texto(entrada.tema);
  if (tema.length < 3 || tema.length > 200) return falla("Escribe el tema.");
  const tipo = texto(entrada.tipo);
  if (!esTipoCapacitacion(tipo)) return falla("Elige el tipo de capacitación.");
  const instructorTipo = texto(entrada.instructorTipo);
  if (instructorTipo !== "interno" && instructorTipo !== "externo") return falla("Elige si el instructor es interno o externo.");
  const instructorNombre = texto(entrada.instructorNombre);
  if (instructorNombre.length < 3 || instructorNombre.length > 120) return falla("Escribe el nombre del instructor.");
  const externo = instructorTipo === "externo";
  const instructorEntidad = externo ? texto(entrada.instructorEntidad) || null : null;
  if (instructorEntidad && instructorEntidad.length > 120) return falla("El nombre de la empresa es muy largo (máx. 120 caracteres).");
  const proveedorId = externo ? id(entrada.proveedorId) : null;

  const crudos: unknown[] = Array.isArray(entrada.equipoIds) ? entrada.equipoIds : [];
  const equipoIds: number[] = [];
  for (const v of crudos) {
    const n = id(v);
    if (n === null) return falla("Uno de los equipos no es válido. Recarga la página.");
    if (!equipoIds.includes(n)) equipoIds.push(n);
  }
  const modeloCubierto = texto(entrada.modeloCubierto) || null;
  if (modeloCubierto && modeloCubierto.length > 120) return falla("El modelo es muy largo (máx. 120 caracteres).");
  if (!equipoIds.length && !modeloCubierto) return falla("Elige al menos un equipo o escribe el modelo.");
  if (equipoIds.length > MAX_EQUIPOS) return falla(`Máximo ${MAX_EQUIPOS} equipos por capacitación.`);

  let duracionMinutos: number | null = null;
  const dur = entrada.duracionMinutos;
  if (dur !== null && dur !== undefined && String(dur).trim() !== "") {
    const n = typeof dur === "number" ? dur : Number(String(dur).trim());
    if (!Number.isInteger(n) || n < 5 || n > 1440) return falla("La duración va en minutos, entre 5 y 1440.");
    duracionMinutos = n;
  }
  const lugar = texto(entrada.lugar) || null;
  if (lugar && lugar.length > 120) return falla("El lugar es muy largo (máx. 120 caracteres).");
  const servicio = texto(entrada.servicio) || null;
  if (servicio && servicio.length > 80) return falla("El servicio es muy largo (máx. 80 caracteres).");
  const notas = entrada.notas === null || entrada.notas === undefined ? null : String(entrada.notas).trim() || null;
  if (notas && notas.length > 1000) return falla("Las notas son muy largas (máx. 1000 caracteres).");

  const lectura = leerAsistentes(typeof entrada.asistentesTexto === "string" ? entrada.asistentesTexto : "");
  if (lectura.errores.length) return { ok: false, error: "Revisa la lista de asistentes.", errores: lectura.errores };

  return {
    ok: true,
    datos: {
      fecha: fecha.valor, tema, tipo, instructorTipo, instructorNombre, proveedorId, instructorEntidad, modeloCubierto,
      duracionMinutos, sucursalId: id(entrada.sucursalId), lugar, servicio, notas,
    },
    asistentes: lectura.asistentes,
    equipoIds,
  };
}

// ═══ Lista, filtros y CSV ═══════════════════════════════════════════════════

export interface EquipoCapacitacion { id: number; codigo: string; nombre: string; marca: string | null; modelo: string | null }

/** Una capacitación como la devuelve listarCapacitaciones (bio-consultas.ts). */
export interface FilaCapacitacion {
  id: number; fecha: string; tema: string; tipo: string; instructorTipo: string; instructorNombre: string;
  proveedorId: number | null; proveedor: string | null; instructorEntidad: string | null; modeloCubierto: string | null;
  duracionMinutos: number | null; sucursalId: number | null; sede: string | null; lugar: string | null;
  servicio: string | null; notas: string | null;
  equipos: EquipoCapacitacion[];
  asistentes: Asistente[];
  listasFirmadas: number;
  archivos: number;
}

export interface FiltrosCapacitacion {
  desde: string; hasta: string | null; activo: number | null; equipo: string; servicio: string;
  tipo: TipoCapacitacion | null; sede: number | null;
}

/** Filtros de la URL. «Desde» por defecto: hace un año. Fechas que no se leen se ignoran. */
export function leerFiltrosCapacitacion(params: URLSearchParams, hoy: string): FiltrosCapacitacion {
  const fecha = (v: string | null) => { const r = leerFechaEntrada(v); return "valor" in r ? r.valor : null; };
  const tipo = params.get("tipo");
  return {
    desde: fecha(params.get("desde")) ?? sumarDias(hoy, -365),
    hasta: fecha(params.get("hasta")),
    activo: id(params.get("activo")),
    equipo: texto(params.get("equipo")).slice(0, 100),
    servicio: texto(params.get("servicio")).slice(0, 80),
    tipo: esTipoCapacitacion(tipo) ? tipo : null,
    sede: id(params.get("sede")),
  };
}

/** Parámetros de la URL que reproducen estos filtros (para el CSV). */
export function paramsDeFiltrosCapacitacion(f: FiltrosCapacitacion): URLSearchParams {
  const p = new URLSearchParams();
  p.set("desde", f.desde);
  if (f.hasta) p.set("hasta", f.hasta);
  if (f.activo !== null) p.set("activo", String(f.activo));
  if (f.equipo) p.set("equipo", f.equipo);
  if (f.servicio) p.set("servicio", f.servicio);
  if (f.tipo) p.set("tipo", f.tipo);
  if (f.sede !== null) p.set("sede", String(f.sede));
  return p;
}

/**
 * `activo`: el equipo está enlazado. `equipo`: texto en el código, nombre, marca o modelo de
 * algún equipo, o en el modelo cubierto. `servicio`: en el de la sesión o el de algún asistente.
 */
export function filtrarCapacitaciones<T extends FilaCapacitacion>(filas: readonly T[], f: FiltrosCapacitacion): T[] {
  const eq = normalizarTexto(f.equipo), sq = normalizarTexto(f.servicio);
  return filas.filter((c) => {
    if (c.fecha < f.desde) return false;
    if (f.hasta && c.fecha > f.hasta) return false;
    if (f.activo !== null && !c.equipos.some((e) => e.id === f.activo)) return false;
    if (eq && !normalizarTexto(c.modeloCubierto).includes(eq)
      && !c.equipos.some((e) => [e.codigo, e.nombre, e.marca, e.modelo].some((t) => normalizarTexto(t).includes(eq)))) return false;
    if (sq && !normalizarTexto(c.servicio).includes(sq) && !c.asistentes.some((a) => normalizarTexto(a.servicio).includes(sq))) return false;
    if (f.tipo && c.tipo !== f.tipo) return false;
    if (f.sede !== null && c.sucursalId !== f.sede) return false;
    return true;
  });
}

/** Marca y modelo sin tildes ni mayúsculas, para «agregar los del mismo modelo»; sin modelo → null. */
export function claveModelo(marca: string | null | undefined, modelo: string | null | undefined): string | null {
  const m = normalizarTexto(modelo);
  return m ? `${normalizarTexto(marca)}|${m}` : null;
}

export const COLUMNAS_CSV_CAPACITACIONES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "codigo", label: "Código" }, { key: "fecha", label: "Fecha" }, { key: "tema", label: "Tema" },
  { key: "tipo", label: "Tipo" }, { key: "instructor", label: "Instructor" }, { key: "instructorTipo", label: "Interno/Externo" },
  { key: "empresa", label: "Proveedor o empresa" }, { key: "equipos", label: "Equipos (códigos)" }, { key: "modelo", label: "Modelo" },
  { key: "duracion", label: "Duración (min)" }, { key: "sede", label: "Sede" }, { key: "lugar", label: "Lugar" },
  { key: "servicio", label: "Servicio" }, { key: "asistentes", label: "Asistentes" }, { key: "listaFirmada", label: "Lista firmada" },
  { key: "evidencia", label: "Evidencia" },
];

export function filaCsvCapacitacion(c: FilaCapacitacion, hoy: string): Record<string, string | number> {
  const ev = evidenciaCapacitacion({ fecha: c.fecha, asistentes: c.asistentes.length, listasFirmadas: c.listasFirmadas }, hoy);
  return {
    codigo: codigoCapacitacion(c.id), fecha: c.fecha, tema: c.tema, tipo: etiquetaTipoCapacitacion(c.tipo),
    instructor: c.instructorNombre, instructorTipo: c.instructorTipo === "externo" ? "Externo" : "Interno",
    empresa: c.proveedor ?? c.instructorEntidad ?? "", equipos: c.equipos.map((e) => e.codigo).join(", "),
    modelo: c.modeloCubierto ?? "", duracion: c.duracionMinutos ?? "", sede: c.sede ?? "", lugar: c.lugar ?? "",
    servicio: c.servicio ?? "", asistentes: c.asistentes.length, listaFirmada: c.listasFirmadas > 0 ? "Sí" : "No",
    evidencia: EVIDENCIA_CAPACITACION[ev].etiqueta,
  };
}

export const COLUMNAS_CSV_ASISTENTES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "codigo", label: "Código" }, { key: "fecha", label: "Fecha" }, { key: "tema", label: "Tema" },
  { key: "equipos", label: "Equipos" }, { key: "nombre", label: "Nombre" }, { key: "cargo", label: "Cargo" },
  { key: "servicio", label: "Servicio" },
];

export function filasCsvAsistentes(c: FilaCapacitacion): Array<Record<string, string>> {
  const comunes = { codigo: codigoCapacitacion(c.id), fecha: c.fecha, tema: c.tema, equipos: c.equipos.map((e) => e.codigo).join(", ") || (c.modeloCubierto ?? "") };
  return c.asistentes.map((a) => ({ ...comunes, nombre: a.nombre, cargo: a.cargo ?? "", servicio: a.servicio ?? "" }));
}
