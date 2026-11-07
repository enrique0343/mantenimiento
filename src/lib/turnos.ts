// El turno que está corriendo, sin base de datos ni zona horaria del runtime.
// Lo usan el servidor y el celular: sin señal, el celular calcula igual.
export const TURNOS_DEFECTO = ["06:00", "14:00", "22:00"];

export interface TurnoInfo {
  /** Hora de inicio, "06:00" */
  turno: string;
  /** Fecha del turno en El Salvador, "AAAA-MM-DD". Puede ser ayer en la madrugada. */
  fecha: string;
  etiqueta: string;
}

/** Fecha y hora de El Salvador (UTC-6) sin depender del TZ del runtime. */
export function ahoraSV(ref?: Date): { fecha: string; hora: string; minutos: number } {
  const ms = (ref ? ref.getTime() : Date.now()) - 6 * 60 * 60 * 1000;
  const iso = new Date(ms).toISOString();
  const fecha = iso.slice(0, 10);
  const hora = iso.slice(11, 16);
  const [h, m] = hora.split(":").map(Number);
  return { fecha, hora, minutos: h * 60 + m };
}

const aMinutos = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

/** Resta un día a "AAAA-MM-DD" sin pasar por Date (que desfasa en UTC-6). */
export function diaAnterior(fecha: string): string {
  const ms = Date.parse(`${fecha.slice(0, 10)}T12:00:00Z`) - 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export const etiquetaTurno = (turno: string): string => {
  const m = aMinutos(turno);
  if (m < 12 * 60) return `Turno ${turno} · mañana`;
  if (m < 18 * 60) return `Turno ${turno} · tarde`;
  return `Turno ${turno} · noche`;
};

export function parsearTurnos(json: string | null | undefined): string[] {
  if (!json) return TURNOS_DEFECTO;
  try {
    const v = JSON.parse(json);
    const arr = Array.isArray(v) ? v.filter((x) => typeof x === "string" && /^\d{2}:\d{2}$/.test(x)) : [];
    return arr.length ? arr.sort((a, b) => aMinutos(a) - aMinutos(b)) : TURNOS_DEFECTO;
  } catch {
    return TURNOS_DEFECTO;
  }
}

/**
 * El turno que está corriendo ahora. Antes del primer turno del día, el turno
 * vigente es el último de ayer: la ronda de la noche se cierra de madrugada.
 */
export function turnoActual(turnos: string[], ref?: Date): TurnoInfo {
  const lista = turnos.length ? turnos : TURNOS_DEFECTO;
  const { fecha, minutos } = ahoraSV(ref);
  let elegido = lista[0];
  let fechaTurno = fecha;
  const anteriores = lista.filter((t) => aMinutos(t) <= minutos);
  if (anteriores.length) {
    elegido = anteriores[anteriores.length - 1];
  } else {
    elegido = lista[lista.length - 1];
    fechaTurno = diaAnterior(fecha);
  }
  return { turno: elegido, fecha: fechaTurno, etiqueta: etiquetaTurno(elegido) };
}

/** Lunes de la semana de esa fecha, para la revisión semanal. */
export function lunesDe(fecha: string): string {
  const d = new Date(`${fecha.slice(0, 10)}T12:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}

export function sumarDias(fecha: string, n: number): string {
  return new Date(Date.parse(`${fecha.slice(0, 10)}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Las líneas del SOP-MG-01 que piden abrir una orden si no cumplen (guía, líneas 1, 8, 9 y 10). */
export const LINEAS_CON_ORDEN = [1, 8, 9, 10];
