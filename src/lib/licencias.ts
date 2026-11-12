// Fase 59 · WP-D: licencias y permisos (requisito 11). Puro: lo usan el formulario
// en el navegador, la API, la lista, el CSV y las pruebas. La vigencia (tramos de
// 90, 60 y 30 días) es la de biomedico.ts: situacionLicencia.
import { SITUACION_LICENCIA, leerFechaEntrada, normalizarTexto, situacionLicencia, type SituacionLicencia } from "./biomedico";

export const ENTIDADES_LICENCIA = { srs: "SRS", cssp: "CSSP", minsal: "MINSAL", otra: "Otra" } as const;
export type EntidadLicencia = keyof typeof ENTIDADES_LICENCIA;
export const TIPOS_LICENCIA = {
  funcionamiento: "Permiso o licencia de funcionamiento",
  radiacion_equipo: "Licencia de equipo o instalación de radiación",
  radiacion_personal: "Licencia del personal que opera radiación",
  inscripcion: "Inscripción o registro",
  otro: "Otro permiso",
} as const;
export type TipoLicencia = keyof typeof TIPOS_LICENCIA;
export const AMBITOS_LICENCIA = { establecimiento: "Establecimiento", servicio: "Servicio", equipo: "Equipo", persona: "Persona" } as const;
export type AmbitoLicencia = keyof typeof AMBITOS_LICENCIA;
export const ESTADOS_LICENCIA = { activa: "Activa", en_tramite: "En trámite", reemplazada: "Reemplazada", anulada: "Anulada" } as const;
export type EstadoLicencia = keyof typeof ESTADOS_LICENCIA;
export const CATEGORIAS_ARCHIVO_LICENCIA = { licencia: "Licencia o resolución", constancia_tramite: "Constancia de trámite", otro: "Otro" } as const;
export type CategoriaArchivoLicencia = keyof typeof CATEGORIAS_ARCHIVO_LICENCIA;

const tiene = <T extends object>(obj: T, k: unknown): k is keyof T => typeof k === "string" && Object.prototype.hasOwnProperty.call(obj, k);
export const esEntidadLicencia = (v: unknown): v is EntidadLicencia => tiene(ENTIDADES_LICENCIA, v);
export const esTipoLicencia = (v: unknown): v is TipoLicencia => tiene(TIPOS_LICENCIA, v);
export const esAmbitoLicencia = (v: unknown): v is AmbitoLicencia => tiene(AMBITOS_LICENCIA, v);
export const esCategoriaArchivoLicencia = (v: unknown): v is CategoriaArchivoLicencia => tiene(CATEGORIAS_ARCHIVO_LICENCIA, v);

/** 7 → 'LIC-0007'. */
export const codigoLicencia = (id: number): string => `LIC-${String(id).padStart(4, "0")}`;

/** 'srs' → 'SRS'; 'otra' → el nombre escrito (o «Otra»). */
export function etiquetaEntidad(entidad: string | null | undefined, entidadOtra?: string | null): string {
  if (entidad === "otra") return entidadOtra?.trim() || "Otra";
  return esEntidadLicencia(entidad) ? ENTIDADES_LICENCIA[entidad] : entidad ?? "—";
}
export const etiquetaTipoLicencia = (t: string | null | undefined): string => (esTipoLicencia(t) ? TIPOS_LICENCIA[t] : t ?? "—");
export const etiquetaAmbito = (a: string | null | undefined): string => (esAmbitoLicencia(a) ? AMBITOS_LICENCIA[a] : a ?? "—");
export const etiquetaEstadoLicencia = (e: string | null | undefined): string => (tiene(ESTADOS_LICENCIA, e) ? ESTADOS_LICENCIA[e] : e ?? "—");

export interface DatosLicencia {
  entidad: EntidadLicencia; entidadOtra: string | null; tipo: TipoLicencia; nombre: string; numero: string | null;
  ambito: AmbitoLicencia; sucursalId: number | null; servicio: string | null; activoId: number | null; titular: string | null;
  fechaEmision: string | null; fechaVencimiento: string | null; responsableId: number | null;
  estado: "activa" | "en_tramite"; notas: string | null;
}

const texto = (v: unknown): string => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());
const textoLargo = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
const id = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isInteger(n) && n > 0 ? n : null;
};
const siMarcado = (v: unknown): boolean => v === true || v === 1 || v === "1" || v === "true" || v === "on";

/**
 * Revisa una licencia que se registra o se edita y devuelve los datos limpios (los campos
 * que no corresponden al ámbito quedan en null). Las fechas aceptan AAAA-MM-DD o DD/MM/AAAA.
 * Una activa necesita número y vencimiento (o «No vence»); en edición, una activa no
 * vuelve a «En trámite».
 */
export function validarLicencia(
  entrada: Record<string, unknown>,
  opciones: { modo: "crear" | "editar"; estadoActual?: string | null },
): { ok: true; datos: DatosLicencia } | { ok: false; error: string } {
  const falla = (error: string) => ({ ok: false as const, error });
  const entidad = texto(entrada.entidad);
  if (!esEntidadLicencia(entidad)) return falla("Elige la entidad que la emite.");
  let entidadOtra: string | null = null;
  if (entidad === "otra") {
    entidadOtra = texto(entrada.entidadOtra) || null;
    if (!entidadOtra) return falla("Escribe el nombre de la entidad.");
    if (entidadOtra.length > 120) return falla("El nombre de la entidad es muy largo (máx. 120 caracteres).");
  }
  const tipo = texto(entrada.tipo);
  if (!esTipoLicencia(tipo)) return falla("Elige el tipo de licencia.");
  const nombre = texto(entrada.nombre);
  if (nombre.length < 3 || nombre.length > 150) return falla("Escribe una descripción corta de la licencia.");

  const estadoTxt = texto(entrada.estado) || "activa";
  if (estadoTxt !== "activa" && estadoTxt !== "en_tramite") return falla("Estado no válido.");
  const estado: "activa" | "en_tramite" = estadoTxt;
  if (opciones.modo === "editar" && opciones.estadoActual === "activa" && estado === "en_tramite") {
    return falla("Una licencia activa no vuelve a «En trámite»: registra una renovación.");
  }
  const numero = texto(entrada.numero) || null;
  if (numero && numero.length > 60) return falla("El número es muy largo (máx. 60 caracteres).");
  if (estado === "activa" && !numero) return falla("Escribe el número de la licencia o márcala «En trámite».");

  const ambito = texto(entrada.ambito);
  if (!esAmbitoLicencia(ambito)) return falla("Elige a qué aplica.");
  let sucursalId: number | null = null, servicio: string | null = null, activoId: number | null = null, titular: string | null = null;
  if (ambito === "establecimiento") {
    sucursalId = id(entrada.sucursalId);
    if (!sucursalId) return falla("Elige la sede.");
  } else if (ambito === "servicio") {
    sucursalId = id(entrada.sucursalId);
    if (!sucursalId) return falla("Elige la sede.");
    servicio = texto(entrada.servicio) || null;
    if (!servicio) return falla("Escribe el servicio.");
    if (servicio.length > 80) return falla("El servicio es muy largo (máx. 80 caracteres).");
  } else if (ambito === "equipo") {
    activoId = id(entrada.activoId);
    if (!activoId) return falla("Elige el equipo de la lista.");
  } else {
    titular = texto(entrada.titular) || null;
    if (!titular) return falla("Escribe el nombre del titular.");
    if (titular.length > 120) return falla("El nombre del titular es muy largo (máx. 120 caracteres).");
    sucursalId = id(entrada.sucursalId);
  }

  const emision = leerFechaEntrada(entrada.fechaEmision);
  if ("error" in emision) return falla("La fecha de emisión no es válida.");
  const noVence = siMarcado(entrada.noVence);
  const vence = noVence ? { valor: null } : leerFechaEntrada(entrada.fechaVencimiento);
  if ("error" in vence) return falla("La fecha de vencimiento no es válida.");
  if (emision.valor && vence.valor && vence.valor <= emision.valor) return falla("El vencimiento debe ser posterior a la emisión.");
  if (estado === "activa" && !vence.valor && !noVence) return falla("Escribe la fecha de vencimiento o marca «No vence».");

  const notas = textoLargo(entrada.notas) || null;
  if (notas && notas.length > 1000) return falla("Las notas son muy largas (máx. 1000 caracteres).");

  return {
    ok: true,
    datos: {
      entidad, entidadOtra, tipo, nombre, numero, ambito, sucursalId, servicio, activoId, titular,
      fechaEmision: emision.valor, fechaVencimiento: vence.valor, responsableId: id(entrada.responsableId), estado, notas,
    },
  };
}

/** Lo que ya se sabe de una renovación: mismos datos de la licencia, sin número, fechas ni notas. */
export function licenciaParaRenovar(l: {
  id: number; entidad: string; entidadOtra: string | null; tipo: string; nombre: string; ambito: string;
  sucursalId: number | null; servicio: string | null; activoId: number | null; titular: string | null; responsableId: number | null;
}) {
  return {
    entidad: l.entidad, entidadOtra: l.entidadOtra, tipo: l.tipo, nombre: l.nombre, ambito: l.ambito,
    sucursalId: l.sucursalId, servicio: l.servicio, activoId: l.activoId, titular: l.titular, responsableId: l.responsableId,
    numero: null, fechaEmision: null, fechaVencimiento: null, notas: null,
    estado: "en_tramite" as const, reemplazaAId: l.id,
  };
}

// ═══ Lista, filtros y CSV ═══════════════════════════════════════════════════

/** Una licencia como la devuelve listarLicencias (bio-consultas.ts). */
export interface FilaLicencia {
  id: number; entidad: string; entidadOtra: string | null; tipo: string; nombre: string; numero: string | null;
  ambito: string; sucursalId: number | null; sede: string | null; servicio: string | null;
  activoId: number | null; equipoCodigo: string | null; equipoNombre: string | null; titular: string | null;
  fechaEmision: string | null; fechaVencimiento: string | null; responsableId: number | null; responsable: string | null;
  estado: string; reemplazaAId: number | null; notas: string | null; archivos: number; renovacionEnTramite: boolean;
  createdAt: string | null;
}

export const SITUACIONES_FILTRO = {
  actuales: "Activas y en trámite",
  vigentes: "Vigentes",
  vence_90: "Vencen en ≤ 90 días",
  vence_60: "Vencen en ≤ 60 días",
  vence_30: "Vencen en ≤ 30 días",
  vencidas: "Vencidas",
  en_tramite: "En trámite",
  historial: "Reemplazadas y anuladas",
  todas: "Todas",
} as const;
export type SituacionFiltro = keyof typeof SITUACIONES_FILTRO;

export interface FiltrosLicencia {
  situacion: SituacionFiltro; entidad: EntidadLicencia | null; tipo: TipoLicencia | null; ambito: AmbitoLicencia | null;
  sede: number | null; activo: number | null; q: string;
}

export function leerFiltrosLicencia(params: URLSearchParams): FiltrosLicencia {
  const s = params.get("situacion");
  const entidad = params.get("entidad"), tipo = params.get("tipo"), ambito = params.get("ambito");
  return {
    situacion: tiene(SITUACIONES_FILTRO, s) ? s : "actuales",
    entidad: esEntidadLicencia(entidad) ? entidad : null,
    tipo: esTipoLicencia(tipo) ? tipo : null,
    ambito: esAmbitoLicencia(ambito) ? ambito : null,
    sede: id(params.get("sede")),
    activo: id(params.get("activo")),
    q: texto(params.get("q")).slice(0, 100),
  };
}

/** Parámetros de la URL que reproducen estos filtros (para el CSV). */
export function paramsDeFiltrosLicencia(f: FiltrosLicencia): URLSearchParams {
  const p = new URLSearchParams();
  if (f.situacion !== "actuales") p.set("situacion", f.situacion);
  if (f.entidad) p.set("entidad", f.entidad);
  if (f.tipo) p.set("tipo", f.tipo);
  if (f.ambito) p.set("ambito", f.ambito);
  if (f.sede !== null) p.set("sede", String(f.sede));
  if (f.activo !== null) p.set("activo", String(f.activo));
  if (f.q) p.set("q", f.q);
  return p;
}

const situacionDe = (l: FilaLicencia, hoy: string) => situacionLicencia(l, hoy, { renovacionEnTramite: l.renovacionEnTramite });

/** ¿La licencia entra en esta situación? Las ventanas se acumulan: ≤ 90 incluye ≤ 60 y ≤ 30. */
export function enSituacion(l: FilaLicencia, situacion: SituacionFiltro, hoy: string): boolean {
  const s = situacionDe(l, hoy);
  const activa = l.estado === "activa";
  switch (situacion) {
    case "todas": return true;
    case "actuales": return l.estado === "activa" || l.estado === "en_tramite";
    case "vigentes": return activa && s.vigente;
    case "vencidas": return activa && s.clave === "vencida";
    case "en_tramite": return l.estado === "en_tramite";
    case "historial": return l.estado === "reemplazada" || l.estado === "anulada";
    default: {
      const limite = situacion === "vence_30" ? 30 : situacion === "vence_60" ? 60 : 90;
      return activa && s.dias !== null && s.dias >= 0 && s.dias <= limite;
    }
  }
}

/** Filtra, busca sin tildes y ordena: lo más urgente primero y, dentro, por vencimiento. */
export function filtrarLicencias(filas: readonly FilaLicencia[], f: FiltrosLicencia, hoy: string): FilaLicencia[] {
  const q = normalizarTexto(f.q);
  const lista = filas.filter((l) => {
    if (!enSituacion(l, f.situacion, hoy)) return false;
    if (f.entidad && l.entidad !== f.entidad) return false;
    if (f.tipo && l.tipo !== f.tipo) return false;
    if (f.ambito && l.ambito !== f.ambito) return false;
    if (f.sede !== null && l.sucursalId !== f.sede) return false;
    if (f.activo !== null && l.activoId !== f.activo) return false;
    if (q) {
      const campos = [l.nombre, l.numero, l.titular, l.servicio, codigoLicencia(l.id), l.equipoCodigo, l.equipoNombre, etiquetaEntidad(l.entidad, l.entidadOtra)];
      if (!campos.some((c) => normalizarTexto(c).includes(q))) return false;
    }
    return true;
  });
  const orden = (l: FilaLicencia) => SITUACION_LICENCIA[situacionDe(l, hoy).clave].orden;
  return lista.sort((a, b) => {
    const d = orden(a) - orden(b);
    if (d) return d;
    const va = a.fechaVencimiento ?? "9999-12-31", vb = b.fechaVencimiento ?? "9999-12-31";
    if (va !== vb) return va < vb ? -1 : 1;
    return a.id - b.id;
  });
}

/** Cuántas hay en cada tarjeta de la lista (las ventanas se acumulan). */
export function contarLicencias(filas: readonly FilaLicencia[], hoy: string) {
  const n = (s: SituacionFiltro) => filas.filter((l) => enSituacion(l, s, hoy)).length;
  return {
    vigentes: n("vigentes"), vence90: n("vence_90"), vence60: n("vence_60"), vence30: n("vence_30"),
    vencidas: n("vencidas"), enTramite: n("en_tramite"), historial: n("historial"), total: filas.length,
  };
}

/** Lo que dice la columna «Aplica a». */
export function aplicaA(l: Pick<FilaLicencia, "ambito" | "sede" | "servicio" | "equipoCodigo" | "equipoNombre" | "titular">): string {
  if (l.ambito === "establecimiento") return l.sede ? `Establecimiento · ${l.sede}` : "Establecimiento";
  if (l.ambito === "servicio") return [l.servicio, l.sede].filter(Boolean).join(" · ") || "Servicio";
  if (l.ambito === "equipo") return [l.equipoCodigo, l.equipoNombre].filter(Boolean).join(" — ") || "Equipo";
  return [l.titular, l.sede].filter(Boolean).join(" · ") || "Persona";
}

export const COLUMNAS_CSV_LICENCIAS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "codigo", label: "Código" }, { key: "entidad", label: "Entidad" }, { key: "tipo", label: "Tipo" },
  { key: "licencia", label: "Licencia" }, { key: "numero", label: "Número" }, { key: "ambito", label: "Ámbito" },
  { key: "sede", label: "Sede" }, { key: "servicio", label: "Servicio" }, { key: "equipoCodigo", label: "Equipo (código)" },
  { key: "equipo", label: "Equipo" }, { key: "titular", label: "Titular" }, { key: "emision", label: "Emisión" },
  { key: "vence", label: "Vence" }, { key: "situacion", label: "Situación" }, { key: "dias", label: "Días para vencer" },
  { key: "estado", label: "Estado" }, { key: "responsable", label: "Responsable" }, { key: "archivo", label: "Archivo" },
  { key: "notas", label: "Notas" },
];

/** Una fila del CSV: fechas AAAA-MM-DD y Sí/No. */
export function filaCsvLicencia(l: FilaLicencia, hoy: string): Record<string, string | number> {
  const s = situacionDe(l, hoy);
  return {
    codigo: codigoLicencia(l.id), entidad: etiquetaEntidad(l.entidad, l.entidadOtra), tipo: etiquetaTipoLicencia(l.tipo),
    licencia: l.nombre, numero: l.numero ?? "", ambito: etiquetaAmbito(l.ambito), sede: l.sede ?? "", servicio: l.servicio ?? "",
    equipoCodigo: l.equipoCodigo ?? "", equipo: l.equipoNombre ?? "", titular: l.titular ?? "",
    emision: l.fechaEmision ?? "", vence: l.fechaVencimiento ?? "",
    situacion: s.etiqueta + (l.estado === "activa" && l.renovacionEnTramite ? " · renovación en trámite" : ""),
    dias: l.estado === "activa" && s.dias !== null ? s.dias : "", estado: etiquetaEstadoLicencia(l.estado),
    responsable: l.responsable ?? "", archivo: l.archivos > 0 ? "Sí" : "No", notas: l.notas ?? "",
  };
}

export type { SituacionLicencia };
