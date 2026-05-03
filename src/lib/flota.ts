// Helpers del módulo Flota: QR token, Haversine, formateadores, permisos

export const TIPOS_VEHICULO = [
  { value: "carro", label: "Carro / Sedan" },
  { value: "pickup", label: "Pick-up" },
  { value: "moto", label: "Motocicleta" },
  { value: "camion", label: "Camión" },
  { value: "microbus", label: "Microbús" },
  { value: "otro", label: "Otro" },
] as const;

export const COMBUSTIBLES = [
  { value: "gasolina", label: "Gasolina" },
  { value: "diesel", label: "Diesel" },
  { value: "electrico", label: "Eléctrico" },
  { value: "hibrido", label: "Híbrido" },
] as const;

export const ESTADO_VEHICULO_LABEL: Record<string, string> = {
  disponible: "Disponible",
  en_viaje: "En viaje",
  mantenimiento: "En mantenimiento",
  baja: "Dado de baja",
};

export const ESTADO_VEHICULO_COLOR: Record<string, string> = {
  disponible: "bg-emerald-100 text-emerald-700",
  en_viaje: "bg-amber-100 text-amber-700",
  mantenimiento: "bg-blue-100 text-blue-700",
  baja: "bg-slate-200 text-slate-600",
};

export const TIPO_DOCUMENTO_LABEL: Record<string, string> = {
  tarjeta_circulacion: "Tarjeta de circulación",
  seguro: "Seguro vehicular",
  revision_tecnica: "Revisión técnica",
  otro: "Otro",
};

// Token aleatorio de 16 chars (alfabeto sin caracteres confusos)
export function generateQrToken(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

// Distancia Haversine entre 2 puntos (lat/lng en grados) — kilómetros
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function fmtDuracion(min: number | null | undefined): string {
  if (!min || min < 1) return "-";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

export function fmtKm(km: number | null | undefined): string {
  if (km == null) return "-";
  return `${km.toLocaleString("es", { maximumFractionDigits: 1 })} km`;
}

export function diasParaVencer(fecha: string | null | undefined): number | null {
  if (!fecha) return null;
  const ms = new Date(fecha).getTime() - Date.now();
  return Math.floor(ms / 86400_000);
}

// ¿Cuál es la URL absoluta del QR (depende del host actual)?
export function vehicleQrUrl(host: string, token: string): string {
  return `${host}/vehiculo/qr/${token}`;
}

// Permisos
export type RolFlota = "admin" | "jefe" | "motorista";

export function puedeVerFlota(rol: string): boolean {
  return rol === "admin" || rol === "jefe" || rol === "motorista";
}

export function puedeAdministrarFlota(rol: string): boolean {
  return rol === "admin" || rol === "jefe";
}
