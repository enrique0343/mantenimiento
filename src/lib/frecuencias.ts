export type Frecuencia =
  | "turno"
  | "diaria"
  | "semanal"
  | "quincenal"
  | "mensual"
  | "bimestral"
  | "cuatrimestral"
  | "trimestral"
  | "semestral"
  | "anual";

export const FRECUENCIAS: { value: Frecuencia; label: string; dias: number }[] = [
  { value: "turno", label: "Por turno", dias: 1 },
  { value: "diaria", label: "Diaria", dias: 1 },
  { value: "semanal", label: "Semanal", dias: 7 },
  { value: "quincenal", label: "Quincenal (15 dias)", dias: 15 },
  { value: "mensual", label: "Mensual", dias: 30 },
  { value: "bimestral", label: "Bimestral (2 meses)", dias: 60 },
  { value: "trimestral", label: "Trimestral (3 meses)", dias: 90 },
  { value: "cuatrimestral", label: "Cuatrimestral (3 veces al año)", dias: 120 },
  { value: "semestral", label: "Semestral (6 meses)", dias: 180 },
  { value: "anual", label: "Anual", dias: 365 },
];

export function siguienteFecha(desde: string | Date, frecuencia: Frecuencia): string {
  const base = typeof desde === "string" ? new Date(desde) : desde;
  const next = new Date(base);
  switch (frecuencia) {
    case "turno":
    case "diaria":
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    case "semanal":
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case "quincenal":
      next.setUTCDate(next.getUTCDate() + 15);
      break;
    case "mensual":
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
    case "bimestral":
      next.setUTCMonth(next.getUTCMonth() + 2);
      break;
    case "trimestral":
      next.setUTCMonth(next.getUTCMonth() + 3);
      break;
    case "cuatrimestral":
      next.setUTCMonth(next.getUTCMonth() + 4);
      break;
    case "semestral":
      next.setUTCMonth(next.getUTCMonth() + 6);
      break;
    case "anual":
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
  }
  return next.toISOString().slice(0, 10);
}

// ─── Fase 59 · plan anual, calendario y Gantt ────────────────────────────────
// `Frecuencia`, `FRECUENCIAS` y `siguienteFecha` no cambian: los usan el cierre de
// órdenes y los registros viejos. Las rutinas de equipo ofrecen y aceptan
// FRECUENCIAS_RUTINA_EQUIPO de biomedico.ts (sin «Por turno»). Este módulo no
// importa biomedico.ts: sus fechas son privadas y en UTC.

/** Respuesta 400 de la API de rutinas cuando llega «turno». */
export const MENSAJE_FRECUENCIA_TURNO =
  "«Por turno» no se usa en rutinas de equipo. Elige «Diaria» o registra la revisión en la ronda de turno.";

const ABREVIATURA: Record<string, string> = {
  turno: "T", diaria: "D", semanal: "S", quincenal: "Q", mensual: "M",
  bimestral: "2M", trimestral: "3M", cuatrimestral: "4M", semestral: "6M", anual: "A",
};

/** Abreviatura del calendario y del Gantt: 'cuatrimestral' → '4M'; desconocida → '?'. */
export function abrevFrecuencia(f: string | null | undefined): string {
  return (f && ABREVIATURA[f]) || "?";
}

/** Paso de cada frecuencia: días fijos o meses de calendario. */
const PASO: Record<string, { dias: number } | { meses: number }> = {
  turno: { dias: 1 }, diaria: { dias: 1 }, semanal: { dias: 7 }, quincenal: { dias: 15 },
  mensual: { meses: 1 }, bimestral: { meses: 2 }, trimestral: { meses: 3 },
  cuatrimestral: { meses: 4 }, semestral: { meses: 6 }, anual: { meses: 12 },
};

const dos = (n: number) => String(n).padStart(2, "0");
const finDeMes = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();

/** [año, mes, día] de una fecha 'AAAA-MM-DD' real; si no, null. */
function partesFecha(fecha: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) return null;
  const a = Number(m[1]), mes = Number(m[2]), d = Number(m[3]);
  if (mes < 1 || mes > 12 || d < 1 || d > finDeMes(a, mes)) return null;
  return [a, mes, d];
}
const masDias = (p: [number, number, number], n: number) =>
  new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
function masMeses(p: [number, number, number], n: number): string {
  const total = p[0] * 12 + (p[1] - 1) + n;
  const anio = Math.floor(total / 12), mes = (total % 12) + 1;
  return `${anio}-${dos(mes)}-${dos(Math.min(p[2], finDeMes(anio, mes)))}`;
}

/**
 * Fechas de una rutina dentro de [desde, hasta): ancla + k·paso con k ≥ 0. No inventa
 * ejecuciones antes de la ancla (la próxima fecha registrada). Los meses se cuentan
 * desde la ancla y el día se recorta al fin de mes (31/01 mensual → 28/02, 31/03…):
 * no se encadena siguienteFecha, que corre el día. Ancla, desde o hasta no válidas,
 * o frecuencia desconocida → []. Como mucho `max` fechas y 5000 vueltas.
 */
export function proyectarFechas(ancla: string, frecuencia: string, desde: string, hasta: string, max = 400): string[] {
  const p = partesFecha(ancla);
  const paso = PASO[frecuencia];
  const d = partesFecha(desde);
  if (!p || !paso || !d || !partesFecha(hasta)) return [];
  // Saltar cerca de `desde` sin recorrer cada paso (una diaria de hace años).
  let k = 0;
  if (ancla < desde) {
    if ("dias" in paso) {
      const dias = Math.round((Date.UTC(d[0], d[1] - 1, d[2]) - Date.UTC(p[0], p[1] - 1, p[2])) / 86_400_000);
      k = Math.max(0, Math.floor(dias / paso.dias));
    } else {
      const meses = (d[0] - p[0]) * 12 + (d[1] - p[1]);
      k = Math.max(0, Math.floor(meses / paso.meses) - 1);
    }
  }
  const fechas: string[] = [];
  for (let vueltas = 0; vueltas < 5000 && fechas.length < max; vueltas++, k++) {
    const f = "dias" in paso ? masDias(p, k * paso.dias) : masMeses(p, k * paso.meses);
    if (f >= hasta) break;
    if (f >= desde) fechas.push(f);
  }
  return fechas;
}
