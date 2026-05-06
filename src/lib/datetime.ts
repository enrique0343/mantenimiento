// Helpers de formateo de fechas con zona horaria fija (El Salvador, UTC-6).
// Cloudflare Workers ejecuta en UTC, así que sin esto los correos generados
// del servidor mostrarían 6 horas adelante.

export const TZ = "America/El_Salvador";

function toDate(d: Date | string | null | undefined): Date | null {
  if (!d) return null;
  return typeof d === "string" ? new Date(d) : d;
}

// "6 de mayo de 2026, 2:32 p.m."
export function fmtFechaLarga(d: Date | string | null | undefined): string {
  const date = toDate(d);
  if (!date) return "—";
  return date.toLocaleString("es", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  });
}

// "06/05/2026, 14:32"
export function fmtFecha(d: Date | string | null | undefined): string {
  const date = toDate(d);
  if (!date) return "—";
  return date.toLocaleString("es", { timeZone: TZ });
}

// "06/05/2026"
export function fmtFechaSimple(d: Date | string | null | undefined): string {
  const date = toDate(d);
  if (!date) return "—";
  return date.toLocaleDateString("es", { timeZone: TZ });
}

// Para Telegram y otros donde queremos un formato compacto pero legible.
export function fmtFechaCompacta(d: Date | string | null | undefined): string {
  const date = toDate(d);
  if (!date) return "—";
  return date.toLocaleString("es", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });
}
