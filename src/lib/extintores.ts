// Helpers del módulo Extintores: tipos de agente, calculo de fechas, estado de vencimiento.

export const TIPOS_AGENTE = [
  { value: "pqs", label: "PQS / ABC (polvo químico seco)", color: "bg-amber-100 text-amber-700" },
  { value: "co2", label: "CO₂ (dióxido de carbono)", color: "bg-slate-100 text-slate-700" },
  { value: "agua", label: "Agua a presión", color: "bg-blue-100 text-blue-700" },
  { value: "espuma", label: "Espuma (AFFF)", color: "bg-cyan-100 text-cyan-700" },
  { value: "k", label: "Clase K (cocinas)", color: "bg-orange-100 text-orange-700" },
  { value: "d", label: "Clase D (metales)", color: "bg-purple-100 text-purple-700" },
] as const;

export const TIPO_AGENTE_LABEL: Record<string, string> =
  Object.fromEntries(TIPOS_AGENTE.map((t) => [t.value, t.label]));
export const TIPO_AGENTE_COLOR: Record<string, string> =
  Object.fromEntries(TIPOS_AGENTE.map((t) => [t.value, t.color]));

export const TIPO_EVENTO_LABEL: Record<string, string> = {
  inspeccion: "Inspección visual",
  recarga: "Recarga",
  prueba_hidrostatica: "Prueba hidrostática",
  reemplazo: "Reemplazo",
  baja: "Baja",
  otro: "Otro",
};

export const TIPO_EVENTO_ICONO: Record<string, string> = {
  inspeccion: "👁",
  recarga: "🔋",
  prueba_hidrostatica: "💧",
  reemplazo: "🔄",
  baja: "🚫",
  otro: "•",
};

export const ZONAS_SUGERIDAS = [
  "Cocina",
  "Oficina",
  "Bodega",
  "Tecnología / Servidores",
  "Sala eléctrica",
  "Pasillo",
  "Exterior",
  "Producción",
  "Recepción",
  "Otro",
];

export const ESTADO_EXT_LABEL: Record<string, string> = {
  activo: "Activo",
  mantenimiento: "En mantenimiento",
  baja: "Dado de baja",
};

export const ESTADO_EXT_COLOR: Record<string, string> = {
  activo: "bg-emerald-100 text-emerald-700",
  mantenimiento: "bg-amber-100 text-amber-700",
  baja: "bg-slate-200 text-slate-600",
};

// Suma X días a una fecha YYYY-MM-DD y devuelve YYYY-MM-DD
export function addDays(fecha: string, dias: number): string {
  const d = new Date(fecha);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function addMonths(fecha: string, meses: number): string {
  const d = new Date(fecha);
  d.setMonth(d.getMonth() + meses);
  return d.toISOString().slice(0, 10);
}

export function addYears(fecha: string, anios: number): string {
  const d = new Date(fecha);
  d.setFullYear(d.getFullYear() + anios);
  return d.toISOString().slice(0, 10);
}

export type EstadoVencimiento = "ok" | "proximo" | "vencido" | "n/a";

export function estadoVencimiento(fecha: string | null | undefined, diasUmbral = 30): EstadoVencimiento {
  if (!fecha) return "n/a";
  const ms = new Date(fecha + "T00:00:00").getTime() - Date.now();
  const dias = Math.ceil(ms / 86400_000);
  if (dias < 0) return "vencido";
  if (dias <= diasUmbral) return "proximo";
  return "ok";
}

export const ESTADO_VENC_COLOR: Record<EstadoVencimiento, string> = {
  ok: "text-emerald-600",
  proximo: "text-amber-600",
  vencido: "text-red-600 font-bold",
  "n/a": "text-slate-400",
};

export function diasParaFecha(fecha: string | null | undefined): number | null {
  if (!fecha) return null;
  return Math.ceil((new Date(fecha + "T00:00:00").getTime() - Date.now()) / 86400_000);
}

// Genera token aleatorio para el QR (16 caracteres legibles)
export function generateExtintorQrToken(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

// Calcula la siguiente fecha programada según el tipo de evento + frecuencia del extintor
export function calcularProximaFecha(
  tipo: "inspeccion" | "recarga" | "prueba_hidrostatica",
  fechaBase: string,
  frecuencias: { diasInspeccion: number; mesesRecarga: number; aniosPrueba: number }
): string {
  if (tipo === "inspeccion") return addDays(fechaBase, frecuencias.diasInspeccion);
  if (tipo === "recarga") return addMonths(fechaBase, frecuencias.mesesRecarga);
  return addYears(fechaBase, frecuencias.aniosPrueba);
}

// Permisos
export function puedeVerSeguridad(rol: string): boolean {
  return rol === "admin" || rol === "jefe" || rol === "tecnico" || rol === "solicitante" || rol === "visualizador";
}

export function puedeAdministrarSeguridad(rol: string): boolean {
  return rol === "admin" || rol === "jefe" || rol === "tecnico";
}
