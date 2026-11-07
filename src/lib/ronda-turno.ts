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
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { ahoraSV, parsearTurnos, sumarDias, turnoActual, etiquetaTurno } from "./turnos";
import { abrirEvento, ahoraISO, evaluarLectura, minutosEntre, registrarAccion } from "./aop";
import { etiquetaOT } from "@/lib/orden-codigo";
import {
  aopEventos,
  aopUmbrales,
  mediciones,
  ordenes,
  procedimientos,
  rondaEjecuciones,
  rondaLecturas,
  rondaMarcas,
  rondaPuntos,
  rondaRevisiones,
  rondas,
  sucursales,
  variablesPredictivas,
} from "./schema";

type Db = ReturnType<typeof getDb>;

// ── Permisos ────────────────────────────────────────────────────────────────
/** La ronda la ejecuta quien está de turno. */
export const puedeEjecutarRonda = (rol: string) => ["admin", "jefe", "tecnico"].includes(rol);
/** El tablero de rondas es de quien supervisa; el técnico trabaja en /campo. */
export const puedeVerRondas = (rol: string) =>
  ["admin", "jefe", "visualizador"].includes(rol);
/** Cambiar los puntos del recorrido y sus valores normales. */
export const puedeConfigurarRondas = (rol: string) => ["admin", "jefe"].includes(rol);

export * from "./turnos";

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
    .where(or(eq(rondas.sucursalId, sucursalId), isNull(rondas.sucursalId)));
  const propia = filas.find((r: Ronda) => r.sucursalId === sucursalId);
  if (propia) return propia.activa ? propia : null;
  return filas.find((r: Ronda) => r.sucursalId == null && r.activa) ?? null;
}

export async function puntosDeRonda(db: Db, rondaId: number): Promise<RondaPunto[]> {
  return db
    .select()
    .from(rondaPuntos)
    .where(and(eq(rondaPuntos.rondaId, rondaId), eq(rondaPuntos.activo, true)))
    .orderBy(asc(rondaPuntos.orden), asc(rondaPuntos.id));
}

// ── La foto del recorrido ───────────────────────────────────────────────────
/** Lo que decía el recorrido cuando se abrió el turno. Un cambio aplica desde el turno siguiente. */
export function recorridoDe(ejec: Pick<RondaEjecucion, "recorridoJson">): RondaPunto[] | null {
  if (!ejec.recorridoJson) return null;
  try {
    const v = JSON.parse(ejec.recorridoJson);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export async function paradasDeEjecucion(db: Db, ejec: RondaEjecucion): Promise<RondaPunto[]> {
  return recorridoDe(ejec) ?? puntosDeRonda(db, ejec.rondaId);
}

// ── Abrir la ronda del turno ────────────────────────────────────────────────
/**
 * Devuelve la ejecución del turno, creándola si no existe. El índice único
 * (sede, fecha, turno) garantiza una sola ronda por turno aunque dos técnicos
 * la abran a la vez o la sede cambie de recorrido a mitad del turno.
 */
export async function abrirEjecucion(
  db: Db,
  input: { rondaId: number; sucursalId: number; fecha: string; turno: string; usuarioId?: number | null; momento?: string },
): Promise<{ ejecucion: RondaEjecucion; yaExistia: boolean }> {
  const existente = await buscarEjecucion(db, input);
  if (existente) return { ejecucion: existente, yaExistia: true };

  const puntos = await puntosDeRonda(db, input.rondaId);
  try {
    const [row] = await db
      .insert(rondaEjecuciones)
      .values({
        rondaId: input.rondaId,
        sucursalId: input.sucursalId,
        fecha: input.fecha,
        turno: input.turno,
        estado: "en_curso",
        iniciadaEn: input.momento ?? ahoraISO(),
        iniciadaPor: input.usuarioId ?? null,
        puntosTotal: puntos.length,
        recorridoJson: JSON.stringify(puntos),
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
  input: { sucursalId: number; fecha: string; turno: string },
): Promise<RondaEjecucion | null> {
  const [row] = await db
    .select()
    .from(rondaEjecuciones)
    .where(
      and(
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
  /** Episodio AOP abierto (o ya abierto) por esta lectura. */
  eventoId: number | null;
  /** true si esta lectura lo abrió: es cuando se avisa a la jefatura. */
  eventoNuevo: boolean;
  fuera: boolean;
  /** Llegó con la ronda ya firmada: solo quedó en el libro. */
  tardia: boolean;
}

/** ¿La lectura numérica se sale del valor normal del punto? */
export function fueraDeRango(punto: Pick<RondaPunto, "minEsperado" | "maxEsperado">, valor: number | null): boolean {
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
 * Anota un punto. Si sale fuera abre el episodio del AOP que rige la parada.
 * Dos cosas distintas: la marca guarda todo lo que pasó; la lectura guarda lo
 * vigente, y manda la hora capturada más reciente, no la última en llegar. Una
 * lectura que llega con la ronda ya firmada no la toca: queda en el libro y, si
 * salió fuera, abre su AOP igual, porque el problema existe aunque la ronda ya cerró.
 */
export async function registrarLectura(
  db: Db,
  ejec: RondaEjecucion,
  punto: RondaPunto,
  input: {
    resultado: "ok" | "fuera" | "no_verificado";
    valor?: number | null;
    nota?: string | null;
    usuarioId?: number | null;
    momento: { iso: string; recibido: string; sinSenal: boolean; ajustado: boolean };
    opId?: string | null;
  },
): Promise<ResultadoLectura> {
  const valor = input.valor ?? null;
  const nota = input.nota ?? null;
  const momento = input.momento.iso;
  // Un número fuera del rango normal manda sobre lo que marcó el botón.
  const fuera = input.resultado === "fuera" || (input.resultado === "ok" && fueraDeRango(punto, valor));
  const resultado: "ok" | "fuera" | "no_verificado" = input.resultado === "no_verificado" ? "no_verificado" : fuera ? "fuera" : "ok";

  // La lectura numérica también queda como medición del activo, para la curva.
  let medicionId: number | null = null;
  if (valor != null && punto.variableId) {
    const [v] = await db.select().from(variablesPredictivas).where(eq(variablesPredictivas.id, punto.variableId)).limit(1);
    const ev = evaluarLectura(v ?? null, valor);
    const [m] = await db
      .insert(mediciones)
      .values({ variableId: punto.variableId, valor, fecha: momento, estadoAlerta: ev.banda, usuarioId: input.usuarioId ?? null, origen: "ronda", ubicacionId: punto.ubicacionId ?? null, notas: nota })
      .returning();
    medicionId = m?.id ?? null;
  }

  // El episodio va antes del batch. Si el batch falla, el reintento lo encuentra por el antiduplicado.
  let eventoId: number | null = null;
  let eventoNuevo = false;
  if (resultado === "fuera" && punto.aopProcedimientoId) {
    // Un umbral de una sala de otra sede no le presta su ubicación a esta parada; solo sus plazos.
    const umbrales = await db
      .select()
      .from(aopUmbrales)
      .where(and(eq(aopUmbrales.procedimientoId, punto.aopProcedimientoId), eq(aopUmbrales.activo, true)));
    const generico = umbrales.find((x) => x.ubicacionId == null && x.activoId == null && x.variableId == null);
    const u = generico ?? umbrales[0];
    const { evento, yaExistia } = await abrirEvento(db, {
      procedimientoId: punto.aopProcedimientoId,
      umbralId: generico?.id ?? null,
      variableId: punto.variableId ?? null,
      activoId: punto.activoId ?? null,
      ubicacionId: punto.ubicacionId ?? null,
      sucursalId: ejec.sucursalId,
      rondaPuntoId: punto.id,
      valorDetectado: valor,
      unidad: punto.unidad ?? null,
      detectadoEn: momento,
      detectadoPor: input.usuarioId ?? null,
      origen: "ronda",
      medicionId,
      minutosParaActuar: punto.minutosActuar ?? u?.minutosParaActuar ?? null,
      minutosParaEscalar: punto.minutosEscalar ?? u?.minutosParaEscalar ?? null,
    });
    eventoId = evento.id;
    // Un reintento con la misma captura cuenta como nuevo: el aviso anterior pudo no salir.
    eventoNuevo = !yaExistia || evento.detectadoEn === momento;
  }

  const marca = db.insert(rondaMarcas).values({
    ejecucionId: ejec.id, puntoId: punto.id, resultado, valor, nota, aopEventoId: eventoId,
    ocurridoEn: momento, recibidoEn: input.momento.recibido, sinSenal: input.momento.sinSenal, ajustado: input.momento.ajustado,
    usuarioId: input.usuarioId ?? null, opId: input.opId ?? null,
  }).onConflictDoNothing();

  if (ejec.estado === "completada") {
    await marca;
    return { eventoId, eventoNuevo, fuera: resultado === "fuera", tardia: true };
  }

  const cuenta = (r: string) => sql`(SELECT count(*) FROM ronda_lecturas l WHERE l.ejecucion_id = ${ejec.id} AND l.resultado = ${r})`;
  const [filas] = await db.batch([
    db.insert(rondaLecturas)
      .values({
        ejecucionId: ejec.id, puntoId: punto.id, resultado, valor, nota, medicionId,
        aopEventoId: eventoId, registradoPor: input.usuarioId ?? null, registradoEn: momento,
      })
      .onConflictDoUpdate({
        target: [rondaLecturas.ejecucionId, rondaLecturas.puntoId],
        set: {
          resultado, valor, nota, medicionId,
          // Corregir a «en rango» no desliga el episodio: sigue abierto hasta que alguien lo normalice.
          aopEventoId: sql`COALESCE(${eventoId}, ${rondaLecturas.aopEventoId})`,
          registradoPor: input.usuarioId ?? null, registradoEn: momento,
        },
        setWhere: sql`${momento} >= ${rondaLecturas.registradoEn}`,
      })
      .returning({ id: rondaLecturas.id, aopEventoId: rondaLecturas.aopEventoId }),
    marca,
    db.update(rondaEjecuciones)
      .set({
        puntosOk: cuenta("ok"),
        puntosFuera: cuenta("fuera"),
        puntosNoVerificados: cuenta("no_verificado"),
        // El inicio es la primera hora real capturada, llegue cuando llegue.
        iniciadaEn: sql`MIN(COALESCE(${rondaEjecuciones.iniciadaEn}, ${momento}), ${momento})`,
      })
      .where(eq(rondaEjecuciones.id, ejec.id)),
  ]);
  const lectura = (filas as Array<{ id: number; aopEventoId: number | null }>)[0];

  if (eventoNuevo && eventoId && lectura) await db.update(aopEventos).set({ rondaLecturaId: lectura.id }).where(eq(aopEventos.id, eventoId));
  if (lectura?.aopEventoId && resultado !== "fuera") {
    await registrarAccion(db, lectura.aopEventoId, "Lectura corregida en la ronda", valor != null ? `Nueva lectura: ${valor}${punto.unidad ? ` ${punto.unidad}` : ""}` : "Marcada sin desviación", input.usuarioId ?? null);
  }
  return { eventoId, eventoNuevo, fuera: resultado === "fuera", tardia: false };
}

// ── Cerrar la ronda ─────────────────────────────────────────────────────────
export interface ResultadoCierre {
  ok: boolean;
  error?: string;
  faltantes?: string[];
  fuera?: number;
  sinVerificar?: number;
}

/**
 * Regla dura: una ronda no se firma con una parada en blanco. Si el técnico no
 * pudo verificarla, la marca «no verificado» con su razón: queda escrito, que
 * es distinto de quedar en blanco.
 */
export async function cerrarEjecucion(
  db: Db,
  ejec: RondaEjecucion,
  usuario: { id: number; nombre: string },
  notas: string | null,
  momento: { iso: string; recibido: string },
): Promise<ResultadoCierre> {
  if (ejec.estado === "completada") return { ok: true };
  const puntos = await paradasDeEjecucion(db, ejec);
  if (!puntos.length) return { ok: false, error: "Este recorrido no tiene paradas: no hay nada que firmar." };
  const lecturas = await db.select({ puntoId: rondaLecturas.puntoId, resultado: rondaLecturas.resultado }).from(rondaLecturas).where(eq(rondaLecturas.ejecucionId, ejec.id));
  const anotados = new Set(lecturas.map((l) => l.puntoId));
  const faltantes = puntos.filter((p) => !anotados.has(p.id)).map((p) => p.etiqueta);
  if (faltantes.length) {
    return {
      ok: false,
      error: `Faltan ${faltantes.length} parada(s) sin anotar. Si no se pudieron verificar, márcalas como «no verificado» con la razón.`,
      faltantes,
    };
  }
  const fuera = lecturas.filter((l) => l.resultado === "fuera").length;
  const sinVerificar = lecturas.filter((l) => l.resultado === "no_verificado").length;
  if ((fuera || sinVerificar) && (notas?.length ?? 0) < 3) {
    return { ok: false, error: "Hay novedades abiertas: escribe qué le dejas a quien entra." };
  }
  const iniciada = ejec.iniciadaEn && ejec.iniciadaEn < momento.iso ? ejec.iniciadaEn : momento.iso;
  await db
    .update(rondaEjecuciones)
    .set({
      estado: "completada",
      completadaEn: momento.iso,
      completadaPor: usuario.id,
      firmaNombre: usuario.nombre,
      recibidaEn: momento.recibido,
      minutosRonda: Math.max(0, minutosEntre(iniciada, momento.iso)),
      notas: notas ?? null,
    })
    .where(eq(rondaEjecuciones.id, ejec.id));
  return { ok: true, fuera, sinVerificar };
}

/** La falla o la emergencia que abrió una parada queda ligada a su lectura y a su episodio. */
export async function ligarOrdenALectura(
  db: Db,
  clave: { sucursalId: number; fecha: string; turno: string; puntoId: number },
  ordenId: number,
  emergencia: boolean,
  momento: string,
  usuarioId: number,
): Promise<void> {
  const ejec = await buscarEjecucion(db, clave);
  if (!ejec) return;
  const [lectura] = await db
    .update(rondaLecturas)
    .set({ ordenId })
    .where(and(eq(rondaLecturas.ejecucionId, ejec.id), eq(rondaLecturas.puntoId, clave.puntoId)))
    .returning({ aopEventoId: rondaLecturas.aopEventoId });
  if (!lectura?.aopEventoId) return;
  await db
    .update(aopEventos)
    .set({ ordenId, ...(emergencia ? { estado: "paso_a_eop" as const, escaladoEn: momento } : {}) })
    .where(eq(aopEventos.id, lectura.aopEventoId));
  if (emergencia) {
    const [orden] = await db.select({ codigo: ordenes.codigo }).from(ordenes).where(eq(ordenes.id, ordenId)).limit(1);
    await registrarAccion(db, lectura.aopEventoId, "Pasó a EOP desde la ronda", etiquetaOT({ id: ordenId, codigo: orden?.codigo }), usuarioId);
  }
}

// ── El tablero ──────────────────────────────────────────────────────────────
export type EstadoFila = "no_aplica" | "sin_iniciar" | "no_se_hizo" | "en_curso" | "incompleta" | "con_novedad" | "completa";

export interface FilaTablero {
  sucursalId: number;
  sucursal: string;
  rondaId: number | null;
  rondaNombre: string | null;
  ejecucionId: number | null;
  fecha: string;
  turno: string;
  estado: EstadoFila;
  puntosTotal: number;
  anotados: number;
  fuera: number;
  sinVerificar: number;
  pct: number;
  iniciadaEn: string | null;
  completadaEn: string | null;
  firma: string | null;
}

export const ESTADO_RONDA: Record<EstadoFila, { label: string; badge: string; punto: string }> = {
  no_aplica: { label: "No aplica", badge: "bg-slate-100 text-slate-500", punto: "bg-slate-400" },
  sin_iniciar: { label: "Sin iniciar", badge: "bg-red-100 text-red-700", punto: "bg-red-500" },
  no_se_hizo: { label: "No se hizo", badge: "bg-red-100 text-red-700", punto: "bg-red-500" },
  en_curso: { label: "En curso", badge: "bg-amber-100 text-amber-700", punto: "bg-amber-500" },
  incompleta: { label: "Incompleta", badge: "bg-red-100 text-red-700", punto: "bg-red-500" },
  con_novedad: { label: "Completa con novedades", badge: "bg-amber-100 text-amber-700", punto: "bg-amber-500" },
  completa: { label: "Completa", badge: "bg-emerald-100 text-emerald-700", punto: "bg-emerald-500" },
};

type FilaEjec = Pick<RondaEjecucion, "id" | "sucursalId" | "fecha" | "turno" | "estado" | "puntosTotal" | "puntosOk" | "puntosFuera" | "puntosNoVerificados" | "iniciadaEn" | "completadaEn" | "firmaNombre">;
const COLUMNAS_FILA = {
  id: rondaEjecuciones.id, sucursalId: rondaEjecuciones.sucursalId, fecha: rondaEjecuciones.fecha, turno: rondaEjecuciones.turno, estado: rondaEjecuciones.estado,
  puntosTotal: rondaEjecuciones.puntosTotal, puntosOk: rondaEjecuciones.puntosOk, puntosFuera: rondaEjecuciones.puntosFuera, puntosNoVerificados: rondaEjecuciones.puntosNoVerificados,
  iniciadaEn: rondaEjecuciones.iniciadaEn, completadaEn: rondaEjecuciones.completadaEn, firmaNombre: rondaEjecuciones.firmaNombre,
};

/** El estado de una sede en un turno. Verde solo si todo se verificó y nada salió de rango. */
export function estadoDeFila(e: FilaEjec | null | undefined, opts: { aplica: boolean; pasado: boolean }): EstadoFila {
  if (!opts.aplica) return "no_aplica";
  if (!e) return opts.pasado ? "no_se_hizo" : "sin_iniciar";
  if (e.estado !== "completada") return opts.pasado ? "incompleta" : "en_curso";
  return e.puntosFuera > 0 || e.puntosNoVerificados > 0 ? "con_novedad" : "completa";
}

const valorMs = (fecha: string, turno: string) => Date.parse(`${fecha}T${turno}:00-06:00`);

/**
 * Estado de la ronda en todas las sedes. Sin fecha ni turno, cada sede muestra
 * su turno vigente. Dos lecturas en un batch, sin importar cuántas sedes haya.
 */
export async function tableroRondas(db: Db, pedido?: { fecha: string; turno: string }): Promise<FilaTablero[]> {
  const hoy = ahoraSV().fecha;
  const fechas = pedido ? [pedido.fecha] : [hoy, sumarDias(hoy, -1)];
  const [sedes, todas, ejecuciones] = await db.batch([
    db.select({ id: sucursales.id, nombre: sucursales.nombre }).from(sucursales).where(eq(sucursales.activa, true)).orderBy(asc(sucursales.nombre)),
    db.select({
      id: rondas.id, nombre: rondas.nombre, sucursalId: rondas.sucursalId, activa: rondas.activa, turnos: rondas.turnos, vigenteDesde: rondas.vigenteDesde,
      // Texto literal: Drizzle no califica la columna y dentro de la subconsulta «id» sería el de la parada.
      paradas: sql<number>`(SELECT count(*) FROM ronda_puntos p WHERE p.ronda_id = rondas.id AND p.activo = 1)`,
    }).from(rondas),
    db.select(COLUMNAS_FILA).from(rondaEjecuciones).where(inArray(rondaEjecuciones.fecha, fechas)),
  ]);
  const modelo = todas.find((r) => r.sucursalId == null && r.activa) ?? null;
  const ahora = Date.now();
  return sedes.map((s) => {
    const propia = todas.find((r) => r.sucursalId === s.id);
    const ronda = propia ? (propia.activa ? propia : null) : modelo;
    const turnos = ronda ? parsearTurnos(ronda.turnos) : [];
    const vigente = turnoActual(turnos);
    const fecha = pedido?.fecha ?? vigente.fecha;
    const turno = pedido?.turno ?? vigente.turno;
    const e = ejecuciones.find((x) => x.sucursalId === s.id && x.fecha === fecha && x.turno === turno) ?? null;
    const aplica = !!ronda && turnos.includes(turno) && (!ronda.vigenteDesde || fecha >= ronda.vigenteDesde);
    // Un turno terminó cuando ya empezó el siguiente.
    const pasado = valorMs(fecha, turno) < valorMs(vigente.fecha, vigente.turno) && valorMs(fecha, turno) < ahora;
    const total = e?.puntosTotal || (ronda?.paradas ?? 0);
    const anotados = e ? e.puntosOk + e.puntosFuera + e.puntosNoVerificados : 0;
    return {
      sucursalId: s.id, sucursal: s.nombre, rondaId: ronda?.id ?? null, rondaNombre: ronda?.nombre ?? null, ejecucionId: e?.id ?? null,
      fecha, turno, estado: estadoDeFila(e, { aplica: aplica || !!e, pasado }),
      puntosTotal: total, anotados, fuera: e?.puntosFuera ?? 0, sinVerificar: e?.puntosNoVerificados ?? 0,
      pct: total > 0 ? Math.round((anotados / total) * 100) : 0,
      iniciadaEn: e?.iniciadaEn ?? null, completadaEn: e?.completadaEn ?? null, firma: e?.firmaNombre ?? null,
    };
  });
}

/** Resumen de una línea para el panel. Verde solo con todas las sedes completas sin novedades. */
export function resumenTablero(filas: FilaTablero[]) {
  const con = filas.filter((f) => f.estado !== "no_aplica");
  const n = (e: EstadoFila) => con.filter((f) => f.estado === e).length;
  const completas = n("completa");
  return {
    sedes: con.length,
    completas,
    conNovedad: n("con_novedad"),
    enCurso: n("en_curso"),
    sinIniciar: n("sin_iniciar"),
    noSeHizo: n("no_se_hizo"),
    incompletas: n("incompleta"),
    fuera: con.reduce((s, f) => s + f.fuera, 0),
    sinVerificar: con.reduce((s, f) => s + f.sinVerificar, 0),
    todoListo: con.length > 0 && completas === con.length,
  };
}

/** La lista de turnos para el filtro del tablero: la unión de los recorridos activos. */
export async function turnosDeTablero(db: Db): Promise<string[]> {
  const filas = await db.select({ turnos: rondas.turnos }).from(rondas).where(eq(rondas.activa, true));
  return [...new Set(filas.flatMap((f) => parsearTurnos(f.turnos)))].sort();
}

// ── La revisión semanal ─────────────────────────────────────────────────────
export interface CeldaSemana { fecha: string; turno: string; estado: EstadoFila; ejecucionId: number | null }
export interface ResumenSemana {
  sucursalId: number; lunes: string; domingo: string; turnos: string[]; celdas: CeldaSemana[];
  esperadas: number; completas: number; conNovedad: number; incompletas: number; noHechas: number;
  terminada: boolean; excepciones: boolean;
}

export async function resumenSemana(db: Db, sucursalId: number, lunes: string): Promise<ResumenSemana> {
  const domingo = sumarDias(lunes, 6);
  const ronda = await rondaDeSede(db, sucursalId);
  const turnos = ronda ? parsearTurnos(ronda.turnos) : [];
  const filas = await db.select(COLUMNAS_FILA).from(rondaEjecuciones).where(and(eq(rondaEjecuciones.sucursalId, sucursalId), gte(rondaEjecuciones.fecha, lunes), lte(rondaEjecuciones.fecha, domingo)));
  const hoy = ahoraSV().fecha;
  const vigente = turnoActual(turnos);
  const celdas: CeldaSemana[] = [];
  for (let d = 0; d < 7; d++) {
    const fecha = sumarDias(lunes, d);
    for (const turno of turnos) {
      const e = filas.find((f) => f.fecha === fecha && f.turno === turno) ?? null;
      const aplica = !!e || (!ronda?.vigenteDesde || fecha >= ronda.vigenteDesde);
      const futuro = valorMs(fecha, turno) > valorMs(vigente.fecha, vigente.turno);
      const pasado = valorMs(fecha, turno) < valorMs(vigente.fecha, vigente.turno);
      celdas.push({ fecha, turno, estado: futuro && !e ? "no_aplica" : estadoDeFila(e, { aplica, pasado }), ejecucionId: e?.id ?? null });
    }
  }
  const n = (x: EstadoFila) => celdas.filter((c) => c.estado === x).length;
  const contadas = celdas.filter((c) => c.estado !== "no_aplica" && c.estado !== "sin_iniciar" && c.estado !== "en_curso").length;
  const r = {
    sucursalId, lunes, domingo, turnos, celdas,
    esperadas: contadas, completas: n("completa"), conNovedad: n("con_novedad"), incompletas: n("incompleta"), noHechas: n("no_se_hizo"),
    terminada: domingo < hoy, excepciones: false,
  };
  r.excepciones = r.conNovedad + r.incompletas + r.noHechas > 0;
  return r;
}

export type ResultadoRevision = { ok: true; id: number } | { ok: false; status: number; error: string };

/** Firma la semana de una sede. Quien hizo rondas esa semana en esa sede no la revisa. */
export async function firmarRevision(db: Db, usuario: { id: number; nombre: string }, sucursalId: number, lunes: string, observaciones: string | null): Promise<ResultadoRevision> {
  const r = await resumenSemana(db, sucursalId, lunes);
  if (!r.terminada) return { ok: false, status: 409, error: "La semana todavía no termina." };
  if (r.esperadas === 0) return { ok: false, status: 409, error: "Esa semana no se exigían rondas en esta sede." };
  if (r.excepciones && (observaciones?.length ?? 0) < 3) return { ok: false, status: 400, error: "Hubo excepciones: escribe qué revisaste y qué se hizo." };
  const [propia] = await db
    .select({ id: rondaMarcas.id })
    .from(rondaMarcas)
    .innerJoin(rondaEjecuciones, eq(rondaEjecuciones.id, rondaMarcas.ejecucionId))
    .where(and(eq(rondaEjecuciones.sucursalId, sucursalId), gte(rondaEjecuciones.fecha, r.lunes), lte(rondaEjecuciones.fecha, r.domingo), eq(rondaMarcas.usuarioId, usuario.id)))
    .limit(1);
  const [firmo] = await db
    .select({ id: rondaEjecuciones.id })
    .from(rondaEjecuciones)
    .where(and(eq(rondaEjecuciones.sucursalId, sucursalId), gte(rondaEjecuciones.fecha, r.lunes), lte(rondaEjecuciones.fecha, r.domingo), eq(rondaEjecuciones.completadaPor, usuario.id)))
    .limit(1);
  if (propia || firmo) return { ok: false, status: 403, error: "Hiciste rondas esa semana en esta sede: la revisa otra persona." };
  const [fila] = await db
    .insert(rondaRevisiones)
    .values({
      sucursalId, semana: r.lunes, esperadas: r.esperadas, completas: r.completas, conNovedad: r.conNovedad, incompletas: r.incompletas, noHechas: r.noHechas,
      observaciones, revisadaPor: usuario.id, revisadaNombre: usuario.nombre, revisadaEn: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .returning({ id: rondaRevisiones.id });
  if (!fila) return { ok: false, status: 409, error: "Esa semana ya está revisada." };
  return { ok: true, id: fila.id };
}
