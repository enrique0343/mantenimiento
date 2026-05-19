// Helpers del módulo Actividades recurrentes.

export function puedeVerActividades(rol: string): boolean {
  return rol !== "motorista" && rol !== "proveedor";
}

export function puedeAdministrarActividades(rol: string): boolean {
  return rol === "admin" || rol === "jefe" || rol === "tecnico";
}

export function diasParaFecha(fecha: string | null | undefined): number | null {
  if (!fecha) return null;
  return Math.ceil((new Date(fecha + "T00:00:00").getTime() - Date.now()) / 86400_000);
}

export type EstadoFecha = "ok" | "proximo" | "vencido";

export function estadoFecha(fecha: string | null | undefined, alertaDiasAntes = 7): EstadoFecha {
  const d = diasParaFecha(fecha);
  if (d == null) return "ok";
  if (d < 0) return "vencido";
  if (d <= alertaDiasAntes) return "proximo";
  return "ok";
}

export const ESTADO_FECHA_COLOR: Record<EstadoFecha, string> = {
  ok: "text-emerald-600",
  proximo: "text-amber-600",
  vencido: "text-red-600 font-bold",
};

export const FRECUENCIA_LABEL: Record<string, string> = {
  diaria: "Diaria",
  semanal: "Semanal",
  quincenal: "Quincenal",
  mensual: "Mensual",
  bimestral: "Bimestral",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
};
