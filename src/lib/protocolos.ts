// Fase 59 · WP-G · Protocolos institucionales y PDF aprobado de la biblioteca.
//
// El protocolo institucional (incidentes, limpieza y desinfección, bajas) es un
// tipo más de la biblioteca, «protocolo», con sistema «otro». No se archiva como
// SOP: así el resolver de «Procedimiento que rige» no lo toma como la rutina de
// todo equipo biomédico (agrupa por los cinco tipos conocidos). Le aplican las
// reglas de siempre: dueño, matriz de validación y regla para pasar a vigente;
// no lleva semana de validación, nivel de riesgo ni escalamientos.
//
// Cada documento guarda un solo PDF aprobado (procedimientos.r2_key y pdf_*).
// Archivo puro: lo usan las páginas, la API del PDF y las pruebas.
import { TIPO_PROC, type TipoProcInfo } from "./procedimientos";
import { ARCHIVO_MAX_BYTES, detectarTipoArchivo, nombreSeguroR2 } from "./biomedico";

export const TIPO_PROTOCOLO = "protocolo" as const;
export const TIPOS_BIBLIOTECA = ["scp", "sop", "mop", "eop", "aop", "protocolo"] as const;
export type TipoBiblioteca = (typeof TIPOS_BIBLIOTECA)[number];
export const esTipoBiblioteca = (t: unknown): t is TipoBiblioteca => (TIPOS_BIBLIOTECA as readonly unknown[]).includes(t);

export const INFO_PROTOCOLO: TipoProcInfo = {
  label: "Protocolo",
  nombre: "Protocolo institucional",
  icono: "",
  color: "bg-brand-50 text-brand-700",
  borde: "border-brand-300",
  pregunta: "¿Qué hace el personal, paso a paso, según la norma aprobada por Calidad?",
  vive: "Como documento aprobado en PDF; se consulta e imprime desde la biblioteca.",
};

/** Datos del tipo para insignias y fichas. Un tipo desconocido no rompe la página. */
export function infoTipoBiblioteca(tipo: string | null | undefined): TipoProcInfo {
  if (tipo === TIPO_PROTOCOLO) return INFO_PROTOCOLO;
  // Solo propiedades propias: «constructor» o «toString» no son tipos.
  if (tipo && Object.prototype.hasOwnProperty.call(TIPO_PROC, tipo)) return (TIPO_PROC as Record<string, TipoProcInfo>)[tipo];
  return {
    label: (tipo ?? "—").toUpperCase(),
    nombre: "Documento",
    icono: "",
    color: "bg-slate-100 text-slate-600",
    borde: "border-slate-300",
    pregunta: "",
    vive: "",
  };
}

/** Lo que dice la columna Sistema de un documento de la biblioteca. */
export const ETIQUETA_SISTEMA_PROTOCOLO = "Institucional";

export interface SugerenciaProtocolo { titulo: string; areas: string[]; queConfirma: string }

/**
 * Códigos sugeridos para los tres protocolos que pide la evaluación JCI. No se
 * siembran fichas: los códigos y el texto son de Calidad. Escribir uno de estos
 * códigos en «Nuevo documento» precarga título y áreas validadoras.
 */
export const PROTOCOLOS_SUGERIDOS: Record<string, SugerenciaProtocolo> = {
  "PRT-INC-01": {
    titulo: "Incidentes y eventos adversos con equipo médico: aviso, retención del equipo e investigación",
    areas: ["Calidad", "Mantenimiento Biomédico", "Enfermería"],
    queConfirma: "Cómo se avisa a Calidad, qué se hace con el equipo y quién lo libera",
  },
  "PRT-LYD-01": {
    titulo: "Limpieza y desinfección de equipo médico",
    areas: ["Control de Infecciones", "Mantenimiento Biomédico", "Enfermería", "Calidad"],
    queConfirma: "Productos, frecuencia y responsable por tipo de equipo",
  },
  "PRT-BAJ-01": {
    titulo: "Baja y disposición final de equipo médico",
    areas: ["Mantenimiento Biomédico", "Compras y Finanzas", "Calidad"],
    queConfirma: "Evaluación técnica, autorización y destino final del equipo",
  },
};

/** La sugerencia de un código (sin distinguir mayúsculas ni espacios); desconocido → null. */
export function sugerenciaProtocolo(codigo: string | null | undefined): SugerenciaProtocolo | null {
  const clave = codigo?.trim().toUpperCase();
  return clave && Object.prototype.hasOwnProperty.call(PROTOCOLOS_SUGERIDOS, clave) ? PROTOCOLOS_SUGERIDOS[clave] : null;
}

/**
 * Avisos sobre el PDF aprobado de un documento, en este orden:
 * 1. Retirado (inactivo o estado «retirado») → solo «no usar».
 * 2. Sin PDF: un protocolo en vigor lo pide; los demás documentos no.
 * 3. Con PDF: de otra versión, o de un documento que todavía no está en vigor.
 * «En revisión» sigue en vigor con la versión aprobada (no se avisa por el estado).
 */
export function avisosPdf(p: {
  tipo: string; estado: string; activo: boolean; version: string;
  r2Key: string | null; pdfVersion: string | null;
}): string[] {
  if (!p.activo || p.estado === "retirado") return ["Documento retirado: no usar."];
  const enVigor = p.estado === "vigente" || p.estado === "en_revision";
  if (!p.r2Key) {
    return p.tipo === TIPO_PROTOCOLO && enVigor ? ["Este protocolo está vigente y todavía no tiene su PDF aprobado."] : [];
  }
  const avisos: string[] = [];
  if (!p.pdfVersion) {
    avisos.push(`No consta de qué versión es el PDF y el documento está en la versión ${p.version}. Sube el PDF de la versión actual.`);
  } else if (p.pdfVersion !== p.version) {
    avisos.push(`El PDF es de la versión ${p.pdfVersion} y el documento está en la versión ${p.version}. Sube el PDF de la versión actual.`);
  }
  if (!enVigor) avisos.push("El documento todavía no está vigente: este PDF no es una versión aprobada.");
  return avisos;
}

/** 512000 → '500 KB'; 1536000 → '1,5 MB'; null o negativo → '—'. */
export function tamanoLegible(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "—";
  const MIB = 1024 * 1024;
  if (bytes < MIB) return `${bytes === 0 ? 0 : Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / MIB).toFixed(1).replace(".", ",")} MB`;
}

/**
 * Solo PDF, revisado por su firma (%PDF- en el primer KB; pasar hasta 1024 bytes),
 * hasta 15 MB. Vacío → 400; grande → 413; otro tipo → 415 (convención de la fase).
 */
export function validarPdf(tamano: number, cabecera: Uint8Array):
  | { ok: true }
  | { ok: false; status: 400 | 413 | 415; error: string } {
  if (!(tamano > 0)) return { ok: false, status: 400, error: "El archivo está vacío." };
  if (tamano > ARCHIVO_MAX_BYTES) return { ok: false, status: 413, error: "El PDF pasa de 15 MB. Redúcelo e inténtalo de nuevo." };
  if (detectarTipoArchivo(cabecera) !== "application/pdf") return { ok: false, status: 415, error: "El archivo no es un PDF." };
  return { ok: true };
}

/** ('PRT-LYD-01', '1.0') → 'PRT-LYD-01_v1.0.pdf'; sin versión → 'PRT-LYD-01.pdf'. */
export function nombreDescargaPdf(codigoCorto: string, version: string | null): string {
  const v = version?.trim();
  return nombreSeguroR2(v ? `${codigoCorto}_v${v}.pdf` : `${codigoCorto}.pdf`);
}
