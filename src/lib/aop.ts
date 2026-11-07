// ─── AOP · motor de la condición anormal (capítulo 07 de GO-GUI-011-2026) ─────
// El AOP es el espacio entre "lo anoté en la ronda" y "es una emergencia":
// una lectura fuera de rango con UN RELOJ CORRIENDO. Cada AOP define el rango
// normal y el de alerta de un atributo (humedad, presión, temperatura, nivel);
// cuando hay sensor la lectura abre el episodio sola, cuando no lo hay lo abre
// el técnico desde la ronda. El AOP fija el tiempo máximo antes de escalar y el
// umbral de paso al EOP.
//
// Los AOP NO ocupan filas del plan de mantenimiento: viven como umbrales sobre
// los activos (aop_umbrales) y cada desviación es un episodio (aop_eventos).
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { getDb } from "./db";
import { limitesPeriodo } from "./metricas";
import {
  aopEventoAcciones,
  aopEventos,
  aopUmbrales,
  metricasSala,
  ubicaciones,
  type AopEvento,
} from "./schema";

type Db = ReturnType<typeof getDb>;

// ── Permisos ────────────────────────────────────────────────────────────────
// Alineado con la entrada "Desviaciones (AOP)" del nav de Layout.astro, que se
// muestra con isOperativo (admin | jefe | tecnico). Si alguna vez se agrega
// `visualizador` a esa linea del nav, hay que agregarlo tambien aqui.
export const puedeVerAop = (rol: string) =>
  ["admin", "jefe", "tecnico"].includes(rol);

/** Abrir desviaciones, marcar acciones, normalizar, escalar. */
export const puedeOperarAop = (rol: string) =>
  ["admin", "jefe", "tecnico"].includes(rol);

/** Configurar los umbrales que viven sobre los activos. */
export const puedeAdministrarAop = (rol: string) =>
  ["admin", "jefe"].includes(rol);

// ── Estados del episodio ────────────────────────────────────────────────────
export type EstadoAop = "abierto" | "en_correccion" | "escalado" | "paso_a_eop" | "cerrado";

/** Estados en los que el reloj sigue corriendo. */
export const ESTADOS_AOP_ABIERTOS: EstadoAop[] = ["abierto", "en_correccion", "escalado"];

export const ESTADO_AOP: Record<EstadoAop, { label: string; badge: string; punto: string; descripcion: string }> = {
  abierto: {
    label: "Por actuar",
    badge: "bg-amber-100 text-amber-700",
    punto: "bg-amber-500",
    descripcion: "Desviación detectada; nadie ha registrado todavía una acción inmediata.",
  },
  en_correccion: {
    label: "En corrección",
    badge: "bg-sky-100 text-sky-700",
    punto: "bg-sky-500",
    descripcion: "Alguien está ejecutando las acciones inmediatas del AOP.",
  },
  escalado: {
    label: "Escalado",
    badge: "bg-red-100 text-red-700",
    punto: "bg-red-500",
    descripcion: "No se restableció en el tiempo tolerable; avisado el nivel superior.",
  },
  paso_a_eop: {
    label: "Pasó a EOP",
    badge: "bg-purple-100 text-purple-700",
    punto: "bg-purple-500",
    descripcion: "Se alcanzó el criterio de emergencia; lo conduce el EOP.",
  },
  cerrado: {
    label: "Normalizado",
    badge: "bg-emerald-100 text-emerald-700",
    punto: "bg-emerald-500",
    descripcion: "Relectura en rango y registro completo.",
  },
};

// ── El reloj ────────────────────────────────────────────────────────────────
export type EstadoReloj = "ok" | "por_vencer" | "vencido_actuar" | "vencido_escalar";

/** Minutos antes del vencimiento en los que el tablero ya avisa. */
export const MINUTOS_POR_VENCER = 30;

export const RELOJ: Record<EstadoReloj, { label: string; badge: string; texto: string; borde: string }> = {
  ok: {
    label: "En tiempo",
    badge: "bg-slate-100 text-slate-600",
    texto: "text-slate-700",
    borde: "border-slate-200",
  },
  por_vencer: {
    label: "Por vencer",
    badge: "bg-amber-100 text-amber-700",
    texto: "text-amber-600",
    borde: "border-amber-300",
  },
  vencido_actuar: {
    label: "Vencido para actuar",
    badge: "bg-orange-100 text-orange-700",
    texto: "text-orange-600",
    borde: "border-orange-400",
  },
  vencido_escalar: {
    label: "Vencido para escalar",
    badge: "bg-red-100 text-red-700",
    texto: "text-red-600",
    borde: "border-red-400",
  },
};

// ── Tiempo ──────────────────────────────────────────────────────────────────
// Las marcas de tiempo se guardan como texto. Las que escribe la app son ISO
// con Z; las que pone SQLite con CURRENT_TIMESTAMP son "AAAA-MM-DD HH:MM:SS"
// en UTC y sin zona. Normalizamos para no depender del parser del runtime.
export function msDe(valor: string | null | undefined): number | null {
  if (!valor) return null;
  const s = valor.trim();
  if (!s) return null;
  // Solo-fecha: el runtime ya la interpreta como medianoche UTC; pegarle una Z
  // la vuelve invalida.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const solo = Date.parse(s);
    return Number.isFinite(solo) ? solo : null;
  }
  const iso = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) ? s.replace(" ", "T") : `${s.replace(" ", "T")}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export const ahoraISO = () => new Date().toISOString();

export function sumarMinutos(desde: string, minutos: number): string | null {
  const ms = msDe(desde);
  if (ms == null) return null;
  return new Date(ms + minutos * 60_000).toISOString();
}

/**
 * Normaliza lo que manda el navegador a ISO. Un <input type="datetime-local">
 * manda "AAAA-MM-DDTHH:MM" sin zona: lo tomamos como hora de El Salvador
 * (UTC-6), igual que el resto del sistema, y nunca como UTC.
 */
export function normalizarMomento(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const s = valor.trim().replace(" ", "T");
  if (!s) return null;
  const base = s.length === 10 ? `${s}T00:00:00` : s.length === 16 ? `${s}:00` : s;
  const conZona = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${base}-06:00`;
  const ms = Date.parse(conZona);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Minutos transcurridos de `a` a `b` (negativo si `b` es anterior). */
export function minutosEntre(a: string, b: string): number {
  const ia = msDe(a);
  const ib = msDe(b);
  if (ia == null || ib == null) return 0;
  return Math.round((ib - ia) / 60_000);
}

/** "2 h 15 min" · "45 min" · "1 d 3 h" */
export function fmtDuracion(minutos: number | null | undefined): string {
  if (minutos == null || !Number.isFinite(minutos)) return "—";
  const m = Math.abs(Math.round(minutos));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const resto = m % 60;
  if (h < 24) return resto ? `${h} h ${resto} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const hr = h % 24;
  return hr ? `${d} d ${hr} h` : `${d} d`;
}

/** Cuenta regresiva legible: "faltan 1 h 20 min" / "vencido hace 35 min". */
export function fmtCuentaRegresiva(minutosRestantes: number | null | undefined): string {
  if (minutosRestantes == null) return "sin plazo definido";
  return minutosRestantes >= 0
    ? `faltan ${fmtDuracion(minutosRestantes)}`
    : `vencido hace ${fmtDuracion(minutosRestantes)}`;
}

// ── 1. Evaluar la lectura ───────────────────────────────────────────────────
export type Banda = "normal" | "alerta" | "critico";

export interface BandasVariable {
  minCritico?: number | null;
  minWarning?: number | null;
  maxWarning?: number | null;
  maxCritico?: number | null;
}

export interface BandasUmbral {
  minAlerta?: number | null;
  maxAlerta?: number | null;
}

export interface Lectura {
  fuera: boolean;
  banda: Banda;
  /** Banda de alerta efectiva, ya resuelta la herencia. */
  minAlerta: number | null;
  maxAlerta: number | null;
  minCritico: number | null;
  maxCritico: number | null;
}

/**
 * El umbral del AOP SOBRESCRIBE las bandas de la variable sólo si no son null;
 * si son null, HEREDA de la variable. La banda crítica siempre viene de la
 * variable (el umbral del AOP sólo declara alerta).
 */
export function evaluarLectura(
  variable: BandasVariable | null | undefined,
  valor: number,
  umbral?: BandasUmbral | null,
): Lectura {
  const minAlerta = umbral?.minAlerta ?? variable?.minWarning ?? null;
  const maxAlerta = umbral?.maxAlerta ?? variable?.maxWarning ?? null;
  const minCritico = variable?.minCritico ?? null;
  const maxCritico = variable?.maxCritico ?? null;

  let banda: Banda = "normal";
  if ((minCritico != null && valor < minCritico) || (maxCritico != null && valor > maxCritico)) {
    banda = "critico";
  } else if ((minAlerta != null && valor < minAlerta) || (maxAlerta != null && valor > maxAlerta)) {
    banda = "alerta";
  }
  return { fuera: banda !== "normal", banda, minAlerta, maxAlerta, minCritico, maxCritico };
}

export const BANDA: Record<Banda, { label: string; badge: string }> = {
  normal: { label: "En rango", badge: "bg-emerald-100 text-emerald-700" },
  alerta: { label: "Fuera de rango", badge: "bg-amber-100 text-amber-700" },
  critico: { label: "Umbral crítico", badge: "bg-red-100 text-red-700" },
};

/** "fuera de 35–60 %" para mostrar el rango que se violó. */
export function fmtRango(min: number | null, max: number | null, unidad?: string | null): string {
  const u = unidad ? ` ${unidad}` : "";
  if (min != null && max != null) return `${min}–${max}${u}`;
  if (min != null) return `≥ ${min}${u}`;
  if (max != null) return `≤ ${max}${u}`;
  return "sin rango definido";
}

// ── 2. Abrir el episodio ────────────────────────────────────────────────────
export interface AbrirEventoInput {
  procedimientoId?: number | null;
  umbralId?: number | null;
  variableId?: number | null;
  activoId?: number | null;
  ubicacionId?: number | null;
  sucursalId?: number | null;
  valorDetectado?: number | null;
  unidad?: string | null;
  /** ISO. Si no viene, ahora. */
  detectadoEn?: string | null;
  detectadoPor?: number | null;
  origen?: "ronda" | "sensor" | "manual";
  medicionId?: number | null;
  ordenId?: number | null;
  /** Sobrescriben los minutos del umbral si se pasan. */
  minutosParaActuar?: number | null;
  minutosParaEscalar?: number | null;
  /** La parada de la ronda que lo abrió: cada parada lleva su propio episodio. */
  rondaPuntoId?: number | null;
}

/**
 * Crea el episodio calculando el reloj:
 *   actuarAntesDe  = detectadoEn + minutosParaActuar
 *   escalarAntesDe = detectadoEn + minutosParaEscalar
 * Si ya hay un episodio abierto para la misma variable + ubicación NO duplica:
 * devuelve el existente (`yaExistia: true`). Una desviación que persiste es un
 * solo episodio con sus horas fuera de rango, no veinte tarjetas.
 */
export async function abrirEvento(
  db: Db,
  input: AbrirEventoInput,
): Promise<{ evento: AopEvento; yaExistia: boolean }> {
  let umbral: typeof aopUmbrales.$inferSelect | null = null;
  if (input.umbralId) {
    const [u] = await db.select().from(aopUmbrales).where(eq(aopUmbrales.id, input.umbralId)).limit(1);
    umbral = u ?? null;
  }

  const procedimientoId = input.procedimientoId ?? umbral?.procedimientoId ?? null;
  const variableId = input.variableId ?? umbral?.variableId ?? null;
  const activoId = input.activoId ?? umbral?.activoId ?? null;
  const ubicacionId = input.ubicacionId ?? umbral?.ubicacionId ?? null;

  // ── Antiduplicado ──
  if (variableId != null || procedimientoId != null) {
    const cond = [inArray(aopEventos.estado, ESTADOS_AOP_ABIERTOS)];
    if (variableId != null) cond.push(eq(aopEventos.variableId, variableId));
    else cond.push(eq(aopEventos.procedimientoId, procedimientoId!));
    // El equipo manda sobre la ubicación: dos unidades en la misma sala son dos desviaciones.
    if (activoId != null) cond.push(eq(aopEventos.activoId, activoId));
    else if (ubicacionId != null) cond.push(eq(aopEventos.ubicacionId, ubicacionId));
    else if (input.sucursalId != null) cond.push(eq(aopEventos.sucursalId, input.sucursalId));
    if (input.rondaPuntoId != null) {
      cond.push(eq(aopEventos.rondaPuntoId, input.rondaPuntoId));
      if (input.sucursalId != null) cond.push(eq(aopEventos.sucursalId, input.sucursalId));
    }
    const [abierto] = await db
      .select()
      .from(aopEventos)
      .where(and(...cond))
      .orderBy(desc(aopEventos.detectadoEn))
      .limit(1);
    if (abierto) return { evento: abierto, yaExistia: true };
  }

  const detectadoEn = input.detectadoEn || ahoraISO();

  // La sede se deduce de la sala cuando no la mandan.
  let sucursalId = input.sucursalId ?? null;
  if (sucursalId == null && ubicacionId != null) {
    const [u] = await db
      .select({ sucursalId: ubicaciones.sucursalId })
      .from(ubicaciones)
      .where(eq(ubicaciones.id, ubicacionId))
      .limit(1);
    sucursalId = u?.sucursalId ?? null;
  }

  const minActuar = input.minutosParaActuar ?? umbral?.minutosParaActuar ?? null;
  const minEscalar = input.minutosParaEscalar ?? umbral?.minutosParaEscalar ?? null;

  const [evento] = await db
    .insert(aopEventos)
    .values({
      procedimientoId,
      umbralId: umbral?.id ?? input.umbralId ?? null,
      variableId,
      activoId,
      ubicacionId,
      sucursalId,
      valorDetectado: input.valorDetectado ?? null,
      unidad: input.unidad ?? null,
      detectadoEn,
      detectadoPor: input.detectadoPor ?? null,
      origen: input.origen ?? "ronda",
      medicionId: input.medicionId ?? null,
      ordenId: input.ordenId ?? null,
      rondaPuntoId: input.rondaPuntoId ?? null,
      estado: "abierto",
      actuarAntesDe: minActuar != null ? sumarMinutos(detectadoEn, minActuar) : null,
      escalarAntesDe: minEscalar != null ? sumarMinutos(detectadoEn, minEscalar) : null,
    })
    .returning();

  return { evento, yaExistia: false };
}

/** Deja constancia de una acción inmediata con su hora. */
export async function registrarAccion(
  db: Db,
  eventoId: number,
  accion: string,
  resultado: string | null,
  usuarioId: number | null,
): Promise<typeof aopEventoAcciones.$inferSelect> {
  const [row] = await db
    .insert(aopEventoAcciones)
    .values({ eventoId, accion, resultado, ejecutadoPor: usuarioId, ejecutadoEn: ahoraISO() })
    .returning();
  return row;
}

// ── 3. Cerrar el episodio ───────────────────────────────────────────────────
/**
 * Normaliza: registra el valor final, calcula los minutos fuera de rango entre
 * detectadoEn y ahora (de ahí sale el indicador 8) y cierra.
 */
export async function cerrarEvento(
  db: Db,
  id: number,
  valorFinal: number | null,
  usuarioId: number | null,
  opts?: { evaluacionRiesgo?: string | null; ahora?: string },
): Promise<AopEvento | null> {
  const [actual] = await db.select().from(aopEventos).where(eq(aopEventos.id, id)).limit(1);
  if (!actual) return null;

  const ahora = opts?.ahora || ahoraISO();
  const minutosFuera = Math.max(0, minutosEntre(actual.detectadoEn, ahora));

  const [row] = await db
    .update(aopEventos)
    .set({
      estado: "cerrado",
      valorFinal,
      normalizadoEn: ahora,
      minutosFuera,
      cerradoPor: usuarioId,
      cerradoEn: ahora,
      ...(opts?.evaluacionRiesgo !== undefined ? { evaluacionRiesgo: opts.evaluacionRiesgo } : {}),
    })
    .where(eq(aopEventos.id, id))
    .returning();
  return row ?? null;
}

// ── 4. El reloj del tablero ─────────────────────────────────────────────────
export type EventoReloj = Pick<AopEvento, "estado" | "detectadoEn" | "actuarAntesDe" | "escalarAntesDe">;

/**
 * Lo que pinta el tablero. Un episodio cerrado o pasado a EOP ya no corre.
 */
export function estadoReloj(evento: EventoReloj, ahoraISO?: string): EstadoReloj {
  if (evento.estado === "cerrado" || evento.estado === "paso_a_eop") return "ok";
  const ahora = msDe(ahoraISO) ?? Date.now();
  const escalar = msDe(evento.escalarAntesDe);
  const actuar = msDe(evento.actuarAntesDe);

  if (escalar != null && ahora >= escalar) return "vencido_escalar";
  if (actuar != null && ahora >= actuar) return "vencido_actuar";

  const proximo = [actuar, escalar].filter((v): v is number => v != null).sort((a, b) => a - b)[0];
  if (proximo != null && proximo - ahora <= MINUTOS_POR_VENCER * 60_000) return "por_vencer";
  return "ok";
}

export interface Cronometro {
  reloj: EstadoReloj;
  /** Minutos que faltan (negativo = vencido). null si no hay plazo. */
  minutosParaActuar: number | null;
  minutosParaEscalar: number | null;
  /** Minutos desde que se detectó. */
  minutosAbierto: number;
  /** Menor es más urgente: ordena el tablero. */
  urgencia: number;
}

export function cronometro(evento: EventoReloj, ref?: string): Cronometro {
  const ahora = ref || ahoraISO();
  const ahoraMs = msDe(ahora) ?? Date.now();
  const actuar = msDe(evento.actuarAntesDe);
  const escalar = msDe(evento.escalarAntesDe);
  const minutosParaActuar = actuar != null ? Math.round((actuar - ahoraMs) / 60_000) : null;
  const minutosParaEscalar = escalar != null ? Math.round((escalar - ahoraMs) / 60_000) : null;
  const reloj = estadoReloj(evento, ahora);
  const pendiente = [minutosParaEscalar, minutosParaActuar].filter((v): v is number => v != null);
  // Sin plazo definido va al final (999999) pero nunca antes que un vencido.
  const urgencia = pendiente.length ? Math.min(...pendiente) : 999_999;
  return {
    reloj,
    minutosParaActuar,
    minutosParaEscalar,
    minutosAbierto: Math.max(0, minutosEntre(evento.detectadoEn, ahora)),
    urgencia,
  };
}

/** Ordena por urgencia del reloj: lo más vencido primero. */
export function ordenarPorUrgencia<T extends EventoReloj>(eventos: T[], ref?: string): Array<T & { cron: Cronometro }> {
  return eventos
    .map((e) => ({ ...e, cron: cronometro(e, ref) }))
    .sort((a, b) => a.cron.urgencia - b.cron.urgencia || b.cron.minutosAbierto - a.cron.minutosAbierto);
}

// ── 5. Indicador 8 · horas fuera de rango por sala ──────────────────────────
export interface FilaIndicador8 {
  ubicacionId: number | null;
  sala: string;
  sucursalId: number | null;
  horasFueraRango: number;
  desviaciones: number;
  desviacionesEscaladas: number;
}

/**
 * INDICADOR 8 del volumen: horas fuera de rango por sala en un período
 * 'AAAA-MM'. Un episodio aún abierto cuenta desde que se detectó hasta ahora
 * (recortado al fin del período): la desviación que sigue corriendo ya pesa.
 */
export async function horasFueraRangoPorSala(db: Db, periodo: string): Promise<FilaIndicador8[]> {
  const { inicio, fin } = limitesPeriodo(periodo);

  const rows = await db
    .select({ e: aopEventos, salaNombre: ubicaciones.nombre })
    .from(aopEventos)
    .leftJoin(ubicaciones, eq(ubicaciones.id, aopEventos.ubicacionId))
    .where(and(gte(aopEventos.detectadoEn, inicio), lt(aopEventos.detectadoEn, fin)))
    .orderBy(asc(aopEventos.detectadoEn));

  const topeMs = Math.min(Date.now(), msDe(fin) ?? Date.now());
  const porSala = new Map<string, FilaIndicador8>();

  for (const { e, salaNombre } of rows) {
    const clave = String(e.ubicacionId ?? "sin-sala");
    const fila = porSala.get(clave) ?? {
      ubicacionId: e.ubicacionId ?? null,
      sala: salaNombre ?? "Sin sala asignada",
      sucursalId: e.sucursalId ?? null,
      horasFueraRango: 0,
      desviaciones: 0,
      desviacionesEscaladas: 0,
    };

    let minutos = e.minutosFuera ?? null;
    if (minutos == null) {
      const cierre = e.normalizadoEn || e.cerradoEn || null;
      if (cierre) {
        minutos = Math.max(0, minutosEntre(e.detectadoEn, cierre));
      } else {
        const ini = msDe(e.detectadoEn);
        minutos = ini != null ? Math.max(0, Math.round((topeMs - ini) / 60_000)) : 0;
      }
    }

    fila.horasFueraRango += minutos / 60;
    fila.desviaciones += 1;
    if (e.estado === "escalado" || e.estado === "paso_a_eop" || e.escaladoEn) fila.desviacionesEscaladas += 1;
    porSala.set(clave, fila);
  }

  return [...porSala.values()]
    .map((f) => ({ ...f, horasFueraRango: Math.round(f.horasFueraRango * 10) / 10 }))
    .sort((a, b) => b.horasFueraRango - a.horasFueraRango || a.sala.localeCompare(b.sala, "es"));
}

/** Persiste el indicador 8 en metricas_sala (grano de sala, que metricas_kpi no tiene). */
export async function capturarMetricasSala(db: Db, periodo: string): Promise<number> {
  const filas = await horasFueraRangoPorSala(db, periodo);
  for (const f of filas) {
    if (f.ubicacionId == null) continue; // la UNIQUE del período es (periodo, ubicacion_id)
    const valores = {
      sucursalId: f.sucursalId,
      horasFueraRango: f.horasFueraRango,
      desviaciones: f.desviaciones,
      desviacionesEscaladas: f.desviacionesEscaladas,
      capturadoEn: ahoraISO(),
    };
    await db
      .insert(metricasSala)
      .values({ periodo, ubicacionId: f.ubicacionId, ...valores })
      .onConflictDoUpdate({ target: [metricasSala.periodo, metricasSala.ubicacionId], set: valores });
  }
  return filas.length;
}
