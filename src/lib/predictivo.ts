export type EstadoAlerta = "ok" | "warning" | "critico";

export interface Umbrales {
  minCritico?: number | null;
  minWarning?: number | null;
  maxWarning?: number | null;
  maxCritico?: number | null;
}

export function evaluarMedicion(valor: number, u: Umbrales): EstadoAlerta {
  if (u.minCritico != null && valor < u.minCritico) return "critico";
  if (u.maxCritico != null && valor > u.maxCritico) return "critico";
  if (u.minWarning != null && valor < u.minWarning) return "warning";
  if (u.maxWarning != null && valor > u.maxWarning) return "warning";
  return "ok";
}

export const ESTADO_ALERTA_COLOR: Record<EstadoAlerta, string> = {
  ok: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-700",
  critico: "bg-red-100 text-red-700",
};

export const ESTADO_ALERTA_LABEL: Record<EstadoAlerta, string> = {
  ok: "OK",
  warning: "Alerta",
  critico: "Crítico",
};
