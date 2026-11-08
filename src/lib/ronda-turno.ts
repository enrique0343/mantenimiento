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
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { TURNOS_DEFECTO, ahoraSV, laHora, parsearTurnos, sumarDias, turnoActual, etiquetaTurno, type TurnoInfo } from "./turnos";
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
  rondaVigencias,
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
export type RondaVigencia = typeof rondaVigencias.$inferSelect;

/** Las familias de una parada, en el orden de la pantalla. */
export const FAMILIAS_RONDA = ["electrico", "hvac", "minisplit", "gases", "agua", "incendios", "ascensores", "otro"] as const;

/** El recorrido que usa la sede: el propio si existe; si no, el modelo. No mira si la sede hace ronda. */
export function recorridoDeSede<T extends Pick<Ronda, "sucursalId" | "activa">>(filas: T[], sucursalId: number): T | null {
  const propia = filas.find((r) => r.sucursalId === sucursalId);
  if (propia) return propia.activa ? propia : null;
  return filas.find((r) => r.sucursalId == null && r.activa) ?? null;
}

/** Cómo se llama en pantalla y en la auditoría. */
export const nombreRecorrido = (ronda: Pick<Ronda, "sucursalId">, sede?: string | null) =>
  ronda.sucursalId == null ? "Modelo" : `Recorrido propio de ${sede ?? `la sede ${ronda.sucursalId}`}`;

// ── Lo que regía cuando empezó cada turno ───────────────────────────────────
/** Hora de inicio de un turno. Un turno se juzga con lo que regía en ese momento. */
export const inicioTurno = (fecha: string, turno: string) => Date.parse(`${fecha}T${turno}:00-06:00`);

/**
 * Lo que regía al empezar un turno: así se juzga la marca de una sede. Cada
 * cambio guarda lo que había antes y cuándo cambió: rige lo de antes del
 * primer cambio hecho después de ese inicio. Sin cambios posteriores, rige lo
 * de hoy. Así un cambio entra en la ronda del turno que todavía no empezó y no
 * reescribe los que ya empezaron. Los turnos tienen su línea de tiempo: lineaDeTurnos.
 */
export function vigenteAl<T>(cambios: ReadonlyArray<{ hasta: string; antes: T }>, actual: T, inicioMs: number): T {
  let primero: { ms: number; antes: T } | null = null;
  for (const c of cambios) {
    const ms = Date.parse(c.hasta);
    if (ms > inicioMs && (!primero || ms < primero.ms)) primero = { ms, antes: c.antes };
  }
  return primero ? primero.antes : actual;
}

/** Los cambios de «esta sede no hace ronda». */
export const cambiosDeSede = (vigencias: RondaVigencia[], sucursalId: number) =>
  vigencias.filter((v) => v.sucursalId === sucursalId && v.haceRondaAntes != null).map((v) => ({ hasta: v.hasta, antes: !!v.haceRondaAntes }));

/** El primer turno de la lista que empieza desde este momento. */
export function siguienteTurno(turnos: string[], ref = Date.now()): { fecha: string; turno: string } {
  const lista = turnos.length ? [...turnos].sort() : TURNOS_DEFECTO;
  const hoy = ahoraSV(new Date(ref)).fecha;
  for (let d = -1; d <= 2; d++) {
    const fecha = sumarDias(hoy, d);
    for (const turno of lista) if (inicioTurno(fecha, turno) >= ref) return { fecha, turno };
  }
  return { fecha: sumarDias(hoy, 1), turno: lista[0] };
}

// ── La línea de tiempo de los turnos ────────────────────────────────────────
/** Un turno con su fecha: el de las 14:00 del 10/11/2026. */
export interface TurnoFecha {
  fecha: string;
  turno: string;
}

/**
 * Desde cuándo rige una lista de turnos. El primer tramo rige desde siempre; los
 * demás, desde `entra`. `omite`: los turnos de la lista anterior que no se abren
 * porque empezarían menos de 2 h antes de `entra`, y los que un cambio
 * reemplazado ya había anunciado así y ya empezaron.
 */
export interface TramoTurnos {
  desde: number;
  entra: TurnoFecha | null;
  turnos: string[];
  omite: TurnoFecha[];
}

/** Un turno de la lista anterior que empezaría menos de esto antes del primero de la lista nueva no se abre. */
export const MARGEN_CAMBIO_MS = 2 * 3_600_000;

/** Una lista que rige desde siempre. */
export const lineaFija = (turnos: string[]): TramoTurnos[] => [{ desde: -Infinity, entra: null, turnos: turnos.length ? turnos : TURNOS_DEFECTO, omite: [] }];

/** Los turnos de una lista que empiezan después de `desdeMs` y antes de `hastaMs`, en orden. */
function turnosEntre(lista: string[], desdeMs: number, hastaMs: number): TurnoFecha[] {
  const out: TurnoFecha[] = [];
  const primero = ahoraSV(new Date(desdeMs)).fecha;
  for (let d = 0; d <= 2; d++) {
    const fecha = sumarDias(primero, d);
    for (const turno of lista) {
      const ms = inicioTurno(fecha, turno);
      if (ms > desdeMs && ms < hastaMs) out.push({ fecha, turno });
    }
  }
  return out;
}

/** Turnos que no se abren, sin repetir y en orden de inicio. */
function juntarOmitidos(...listas: TurnoFecha[][]): TurnoFecha[] {
  const out: TurnoFecha[] = [];
  for (const t of listas.flat()) if (!out.some((o) => o.fecha === t.fecha && o.turno === t.turno)) out.push(t);
  return out.sort((a, b) => inicioTurno(a.fecha, a.turno) - inicioTurno(b.fecha, b.turno));
}

/**
 * Qué lista de turnos rige en cada momento. Cada cambio guarda la lista de
 * antes y cuándo se hizo; la lista nueva es la de antes del cambio siguiente,
 * o la de hoy si es el último. Un cambio entra cuando empieza el primer turno
 * de la lista nueva; hasta ahí siguen los turnos de antes, salvo el que
 * empezaría menos de 2 h antes: ese no se abre y el turno que corría sigue
 * hasta el nuevo. Un cambio que todavía no entraba lo reemplaza el que se hizo
 * después; un turno que ese cambio ya dejó sin abrir y cuya hora ya llegó sigue
 * sin abrirse, aunque se cancele el cambio. Uno que no llegaba se calcula de nuevo.
 */
export function lineaDeTurnos(
  ronda: Pick<Ronda, "id" | "turnos">,
  vigencias: ReadonlyArray<Pick<RondaVigencia, "id" | "rondaId" | "turnosAntes" | "hasta">>,
): TramoTurnos[] {
  const cambios = vigencias
    .filter((v) => v.rondaId === ronda.id && v.turnosAntes != null && Number.isFinite(Date.parse(v.hasta)))
    .map((v) => ({ id: v.id, ms: Date.parse(v.hasta), antes: parsearTurnos(v.turnosAntes) }))
    .sort((a, b) => a.ms - b.ms || a.id - b.id);
  const actual = parsearTurnos(ronda.turnos);
  if (!cambios.length) return lineaFija(actual);
  const linea = lineaFija(cambios[0].antes);
  cambios.forEach((c, k) => {
    const nueva = cambios[k + 1]?.antes ?? actual;
    // Lo que el cambio reemplazado ya anunció como «no se abre» y ya empezó no vuelve a abrirse.
    const anunciados: TurnoFecha[] = [];
    while (linea.length > 1 && linea[linea.length - 1].desde >= c.ms) {
      anunciados.push(...linea.pop()!.omite.filter((t) => inicioTurno(t.fecha, t.turno) <= c.ms));
    }
    const vigente = linea[linea.length - 1];
    if (vigente.turnos.join() === nueva.join()) {
      // Vuelve a la lista que rige: los anunciados quedan en ella.
      if (anunciados.length) linea[linea.length - 1] = { ...vigente, omite: juntarOmitidos(vigente.omite, anunciados) };
      return;
    }
    const entra = siguienteTurno(nueva, c.ms);
    const desde = inicioTurno(entra.fecha, entra.turno);
    const omite = turnosEntre(vigente.turnos, c.ms, desde).filter((t) => desde - inicioTurno(t.fecha, t.turno) < MARGEN_CAMBIO_MS);
    linea.push({ desde, entra, turnos: nueva, omite: juntarOmitidos(anunciados, omite) });
  });
  return linea;
}

/** El tramo que rige en ese momento: el último que ya empezó. */
export function tramoEn(linea: TramoTurnos[], ms = Date.now()): TramoTurnos {
  let elegido = linea[0];
  for (const t of linea) {
    if (t.desde > ms) break;
    elegido = t;
  }
  return elegido;
}

/** La lista de turnos que rige en ese momento. */
export const turnosEn = (linea: TramoTurnos[], ms = Date.now()): string[] => tramoEn(linea, ms).turnos;

/** Un turno que no se abre por un cambio de turnos. */
export const turnoOmitido = (linea: TramoTurnos[], t: TurnoFecha): boolean =>
  linea.some((x) => x.omite.some((o) => o.fecha === t.fecha && o.turno === t.turno));

/**
 * El turno que corre en ese momento. Termina cuando empieza el siguiente de la
 * línea de tiempo. Si el que tocaba no se abre, corre el que corría justo antes de su inicio.
 */
export function turnoEn(linea: TramoTurnos[], ms = Date.now()): TurnoInfo {
  let t = turnoActual(turnosEn(linea, ms), new Date(ms));
  for (let i = 0; i < 8 && turnoOmitido(linea, t); i++) {
    const antes = inicioTurno(t.fecha, t.turno) - 1;
    t = turnoActual(turnosEn(linea, antes), new Date(antes));
  }
  return t;
}

/** Un turno existe si su hora está en la lista que regía cuando empezaba y no es uno que no se abre. */
export const existeTurno = (linea: TramoTurnos[], fecha: string, turno: string): boolean =>
  turnosEn(linea, inicioTurno(fecha, turno)).includes(turno) && !turnoOmitido(linea, { fecha, turno });

/** El cambio de turnos que todavía no entró, si hay uno. */
export const proximoTramo = (linea: TramoTurnos[], ms = Date.now()): TramoTurnos | null => linea.find((t) => t.desde > ms) ?? null;

/** Los turnos que no se abren y empiezan entre esos dos momentos, en orden. */
export function omitidosEntre(linea: TramoTurnos[], desdeMs: number, hastaMs: number): TurnoFecha[] {
  return linea
    .flatMap((t) => t.omite)
    .filter((o) => inicioTurno(o.fecha, o.turno) >= desdeMs && inicioTurno(o.fecha, o.turno) <= hastaMs)
    .sort((a, b) => inicioTurno(a.fecha, a.turno) - inicioTurno(b.fecha, b.turno));
}

/** El primer turno de la línea de tiempo que empieza en ese momento o después: ahí entra la marca de una sede. */
export function siguienteInicio(linea: TramoTurnos[], ms = Date.now()): TurnoFecha {
  const todos = [...new Set(linea.flatMap((t) => t.turnos))].sort();
  const hoy = ahoraSV(new Date(ms)).fecha;
  for (let d = 0; d <= 3; d++) {
    const fecha = sumarDias(hoy, d);
    for (const turno of todos) {
      if (inicioTurno(fecha, turno) >= ms && existeTurno(linea, fecha, turno)) return { fecha, turno };
    }
  }
  return siguienteTurno(turnosEn(linea, ms), ms);
}

/** «10/11/2026» */
export const fechaCorta = (fecha: string) => fecha.slice(0, 10).split("-").reverse().join("/");

/** «el de las 14:00» · «los de la 01:00 y las 02:00» */
const lasHoras = (xs: TurnoFecha[]) => (xs.length === 1 ? `el de ${laHora(xs[0].turno)}` : `los de ${xs.slice(0, -1).map((x) => laHora(x.turno)).join(", ")} y ${laHora(xs.at(-1)!.turno)}`);

/**
 * Lo que pasa hasta que entra un cambio de turnos pendiente, en frases cortas:
 * cuándo entran los nuevos, qué turno llega hasta esa hora y cuál no se abre.
 * Sin cambio pendiente, null.
 */
export function avisoCambioTurnos(linea: TramoTurnos[], ms = Date.now()): string | null {
  const p = proximoTramo(linea, ms);
  if (!p?.entra) return null;
  const corre = turnoEn(linea, ms);
  const ultimo = turnoEn(linea, p.desde - 1);
  const mismo = corre.fecha === ultimo.fecha && corre.turno === ultimo.turno;
  const hasta = mismo ? `El turno de ${laHora(corre.turno)} sigue hasta esa hora` : `Hasta entonces siguen los de antes; el de ${laHora(ultimo.turno)} dura hasta esa hora`;
  const omite = p.omite;
  const no = omite.length ? `${mismo ? ";" : " y"} ${lasHoras(omite)} ${omite.length === 1 ? "no se abre" : "no se abren"}` : "";
  return `Los turnos nuevos entran a ${laHora(p.entra.turno)} del ${fechaCorta(p.entra.fecha)}. ${hasta}${no}.`;
}

/** Las vigencias que pesan en una sede: su marca y los turnos de los recorridos que puede usar. */
const vigenciasDeSede = (db: Db, sucursalId: number) =>
  db.select().from(rondaVigencias).where(or(
    eq(rondaVigencias.sucursalId, sucursalId),
    inArray(rondaVigencias.rondaId, db.select({ id: rondas.id }).from(rondas).where(or(eq(rondas.sucursalId, sucursalId), isNull(rondas.sucursalId)))),
  ));

export interface RecorridoDeSede {
  ronda: Ronda;
  /** Los recorridos que la sede puede usar: el modelo y, si lo tiene, el propio. */
  recorridos: Ronda[];
  linea: TramoTurnos[];
  activa: boolean;
  /** Si la sede hacía ronda en el turno que empieza en ese momento. */
  haceRondaEn: (inicioMs: number) => boolean;
}

/** El recorrido que usa la sede y su línea de tiempo, sin mirar si la sede hace ronda. Una sola lectura. */
export async function recorridoConLinea(db: Db, sucursalId: number): Promise<RecorridoDeSede | null> {
  const [filas, sede, vigencias] = await db.batch([
    db.select().from(rondas).where(or(eq(rondas.sucursalId, sucursalId), isNull(rondas.sucursalId))).orderBy(asc(rondas.id)),
    db.select({ haceRonda: sucursales.haceRonda, activa: sucursales.activa }).from(sucursales).where(eq(sucursales.id, sucursalId)).limit(1),
    vigenciasDeSede(db, sucursalId),
  ]);
  const ronda = recorridoDeSede(filas, sucursalId);
  if (!ronda) return null;
  const marca = cambiosDeSede(vigencias, sucursalId);
  const hoy = sede[0]?.haceRonda ?? true;
  return { ronda, recorridos: filas, linea: lineaDeTurnos(ronda, vigencias), activa: !!sede[0]?.activa, haceRondaEn: (inicioMs) => vigenteAl(marca, hoy, inicioMs) };
}

/**
 * El recorrido de la sede, si la sede hace ronda en ese turno; sin turno, en
 * el que corre según la línea de tiempo. La marca entra en el turno que
 * todavía no empezó: la sede que deja de hacer ronda termina la del turno que
 * ya empezó.
 */
export async function rondaDeSede(db: Db, sucursalId: number, turno?: { fecha: string; turno: string }): Promise<Ronda | null> {
  const r = await recorridoConLinea(db, sucursalId);
  if (!r) return null;
  const t = turno ?? turnoEn(r.linea);
  return r.haceRondaEn(inicioTurno(t.fecha, t.turno)) ? r.ronda : null;
}

export async function puntosDeRonda(db: Db, rondaId: number): Promise<RondaPunto[]> {
  return db
    .select()
    .from(rondaPuntos)
    .where(and(eq(rondaPuntos.rondaId, rondaId), eq(rondaPuntos.activo, true)))
    .orderBy(asc(rondaPuntos.orden), asc(rondaPuntos.id));
}

// ── La foto del recorrido ───────────────────────────────────────────────────
/** Lo que decía el recorrido cuando se abrió la ronda. La ronda que ya empezó conserva lo que decía al abrir. */
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
  /** Si la sede hacía ronda cuando empezó este turno. */
  haceRonda: boolean;
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

const valorMs = inicioTurno;

/** ¿Se le exigía ronda a la sede en ese turno? Con lo que regía cuando empezó, no con lo de hoy. */
function exigida(
  ronda: Pick<Ronda, "vigenteDesde"> | null,
  linea: TramoTurnos[] | null,
  sede: { id: number; haceRonda: boolean },
  vigencias: RondaVigencia[],
  fecha: string,
  turno: string,
): { aplica: boolean; haceRonda: boolean } {
  const inicio = inicioTurno(fecha, turno);
  const haceRonda = vigenteAl(cambiosDeSede(vigencias, sede.id), sede.haceRonda, inicio);
  if (!ronda || !linea || !haceRonda) return { aplica: false, haceRonda };
  if (ronda.vigenteDesde && fecha < ronda.vigenteDesde) return { aplica: false, haceRonda };
  return { aplica: existeTurno(linea, fecha, turno), haceRonda };
}

/**
 * Estado de la ronda en todas las sedes. Sin fecha ni turno, cada sede muestra
 * su turno vigente. Cuatro lecturas en un batch, sin importar cuántas sedes haya.
 */
export async function tableroRondas(db: Db, pedido?: { fecha: string; turno: string }): Promise<FilaTablero[]> {
  const hoy = ahoraSV().fecha;
  const fechas = pedido ? [pedido.fecha] : [hoy, sumarDias(hoy, -1)];
  const [sedes, todas, ejecuciones, vigencias] = await db.batch([
    db.select({ id: sucursales.id, nombre: sucursales.nombre, haceRonda: sucursales.haceRonda }).from(sucursales).where(eq(sucursales.activa, true)).orderBy(asc(sucursales.nombre)),
    db.select({
      id: rondas.id, nombre: rondas.nombre, sucursalId: rondas.sucursalId, activa: rondas.activa, turnos: rondas.turnos, vigenteDesde: rondas.vigenteDesde,
      // Texto literal: Drizzle no califica la columna y dentro de la subconsulta «id» sería el de la parada.
      paradas: sql<number>`(SELECT count(*) FROM ronda_puntos p WHERE p.ronda_id = rondas.id AND p.activo = 1)`,
    }).from(rondas).orderBy(asc(rondas.id)),
    db.select(COLUMNAS_FILA).from(rondaEjecuciones).where(inArray(rondaEjecuciones.fecha, fechas)),
    db.select().from(rondaVigencias),
  ]);
  const ahora = Date.now();
  return sedes.map((s) => {
    const ronda = recorridoDeSede(todas, s.id);
    const linea = ronda ? lineaDeTurnos(ronda, vigencias) : null;
    const vigente = linea ? turnoEn(linea, ahora) : turnoActual([], new Date(ahora));
    const fecha = pedido?.fecha ?? vigente.fecha;
    const turno = pedido?.turno ?? vigente.turno;
    const e = ejecuciones.find((x) => x.sucursalId === s.id && x.fecha === fecha && x.turno === turno) ?? null;
    const { aplica, haceRonda } = exigida(ronda, linea, s, vigencias, fecha, turno);
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
      haceRonda,
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

/**
 * El filtro del tablero: los turnos que rigieron, rigen o van a regir en los
 * recorridos activos, y el turno que corre en el modelo para elegirlo de entrada.
 */
export async function turnosDeTablero(db: Db): Promise<{ turnos: string[]; vigente: TurnoInfo }> {
  const [filas, vigencias] = await db.batch([
    db.select({ id: rondas.id, turnos: rondas.turnos, sucursalId: rondas.sucursalId }).from(rondas).where(eq(rondas.activa, true)).orderBy(asc(rondas.id)),
    db.select().from(rondaVigencias).where(isNotNull(rondaVigencias.rondaId)),
  ]);
  const lineas = filas.map((f) => ({ modelo: f.sucursalId == null, linea: lineaDeTurnos(f, vigencias) }));
  const turnos = [...new Set(lineas.flatMap((x) => x.linea.flatMap((t) => t.turnos)))].sort();
  const base = lineas.find((x) => x.modelo) ?? lineas[0];
  return { turnos, vigente: base ? turnoEn(base.linea) : turnoActual([]) };
}

// ── La revisión semanal ─────────────────────────────────────────────────────
export interface CeldaSemana { fecha: string; turno: string; estado: EstadoFila; ejecucionId: number | null }
export interface ResumenSemana {
  sucursalId: number; lunes: string; domingo: string; turnos: string[]; celdas: CeldaSemana[];
  esperadas: number; completas: number; conNovedad: number; incompletas: number; noHechas: number;
  terminada: boolean; excepciones: boolean;
  /** Si hoy la sede hace ronda. Cada celda se juzga con lo que regía cuando empezó su turno. */
  haceRonda: boolean;
}

export async function resumenSemana(db: Db, sucursalId: number, lunes: string): Promise<ResumenSemana> {
  const domingo = sumarDias(lunes, 6);
  const [todas, sede, filas, vigencias] = await db.batch([
    db.select().from(rondas).where(or(eq(rondas.sucursalId, sucursalId), isNull(rondas.sucursalId))).orderBy(asc(rondas.id)),
    db.select({ haceRonda: sucursales.haceRonda }).from(sucursales).where(eq(sucursales.id, sucursalId)).limit(1),
    db.select(COLUMNAS_FILA).from(rondaEjecuciones).where(and(eq(rondaEjecuciones.sucursalId, sucursalId), gte(rondaEjecuciones.fecha, lunes), lte(rondaEjecuciones.fecha, domingo))),
    db.select().from(rondaVigencias).where(or(eq(rondaVigencias.sucursalId, sucursalId), isNotNull(rondaVigencias.rondaId))),
  ]);
  const ronda = recorridoDeSede(todas, sucursalId);
  const haceRonda = sede[0]?.haceRonda ?? true;
  const linea = ronda ? lineaDeTurnos(ronda, vigencias) : null;
  const dias = Array.from({ length: 7 }, (_, d) => sumarDias(lunes, d));
  const hecha = (fecha: string, turno: string) => filas.find((f) => f.fecha === fecha && f.turno === turno) ?? null;
  const seExigia = (fecha: string, turno: string) => exigida(ronda, linea, { id: sucursalId, haceRonda }, vigencias, fecha, turno).aplica;
  // Una fila por turno que se exigió algún día de esa semana o que tuvo ronda: nada hecho desaparece
  // y un turno que se agregó después no aparece como «no se hizo» en los días de antes.
  const candidatos = new Set(linea ? linea.flatMap((t) => t.turnos) : []);
  for (const f of filas) candidatos.add(f.turno);
  const turnos = [...candidatos].sort().filter((t) => dias.some((fecha) => hecha(fecha, t) || seExigia(fecha, t)));
  const vigente = linea ? turnoEn(linea) : turnoActual([]);
  const celdas: CeldaSemana[] = [];
  for (const fecha of dias) {
    for (const turno of turnos) {
      const e = hecha(fecha, turno);
      const aplica = !!e || seExigia(fecha, turno);
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
    // Termina cuando termina su último turno: el lunes de madrugada todavía corre el del domingo.
    terminada: vigente.fecha > domingo, excepciones: false, haceRonda,
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
