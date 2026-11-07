// ─── La ronda de turno · primer paso de la cadena ────────────────────────────
//
// El volumen GO-GUI-011-2026 encadena cinco documentos, y la cadena arranca
// aquí: el SOP se ejecuta como una ronda por turno. Cada parada sabe de qué
// familia es y qué AOP la rige, así que una lectura fuera de rango no queda
// como una nota en un cuaderno: abre el episodio con su reloj corriendo y, si
// el criterio de emergencia se cumple, señala el EOP que sigue.
//
//   RONDA (SOP) → lectura fuera de rango → AOP con reloj → EOP si ya falló
//                                                        → MOP si hay que intervenir
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { abrirEvento, ahoraISO, evaluarLectura, minutosEntre } from "./aop";
import {
  aopEventos,
  aopUmbrales,
  mediciones,
  procedimientos,
  rondaEjecuciones,
  rondaLecturas,
  rondaPuntos,
  rondas,
  sucursales,
  variablesPredictivas,
} from "./schema";

type Db = ReturnType<typeof getDb>;

// ── Permisos ────────────────────────────────────────────────────────────────
/** La ronda la ejecuta quien está de turno. */
export const puedeEjecutarRonda = (rol: string) => ["admin", "jefe", "tecnico"].includes(rol);
/** El tablero de rondas lo ve también quien solo supervisa. */
export const puedeVerRondas = (rol: string) =>
  ["admin", "jefe", "tecnico", "visualizador"].includes(rol);
/** Cambiar los puntos del recorrido y sus valores normales. */
export const puedeConfigurarRondas = (rol: string) => ["admin", "jefe"].includes(rol);

// ── Turnos ──────────────────────────────────────────────────────────────────
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

// ── La ronda que aplica a una sede ──────────────────────────────────────────
export type Ronda = typeof rondas.$inferSelect;
export type RondaPunto = typeof rondaPuntos.$inferSelect;
export type RondaEjecucion = typeof rondaEjecuciones.$inferSelect;
export type RondaLectura = typeof rondaLecturas.$inferSelect;

/** La ronda propia de la sede si existe; si no, la ronda modelo. */
export async function rondaDeSede(db: Db, sucursalId: number): Promise<Ronda | null> {
  const filas = await db
    .select()
    .from(rondas)
    .where(and(eq(rondas.activa, true), or(eq(rondas.sucursalId, sucursalId), isNull(rondas.sucursalId))));
  return filas.find((r: Ronda) => r.sucursalId === sucursalId) ?? filas.find((r: Ronda) => r.sucursalId == null) ?? null;
}

export async function puntosDeRonda(db: Db, rondaId: number): Promise<RondaPunto[]> {
  return db
    .select()
    .from(rondaPuntos)
    .where(and(eq(rondaPuntos.rondaId, rondaId), eq(rondaPuntos.activo, true)))
    .orderBy(asc(rondaPuntos.orden), asc(rondaPuntos.id));
}

// ── Abrir la ronda del turno ────────────────────────────────────────────────
/**
 * Devuelve la ejecución del turno, creándola si no existe. La UNIQUE
 * (ronda, sede, fecha, turno) garantiza una sola ronda por turno aunque dos
 * técnicos la abran a la vez.
 */
export async function abrirEjecucion(
  db: Db,
  input: { rondaId: number; sucursalId: number; fecha: string; turno: string; usuarioId?: number | null },
): Promise<{ ejecucion: RondaEjecucion; yaExistia: boolean }> {
  const existente = await buscarEjecucion(db, input);
  if (existente) return { ejecucion: existente, yaExistia: true };

  const total = (await puntosDeRonda(db, input.rondaId)).length;
  try {
    const [row] = await db
      .insert(rondaEjecuciones)
      .values({
        rondaId: input.rondaId,
        sucursalId: input.sucursalId,
        fecha: input.fecha,
        turno: input.turno,
        estado: "en_curso",
        iniciadaEn: ahoraISO(),
        iniciadaPor: input.usuarioId ?? null,
        puntosTotal: total,
        puntosNoVerificados: total,
      })
      .returning();
    return { ejecucion: row, yaExistia: false };
  } catch {
    // Carrera contra otro técnico: la que ganó ya está ahí.
    const otra = await buscarEjecucion(db, input);
    if (otra) return { ejecucion: otra, yaExistia: true };
    throw new Error("No se pudo abrir la ronda del turno");
  }
}

export async function buscarEjecucion(
  db: Db,
  input: { rondaId: number; sucursalId: number; fecha: string; turno: string },
): Promise<RondaEjecucion | null> {
  const [row] = await db
    .select()
    .from(rondaEjecuciones)
    .where(
      and(
        eq(rondaEjecuciones.rondaId, input.rondaId),
        eq(rondaEjecuciones.sucursalId, input.sucursalId),
        eq(rondaEjecuciones.fecha, input.fecha),
        eq(rondaEjecuciones.turno, input.turno),
      ),
    )
    .limit(1);
  return row ?? null;
}

// ── Registrar la lectura de un punto ────────────────────────────────────────
export interface ResultadoLectura {
  lectura: RondaLectura;
  /** Episodio AOP abierto (o ya abierto) por esta lectura. */
  eventoId: number | null;
  /** Código del AOP que rige el punto, para decirlo en pantalla. */
  aopCodigo: string | null;
  aopTitulo: string | null;
  minutosParaActuar: number | null;
  minutosParaEscalar: number | null;
  fuera: boolean;
  mensaje: string;
}

/** ¿La lectura numérica se sale del valor normal del punto? */
export function fueraDeRango(punto: RondaPunto, valor: number | null): boolean {
  if (valor == null) return false;
  if (punto.minEsperado != null && valor < punto.minEsperado) return true;
  if (punto.maxEsperado != null && valor > punto.maxEsperado) return true;
  return false;
}

/** "20–24 °C" · "≥ 50 %" · el texto esperado cuando no es numérico. */
export function rangoNormal(punto: RondaPunto): string {
  const u = punto.unidad ? ` ${punto.unidad}` : "";
  if (punto.requiereValor) {
    const { minEsperado: mn, maxEsperado: mx } = punto;
    if (mn != null && mx != null) return `${mn}–${mx}${u}`;
    if (mn != null) return `≥ ${mn}${u}`;
    if (mx != null) return `≤ ${mx}${u}`;
    return `sin rango definido${u ? ` (${punto.unidad})` : ""}`;
  }
  return punto.valorEsperadoTexto || "sin valor normal definido";
}

/**
 * Anota un punto de la ronda. Si el resultado es "fuera" (o el número se sale
 * del rango) abre el episodio del AOP que rige el punto, con los minutos que
 * declara su umbral. Idempotente por (ejecución, punto): reanotar corrige.
 */
export async function registrarLectura(
  db: Db,
  input: {
    ejecucionId: number;
    puntoId: number;
    resultado: "ok" | "fuera" | "no_verificado";
    valor?: number | null;
    valorTexto?: string | null;
    nota?: string | null;
    usuarioId?: number | null;
  },
): Promise<ResultadoLectura> {
  const [punto] = await db.select().from(rondaPuntos).where(eq(rondaPuntos.id, input.puntoId)).limit(1);
  if (!punto) throw new Error("El punto no existe en esta ronda");
  const [ejec] = await db.select().from(rondaEjecuciones).where(eq(rondaEjecuciones.id, input.ejecucionId)).limit(1);
  if (!ejec) throw new Error("La ronda no existe");

  const valor = input.valor ?? null;
  // Un número fuera del rango normal manda sobre lo que marcó el botón.
  const fuera = input.resultado === "fuera" || (input.resultado === "ok" && fueraDeRango(punto, valor));
  const resultado: "ok" | "fuera" | "no_verificado" = input.resultado === "no_verificado" ? "no_verificado" : fuera ? "fuera" : "ok";

  // La lectura numérica también queda como medición del activo, para la curva.
  let medicionId: number | null = null;
  if (valor != null && punto.variableId) {
    const [v] = await db
      .select()
      .from(variablesPredictivas)
      .where(eq(variablesPredictivas.id, punto.variableId))
      .limit(1);
    const ev = evaluarLectura(v ?? null, valor);
    const [m] = await db
      .insert(mediciones)
      .values({
        variableId: punto.variableId,
        valor,
        fecha: ahoraISO(),
        estadoAlerta: ev.banda,
        usuarioId: input.usuarioId ?? null,
        origen: "ronda",
        ubicacionId: punto.ubicacionId ?? null,
        notas: input.nota ?? null,
      })
      .returning();
    medicionId = m?.id ?? null;
  }

  // ── El AOP que rige el punto ──
  let aopCodigo: string | null = null;
  let aopTitulo: string | null = null;
  let minActuar: number | null = null;
  let minEscalar: number | null = null;
  let umbralId: number | null = null;
  if (punto.aopProcedimientoId) {
    const [p] = await db
      .select({ codigo: procedimientos.codigoCorto, titulo: procedimientos.titulo })
      .from(procedimientos)
      .where(eq(procedimientos.id, punto.aopProcedimientoId))
      .limit(1);
    aopCodigo = p?.codigo ?? null;
    aopTitulo = p?.titulo ?? null;
    const [u] = await db
      .select()
      .from(aopUmbrales)
      .where(and(eq(aopUmbrales.procedimientoId, punto.aopProcedimientoId), eq(aopUmbrales.activo, true)))
      .limit(1);
    if (u) {
      umbralId = u.id;
      minActuar = u.minutosParaActuar ?? null;
      minEscalar = u.minutosParaEscalar ?? null;
    }
  }

  let eventoId: number | null = null;
  if (resultado === "fuera" && punto.aopProcedimientoId) {
    const { evento } = await abrirEvento(db, {
      procedimientoId: punto.aopProcedimientoId,
      umbralId,
      variableId: punto.variableId ?? null,
      activoId: punto.activoId ?? null,
      ubicacionId: punto.ubicacionId ?? null,
      sucursalId: ejec.sucursalId,
      valorDetectado: valor,
      unidad: punto.unidad ?? null,
      detectadoPor: input.usuarioId ?? null,
      origen: "ronda",
      medicionId,
      minutosParaActuar: minActuar,
      minutosParaEscalar: minEscalar,
    });
    eventoId = evento.id;
  }

  const valores = {
    resultado,
    valor,
    valorTexto: input.valorTexto ?? null,
    nota: input.nota ?? null,
    medicionId,
    aopEventoId: eventoId,
    registradoPor: input.usuarioId ?? null,
    registradoEn: ahoraISO(),
  };
  const [lectura] = await db
    .insert(rondaLecturas)
    .values({ ejecucionId: input.ejecucionId, puntoId: input.puntoId, ...valores })
    .onConflictDoUpdate({
      target: [rondaLecturas.ejecucionId, rondaLecturas.puntoId],
      set: valores,
    })
    .returning();

  if (eventoId) {
    await db.update(aopEventos).set({ rondaLecturaId: lectura.id }).where(eq(aopEventos.id, eventoId));
  }

  await recontarEjecucion(db, input.ejecucionId);

  const mensaje =
    resultado === "fuera"
      ? aopCodigo
        ? `Fuera de rango. Se rige por ${aopCodigo}; el reloj ya está corriendo.`
        : "Fuera de rango. Este punto todavía no tiene un AOP que lo rija."
      : resultado === "no_verificado"
        ? "Punto marcado como no verificado."
        : "En rango.";

  return { lectura, eventoId, aopCodigo, aopTitulo, minutosParaActuar: minActuar, minutosParaEscalar: minEscalar, fuera: resultado === "fuera", mensaje };
}

/** Recalcula los contadores de la ejecución desde las lecturas. */
export async function recontarEjecucion(db: Db, ejecucionId: number): Promise<void> {
  const [ejec] = await db.select().from(rondaEjecuciones).where(eq(rondaEjecuciones.id, ejecucionId)).limit(1);
  if (!ejec) return;
  const total = (await puntosDeRonda(db, ejec.rondaId)).length;
  const lecturas = await db.select().from(rondaLecturas).where(eq(rondaLecturas.ejecucionId, ejecucionId));
  const ok = lecturas.filter((l: RondaLectura) => l.resultado === "ok").length;
  const fuera = lecturas.filter((l: RondaLectura) => l.resultado === "fuera").length;
  await db
    .update(rondaEjecuciones)
    .set({
      puntosTotal: total,
      puntosOk: ok,
      puntosFuera: fuera,
      puntosNoVerificados: Math.max(0, total - ok - fuera),
    })
    .where(eq(rondaEjecuciones.id, ejecucionId));
}

// ── Cerrar la ronda ─────────────────────────────────────────────────────────
export interface ResultadoCierre {
  ok: boolean;
  error?: string;
  faltantes?: string[];
}

/**
 * Regla dura: una ronda no se cierra con un punto crítico sin anotar. Si el
 * técnico no pudo verificarlo, lo marca "no verificado" con su razón — queda
 * escrito, que es distinto de quedar en blanco.
 */
export async function cerrarEjecucion(
  db: Db,
  ejecucionId: number,
  usuarioId: number | null,
  notas?: string | null,
): Promise<ResultadoCierre> {
  const [ejec] = await db.select().from(rondaEjecuciones).where(eq(rondaEjecuciones.id, ejecucionId)).limit(1);
  if (!ejec) return { ok: false, error: "La ronda no existe" };
  if (ejec.estado === "completada") return { ok: true };

  const puntos = await puntosDeRonda(db, ejec.rondaId);
  const lecturas = await db.select().from(rondaLecturas).where(eq(rondaLecturas.ejecucionId, ejecucionId));
  const anotados = new Set(lecturas.map((l: RondaLectura) => l.puntoId));
  const faltantes = puntos.filter((p) => p.critico && !anotados.has(p.id)).map((p) => p.etiqueta);
  if (faltantes.length) {
    return {
      ok: false,
      error: `Faltan ${faltantes.length} punto(s) crítico(s) sin anotar. Si no se pudieron verificar, márcalos como «no verificado» con la razón.`,
      faltantes,
    };
  }

  const ahora = ahoraISO();
  await recontarEjecucion(db, ejecucionId);
  await db
    .update(rondaEjecuciones)
    .set({
      estado: "completada",
      completadaEn: ahora,
      completadaPor: usuarioId,
      minutosRonda: ejec.iniciadaEn ? Math.max(0, minutosEntre(ejec.iniciadaEn, ahora)) : null,
      ...(notas != null ? { notas } : {}),
    })
    .where(eq(rondaEjecuciones.id, ejecucionId));
  return { ok: true };
}

// ── El tablero ──────────────────────────────────────────────────────────────
export interface FilaTablero {
  sucursalId: number;
  sucursal: string;
  rondaId: number | null;
  rondaNombre: string | null;
  ejecucion: RondaEjecucion | null;
  estado: "sin_iniciar" | "en_curso" | "completada" | "sin_ronda";
  puntosTotal: number;
  anotados: number;
  fuera: number;
  pct: number;
}

export const ESTADO_RONDA: Record<FilaTablero["estado"], { label: string; badge: string; punto: string }> = {
  sin_iniciar: { label: "Sin iniciar", badge: "bg-red-100 text-red-700", punto: "bg-red-500" },
  en_curso: { label: "En curso", badge: "bg-amber-100 text-amber-700", punto: "bg-amber-500" },
  completada: { label: "Completada", badge: "bg-emerald-100 text-emerald-700", punto: "bg-emerald-500" },
  sin_ronda: { label: "Sin ronda configurada", badge: "bg-slate-100 text-slate-500", punto: "bg-slate-400" },
};

/**
 * Estado de la ronda de un turno en todas las sedes. Es la primera cosa que
 * mira el jefe: si la ronda de las 06:00 no se hizo, nada de lo demás es
 * confiable.
 */
export async function tableroRondas(db: Db, fecha: string, turno: string): Promise<FilaTablero[]> {
  const sedes = await db
    .select({ id: sucursales.id, nombre: sucursales.nombre })
    .from(sucursales)
    .where(eq(sucursales.activa, true))
    .orderBy(asc(sucursales.nombre));

  const out: FilaTablero[] = [];
  for (const s of sedes) {
    const ronda = await rondaDeSede(db, s.id);
    if (!ronda) {
      out.push({
        sucursalId: s.id, sucursal: s.nombre, rondaId: null, rondaNombre: null,
        ejecucion: null, estado: "sin_ronda", puntosTotal: 0, anotados: 0, fuera: 0, pct: 0,
      });
      continue;
    }
    const ejec = await buscarEjecucion(db, { rondaId: ronda.id, sucursalId: s.id, fecha, turno });
    const total = ejec?.puntosTotal || (await puntosDeRonda(db, ronda.id)).length;
    // «Anotado» es todo lo que dejó de estar en blanco: en rango, fuera de
    // rango o declarado no verificado con su razón.
    const anotados = ejec ? Math.max(0, total - ejec.puntosNoVerificados) : 0;
    out.push({
      sucursalId: s.id,
      sucursal: s.nombre,
      rondaId: ronda.id,
      rondaNombre: ronda.nombre,
      ejecucion: ejec,
      estado: !ejec ? "sin_iniciar" : ejec.estado === "completada" ? "completada" : "en_curso",
      puntosTotal: total,
      anotados,
      fuera: ejec?.puntosFuera ?? 0,
      pct: total > 0 ? Math.round((anotados / total) * 100) : 0,
    });
  }
  return out;
}

/** Resumen de una línea para el panel: "2 de 4 sedes hicieron la ronda". */
export function resumenTablero(filas: FilaTablero[]): {
  sedes: number; completadas: number; enCurso: number; sinIniciar: number; fuera: number; todoListo: boolean;
} {
  const conRonda = filas.filter((f) => f.estado !== "sin_ronda");
  const completadas = conRonda.filter((f) => f.estado === "completada").length;
  const enCurso = conRonda.filter((f) => f.estado === "en_curso").length;
  return {
    sedes: conRonda.length,
    completadas,
    enCurso,
    sinIniciar: conRonda.filter((f) => f.estado === "sin_iniciar").length,
    fuera: conRonda.reduce((s, f) => s + f.fuera, 0),
    todoListo: conRonda.length > 0 && completadas === conRonda.length,
  };
}
