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

// Para cadenas SOLO-fecha ("YYYY-MM-DD") como proximaFecha, vencimiento, etc.
// NO las pasamos por `new Date()` + toLocaleDateString({timeZone}) porque el
// runtime las interpreta como medianoche UTC y al convertir a UTC-6 retrocede
// al día anterior 6:00 p.m. Aquí construimos la cadena directamente desde los
// componentes para no depender de la zona horaria del runtime ni del browser.
const MESES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
export function fmtFechaSolo(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  if (!y || !m || !day) return "—";
  return `${day} de ${MESES_ES[m - 1]} de ${y}`;
}
// Variante compacta dd/mm/yyyy para tablas.
export function fmtFechaSoloCompacta(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  if (!y || !m || !day) return "—";
  return `${String(day).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
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

// Milisegundos de una marca de tiempo guardada: el ISO con Z que escribe la app o
// el "AAAA-MM-DD HH:MM:SS" (UTC, sin zona) de CURRENT_TIMESTAMP. null si no se lee.
export function msDeMarca(d: string | null | undefined): number | null {
  const s = String(d ?? "").trim();
  if (!s) return null;
  const iso = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) ? s.replace(" ", "T") : `${s.replace(" ", "T")}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

// "06/05/2026 14:32" en hora de El Salvador (UTC-6, sin horario de verano), sin
// depender de la zona del runtime ni del navegador. Para registros de auditoría.
export function fmtMarcaSV(d: string | null | undefined): string {
  const ms = msDeMarca(d);
  if (ms === null) return "—";
  const iso = new Date(ms - 6 * 3_600_000).toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}`;
}

// "14:32" en hora de El Salvador. Acepta tanto el ISO con Z que escribe la app
// como el "AAAA-MM-DD HH:MM:SS" (UTC, sin zona) que pone SQLite con
// CURRENT_TIMESTAMP; sin normalizar, el segundo se interpretaría como local.
export function fmtHora(d: string | null | undefined): string {
  if (!d) return "—";
  const s = String(d).trim();
  if (!s) return "—";
  const iso = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) ? s.replace(" ", "T") : `${s.replace(" ", "T")}Z`;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleTimeString("es", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  });
}
