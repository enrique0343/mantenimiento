// Helpers para contratos de mantenimiento

export type EstadoContrato = "vigente" | "por_vencer" | "vencido" | "renovado" | "cancelado";

export const ESTADO_CONTRATO_LABEL: Record<EstadoContrato, string> = {
  vigente: "Vigente",
  por_vencer: "Por vencer",
  vencido: "Vencido",
  renovado: "Renovado",
  cancelado: "Cancelado",
};

export const ESTADO_CONTRATO_COLOR: Record<EstadoContrato, string> = {
  vigente: "bg-emerald-100 text-emerald-700",
  por_vencer: "bg-amber-100 text-amber-700",
  vencido: "bg-red-100 text-red-700",
  renovado: "bg-slate-200 text-slate-600",
  cancelado: "bg-slate-100 text-slate-500",
};

export const TIPO_CONTRATO_LABEL: Record<string, string> = {
  preventivo: "Preventivo",
  correctivo: "Correctivo",
  integral: "Integral",
  garantia: "Garantía",
};

export const PERIODICIDAD_LABEL: Record<string, string> = {
  mensual: "Mensual",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
  unico: "Pago único",
};

// Días hasta el fin del contrato (negativo si ya venció)
export function diasParaVencer(fechaFin: string): number {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const fin = new Date(fechaFin); fin.setHours(0, 0, 0, 0);
  return Math.floor((fin.getTime() - hoy.getTime()) / 86400_000);
}

// Estado calculado en función de la fecha fin (independiente del estado almacenado).
// Útil para mostrar urgencia en UI sin depender del cron.
export function estadoVigencia(fechaFin: string): "vigente" | "por_vencer" | "vencido" {
  const d = diasParaVencer(fechaFin);
  if (d < 0) return "vencido";
  if (d <= 90) return "por_vencer";
  return "vigente";
}

export function puedeGestionarContratos(rol: string): boolean {
  return rol === "admin" || rol === "jefe";
}

export function puedeVerContratos(rol: string): boolean {
  return rol === "admin" || rol === "jefe" || rol === "tecnico";
}
