// Helpers para el fundamento documental JCI (Fase 34):
// criticidad operacional, vida útil del equipo y resultados de calibración.
// Fase 59 (WP-D): metadatos de los documentos del equipo, vencimientos que mandan
// y filtros del listado de expedientes técnicos. Sigue siendo puro: lo usan el
// servidor, el navegador y las pruebas.
import {
  CATEGORIAS_DOCUMENTO, RECOMENDADOS_EXPEDIENTE, REQUISITOS_EXPEDIENTE, diaSV, diasEntre, esCategoriaDocumento, esFechaISO,
  etiquetaCategoriaDocumento, horaSV, hoySV, normalizarTexto, sumarMeses,
  type CategoriaDocumento, type CompletitudExpediente,
} from "./biomedico";

export type CriticidadOperacional = "alta" | "media" | "baja";

export const CRITICIDAD_LABEL: Record<CriticidadOperacional, string> = {
  alta: "Alta",
  media: "Media",
  baja: "Baja",
};

export const CRITICIDAD_COLOR: Record<CriticidadOperacional, string> = {
  alta: "bg-red-100 text-red-700",
  media: "bg-amber-100 text-amber-700",
  baja: "bg-slate-100 text-slate-600",
};

// Descripción operativa (qué implica cada nivel para JCI / continuidad de servicio)
export const CRITICIDAD_DESC: Record<CriticidadOperacional, string> = {
  alta: "Su falla puede afectar la seguridad o interrumpir un servicio esencial.",
  media: "Su falla limita parte de la operación; existe una alternativa temporal.",
  baja: "Su falla tiene un impacto localizado y permite programar la intervención.",
};

export type ResultadoCalibracion = "conforme" | "conforme_con_ajuste" | "no_conforme";

export const RESULTADO_CALIB_LABEL: Record<ResultadoCalibracion, string> = {
  conforme: "Conforme",
  conforme_con_ajuste: "Conforme con ajuste",
  no_conforme: "No conforme",
};

export const RESULTADO_CALIB_COLOR: Record<ResultadoCalibracion, string> = {
  conforme: "bg-emerald-100 text-emerald-700",
  conforme_con_ajuste: "bg-amber-100 text-amber-700",
  no_conforme: "bg-red-100 text-red-700",
};

/** Etiqueta de cada categoría de documento (la lista vive en biomedico.ts). */
export const CATEGORIA_DOC_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORIAS_DOCUMENTO.map((c) => [c.clave, c.etiqueta]),
);

// Fecha de fin de vida útil (YYYY-MM-DD) o null si falta data. Fase 59: sin
// new Date('AAAA-MM-DD'); se suma en el calendario (29/02 + 1 año → 28/02).
export function finVidaUtil(fechaAdquisicion: string | null, vidaUtilAnios: number | null): string | null {
  if (!fechaAdquisicion || !vidaUtilAnios || !Number.isInteger(vidaUtilAnios)) return null;
  return sumarMeses(fechaAdquisicion.slice(0, 10), 12 * vidaUtilAnios) || null;
}

// Años restantes de vida útil (negativo si ya la superó), null si falta data.
export function vidaUtilRemanente(fechaAdquisicion: string | null, vidaUtilAnios: number | null): number | null {
  const fin = finVidaUtil(fechaAdquisicion, vidaUtilAnios);
  if (!fin) return null;
  return diasEntre(hoySV(), fin) / 365.25;
}

// True si el equipo ya superó su vida útil estimada.
export function vidaUtilVencida(fechaAdquisicion: string | null, vidaUtilAnios: number | null): boolean {
  const r = vidaUtilRemanente(fechaAdquisicion, vidaUtilAnios);
  return r != null && r < 0;
}

// True si el equipo lleva calibración: biomédico o marcado requiereCalibracion.
export function llevaCalibracion(tipo: string, requiereCalibracion: boolean): boolean {
  return tipo === "biomedico" || requiereCalibracion;
}

// ═══ Fase 59 · Metadatos de un documento del equipo ═════════════════════════

export interface MetadatosDocumento {
  categoria?: CategoriaDocumento;
  version?: string | null;
  /** Fecha del documento (columna fecha_version). */
  fechaVersion?: string | null;
  fechaVencimiento?: string | null;
  nota?: string | null;
}

const textoOpcional = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t ? t : null;
};

/**
 * Lee categoría, versión, fecha del documento, vencimiento y nota. En alta (`parcial: false`)
 * la categoría es obligatoria y lo que no vino queda en null; en edición (`parcial: true`) solo
 * se devuelve lo que vino, y la fecha y el vencimiento se comparan con `actual`.
 * Recorta espacios; '' → null. «manual» (heredada) se acepta.
 */
export function leerMetadatosDocumento(
  entrada: Record<string, unknown>,
  opciones: { parcial: boolean; actual?: { categoria: string | null; fechaVersion: string | null; fechaVencimiento: string | null } },
): { ok: true; datos: MetadatosDocumento } | { ok: false; error: string } {
  const vino = (k: string) => !opciones.parcial || entrada[k] !== undefined;
  const falla = (error: string) => ({ ok: false as const, error });
  const datos: MetadatosDocumento = {};
  if (vino("categoria")) {
    const c = textoOpcional(entrada.categoria);
    if (!c) return falla("Elige la categoría del documento.");
    if (!esCategoriaDocumento(c)) return falla("Categoría no válida.");
    datos.categoria = c;
  }
  if (vino("version")) {
    const v = textoOpcional(entrada.version);
    if (v && v.length > 40) return falla("La versión es muy larga (máx. 40 caracteres).");
    datos.version = v;
  }
  if (vino("fechaDocumento")) {
    const f = textoOpcional(entrada.fechaDocumento);
    if (f && !esFechaISO(f)) return falla("La fecha del documento no es válida.");
    datos.fechaVersion = f;
  }
  if (vino("fechaVencimiento")) {
    const f = textoOpcional(entrada.fechaVencimiento);
    if (f && !esFechaISO(f)) return falla("La fecha de vencimiento no es válida.");
    datos.fechaVencimiento = f;
  }
  if (datos.fechaVersion !== undefined || datos.fechaVencimiento !== undefined) {
    const doc = datos.fechaVersion !== undefined ? datos.fechaVersion : opciones.actual?.fechaVersion ?? null;
    const vence = datos.fechaVencimiento !== undefined ? datos.fechaVencimiento : opciones.actual?.fechaVencimiento ?? null;
    if (esFechaISO(doc) && esFechaISO(vence) && vence < doc) return falla("El vencimiento no puede ser anterior a la fecha del documento.");
  }
  if (vino("nota")) {
    const n = textoOpcional(entrada.nota);
    if (n && n.length > 300) return falla("La nota es muy larga (máx. 300 caracteres).");
    datos.nota = n;
  }
  return { ok: true, datos };
}

// ═══ Vencimientos que mandan ════════════════════════════════════════════════

/** Categorías donde un documento nuevo reemplaza al anterior (expediente e informe eléctrico). */
const CATEGORIAS_QUE_SE_RENUEVAN = new Set<string>([
  ...REQUISITOS_EXPEDIENTE.flatMap((r) => r.categorias), ...RECOMENDADOS_EXPEDIENTE, "seguridad_electrica",
]);

/**
 * Vencimientos que importan en un equipo. En las categorías del expediente y en el informe de
 * seguridad eléctrica, subir la versión nueva reemplaza a la anterior: manda el vencimiento más
 * lejano y, si algún documento de la categoría no vence, la categoría no vence. En las demás
 * categorías (licencia, otro…) cuenta cada documento por su cuenta.
 */
export function vencimientosVigentes<T extends { categoria: string | null; fechaVencimiento?: string | null }>(
  docs: readonly T[],
): Array<{ categoria: string; fecha: string; documento: T }> {
  const sinVence = new Set<string>();
  const porCategoria = new Map<string, { categoria: string; fecha: string; documento: T }>();
  const sueltos: Array<{ categoria: string; fecha: string; documento: T }> = [];
  for (const d of docs) {
    const categoria = d.categoria ?? "otro";
    const fecha = d.fechaVencimiento;
    const seRenueva = CATEGORIAS_QUE_SE_RENUEVAN.has(categoria);
    if (!esFechaISO(fecha)) { if (seRenueva) sinVence.add(categoria); continue; }
    if (!seRenueva) { sueltos.push({ categoria, fecha, documento: d }); continue; }
    const actual = porCategoria.get(categoria);
    if (!actual || fecha > actual.fecha) porCategoria.set(categoria, { categoria, fecha, documento: d });
  }
  const vigentes = [...porCategoria.values()].filter((v) => !sinVence.has(v.categoria));
  return [...vigentes, ...sueltos].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
}

// ═══ Listado de expedientes técnicos (/expedientes y su CSV) ═════════════════

export interface FilaExpediente {
  activoId: number; codigo: string; nombre: string; marca: string | null; modelo: string | null; serial: string | null;
  estado: string; subcategoria: string | null; criticidad: string | null;
  sucursalId: number | null; sede: string | null; ubicacion: string | null;
  aceptacionFecha: string | null;
  documentos: number;
  completitud: CompletitudExpediente;
  /** El vencimiento más cercano de los que mandan (puede estar vencido). */
  proximoVencimiento: { fecha: string; categoria: string; etiquetaCategoria: string; dias: number } | null;
  /** Vencimientos que mandan ya vencidos o que vencen en 90 días o menos. */
  porVencer90: number;
}

/** Lo que se puede buscar como «Falta»: los cinco requisitos y los dos recomendados. */
export const FALTAS_EXPEDIENTE: ReadonlyArray<{ clave: string; etiqueta: string }> = [
  ...REQUISITOS_EXPEDIENTE.map((r) => ({ clave: r.clave as string, etiqueta: r.corta })),
  { clave: "limpieza_desinfeccion", etiqueta: "Protocolo de limpieza" },
  { clave: "garantia", etiqueta: "Garantía" },
];

export interface FiltrosExpediente {
  sede: number | null;
  /** Clave de subcategoría o 'sin'. */
  subcategoria: string | null;
  /** alta, media, baja o 'sin'. */
  criticidad: string | null;
  estado: "todos" | "completos" | "incompletos";
  falta: string | null;
  q: string;
  bajas: boolean;
  /** Solo equipos con algún documento vencido o que vence en 90 días o menos. */
  vence: boolean;
}

const enteroPositivo = (v: string | null): number | null => {
  const n = Number(v);
  return v && Number.isInteger(n) && n > 0 ? n : null;
};

export function leerFiltrosExpediente(params: URLSearchParams, subcategorias: readonly string[] = []): FiltrosExpediente {
  const estado = params.get("estado");
  const falta = params.get("falta");
  const subcat = params.get("subcategoria");
  const crit = params.get("criticidad");
  return {
    sede: enteroPositivo(params.get("sede")),
    subcategoria: subcat && (subcat === "sin" || subcategorias.includes(subcat)) ? subcat : null,
    criticidad: crit && ["alta", "media", "baja", "sin"].includes(crit) ? crit : null,
    estado: estado === "completos" || estado === "incompletos" ? estado : "todos",
    falta: falta && FALTAS_EXPEDIENTE.some((f) => f.clave === falta) ? falta : null,
    q: String(params.get("q") ?? "").trim().slice(0, 100),
    bajas: params.get("bajas") === "1",
    vence: params.get("vence") === "90",
  };
}

/** ¿Le falta este requisito o recomendado? (vencido cuenta como falta). */
export function faltaEnExpediente(c: CompletitudExpediente, clave: string): boolean {
  const req = c.requisitos.find((r) => r.clave === clave);
  if (req) return req.estado === "falta" || req.estado === "vencido";
  const rec = c.recomendados.find((r) => r.categoria === clave);
  return rec ? !rec.tiene : false;
}

export function filtrarExpedientes(filas: readonly FilaExpediente[], f: FiltrosExpediente): FilaExpediente[] {
  const q = normalizarTexto(f.q);
  return filas.filter((r) => {
    if (!f.bajas && r.estado === "baja") return false;
    if (f.sede !== null && r.sucursalId !== f.sede) return false;
    if (f.subcategoria === "sin" ? !!r.subcategoria : f.subcategoria !== null && r.subcategoria !== f.subcategoria) return false;
    if (f.criticidad === "sin" ? !!r.criticidad : f.criticidad !== null && r.criticidad !== f.criticidad) return false;
    if (f.estado === "completos" && !r.completitud.completo) return false;
    if (f.estado === "incompletos" && r.completitud.completo) return false;
    if (f.falta && !faltaEnExpediente(r.completitud, f.falta)) return false;
    if (f.vence && r.porVencer90 === 0) return false;
    if (q && ![r.codigo, r.nombre, r.marca, r.modelo, r.serial].some((t) => normalizarTexto(t).includes(q))) return false;
    return true;
  });
}

/** Parámetros de la URL que reproducen estos filtros (para el CSV y la impresión). */
export function paramsDeFiltrosExpediente(f: FiltrosExpediente): URLSearchParams {
  const p = new URLSearchParams();
  if (f.sede !== null) p.set("sede", String(f.sede));
  if (f.subcategoria) p.set("subcategoria", f.subcategoria);
  if (f.criticidad) p.set("criticidad", f.criticidad);
  if (f.estado !== "todos") p.set("estado", f.estado);
  if (f.falta) p.set("falta", f.falta);
  if (f.q) p.set("q", f.q);
  if (f.bajas) p.set("bajas", "1");
  if (f.vence) p.set("vence", "90");
  return p;
}

const siNo = (b: boolean) => (b ? "Sí" : "No");

/** Cómo se lee un requisito en el CSV. */
export function textoRequisitoCsv(r: CompletitudExpediente["requisitos"][number], aceptacionFecha: string | null): string {
  switch (r.estado) {
    case "con_documento": return `Sí (${r.documentos})`;
    case "aceptacion_registrada": return `Inspección de aceptación ${aceptacionFecha ?? ""}`.trim();
    case "no_aplica": return `No aplica: ${r.motivoNoAplica ?? ""}`.trim();
    case "vencido": return "Vencido";
    default: return "Falta";
  }
}

export const COLUMNAS_CSV_EXPEDIENTES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "codigo", label: "Código" }, { key: "equipo", label: "Equipo" }, { key: "marca", label: "Marca" },
  { key: "modelo", label: "Modelo" }, { key: "serie", label: "Serie" }, { key: "sede", label: "Sede" },
  { key: "ubicacion", label: "Ubicación" }, { key: "subcategoria", label: "Subcategoría" }, { key: "criticidad", label: "Criticidad" },
  { key: "estado", label: "Estado del equipo" }, { key: "avance", label: "Avance" }, { key: "completo", label: "Expediente completo" },
  ...REQUISITOS_EXPEDIENTE.map((r) => ({ key: `req_${r.clave}`, label: r.corta })),
  { key: "falta", label: "Falta" }, { key: "limpieza", label: "Protocolo de limpieza" }, { key: "garantia", label: "Garantía" },
  { key: "documentos", label: "Documentos" }, { key: "proximoVence", label: "Próximo vencimiento" },
  { key: "proximoDocumento", label: "Documento que vence" },
];

export function filaCsvExpediente(
  r: FilaExpediente,
  etiquetas: { estado: (e: string) => string; subcategoria: (s: string | null) => string; criticidad: (c: string | null) => string },
): Record<string, string | number> {
  const c = r.completitud;
  const fila: Record<string, string | number> = {
    codigo: r.codigo, equipo: r.nombre, marca: r.marca ?? "", modelo: r.modelo ?? "", serie: r.serial ?? "",
    sede: r.sede ?? "", ubicacion: r.ubicacion ?? "", subcategoria: etiquetas.subcategoria(r.subcategoria),
    criticidad: etiquetas.criticidad(r.criticidad), estado: etiquetas.estado(r.estado),
    avance: `${c.cumplidos}/${c.total}`, completo: siNo(c.completo),
    falta: c.faltan.join(" · "),
    limpieza: siNo(c.recomendados.find((x) => x.categoria === "limpieza_desinfeccion")?.tiene ?? false),
    garantia: siNo(c.recomendados.find((x) => x.categoria === "garantia")?.tiene ?? false),
    documentos: r.documentos,
    proximoVence: r.proximoVencimiento?.fecha ?? "",
    proximoDocumento: r.proximoVencimiento?.etiquetaCategoria ?? "",
  };
  for (const req of c.requisitos) fila[`req_${req.clave}`] = textoRequisitoCsv(req, r.aceptacionFecha);
  return fila;
}

export const COLUMNAS_CSV_DOCUMENTOS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "codigo", label: "Código" }, { key: "equipo", label: "Equipo" }, { key: "categoria", label: "Categoría" },
  { key: "archivo", label: "Archivo" }, { key: "version", label: "Versión" }, { key: "fecha", label: "Fecha del documento" },
  { key: "vence", label: "Vence" }, { key: "diasVence", label: "Días para vencer" }, { key: "nota", label: "Nota" },
  { key: "subidoPor", label: "Subido por" }, { key: "subidoEl", label: "Subido el" },
];

/** Marca de tiempo para el CSV (§f.5): 'AAAA-MM-DD HH:MM' en hora de El Salvador; fecha sola sin hora; ilegible → ''. */
export function marcaCsvSV(valor: string | null | undefined): string {
  const dia = diaSV(valor);
  if (!dia) return "";
  const hora = horaSV(valor);
  return hora ? `${dia} ${hora}` : dia;
}

/** Una fila del CSV de documentos. `subidoEl` es la marca guardada (created_at, UTC de SQLite). */
export function filaCsvDocumento(
  d: { codigo: string; equipo: string; categoria: string | null; nombre: string; version: string | null; fechaVersion: string | null; fechaVencimiento: string | null; nota: string | null; subidoPor: string | null; subidoEl: string | null },
  hoy: string,
): Record<string, string | number> {
  return {
    codigo: d.codigo, equipo: d.equipo, categoria: etiquetaCategoriaDocumento(d.categoria), archivo: d.nombre,
    version: d.version ?? "", fecha: d.fechaVersion ?? "", vence: d.fechaVencimiento ?? "",
    diasVence: esFechaISO(d.fechaVencimiento) ? diasEntre(hoy, d.fechaVencimiento) : "",
    nota: d.nota ?? "", subidoPor: d.subidoPor ?? "", subidoEl: marcaCsvSV(d.subidoEl),
  };
}
