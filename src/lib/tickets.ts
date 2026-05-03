// SLA por defecto en horas (hospital / contexto critico SV)
export const SLA_HORAS: Record<"baja" | "media" | "alta" | "urgente", number> = {
  urgente: 2,
  alta: 8,
  media: 24,
  baja: 72,
};

export const ESTADOS_TICKET = ["nuevo", "asignado", "en_proceso", "resuelto", "cerrado", "descartado"] as const;
export type EstadoTicket = (typeof ESTADOS_TICKET)[number];

export const ESTADO_TICKET_LABEL: Record<EstadoTicket, string> = {
  nuevo: "Nuevo",
  asignado: "Asignado",
  en_proceso: "En proceso",
  resuelto: "Resuelto",
  cerrado: "Cerrado",
  descartado: "Descartado",
};

export const ESTADO_TICKET_COLOR: Record<EstadoTicket, string> = {
  nuevo: "bg-blue-100 text-blue-700",
  asignado: "bg-indigo-100 text-indigo-700",
  en_proceso: "bg-amber-100 text-amber-700",
  resuelto: "bg-emerald-100 text-emerald-700",
  cerrado: "bg-slate-200 text-slate-700",
  descartado: "bg-red-50 text-red-600",
};

export function generateTrackingToken(): string {
  // 12 caracteres alfanumericos
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export function calcularVencimientoSla(prioridad: keyof typeof SLA_HORAS, desde = new Date()): {
  slaHoras: number;
  vencimiento: string;
} {
  const slaHoras = SLA_HORAS[prioridad];
  const v = new Date(desde);
  v.setHours(v.getHours() + slaHoras);
  return { slaHoras, vencimiento: v.toISOString() };
}

export function slaStatus(vencimiento: string | null, estado: EstadoTicket): "ok" | "warning" | "vencido" | "n/a" {
  if (!vencimiento || estado === "resuelto" || estado === "cerrado" || estado === "descartado") return "n/a";
  const now = Date.now();
  const v = new Date(vencimiento).getTime();
  const diffH = (v - now) / 3600000;
  if (diffH < 0) return "vencido";
  if (diffH < 2) return "warning";
  return "ok";
}
