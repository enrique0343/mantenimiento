// Helpers para el fundamento documental JCI (Fase 34):
// criticidad operacional, vida útil del equipo y resultados de calibración.

export type CriticidadOperacional = "alta" | "media" | "baja";

export const CRITICIDAD_LABEL: Record<CriticidadOperacional, string> = {
  alta: "Crítica",
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
  alta: "No tolera estar fuera de servicio: soporte vital, sin respaldo o de uso continuo.",
  media: "Tolera downtime corto; existe alternativa o el impacto es acotado.",
  baja: "Puede esperar; no afecta la continuidad del servicio.",
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

export const CATEGORIA_DOC_LABEL: Record<string, string> = {
  ficha_tecnica: "Ficha técnica",
  manual: "Manual",
  garantia: "Garantía",
  instalacion: "Acta de instalación",
  otro: "Otro",
};

// Fecha de fin de vida útil (YYYY-MM-DD) o null si falta data.
export function finVidaUtil(fechaAdquisicion: string | null, vidaUtilAnios: number | null): string | null {
  if (!fechaAdquisicion || !vidaUtilAnios) return null;
  const d = new Date(fechaAdquisicion);
  if (Number.isNaN(d.getTime())) return null;
  d.setFullYear(d.getFullYear() + vidaUtilAnios);
  return d.toISOString().slice(0, 10);
}

// Años restantes de vida útil (negativo si ya la superó), null si falta data.
export function vidaUtilRemanente(fechaAdquisicion: string | null, vidaUtilAnios: number | null): number | null {
  const fin = finVidaUtil(fechaAdquisicion, vidaUtilAnios);
  if (!fin) return null;
  const ms = new Date(fin).getTime() - Date.now();
  return ms / (365.25 * 86400_000);
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
