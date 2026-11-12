// Fase 59 · Alertas y retiros de equipo (requisito 14, JCI FMS.07.1).
// Reglas puras del cambio de una alerta: análisis de aplicabilidad, cierre firme con
// fecha declarada y reapertura con motivo. Lo usan la API (PATCH /api/alertas/[id]),
// la lista, la hoja y el CSV; las prueba scripts/test-bio-alertas.mjs.
// Las órdenes no se crean desde aquí (decisión g.10): se crean desde la ficha y se
// anotan en la acción tomada.
import { esFechaISO, diasEntre } from "./biomedico";

export const ESTADOS_ALERTA = ["abierta", "en_proceso", "cerrada"] as const;
export type EstadoAlerta = (typeof ESTADOS_ALERTA)[number];
export const APLICABILIDADES = ["pendiente", "aplica", "no_aplica"] as const;
export type Aplicabilidad = (typeof APLICABILIDADES)[number];
export const TIPOS_ALERTA = ["retiro", "alerta", "aviso"] as const;
export const FUENTES_ALERTA = ["fabricante", "regulador", "proveedor", "interna"] as const;

export const CATEGORIAS_ADJUNTO_ALERTA = ["boletin", "evaluacion", "evidencia", "otro"] as const;
export type CategoriaAdjuntoAlerta = (typeof CATEGORIAS_ADJUNTO_ALERTA)[number];
export const CATEGORIA_ADJUNTO_ALERTA_LABEL: Record<CategoriaAdjuntoAlerta, string> = {
  boletin: "Boletín del fabricante", evaluacion: "Evaluación", evidencia: "Evidencia de la acción", otro: "Otro",
};

/** Mínimo de caracteres del análisis, la acción tomada y el motivo de reapertura. */
export const MIN_TEXTO_ALERTA = 10;

export const MENSAJE_ALERTA = {
  reabrirSinMotivo: "Para reabrir escribe el motivo (mínimo 10 caracteres).",
  cerrada: "La alerta está cerrada. Para corregirla, reábrela y deja el motivo.",
  emisionFutura: "La fecha de emisión no puede ser futura.",
  emisionInvalida: "Fecha de emisión no válida.",
  titulo: "Escribe un título (mínimo 3 caracteres).",
  analisis: "Escribe el análisis: qué se revisó y por qué aplica o no (mínimo 10 caracteres).",
  fechaAnalisis: "La fecha del análisis no puede ser futura ni anterior a la emisión.",
  fechaAnalisisInvalida: "Fecha del análisis no válida.",
  aplicaSinEquipos: "Si la alerta aplica, marca al menos un equipo afectado.",
  cerrarSinAnalisis: "Antes de cerrar registra el análisis de aplicabilidad.",
  cerrarSinAccion: "Para cerrar documenta la acción tomada (mínimo 10 caracteres).",
  fechaCierre: "La fecha de cierre no puede ser futura ni anterior a la emisión.",
  fechaCierreInvalida: "Fecha de cierre no válida.",
} as const;

/** Lo que importa de la alerta guardada para decidir un cambio. */
export interface AlertaActual {
  estado: EstadoAlerta;
  aplicabilidad: Aplicabilidad;
  aplicabilidadAnalisis: string | null;
  aplicabilidadFecha: string | null;
  accionTomada: string | null;
  fechaAlerta: string;
  vecesReabierta: number;
}

/** Lo que pide la pantalla (todo opcional; undefined = no se cambia). */
export interface CambioAlerta {
  tipo?: string;
  fuente?: string;
  titulo?: string;
  descripcion?: string | null;
  referencia?: string | null;
  fechaAlerta?: string;
  estado?: EstadoAlerta;
  accionTomada?: string | null;
  aplicabilidad?: Aplicabilidad;
  aplicabilidadAnalisis?: string | null;
  aplicabilidadFecha?: string | null;
  fechaCierre?: string | null;
  motivoReapertura?: string | null;
  activoIds?: number[];
}

export interface ContextoCambio { hoy: string; ahoraISO: string; usuarioId: number; equiposActuales: number }

export type PlanCambioAlerta =
  | { ok: true; evento: "edicion" | "cierre" | "reapertura"; set: Record<string, unknown>; equipos: number[] | null }
  | { ok: false; status: 400 | 409; error: string };

/** Texto recortado; vacío → null. */
export const limpiarTexto = (s: string | null | undefined): string | null => {
  const t = typeof s === "string" ? s.trim() : "";
  return t ? t : null;
};
const largo = (s: string | null | undefined) => (limpiarTexto(s) ?? "").length;
const error = (status: 400 | 409, mensaje: string): PlanCambioAlerta => ({ ok: false, status, error: mensaje });

/**
 * Decide qué se guarda. En orden: reabrir (con motivo y nada más) → una cerrada no se
 * edita → fechas, análisis y equipos → requisitos para cerrar → copia lo enviado.
 * Al cerrar se fija la fecha declarada (o hoy) y el sello del sistema; reabrir los
 * limpia y deja la constancia (quién, cuándo, motivo y cuántas veces).
 */
export function planearCambioAlerta(actual: AlertaActual, cambio: CambioAlerta, ctx: ContextoCambio): PlanCambioAlerta {
  const enviados = (Object.keys(cambio) as (keyof CambioAlerta)[]).filter((k) => cambio[k] !== undefined);

  // ── Alerta cerrada: solo se reabre, con motivo y sin otros cambios ──
  if (actual.estado === "cerrada") {
    const pideReabrir = cambio.estado === "abierta" || cambio.estado === "en_proceso";
    const soloReabrir = enviados.every((k) => k === "estado" || k === "motivoReapertura");
    if (pideReabrir && soloReabrir) {
      const motivo = limpiarTexto(cambio.motivoReapertura);
      if (!motivo || motivo.length < MIN_TEXTO_ALERTA) return error(400, MENSAJE_ALERTA.reabrirSinMotivo);
      return {
        ok: true,
        evento: "reapertura",
        equipos: null,
        set: {
          estado: cambio.estado,
          cerradaEn: null,
          cerradaPor: null,
          fechaCierre: null,
          reabiertaEn: ctx.ahoraISO,
          reabiertaPor: ctx.usuarioId,
          motivoReapertura: motivo,
          vecesReabierta: (actual.vecesReabierta ?? 0) + 1,
          updatedAt: ctx.ahoraISO,
        },
      };
    }
    return error(409, MENSAJE_ALERTA.cerrada);
  }

  // ── Datos de la alerta ──
  if (cambio.titulo !== undefined) {
    const t = largo(cambio.titulo);
    if (t < 3 || t > 200) return error(400, MENSAJE_ALERTA.titulo);
  }
  if (cambio.fechaAlerta !== undefined && !esFechaISO(cambio.fechaAlerta)) return error(400, MENSAJE_ALERTA.emisionInvalida);
  if (cambio.fechaAlerta !== undefined && cambio.fechaAlerta > ctx.hoy) return error(400, MENSAJE_ALERTA.emisionFutura);
  const emision = cambio.fechaAlerta ?? actual.fechaAlerta;

  // ── Análisis de aplicabilidad (estado final) ──
  const aplicabilidad = cambio.aplicabilidad ?? actual.aplicabilidad;
  const analisis = cambio.aplicabilidadAnalisis !== undefined ? limpiarTexto(cambio.aplicabilidadAnalisis) : actual.aplicabilidadAnalisis;
  if (cambio.aplicabilidadFecha !== undefined && cambio.aplicabilidadFecha !== null && !esFechaISO(cambio.aplicabilidadFecha)) {
    return error(400, MENSAJE_ALERTA.fechaAnalisisInvalida);
  }
  const cambiaAnalisis =
    (cambio.aplicabilidad !== undefined && cambio.aplicabilidad !== actual.aplicabilidad) ||
    (cambio.aplicabilidadAnalisis !== undefined && limpiarTexto(cambio.aplicabilidadAnalisis) !== actual.aplicabilidadAnalisis) ||
    (cambio.aplicabilidadFecha !== undefined && (cambio.aplicabilidadFecha ?? null) !== actual.aplicabilidadFecha);
  const fechaAnalisis = cambiaAnalisis ? (cambio.aplicabilidadFecha ?? ctx.hoy) : actual.aplicabilidadFecha;
  if (aplicabilidad !== "pendiente") {
    if ((analisis ?? "").length < MIN_TEXTO_ALERTA) return error(400, MENSAJE_ALERTA.analisis);
    if (fechaAnalisis && (fechaAnalisis > ctx.hoy || fechaAnalisis < emision)) return error(400, MENSAJE_ALERTA.fechaAnalisis);
  }

  // ── Equipos afectados ──
  const equipos = cambio.activoIds ? [...new Set(cambio.activoIds)] : null;
  const nEquipos = equipos ? equipos.length : ctx.equiposActuales;
  if (aplicabilidad === "aplica" && nEquipos === 0) return error(400, MENSAJE_ALERTA.aplicaSinEquipos);

  // ── Cierre ──
  const cierra = cambio.estado === "cerrada";
  const accion = cambio.accionTomada !== undefined ? limpiarTexto(cambio.accionTomada) : actual.accionTomada;
  let fechaCierre: string | null = null;
  if (cierra) {
    if (aplicabilidad === "pendiente") return error(400, MENSAJE_ALERTA.cerrarSinAnalisis);
    if ((accion ?? "").length < MIN_TEXTO_ALERTA) return error(400, MENSAJE_ALERTA.cerrarSinAccion);
    fechaCierre = cambio.fechaCierre ?? ctx.hoy;
    if (!esFechaISO(fechaCierre)) return error(400, MENSAJE_ALERTA.fechaCierreInvalida);
    if (fechaCierre > ctx.hoy || fechaCierre < emision) return error(400, MENSAJE_ALERTA.fechaCierre);
  }

  // ── Lo que se guarda ──
  const set: Record<string, unknown> = {};
  if (cambio.tipo !== undefined) set.tipo = cambio.tipo;
  if (cambio.fuente !== undefined) set.fuente = cambio.fuente;
  if (cambio.titulo !== undefined) set.titulo = limpiarTexto(cambio.titulo);
  if (cambio.descripcion !== undefined) set.descripcion = limpiarTexto(cambio.descripcion);
  if (cambio.referencia !== undefined) set.referencia = limpiarTexto(cambio.referencia);
  if (cambio.fechaAlerta !== undefined) set.fechaAlerta = cambio.fechaAlerta;
  if (cambio.estado !== undefined) set.estado = cambio.estado;
  if (cambio.accionTomada !== undefined) set.accionTomada = accion;
  if (cambiaAnalisis) {
    set.aplicabilidad = aplicabilidad;
    if (aplicabilidad === "pendiente") {
      set.aplicabilidadAnalisis = null;
      set.aplicabilidadFecha = null;
      set.aplicabilidadPor = null;
    } else {
      set.aplicabilidadAnalisis = analisis;
      set.aplicabilidadFecha = fechaAnalisis;
      set.aplicabilidadPor = ctx.usuarioId;
    }
  }
  if (cierra) {
    set.cerradaEn = ctx.ahoraISO;
    set.cerradaPor = ctx.usuarioId;
    set.fechaCierre = fechaCierre;
  }
  set.updatedAt = ctx.ahoraISO;
  return { ok: true, evento: cierra ? "cierre" : "edicion", set, equipos };
}

// ─── Filtros de la lista y del CSV (mismos en los dos) ───────────────────────

export interface FiltrosAlertas { estado: "todas" | "abiertas" | "cerradas"; analisis: "todos" | Aplicabilidad; anio: number | null }

export function leerFiltrosAlertas(q: URLSearchParams): FiltrosAlertas {
  const estado = q.get("estado");
  const analisis = q.get("analisis");
  const anio = Number(q.get("anio"));
  return {
    estado: estado === "abiertas" || estado === "cerradas" ? estado : "todas",
    analisis: analisis === "pendiente" || analisis === "aplica" || analisis === "no_aplica" ? analisis : "todos",
    anio: Number.isInteger(anio) && anio >= 2000 && anio <= 2100 ? anio : null,
  };
}

/** Query string de los filtros (sin los valores por defecto). */
export function queryFiltrosAlertas(f: FiltrosAlertas): string {
  const p = new URLSearchParams();
  if (f.estado !== "todas") p.set("estado", f.estado);
  if (f.analisis !== "todos") p.set("analisis", f.analisis);
  if (f.anio) p.set("anio", String(f.anio));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function pasaFiltrosAlertas(a: { estado: string; aplicabilidad: string; fechaAlerta: string }, f: FiltrosAlertas): boolean {
  if (f.estado === "abiertas" && a.estado === "cerrada") return false;
  if (f.estado === "cerradas" && a.estado !== "cerrada") return false;
  if (f.analisis !== "todos" && a.aplicabilidad !== f.analisis) return false;
  if (f.anio && a.fechaAlerta.slice(0, 4) !== String(f.anio)) return false;
  return true;
}

/** Días desde la emisión (0 = hoy); fecha no válida → null. */
export function diasDesdeEmision(fechaAlerta: string, hoy: string): number | null {
  const d = diasEntre(fechaAlerta, hoy);
  return Number.isFinite(d) ? d : null;
}

/** 'ALE-0007'. */
export const folioAlerta = (id: number): string => `ALE-${String(id).padStart(4, "0")}`;

/** 'Reabierta 1 vez' · 'Reabierta 3 veces'; 0 → ''. */
export function textoReabierta(veces: number | null | undefined): string {
  const n = Number(veces ?? 0);
  if (!n) return "";
  return n === 1 ? "Reabierta 1 vez" : `Reabierta ${n} veces`;
}
