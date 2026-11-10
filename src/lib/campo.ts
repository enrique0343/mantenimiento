// ─── Modo técnico · lo que el celular pide y lo que el celular envía ─────────
//
// El celular trabaja primero y sincroniza después. Por eso cada cambio viaja
// como una operación con identificador propio y con la hora real en que se
// capturó: si se corta la señal, se guarda en el teléfono y llega cuando vuelva,
// con su hora verdadera y sin aplicarse dos veces.
//
// Nada de esto relaja las reglas: cada operación sobre una orden pasa por el
// mismo camino de la ficha completa: aplicarCambioOrden para la orden y
// src/lib/mop.ts para los prerrequisitos y las lecturas de liberación.
import type { APIContext } from "astro";
import { and, asc, desc, eq, gte, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  activos, aopAcciones, aopEventos, aopUmbrales, campoOperaciones, checklistPlantillaItems, checklistPlantillas,
  eopFicha, ordenLiberaciones, ordenPasoMarcas, ordenPrerrequisitos, ordenVerificacion, ordenVerificacionEventos, ordenes, planesMantenimiento, procedimientos, rondaEjecuciones,
  rondaLecturas, sucursales, tickets, ubicaciones, usuarios,
} from "@/lib/schema";
import { aplicarCambioOrden } from "@/lib/orden-cambio";
import { fotosDeEvidencia } from "@/lib/orden-verificacion";
import { MENSAJE_PASO_SIN_NUMERO, minutosEstimadosChecklist, parseChecklist, pasoConRango, validarAreaTrabajo, vencimientoCausaRaiz, type ChecklistItem } from "@/lib/ordenes";
import { accionesDelCelular, checklistVacio, eopsDeOrdenes, esHitoEop, fichaEop, HITOS_EOP, minimoDeHito, pasosDeAcciones, sembrarAccionesEop, SIN_EOP, type EopDeOrden, type FichaEop } from "@/lib/eop";
import { cambiarPrerrequisito, lecturaEscrita, liberacionParaCampo, mopDeOrdenes, prerrequisitoParaCampo, RechazoMop, registrarLiberacion } from "@/lib/mop";
import { etiquetaOT } from "@/lib/orden-codigo";
import { crearNotificacion } from "@/lib/notif-app";
import { logAudit } from "@/lib/audit";
import { queSigue } from "@/lib/resolver";
import {
  abrirEjecucion, buscarEjecucion, cerrarEjecucion, existeTurno, inicioTurno, ligarOrdenALectura, omitidosEntre, paradasDeEjecucion, proximoTramo, puntosDeRonda, recorridoConLinea,
  recorridoDe, registrarLectura, siguienteInicio, turnoEn, turnosEn, etiquetaTurno, type RondaEjecucion,
} from "@/lib/ronda-turno";
import { LINEAS_CON_ORDEN, laHora } from "@/lib/turnos";
import { abrirEvento, ESTADOS_AOP_ABIERTOS } from "@/lib/aop";
import { leerNumero, textoDeNumero } from "@/lib/numero";
import { calcularVencimiento } from "@/lib/sla";
import { pasoCambioEnLaFicha, PASO_DE_LA_FRASE, envioConPasosCambiados } from "@/lib/frases-campo";

type Db = ReturnType<typeof getDb>;
type Usuario = { id: number; rol: any; nombre: string; especialidad?: string | null };

export const puedeUsarCampo = (rol: string) => ["admin", "jefe", "tecnico"].includes(rol);

// ── La hora capturada ───────────────────────────────────────────────────────
const MAX_FUTURO_MS = 5 * 60_000;
const MAX_PASADO_MS = 14 * 86_400_000;
const UMBRAL_SIN_SENAL_MS = 2 * 60_000;

export interface Momento {
  iso: string;
  recibido: string;
  sinSenal: boolean;
  ajustado: boolean;
}

/**
 * La hora del celular se respeta si es creíble. Un reloj adelantado o muy viejo
 * no puede mover el registro: se usa la del servidor y queda marcada como
 * ajustada. Tampoco puede quedar antes de lo que ya pasó (`minimo`).
 */
export function momentoCapturado(raw: unknown, minimo?: string | null, ahoraMs = Date.now()): Momento {
  const recibido = new Date(ahoraMs).toISOString();
  const ms = typeof raw === "string" ? Date.parse(raw) : NaN;
  let usar = ahoraMs;
  let ajustado = true;
  if (Number.isFinite(ms) && ms <= ahoraMs + MAX_FUTURO_MS && ms >= ahoraMs - MAX_PASADO_MS) {
    usar = Math.min(ms, ahoraMs);
    ajustado = false;
  }
  const min = minimo ? Date.parse(minimo) : NaN;
  if (Number.isFinite(min) && usar < min) {
    usar = Math.min(min, ahoraMs);
    ajustado = true;
  }
  return { iso: new Date(usar).toISOString(), recibido, sinSenal: ahoraMs - usar > UMBRAL_SIN_SENAL_MS, ajustado };
}

const horaSV = (iso: string) => new Date(Date.parse(iso) - 6 * 3_600_000).toISOString().slice(11, 16);
const iniciales = (nombre: string) => nombre.split(/\s+/).filter(Boolean).slice(0, 3).map((p) => p[0].toUpperCase() + ".").join("");

// ── Cómo ve el celular una orden ────────────────────────────────────────────
type FilaOrden = {
  o: typeof ordenes.$inferSelect;
  a: { id: number; codigo: string; nombre: string; marca: string | null; modelo: string | null; ubicacionId: number | null; criticidad: string | null } | null;
};
type MapaUbicaciones = Map<number, { nombre: string; sucursalId: number }>;

/**
 * Todo se trabaja en el celular, una cosa por pantalla: los pasos de un
 * preventivo o correctivo, la emergencia (EOP) con sus tres toques y la
 * intervención (MOP) con prerrequisitos, liberaciones y reversa. La ficha
 * completa queda para la jefatura.
 */
export const modoDeOrden = (tipo: string): "pasos" | "emergencia" | "intervencion" =>
  tipo === "emergencia" ? "emergencia" : tipo === "intervencion" ? "intervencion" : "pasos";

type ExtraOrden = {
  devuelta?: string | null;
  motivoPausa?: string | null;
  ultimas?: Record<string, string>;
  eop?: EopDeOrden;
  prerrequisitos?: Array<typeof ordenPrerrequisitos.$inferSelect>;
  liberaciones?: Array<typeof ordenLiberaciones.$inferSelect>;
  /** Fotos del trabajo que ya tiene la orden: sin una, el celular no deja enviarla. */
  fotos?: number;
};

/** La sede de la orden: la de la ubicación de su equipo, la de su ubicación o la suya. */
function lugarDeFila(fila: FilaOrden, ubis: MapaUbicaciones) {
  const ubId = fila.a?.ubicacionId ?? fila.o.ubicacionId ?? null;
  const ub = ubId ? ubis.get(ubId) : undefined;
  return { ubId, ub, sedeId: ub?.sucursalId ?? fila.o.sucursalId ?? null };
}

function ordenParaCampo(fila: FilaOrden, ubis: MapaUbicaciones, sedes: Map<number, string>, extra: ExtraOrden = {}) {
  const { o, a } = fila;
  const { ubId, ub, sedeId } = lugarDeFila(fila, ubis);
  const modo = modoDeOrden(o.tipo);
  // Una emergencia sin pasos propios trabaja con las acciones de su EOP. Se
  // guardan en la orden con el primer toque (orden.iniciar u orden.paso).
  const pasos: ChecklistItem[] = modo === "emergencia" && checklistVacio(o.checklistEjecucion)
    ? pasosDeAcciones(extra.eop?.acciones ?? [])
    : parseChecklist(o.checklistEjecucion);
  const base = {
    id: o.id,
    rubro: o.rubro,
    codigo: o.codigo ?? null,
    titulo: o.titulo,
    tipo: o.tipo,
    estado: o.estado,
    prioridad: o.prioridad,
    clase: o.clasePrioridad ?? null,
    vencimiento: o.vencimiento ?? null,
    iniciadaEn: o.iniciadaEn ?? null,
    pausadaEn: o.pausadaEn ?? null,
    pausadoMin: o.tiempoPausadoMin ?? 0,
    asignadoA: o.asignadoA ?? null,
    planId: o.planId ?? null,
    descripcion: o.descripcion ?? null,
    trabajos: o.trabajosRealizados ?? null,
    // La causa raíz la escribe la jefatura dentro de las 72 h: el celular ni la pide ni la muestra.
    modo,
    devuelta: extra.devuelta ?? null,
    motivoPausa: extra.motivoPausa ?? null,
    // Las fotos de antes de empezar muestran la falla, no el trabajo: una orden sin empezar no tiene ninguna.
    fotos: o.estado === "abierta" ? 0 : extra.fotos ?? 0,
    activo: a ? { id: a.id, codigo: a.codigo, nombre: a.nombre, marca: a.marca, modelo: a.modelo } : null,
    lugar: {
      sedeId,
      sede: sedeId ? sedes.get(sedeId) ?? null : null,
      ubicacionId: ubId,
      ubicacion: ub?.nombre ?? o.ubicacionDetalle ?? null,
    },
    estimadoMin: minutosEstimadosChecklist(pasos),
    pasos: pasos.map((p, idx) => ({
      idx,
      texto: p.texto,
      estado: p.estado,
      nota: p.notas ?? null,
      criterio: p.criterio ?? null,
      critico: !!p.bloqueante,
      minutos: p.minutos ?? null,
      materiales: p.materiales ?? null,
      valor: p.valorMedido ?? null,
      pideValor: !!p.requiereValor,
      unidad: p.unidad ?? null,
      min: p.esperadoMin ?? null,
      max: p.esperadoMax ?? null,
      ultima: extra.ultimas?.[p.texto] ?? null,
    })),
  };
  // Las horas de la emergencia se registran pero no viajan: el celular solo sabe qué toques ya se dieron.
  if (modo === "emergencia") {
    const eop = extra.eop ?? SIN_EOP;
    return {
      ...base,
      eop: { codigo: eop.codigo, titulo: eop.titulo, etiquetaMitigacion: eop.etiquetaMitigacion },
      hitos: { llegada: !!o.horaLlegada, mitigacion: !!o.horaMitigacion, restablecimiento: !!o.horaRestablecimiento },
    };
  }
  if (modo === "intervencion") {
    return {
      ...base,
      prerrequisitos: (extra.prerrequisitos ?? []).map(prerrequisitoParaCampo),
      liberaciones: (extra.liberaciones ?? []).map(liberacionParaCampo),
      reversa: { plan: o.planReversa ?? null, ejecutada: !!o.reversaEjecutada },
    };
  }
  return base;
}

/**
 * Lo que una emergencia o una intervención trae además de sus pasos, para
 * varias órdenes a la vez. Cada emergencia llega con su EOP y sus acciones,
 * sean cuantas sean: el EOP se busca para todas juntas, en pocas consultas.
 */
async function extrasDeCampo(db: Db, filas: FilaOrden[], ubis: MapaUbicaciones, opciones: { conocidas?: Map<number, FichaEop> } = {}) {
  const emergencias = filas.filter((f) => f.o.tipo === "emergencia");
  const eops = emergencias.length
    ? await eopsDeOrdenes(db, emergencias.map((f) => ({ id: f.o.id, procedimientoId: f.o.procedimientoId ?? null, activoId: f.o.activoId ?? null, sedeId: lugarDeFila(f, ubis).sedeId })), opciones)
    : new Map<number, EopDeOrden>();
  const mop = await mopDeOrdenes(db, filas.filter((f) => f.o.tipo === "intervencion").map((f) => f.o.id));
  return (id: number): ExtraOrden => ({ eop: eops.get(id), prerrequisitos: mop.prerrequisitos.get(id) ?? [], liberaciones: mop.liberaciones.get(id) ?? [] });
}

/** Lo último que se leyó en cada línea del plan, para tener contra qué comparar. */
async function ultimasLecturasDelPlan(db: Db, planId: number, ordenId: number): Promise<Record<string, string>> {
  const [previa] = await db
    .select({ checklist: ordenes.checklistEjecucion })
    .from(ordenes)
    .where(and(eq(ordenes.planId, planId), ne(ordenes.id, ordenId), inArray(ordenes.estado, ["completada", "verificada", "cerrada"])))
    .orderBy(desc(ordenes.completadaEn))
    .limit(1);
  const out: Record<string, string> = {};
  for (const p of parseChecklist(previa?.checklist)) if (p.requiereValor && p.valorMedido) out[p.texto] = p.valorMedido;
  return out;
}

// ── Documentos de la ronda, para tenerlos sin señal ─────────────────────────
export async function documentosAop(db: Db, ids: number[]) {
  const out: Record<string, any> = {};
  if (!ids.length) return out;
  const docs = await db.select({ id: procedimientos.id, codigo: procedimientos.codigoCorto, titulo: procedimientos.titulo }).from(procedimientos).where(inArray(procedimientos.id, ids));
  const umbrales = await db.select().from(aopUmbrales).where(inArray(aopUmbrales.procedimientoId, ids));
  const acciones = await db.select({ pid: aopAcciones.procedimientoId, orden: aopAcciones.orden, accion: aopAcciones.accion }).from(aopAcciones).where(inArray(aopAcciones.procedimientoId, ids)).orderBy(asc(aopAcciones.orden));
  const eopIds = [...new Set(umbrales.map((u) => u.eopProcedimientoId).filter((x): x is number => x != null))];
  const eops = eopIds.length
    ? await db.select({ id: procedimientos.id, codigo: procedimientos.codigoCorto, titulo: procedimientos.titulo, a1: eopFicha.accion1, a2: eopFicha.accion2, a3: eopFicha.accion3 })
        .from(procedimientos).leftJoin(eopFicha, eq(eopFicha.procedimientoId, procedimientos.id)).where(inArray(procedimientos.id, eopIds))
    : [];
  for (const d of docs) {
    const u = umbrales.find((x) => x.procedimientoId === d.id);
    const e = u?.eopProcedimientoId ? eops.find((x) => x.id === u.eopProcedimientoId) : undefined;
    out[d.codigo] = {
      id: d.id,
      codigo: d.codigo,
      titulo: d.titulo,
      actuarMin: u?.minutosParaActuar ?? null,
      escalarMin: u?.minutosParaEscalar ?? null,
      acciones: acciones.filter((a) => a.pid === d.id).slice(0, 3).map((a) => a.accion),
      eop: e ? { id: e.id, codigo: e.codigo, titulo: e.titulo, acciones: [e.a1, e.a2, e.a3].filter(Boolean) } : null,
    };
  }
  return out;
}

const HORA_MS = 3_600_000;

async function rondaParaSede(db: Db, sedeId: number) {
  const ahora = Date.now();
  const r = await recorridoConLinea(db, sedeId);
  if (!r) return null;
  const { ronda, linea } = r;
  // El turno que corre según la línea de tiempo: un cambio de turnos entra con el primer turno de su lista.
  const t = turnoEn(linea, ahora);
  if (!r.haceRondaEn(inicioTurno(t.fecha, t.turno))) return null;
  const proximo = proximoTramo(linea, ahora);
  // La marca «no hace ronda» entra en el turno que todavía no empezó: desde ahí el celular sin señal no abre una ronda nueva.
  const sig = siguienteInicio(linea, ahora + 1);
  const sigMs = inicioTurno(sig.fecha, sig.turno);
  const ejec = await buscarEjecucion(db, { sucursalId: sedeId, fecha: t.fecha, turno: t.turno });
  const puntos = ejec ? await paradasDeEjecucion(db, ejec) : await puntosDeRonda(db, ronda.id);
  // Lo que dejó el turno anterior: la línea 1 del SOP empieza por aquí.
  const [anterior] = await db
    .select({ fecha: rondaEjecuciones.fecha, turno: rondaEjecuciones.turno, notas: rondaEjecuciones.notas, firma: rondaEjecuciones.firmaNombre, en: rondaEjecuciones.completadaEn })
    .from(rondaEjecuciones)
    .where(and(eq(rondaEjecuciones.sucursalId, sedeId), eq(rondaEjecuciones.estado, "completada"), ejec ? ne(rondaEjecuciones.id, ejec.id) : undefined))
    .orderBy(desc(rondaEjecuciones.completadaEn))
    .limit(1);
  const idsAop = [...new Set(puntos.map((p) => p.aopProcedimientoId).filter((x): x is number => x != null))];
  const docs = await documentosAop(db, idsAop);
  const codigoDe = new Map(Object.values(docs).map((d: any) => [d.id, d.codigo]));
  const lecturas = ejec ? await db.select().from(rondaLecturas).where(eq(rondaLecturas.ejecucionId, ejec.id)) : [];
  const previas = await db
    .select({ punto: rondaLecturas.puntoId, valor: rondaLecturas.valor })
    .from(rondaLecturas)
    .innerJoin(rondaEjecuciones, eq(rondaEjecuciones.id, rondaLecturas.ejecucionId))
    .where(and(eq(rondaEjecuciones.sucursalId, sedeId), ejec ? ne(rondaEjecuciones.id, ejec.id) : undefined, sql`${rondaLecturas.valor} IS NOT NULL`))
    .orderBy(desc(rondaLecturas.registradoEn))
    .limit(300);
  const ultimas = new Map<number, number>();
  for (const f of previas) if (!ultimas.has(f.punto) && f.valor != null) ultimas.set(f.punto, f.valor);
  return {
    // La ronda ya abierta sigue con el recorrido con que se abrió.
    rondaId: ejec?.rondaId ?? ronda.id,
    sucursalId: sedeId,
    nombre: ronda.nombre,
    fecha: t.fecha,
    turno: t.turno,
    etiqueta: etiquetaTurno(t.turno),
    // Sin señal, el celular calcula el turno con «turnos» y, desde «turnosProximos.desde», con la lista nueva.
    turnos: turnosEn(linea, ahora),
    turnosProximos: proximo ? { desde: new Date(proximo.desde).toISOString(), turnos: proximo.turnos } : null,
    // Los turnos que no se abren por un cambio de turnos: si el celular calcula uno, sigue el que corría antes.
    omite: omitidosEntre(linea, ahora - 24 * HORA_MS, ahora + 72 * HORA_MS),
    noHaceRondaDesde: r.haceRondaEn(sigMs) ? null : new Date(sigMs).toISOString(),
    entregaAnterior: anterior ?? null,
    minutos: ronda.minutosEstimados ?? null,
    estado: ejec ? ejec.estado : "sin_iniciar",
    ejecucionId: ejec?.id ?? null,
    iniciadaEn: ejec?.iniciadaEn ?? null,
    puntos: puntos.map((p) => ({
      id: p.id,
      orden: p.orden,
      sistema: p.sistema,
      texto: p.etiqueta,
      ayuda: p.instruccion ?? null,
      pideValor: !!p.requiereValor,
      unidad: p.unidad ?? null,
      min: p.minEsperado ?? null,
      max: p.maxEsperado ?? null,
      esperado: p.valorEsperadoTexto ?? null,
      critico: !!p.critico,
      aop: p.aopProcedimientoId ? codigoDe.get(p.aopProcedimientoId) ?? null : null,
      linea: p.lineaSop ?? null,
      pideOrden: LINEAS_CON_ORDEN.includes(p.lineaSop ?? 0),
      actuarMin: p.minutosActuar ?? null,
      escalarMin: p.minutosEscalar ?? null,
      // Como texto que se vuelve a leer igual: 12.345 viaja «12.3450», no «12.345».
      ultima: ultimas.has(p.id) ? textoDeNumero(ultimas.get(p.id)!) : null,
    })),
    lecturas: Object.fromEntries(lecturas.map((l) => [l.puntoId, { resultado: l.resultado, valor: l.valor, nota: l.nota }])),
    docs,
  };
}

// ── El paquete del día ──────────────────────────────────────────────────────
export async function paqueteHoy(db: Db, user: Usuario, sedePedida: number | null) {
  const sedesFilas = await db.select({ id: sucursales.id, nombre: sucursales.nombre }).from(sucursales).where(eq(sucursales.activa, true)).orderBy(asc(sucursales.nombre));
  const sedes = new Map(sedesFilas.map((s) => [s.id, s.nombre]));
  const [yo] = await db.select({ sucursalId: usuarios.sucursalId }).from(usuarios).where(eq(usuarios.id, user.id)).limit(1);
  const sedeId = sedePedida && sedes.has(sedePedida) ? sedePedida : yo?.sucursalId && sedes.has(yo.sucursalId) ? yo.sucursalId : null;
  // Lo primero del turno se lee primero. Si falla, el celular conserva la que ya tenía: no es que no haya ronda.
  let rondaError = false;
  const ronda = sedeId ? await rondaParaSede(db, sedeId).catch((e) => { console.error("campo_ronda", e); rondaError = true; return null; }) : null;

  const ubisFilas = await db.select({ id: ubicaciones.id, nombre: ubicaciones.nombre, sucursalId: ubicaciones.sucursalId }).from(ubicaciones);
  const ubis: MapaUbicaciones = new Map(ubisFilas.map((u) => [u.id, { nombre: u.nombre, sucursalId: u.sucursalId }]));

  const columnasActivo = { id: activos.id, codigo: activos.codigo, nombre: activos.nombre, marca: activos.marca, modelo: activos.modelo, ubicacionId: activos.ubicacionId, criticidad: activos.criticidadOperacional };
  const mias = (await db
    .select({ o: ordenes, a: columnasActivo })
    .from(ordenes)
    .leftJoin(activos, eq(activos.id, ordenes.activoId))
    .where(and(eq(ordenes.asignadoA, user.id), inArray(ordenes.estado, ["abierta", "en_proceso", "en_espera"])))
    .orderBy(asc(ordenes.vencimiento), asc(ordenes.id))
    .limit(60)) as FilaOrden[];

  // Órdenes sin dueño en esta sede: quien esté ahí las puede tomar.
  let libres: FilaOrden[] = [];
  if (sedeId) {
    const candidatas = (await db
      .select({ o: ordenes, a: columnasActivo })
      .from(ordenes)
      .leftJoin(activos, eq(activos.id, ordenes.activoId))
      .where(and(isNull(ordenes.asignadoA), eq(ordenes.estado, "abierta")))
      .orderBy(asc(ordenes.vencimiento), asc(ordenes.id))
      .limit(80)) as FilaOrden[];
    const esp = user.especialidad;
    libres = candidatas
      .filter((f) => {
        const ubId = f.a?.ubicacionId ?? f.o.ubicacionId;
        const sede = (ubId ? ubis.get(ubId)?.sucursalId : null) ?? f.o.sucursalId;
        return sede === sedeId;
      })
      .filter((f) => (esp === "biomedico" ? f.o.rubro === "biomedico" : esp === "general" ? f.o.rubro !== "biomedico" : true));
  }

  // El último motivo de pausa o de devolución. Se lee del historial porque la
  // verificación solo guarda el motivo de la última operación.
  const ids = mias.map((f) => f.o.id);
  const eventos = ids.length
    ? await db.select({ ordenId: ordenVerificacionEventos.ordenId, accion: ordenVerificacionEventos.accion, motivo: ordenVerificacionEventos.motivo })
        .from(ordenVerificacionEventos)
        .where(and(inArray(ordenVerificacionEventos.ordenId, ids), inArray(ordenVerificacionEventos.accion, ["bloqueo", "devolucion", "reapertura", "devolucion_solicitante", "ejecucion_completada"])))
        .orderBy(asc(ordenVerificacionEventos.id))
    : [];
  const devueltas = new Map<number, string | null>();
  const pausas = new Map<number, string | null>();
  for (const ev of eventos) {
    if (ev.accion === "bloqueo") pausas.set(ev.ordenId, ev.motivo);
    else if (ev.accion === "ejecucion_completada") devueltas.delete(ev.ordenId);
    else devueltas.set(ev.ordenId, ev.motivo);
  }

  // Las últimas lecturas de cada plan, en una sola consulta: D1 corta a 50 por solicitud.
  const planesConLectura = [...new Set([...mias, ...libres].filter((f) => f.o.planId && parseChecklist(f.o.checklistEjecucion).some((p) => p.requiereValor)).map((f) => f.o.planId as number))].slice(0, 90);
  const previas = planesConLectura.length
    ? await db.select({ planId: ordenes.planId, checklist: ordenes.checklistEjecucion }).from(ordenes).where(and(inArray(ordenes.planId, planesConLectura), inArray(ordenes.estado, ["completada", "verificada", "cerrada"]))).orderBy(desc(ordenes.completadaEn)).limit(300)
    : [];
  const ultimasPorPlan = new Map<number, Record<string, string>>();
  for (const fila of previas) {
    if (fila.planId == null || ultimasPorPlan.has(fila.planId)) continue;
    const valores: Record<string, string> = {};
    for (const p of parseChecklist(fila.checklist)) if (p.requiereValor && p.valorMedido) valores[p.texto] = p.valorMedido;
    ultimasPorPlan.set(fila.planId, valores);
  }
  // Los EOP viajan con el paquete: una emergencia no espera a que vuelva la señal.
  const eops = await db
    .select({
      id: procedimientos.id, codigo: procedimientos.codigoCorto, titulo: procedimientos.titulo, sistema: procedimientos.sistema, tipo: procedimientos.tipo,
      a1: eopFicha.accion1, a2: eopFicha.accion2, a3: eopFicha.accion3, etiqueta: eopFicha.etiquetaHoraMitigacion,
    })
    .from(procedimientos)
    .innerJoin(eopFicha, eq(eopFicha.procedimientoId, procedimientos.id))
    .where(and(eq(procedimientos.tipo, "eop"), eq(procedimientos.activo, true)))
    .orderBy(asc(procedimientos.codigoCorto));
  const fichas = eops.map(fichaEop);
  // Prerrequisitos y liberaciones de las intervenciones, y el EOP de cada emergencia, sin una consulta por orden.
  const extras = await extrasDeCampo(db, [...mias, ...libres], ubis, { conocidas: new Map(fichas.map((e) => [e.id, e])) });
  // Las fotos del trabajo que ya tiene cada orden mía: el celular no deja enviar una sin foto.
  const fotos = await fotosDeEvidencia(db, ids);
  const armar = (f: FilaOrden) => {
    const ultimas = (f.o.planId && ultimasPorPlan.get(f.o.planId)) || {};
    return ordenParaCampo(f, ubis, sedes, { devuelta: devueltas.get(f.o.id) ?? null, motivoPausa: f.o.estado === "en_espera" ? pausas.get(f.o.id) ?? null : null, ultimas, fotos: fotos.get(f.o.id) ?? 0, ...extras(f.o.id) });
  };
  const ordenesVista = mias.map(armar);
  const libresVista = libres.map(armar);

  const misTickets = await db
    .select({ id: tickets.id, asunto: tickets.asunto, estado: tickets.estado, prioridad: tickets.prioridad, solicitante: tickets.solicitanteNombre, sede: sucursales.nombre })
    .from(tickets)
    .leftJoin(sucursales, eq(sucursales.id, tickets.sucursalId))
    .where(and(eq(tickets.asignadoA, user.id), inArray(tickets.estado, ["nuevo", "asignado", "en_proceso"])))
    .orderBy(desc(tickets.id))
    .limit(20);

  const desviaciones = await db
    .select({
      id: aopEventos.id, codigo: procedimientos.codigoCorto, titulo: procedimientos.titulo, estado: aopEventos.estado,
      detectadoEn: aopEventos.detectadoEn, actuarAntesDe: aopEventos.actuarAntesDe, escalarAntesDe: aopEventos.escalarAntesDe,
      valor: aopEventos.valorDetectado, unidad: aopEventos.unidad, sala: ubicaciones.nombre,
    })
    .from(aopEventos)
    .leftJoin(procedimientos, eq(procedimientos.id, aopEventos.procedimientoId))
    .leftJoin(ubicaciones, eq(ubicaciones.id, aopEventos.ubicacionId))
    .where(and(inArray(aopEventos.estado, ESTADOS_AOP_ABIERTOS), sedeId ? eq(aopEventos.sucursalId, sedeId) : undefined))
    .orderBy(desc(aopEventos.detectadoEn))
    .limit(15);

  // Si jefatura le pidió verificar a este técnico, también le toca verlo aquí.
  const porVerificar = await db
    .select({ id: ordenes.id, codigo: ordenes.codigo, titulo: ordenes.titulo, completadaEn: ordenes.completadaEn })
    .from(ordenVerificacion)
    .innerJoin(ordenes, eq(ordenes.id, ordenVerificacion.ordenId))
    .where(and(or(eq(ordenVerificacion.revisorId, user.id), eq(ordenVerificacion.revisorSuplenteId, user.id)), eq(ordenes.estado, "completada")))
    .orderBy(asc(ordenes.completadaEn))
    .limit(12);

  const hoySV = new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
  const inicioHoy = new Date(`${hoySV}T06:00:00.000Z`).toISOString();
  const hechasHoy = await db
    .select({ id: ordenes.id, codigo: ordenes.codigo, titulo: ordenes.titulo, estado: ordenes.estado, completadaEn: ordenes.completadaEn })
    .from(ordenes)
    .where(and(eq(ordenes.asignadoA, user.id), inArray(ordenes.estado, ["completada", "verificada", "cerrada"]), gte(ordenes.completadaEn, inicioHoy)))
    .orderBy(desc(ordenes.completadaEn))
    .limit(30);

  return {
    generadoEn: new Date().toISOString(),
    usuario: { id: user.id, nombre: user.nombre, rol: user.rol, sucursalId: yo?.sucursalId ?? null },
    sedes: sedesFilas,
    sedeId,
    ronda,
    ...(rondaError ? { rondaError: true } : {}),
    ordenes: ordenesVista,
    libres: libresVista,
    tickets: misTickets,
    desviaciones,
    porVerificar,
    hechasHoy,
    emergencias: eops.map((e, i) => ({ id: e.id, codigo: e.codigo, titulo: e.titulo, sistema: e.sistema, acciones: fichas[i].acciones, etiquetaMitigacion: fichas[i].etiquetaMitigacion })),
  };
}

// ── Buscar un equipo: sede → ubicación → equipo ─────────────────────────────
export async function ubicacionesDeSede(db: Db, sedeId: number) {
  const filas = await db.select({ id: ubicaciones.id, nombre: ubicaciones.nombre, tipo: ubicaciones.tipo, padreId: ubicaciones.padreId }).from(ubicaciones).where(and(eq(ubicaciones.sucursalId, sedeId), eq(ubicaciones.activa, true))).orderBy(asc(ubicaciones.nombre));
  const porId = new Map(filas.map((u) => [u.id, u]));
  const ruta = (u: (typeof filas)[number]) => {
    const partes = [u.nombre];
    let p = u.padreId ? porId.get(u.padreId) : undefined;
    for (let i = 0; p && i < 5; i++) { partes.unshift(p.nombre); p = p.padreId ? porId.get(p.padreId) : undefined; }
    return partes.join(" · ");
  };
  const cuenta = filas.length
    ? await db.select({ ub: activos.ubicacionId, n: sql<number>`count(*)` }).from(activos).where(and(inArray(activos.ubicacionId, filas.map((f) => f.id)), ne(activos.estado, "baja"))).groupBy(activos.ubicacionId)
    : [];
  const n = new Map(cuenta.map((c) => [c.ub, Number(c.n)]));
  const lista = filas.map((u) => ({ id: u.id, nombre: ruta(u), equipos: n.get(u.id) ?? 0 })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const [sin] = await db.select({ n: sql<number>`count(*)` }).from(activos).where(and(isNull(activos.ubicacionId), ne(activos.estado, "baja")));
  return { ubicaciones: lista, sinUbicacion: Number(sin?.n ?? 0) };
}

export async function equiposDeUbicacion(db: Db, ubicacionId: number | null) {
  const hoy = new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
  const filas = await db
    .select({ id: activos.id, codigo: activos.codigo, nombre: activos.nombre, marca: activos.marca, modelo: activos.modelo, estado: activos.estado, rubro: activos.rubro, tipo: activos.tipo })
    .from(activos)
    .where(and(ubicacionId ? eq(activos.ubicacionId, ubicacionId) : isNull(activos.ubicacionId), ne(activos.estado, "baja")))
    .orderBy(asc(activos.nombre))
    .limit(400);
  const ids = filas.map((f) => f.id);
  const planes = ids.length ? await db.select({ activoId: planesMantenimiento.activoId, proxima: planesMantenimiento.proximaFecha }).from(planesMantenimiento).where(and(inArray(planesMantenimiento.activoId, ids), eq(planesMantenimiento.activo, true))) : [];
  const abiertas = ids.length ? await db.select({ activoId: ordenes.activoId }).from(ordenes).where(and(inArray(ordenes.activoId, ids), inArray(ordenes.estado, ["abierta", "en_proceso", "en_espera"]))) : [];
  return filas.map((f) => {
    const delEquipo = planes.filter((p) => p.activoId === f.id).map((p) => p.proxima).sort();
    return { ...f, proxima: delEquipo[0] ?? null, vencido: !!delEquipo[0] && delEquipo[0] < hoy, abiertas: abiertas.filter((a) => a.activoId === f.id).length };
  });
}

export async function fichaEquipo(db: Db, activoId: number, user: Usuario) {
  const [a] = await db
    .select({
      id: activos.id, codigo: activos.codigo, nombre: activos.nombre, marca: activos.marca, modelo: activos.modelo, serial: activos.serial,
      estado: activos.estado, rubro: activos.rubro, tipo: activos.tipo, categoria: activos.categoria, sistema: activos.sistema, padreId: activos.padreId,
      scpProcedimientoId: activos.scpProcedimientoId, ubicacionId: activos.ubicacionId,
      ubicacion: ubicaciones.nombre, sedeId: ubicaciones.sucursalId, sede: sucursales.nombre,
    })
    .from(activos)
    .leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId))
    .leftJoin(sucursales, eq(sucursales.id, ubicaciones.sucursalId))
    .where(eq(activos.id, activoId))
    .limit(1);
  if (!a) return null;
  const planes = await db.select().from(planesMantenimiento).where(and(eq(planesMantenimiento.activoId, activoId), eq(planesMantenimiento.activo, true))).orderBy(asc(planesMantenimiento.proximaFecha));
  const abiertas = await db
    .select({ id: ordenes.id, codigo: ordenes.codigo, titulo: ordenes.titulo, estado: ordenes.estado, tipo: ordenes.tipo, asignadoA: ordenes.asignadoA, asignado: usuarios.nombre, planId: ordenes.planId })
    .from(ordenes)
    .leftJoin(usuarios, eq(usuarios.id, ordenes.asignadoA))
    .where(and(eq(ordenes.activoId, activoId), inArray(ordenes.estado, ["abierta", "en_proceso", "en_espera"])))
    .orderBy(desc(ordenes.id));
  const falla = await queSigue(db, activoId, "falla", a.sedeId ?? null);
  const desv = await queSigue(db, activoId, "desviacion", a.sedeId ?? null);
  const accionesAop = desv.documento
    ? (await db.select({ accion: aopAcciones.accion }).from(aopAcciones).where(eq(aopAcciones.procedimientoId, desv.documento.id)).orderBy(asc(aopAcciones.orden)).limit(3)).map((x) => x.accion)
    : [];
  const idsPlantilla = planes.filter((p) => !p.checklist && p.plantillaId).map((p) => p.plantillaId as number);
  const itemsPlantilla = idsPlantilla.length
    ? await db.select({ plantillaId: checklistPlantillaItems.plantillaId, minutos: checklistPlantillaItems.minutosEstimados }).from(checklistPlantillaItems).where(inArray(checklistPlantillaItems.plantillaId, idsPlantilla))
    : [];
  const plantillas = await db
    .select({ id: checklistPlantillas.id, nombre: checklistPlantillas.nombre, tipo: checklistPlantillas.tipoDocumento, familia: procedimientos.sistema, tipoDoc: procedimientos.tipo })
    .from(checklistPlantillas)
    .leftJoin(procedimientos, eq(procedimientos.id, checklistPlantillas.procedimientoId))
    .where(and(eq(checklistPlantillas.activa, true), ne(checklistPlantillas.tipoDocumento, "mop")))
    .orderBy(asc(checklistPlantillas.nombre))
    .limit(40);
  // La rutina de su familia ya viene elegida: el técnico no tiene que buscarla.
  const familia = falla.documento?.sistema ?? desv.documento?.sistema ?? null;
  const plantillaSugerida = familia ? plantillas.find((p) => p.familia === familia && p.tipoDoc === "sop")?.id ?? null : null;
  return {
    activo: a,
    planes: planes.map((p) => {
      const propios = parseChecklist(p.checklist);
      const dePlantilla = itemsPlantilla.filter((i) => i.plantillaId === p.plantillaId);
      const minutos = minutosEstimadosChecklist(propios) || dePlantilla.reduce((s, i) => s + (i.minutos ?? 0), 0);
      return { id: p.id, titulo: p.titulo, frecuencia: p.frecuencia, proxima: p.proximaFecha, pasos: propios.length || dePlantilla.length, estimadoMin: minutos || (p.horasEstimadas ? Math.round(p.horasEstimadas * 60) : null) };
    }),
    abiertas: abiertas.map((o) => ({ ...o, mia: o.asignadoA === user.id, libre: !o.asignadoA })),
    falla: falla.documento ? { id: falla.documento.id, codigo: falla.documento.codigoCorto, titulo: falla.documento.titulo, acciones: falla.primerasAcciones, fueraDeAlcance: !!falla.fueraDeAlcance, aviso: falla.fueraDeAlcance ? falla.aviso : null } : null,
    desviacion: desv.documento ? { id: desv.documento.id, codigo: desv.documento.codigoCorto, titulo: desv.documento.titulo, actuarMin: desv.minutosParaActuar ?? null, escalarMin: desv.minutosParaEscalar ?? null, acciones: accionesAop, fueraDeAlcance: !!desv.fueraDeAlcance, aviso: desv.fueraDeAlcance ? desv.aviso : null } : null,
    plantillas: plantillas.map(({ id, nombre, tipo }) => ({ id, nombre, tipo })),
    plantillaSugerida,
  };
}

// ── Avisos a la jefatura ────────────────────────────────────────────────────
async function avisarJefatura(ctx: APIContext, db: Db, titulo: string, mensaje: string | undefined, link: string) {
  try {
    const jefes = await db.select({ id: usuarios.id }).from(usuarios).where(and(inArray(usuarios.rol, ["admin", "jefe"]), eq(usuarios.activo, true)));
    for (const j of jefes) await crearNotificacion(ctx, { usuarioId: j.id, tipo: "campo", titulo, mensaje, link });
  } catch {}
}

const sucursalDeUbicacion = async (db: Db, ubicacionId: number | null | undefined) => {
  if (!ubicacionId) return null;
  const [u] = await db.select({ s: ubicaciones.sucursalId }).from(ubicaciones).where(eq(ubicaciones.id, ubicacionId)).limit(1);
  return u?.s ?? null;
};

async function checklistDePlantilla(db: Db, plantillaId: number): Promise<string | null> {
  const items = await db.select().from(checklistPlantillaItems).where(eq(checklistPlantillaItems.plantillaId, plantillaId)).orderBy(asc(checklistPlantillaItems.orden));
  if (!items.length) return null;
  return JSON.stringify(items.map((i) => ({
    texto: i.texto, estado: "pendiente", criterio: i.criterioAceptacion ?? undefined, bloqueante: !!i.bloqueante, minutos: i.minutosEstimados ?? undefined,
    materiales: i.materiales ?? undefined, requiereValor: !!i.requiereValor, unidad: i.unidad ?? undefined, esperadoMin: i.valorEsperadoMin ?? undefined, esperadoMax: i.valorEsperadoMax ?? undefined,
  })));
}

const vencimientoDePlan = (p: typeof planesMantenimiento.$inferSelect) => {
  const v = new Date(p.proximaFecha);
  if (Number.isNaN(v.getTime())) return null;
  v.setUTCDate(v.getUTCDate() + (p.alertaDiasAntes ?? 0));
  return v.toISOString();
};

/** Un rechazo por regla. `motivo` es el de la respuesta de la orden («otra-escritura», por ejemplo), si lo trae. */
export class RechazoCampo extends Error {
  constructor(message: string, public status = 400, public motivo?: string, public pasos?: number[]) { super(message); }
}

/** Mantenimiento fuera de la lista de trabajo: del plan del equipo o no programado. */
export async function crearOrdenEnCampo(
  ctx: APIContext, db: Db, user: Usuario,
  input: { activoId: number; planId?: number | null; tipo?: "preventivo" | "correctivo"; descripcion?: string | null; plantillaId?: number | null },
) {
  const [a] = await db.select({ id: activos.id, codigo: activos.codigo, nombre: activos.nombre, marca: activos.marca, modelo: activos.modelo, ubicacionId: activos.ubicacionId, rubro: activos.rubro, tipo: activos.tipo, estado: activos.estado }).from(activos).where(eq(activos.id, input.activoId)).limit(1);
  if (!a) throw new RechazoCampo("Ese equipo ya no existe.", 404);
  if (a.estado === "baja") throw new RechazoCampo("Ese equipo está dado de baja.", 409);
  const ahora = new Date().toISOString();
  const sucursalId = await sucursalDeUbicacion(db, a.ubicacionId);
  const area = await validarAreaTrabajo(db, { activoId: a.id, sucursalId, ubicacionId: a.ubicacionId });
  if ("error" in area) throw new RechazoCampo(area.error);

  let plan: typeof planesMantenimiento.$inferSelect | undefined;
  if (input.planId) {
    [plan] = await db.select().from(planesMantenimiento).where(and(eq(planesMantenimiento.id, input.planId), eq(planesMantenimiento.activoId, a.id), eq(planesMantenimiento.activo, true))).limit(1);
    if (!plan) throw new RechazoCampo("Ese plan ya no está activo para este equipo.", 409);
    const [yaAbierta] = await db.select({ id: ordenes.id, asignadoA: ordenes.asignadoA }).from(ordenes).where(and(eq(ordenes.planId, plan.id), inArray(ordenes.estado, ["abierta", "en_proceso", "en_espera"]))).limit(1);
    if (yaAbierta) {
      if (yaAbierta.asignadoA && yaAbierta.asignadoA !== user.id) throw new RechazoCampo("Este plan ya tiene una orden abierta asignada a otra persona.", 409);
      return { ordenId: yaAbierta.id, yaExistia: true };
    }
    const [enRevision] = await db.select({ id: ordenes.id, codigo: ordenes.codigo }).from(ordenes).where(and(eq(ordenes.planId, plan.id), inArray(ordenes.estado, ["completada", "verificada"]))).limit(1);
    if (enRevision) throw new RechazoCampo(`Este plan ya tiene la ${etiquetaOT(enRevision)} esperando verificación.`, 409);
  }

  const tipo = plan ? "preventivo" : input.tipo ?? "preventivo";
  const descripcion = input.descripcion?.trim() || plan?.descripcion || null;
  const checklist = plan?.checklist
    ?? (plan?.plantillaId ? await checklistDePlantilla(db, plan.plantillaId) : null)
    ?? (input.plantillaId ? await checklistDePlantilla(db, input.plantillaId) : null);
  const titulo = plan ? `[Preventivo] ${plan.titulo} - ${a.codigo}` : tipo === "correctivo" ? `[Correctivo] ${descripcion ?? "No programado"} - ${a.codigo}` : `[No programado] Mantenimiento - ${a.codigo}`;

  const [orden] = await db.insert(ordenes).values({
    titulo: titulo.slice(0, 200),
    descripcion,
    tipo,
    rubro: area.rubro,
    prioridad: plan?.prioridad ?? "media",
    estado: "abierta",
    activoId: a.id,
    ubicacionId: a.ubicacionId,
    sucursalId,
    asignadoA: user.id,
    asignadoEn: ahora,
    creadoPor: user.id,
    planId: plan?.id ?? null,
    vencimiento: plan ? vencimientoDePlan(plan) : null,
    checklistEjecucion: checklist,
  }).returning({ id: ordenes.id });

  if (plan) await db.update(planesMantenimiento).set({ ultimaGeneracion: ahora }).where(eq(planesMantenimiento.id, plan.id));
  await logAudit(ctx, { entidad: "orden", entidadId: orden.id, accion: "create", resumen: `Creada desde Modo técnico: "${titulo}"` });
  if (!plan) await avisarJefatura(ctx, db, `Mantenimiento no programado: ${a.codigo}`, `${user.nombre} lo inició desde el celular.`, `/ordenes/${orden.id}`);
  return { ordenId: orden.id, yaExistia: false };
}

export async function ordenCampoPorId(db: Db, id: number, user: Usuario) {
  const sedesFilas = await db.select({ id: sucursales.id, nombre: sucursales.nombre }).from(sucursales);
  const ubisFilas = await db.select({ id: ubicaciones.id, nombre: ubicaciones.nombre, sucursalId: ubicaciones.sucursalId }).from(ubicaciones);
  const [f] = (await db
    .select({ o: ordenes, a: { id: activos.id, codigo: activos.codigo, nombre: activos.nombre, marca: activos.marca, modelo: activos.modelo, ubicacionId: activos.ubicacionId, criticidad: activos.criticidadOperacional } })
    .from(ordenes)
    .leftJoin(activos, eq(activos.id, ordenes.activoId))
    .where(eq(ordenes.id, id))
    .limit(1)) as FilaOrden[];
  if (!f) return null;
  if (user.rol === "tecnico" && f.o.asignadoA && f.o.asignadoA !== user.id) return null;
  const ultimas = f.o.planId ? await ultimasLecturasDelPlan(db, f.o.planId, f.o.id) : {};
  const ubis: MapaUbicaciones = new Map(ubisFilas.map((u) => [u.id, { nombre: u.nombre, sucursalId: u.sucursalId }]));
  const extras = await extrasDeCampo(db, [f], ubis);
  const fotos = (await fotosDeEvidencia(db, [f.o.id])).get(f.o.id) ?? 0;
  return ordenParaCampo(f, ubis, new Map(sedesFilas.map((s) => [s.id, s.nombre])), { ultimas, fotos, ...extras(f.o.id) });
}

// ── Las operaciones ─────────────────────────────────────────────────────────
export interface OperacionCampo {
  opId: string;
  tipo: string;
  at?: string;
  [k: string]: unknown;
}
export interface ResultadoOperacion {
  opId: string;
  ok: boolean;
  repetida?: boolean;
  error?: string;
  datos?: unknown;
}

async function cambiarOrden(ctx: APIContext, user: Usuario, id: number, cuerpo: Record<string, unknown>, momento: string, conLaEscritura?: (guard: SQL) => unknown[]) {
  const res = await aplicarCambioOrden(ctx, user, id, cuerpo, { momento, conLaEscritura });
  const j: any = await res.json().catch(() => ({}));
  if (res.status >= 500) throw new Error(typeof j.error === "string" ? j.error : "Error del servidor");
  if (!res.ok) {
    const msg = typeof j.error === "string" ? j.error : "No se pudo guardar.";
    throw new RechazoCampo(msg, res.status, typeof j.motivo === "string" ? j.motivo : undefined, Array.isArray(j.pasos) ? j.pasos.filter(Number.isInteger) : undefined);
  }
  return j;
}

async function ordenDeOp(db: Db, op: OperacionCampo) {
  const id = Number(op.ordenId);
  if (!Number.isInteger(id) || id <= 0) throw new RechazoCampo("Orden inválida.");
  const [o] = await db.select().from(ordenes).where(eq(ordenes.id, id)).limit(1);
  if (!o) throw new RechazoCampo("La orden ya no existe.", 404);
  return o;
}

const esJefatura = (user: Usuario) => user.rol === "admin" || user.rol === "jefe";
const EN_CURSO = ["abierta", "en_proceso", "en_espera"];
const yaNoEnCurso = (estado: string) =>
  estado === "cancelada" ? "La orden fue cancelada." : estado === "cerrada" ? "La orden ya está cerrada." : "La orden ya se envió a verificación.";

/**
 * Las reglas de la ficha, revisadas antes de tocar nada: solo el técnico
 * asignado o la jefatura. Una orden libre y abierta la toma quien empieza a
 * trabajarla; devuelve true cuando hay que tomarla.
 */
function exigirEjecutor(user: Usuario, o: typeof ordenes.$inferSelect, { tomarLibre = false } = {}): boolean {
  if (esJefatura(user) || o.asignadoA === user.id) return false;
  if (tomarLibre && user.rol === "tecnico" && !o.asignadoA && o.estado === "abierta") return true;
  throw new RechazoCampo(o.asignadoA ? "Esta orden está asignada a otra persona." : "Empieza la orden antes de registrar en ella: así queda a tu nombre.", 403);
}

/**
 * Las acciones del EOP que el celular mostró, si las manda. Solo cuentan en una
 * emergencia que todavía no tiene pasos; en cualquier otra orden se ignoran.
 */
function accionesDeOp(o: typeof ordenes.$inferSelect, op: OperacionCampo): string[] | undefined {
  if (o.tipo !== "emergencia" || !checklistVacio(o.checklistEjecucion) || !EN_CURSO.includes(o.estado)) return undefined;
  const r = accionesDelCelular(op.acciones);
  if (r.error) throw new RechazoCampo(r.error);
  return r.acciones;
}

/** Los rechazos del MOP son rechazos del celular: se guardan y se le muestran al técnico. */
async function enMop<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) { if (e instanceof RechazoMop) throw new RechazoCampo(e.message, e.status); throw e; }
}

/**
 * Un número escrito a mano en un campo de solo número, con la regla de
 * src/lib/numero.ts: coma o punto decimal; el separador de miles no se adivina.
 * Uno que se puede leer de dos formas se rechaza con su frase; uno que ya llega
 * como número se acepta tal cual.
 */
function numeroEscrito(raw: unknown) {
  const r = leerNumero(raw);
  if (r.tipo === "ambiguo") throw new RechazoCampo(r.mensaje);
  return r;
}

/** Lo escrito en el valor de un paso tal como está guardado, recortado; null si no es un texto. */
function textoGuardadoDePaso(checklist: string | null | undefined, idx: number): string | null {
  try {
    const it = JSON.parse(checklist ?? "[]")?.[idx];
    return typeof it?.valorMedido === "string" ? it.valorMedido.trim() : null;
  } catch {
    return null;
  }
}

/** El mínimo o el máximo de un paso como lo lee parseChecklist: vacío o ilegible es sin límite. */
const limiteDePaso = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * K17 · La base de una marca: el checklist guardado con el estado, la lectura y la nota del paso como el
 * celular lo mostraba justo antes de marcarlo («antes»); las demás claves y los demás pasos, como están
 * guardados. Con ella la marca se fusiona como la ficha y no pisa lo que la jefatura cambió mientras
 * tanto. Sin «antes» (un registro de un celular con la versión anterior), null: como siempre.
 */
function baseDeLaMarca(checklist: string | null, idx: number, antes: unknown): string | null {
  if (!conAntes(antes)) return null;
  const lista = JSON.parse(checklist ?? "[]");
  lista[idx] = pasoComoLoMostraba(lista[idx], antes);
  return JSON.stringify(lista);
}
/** Un paso guardado, con el estado, la lectura y la nota que el celular mostraba al marcarlo. */
function pasoComoLoMostraba(guardado: unknown, antes: Record<string, unknown>): Record<string, unknown> {
  const { estado, valor, nota } = antes;
  const paso: Record<string, unknown> = { ...(guardado as Record<string, unknown>), estado };
  for (const [clave, v] of [["valorMedido", valor], ["notas", nota]] as const) {
    if (v === null || v === undefined || v === "") delete paso[clave];
    else paso[clave] = v;
  }
  return paso;
}
/** La marca trae el paso como lo mostraba el celular («antes»). */
const conAntes = (antes: unknown): antes is Record<string, unknown> => typeof antes === "object" && antes !== null && !Array.isArray(antes);
// Las frases de K17 y K19 salen de src/lib/frases-campo.ts: el celular las reconoce y las repite.
export { pasoCambioEnLaFicha, envioConPasosCambiados };

/** El estado de un paso como se compara: el viejo {hecho} cuenta como ok; sin uno válido, pendiente. */
const estadoComparable = (p: any) => (["pendiente", "ok", "na", "desviacion"].includes(p?.estado) ? p.estado : p?.hecho === true ? "ok" : "pendiente");
/** Una lectura como se compara: por su número si se lee como uno (leerNumero); si no, el texto recortado. Vacía es null. */
const lecturaComparable = (v: unknown) => { const l = leerNumero(v); return JSON.stringify(l.tipo === "numero" ? l.valor : l.tipo === "vacio" ? null : String(v).trim()); };
/**
 * K17b · La ficha cambió el estado o la lectura del paso desde como lo mostraba el celular («antes») y la marca no
 * deja lo mismo que dejó la ficha: otro estado u otra lectura (la que manda la marca o, si no manda ninguna, la de
 * «antes»). Si la ficha solo cambió la nota, no: la marca se fusiona como siempre (K11).
 */
function marcaSobreCambioDeLaFicha(guardado: any, antes: Record<string, unknown>, estado: string, valor: unknown): boolean {
  const cambio = estadoComparable(guardado) !== estadoComparable(antes) || lecturaComparable(guardado.valorMedido) !== lecturaComparable(antes.valor);
  if (!cambio) return false;
  const lectura = leerNumero(valor).tipo === "vacio" ? antes.valor : valor;
  return estado !== estadoComparable(guardado) || lecturaComparable(lectura) !== lecturaComparable(guardado.valorMedido);
}

/** Un registro procesado después que otro: por recibido_en y, a la misma hora, el que se guardó después. */
type Procesado = { recibidoEn: string; fila: number | null };
const procesadoDespues = (a: Procesado, b: Procesado) => a.recibidoEn > b.recibidoEn || (a.recibidoEn === b.recibidoEn && a.fila != null && b.fila != null && a.fila > b.fila);
/**
 * K19 · Los pasos de la orden que este usuario marcó en el celular, que el servidor rechazó con la frase de K17 (el
 * paso cambió en la ficha mientras tanto) y que no tienen una marca aceptada después del rechazo. Un paso que ya no
 * existe en el checklist no cuenta. Sus índices, ordenados.
 */
async function pasosCambiadosSinMarcar(db: Db, user: Usuario, o: typeof ordenes.$inferSelect): Promise<number[]> {
  const rechazos = await db
    .select({ detalle: campoOperaciones.detalle, recibidoEn: campoOperaciones.recibidoEn, fila: sql<number>`rowid` })
    .from(campoOperaciones)
    .where(and(eq(campoOperaciones.usuarioId, user.id), eq(campoOperaciones.ordenId, o.id), eq(campoOperaciones.tipo, "orden.paso"), eq(campoOperaciones.resultado, "rechazada")));
  const pasos = parseChecklist(o.checklistEjecucion).length;
  const ultimo = new Map<number, Procesado>();
  for (const r of rechazos) {
    const n = PASO_DE_LA_FRASE.exec(r.detalle ?? "");
    const idx = n ? Number(n[1]) - 1 : -1;
    if (idx < 0 || idx >= pasos) continue;
    const previo = ultimo.get(idx);
    if (!previo || procesadoDespues(r, previo)) ultimo.set(idx, r);
  }
  if (!ultimo.size) return [];
  const marcas = await db
    .select({ idx: ordenPasoMarcas.pasoIdx, recibidoEn: ordenPasoMarcas.recibidoEn, fila: sql<number | null>`(SELECT c.rowid FROM campo_operaciones c WHERE c.op_id = orden_paso_marcas.op_id)` })
    .from(ordenPasoMarcas)
    .where(and(eq(ordenPasoMarcas.ordenId, o.id), inArray(ordenPasoMarcas.pasoIdx, [...ultimo.keys()])));
  return [...ultimo].filter(([idx, r]) => !marcas.some((x) => x.idx === idx && procesadoDespues(x, r))).map(([idx]) => idx).sort((a, b) => a - b);
}

type LecturaLiberacion = { etiqueta: string; unidad: string | null; valorMedido: number | null; valorMedidoTexto: string | null };

const sinPunto = (t: string) => t.trim().replace(/\.+\s*$/, "");

/**
 * Trabajos realizados, escritos a partir de lo que el técnico ya marcó. En una
 * emergencia, una acción que no se pudo hacer se cuenta aparte, con su motivo.
 */
export function textoDeTrabajos(
  checklist: string | null | undefined, titulo: string, nota?: string | null,
  extra: { liberaciones?: LecturaLiberacion[]; reversa?: string | null; causaTecnico?: string | null; emergencia?: boolean } = {},
) {
  const pasos = parseChecklist(checklist);
  const limpio = titulo.replace(/^\[[^\]]+\]\s*/, "").replace(/\s+-\s+\S+$/, "").trim() || "Mantenimiento";
  const partes: string[] = [];
  if (pasos.length && extra.emergencia) {
    // En el celular, una acción del EOP se hizo o no se pudo («No se pudo: …»).
    const hechas = pasos.filter((p) => p.estado === "ok").length;
    const na = pasos.filter((p) => p.estado === "na").length;
    const noPudo = pasos.filter((p) => p.estado === "desviacion");
    const motivo = (p: ChecklistItem) => sinPunto((p.notas ?? "").replace(/^\s*no se pudo\s*:?\s*/i, ""));
    const cuales = noPudo.map((p) => `«${sinPunto(p.texto)}»${motivo(p) ? `: ${motivo(p)}` : ""}`).join("; ");
    partes.push(`${limpio}: ${hechas} de ${pasos.length} acciones hechas${na ? `, ${na} no aplica` : ""}${noPudo.length ? `; ${noPudo.length} ${noPudo.length === 1 ? "no se pudo" : "no se pudieron"}: ${cuales}` : ""}.`);
    const lect = pasos.filter((p) => p.valorMedido).map((p) => `${p.texto}: ${p.valorMedido}${p.unidad ? ` ${p.unidad}` : ""}`);
    if (lect.length) partes.push(`Lecturas: ${lect.join("; ")}.`);
  } else if (pasos.length) {
    const ok = pasos.filter((p) => p.estado === "ok").length;
    const na = pasos.filter((p) => p.estado === "na").length;
    const nov = pasos.filter((p) => p.estado === "desviacion");
    partes.push(`${limpio}: ${ok + nov.length} de ${pasos.length} puntos realizados${nov.length ? `, ${nov.length} con novedad` : " sin novedad"}${na ? `, ${na} no aplica` : ""}.`);
    const lect = pasos.filter((p) => p.valorMedido).map((p) => `${p.texto}: ${p.valorMedido}${p.unidad ? ` ${p.unidad}` : ""}`);
    if (lect.length) partes.push(`Lecturas: ${lect.join("; ")}.`);
    for (const n of nov) if (n.notas) partes.push(`Novedad en «${n.texto}»: ${n.notas.replace(/\.+\s*$/, "")}.`);
  }
  const liberadas = (extra.liberaciones ?? [])
    .filter((l) => l.valorMedido != null || l.valorMedidoTexto?.trim())
    .map((l) => `${l.etiqueta}: ${l.valorMedido != null ? `${textoDeNumero(l.valorMedido)}${l.unidad ? ` ${l.unidad}` : ""}` : l.valorMedidoTexto!.trim()}`);
  if (liberadas.length) partes.push(`Lecturas de liberación: ${liberadas.join("; ")}.`);
  if (extra.reversa?.trim()) partes.push(`Reversa ejecutada: ${extra.reversa.trim().replace(/\.+\s*$/, "")}.`);
  if (nota?.trim()) partes.push(nota.trim());
  if (extra.causaTecnico?.trim()) partes.push(`Causa probable según el técnico: ${extra.causaTecnico.trim()}`);
  return partes.join(" ");
}

const SISTEMA_A_AREA: Record<string, "aires" | "infraestructura"> = { hvac: "aires", minisplit: "aires" };

async function abrirOrdenDeFalla(ctx: APIContext, db: Db, user: Usuario, op: OperacionCampo, m: Momento) {
  const emergencia = op.tipo === "emergencia.abrir";
  const activoId = op.activoId ? Number(op.activoId) : null;
  const nota = typeof op.nota === "string" ? op.nota.trim() : "";
  let eop: { id: number; codigo: string; titulo: string; sistema: string } | undefined;
  if (typeof op.eop === "string" && op.eop) {
    [eop] = await db.select({ id: procedimientos.id, codigo: procedimientos.codigoCorto, titulo: procedimientos.titulo, sistema: procedimientos.sistema }).from(procedimientos).where(eq(procedimientos.codigoCorto, op.eop)).limit(1);
  }
  let ubicacionId = op.ubicacionId ? Number(op.ubicacionId) : null;
  let etiqueta = "";
  const columnasSla = { slaUrgenteHoras: activos.slaUrgenteHoras, slaAltaHoras: activos.slaAltaHoras, slaMediaHoras: activos.slaMediaHoras, slaBajaHoras: activos.slaBajaHoras };
  let sla: { slaUrgenteHoras: number; slaAltaHoras: number; slaMediaHoras: number; slaBajaHoras: number } | null = null;
  if (activoId) {
    const [a] = await db.select({ codigo: activos.codigo, ubicacionId: activos.ubicacionId, ...columnasSla }).from(activos).where(eq(activos.id, activoId)).limit(1);
    if (!a) throw new RechazoCampo("Ese equipo ya no existe.", 404);
    ubicacionId = a.ubicacionId ?? ubicacionId;
    etiqueta = a.codigo;
    sla = a;
  }
  const sucursalId = (await sucursalDeUbicacion(db, ubicacionId)) ?? (op.sucursalId ? Number(op.sucursalId) : null);
  const rubroPedido = typeof op.rubro === "string" ? op.rubro : eop ? SISTEMA_A_AREA[eop.sistema] ?? "infraestructura" : null;
  const area = await validarAreaTrabajo(db, { rubro: activoId ? undefined : rubroPedido, activoId, sucursalId, ubicacionId } as any);
  if ("error" in area) throw new RechazoCampo(area.error);
  const base = eop?.titulo ?? (nota.slice(0, 120) || "Falla reportada desde el celular");
  const titulo = `${emergencia ? "[Emergencia]" : "[Correctivo]"} ${base}${etiqueta ? ` - ${etiqueta}` : ""}`.slice(0, 200);
  const prioridad = emergencia ? "urgente" : "alta";
  const [orden] = await db.insert(ordenes).values({
    titulo,
    descripcion: nota || null,
    tipo: emergencia ? "emergencia" : "correctivo",
    rubro: area.rubro,
    prioridad,
    // Como en la ficha: el plazo sale del equipo y la prioridad, desde la hora en que se reportó.
    vencimiento: calcularVencimiento(m.iso, sla, prioridad),
    estado: "abierta",
    activoId,
    ubicacionId,
    sucursalId,
    asignadoA: emergencia ? user.id : null,
    asignadoEn: emergencia ? m.iso : null,
    creadoPor: user.id,
    procedimientoId: eop?.id ?? null,
    ...(emergencia ? { clasePrioridad: "P1" as const, horaAlarma: m.iso, causaRaizVencimiento: vencimientoCausaRaiz(m.iso) } : {}),
  }).returning({ id: ordenes.id });
  await logAudit(ctx, { entidad: "orden", entidadId: orden.id, accion: "create", resumen: `Reportada desde el celular: "${titulo}"` });
  if (Number.isInteger(Number(op.puntoId)) && Number(op.puntoId) > 0) await ligarOrdenALectura(db, { ...claveRonda(op), puntoId: Number(op.puntoId) }, orden.id, emergencia, m.iso, user.id);
  await avisarJefatura(ctx, db, emergencia ? `Emergencia: ${base}` : `Falla reportada: ${base}`, `${user.nombre}${etiqueta ? ` · ${etiqueta}` : ""}${nota ? ` · ${nota.slice(0, 120)}` : ""}`, `/ordenes/${orden.id}`);
  return { ordenId: orden.id };
}

const claveRonda = (op: OperacionCampo) => {
  const sucursalId = Number(op.sucursalId);
  const fecha = String(op.fecha ?? ""), turno = String(op.turno ?? "");
  if (!Number.isInteger(sucursalId) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(turno)) throw new RechazoCampo("Ronda inválida.");
  return { sucursalId, fecha, turno };
};

/**
 * La ronda del turno que trae la operación. Sin señal no hay id: se reconoce
 * por sede, fecha y turno. El turno se juzga con lo que regía cuando empezó:
 * con la línea de tiempo de los turnos y con la marca de la sede de entonces,
 * aunque la jefatura haya cambiado algo antes de que volviera la señal.
 */
async function ejecucionDeOp(db: Db, op: OperacionCampo, user: Usuario, m: Momento): Promise<RondaEjecucion> {
  const clave = claveRonda(op);
  const existente = await buscarEjecucion(db, clave);
  if (existente) return existente;
  const r = await recorridoConLinea(db, clave.sucursalId);
  if (!r) throw new RechazoCampo("Esta sede no tiene ronda configurada.");
  if (!r.activa) throw new RechazoCampo("Esa sede no está activa.");
  const inicio = inicioTurno(clave.fecha, clave.turno);
  const hecho = Date.parse(m.iso);
  if (!Number.isFinite(inicio) || inicio > hecho + 30 * 60_000 || hecho - inicio > 24 * 3_600_000) {
    throw new RechazoCampo("La fecha o el turno de esta ronda no cuadran con la hora en que se capturó.");
  }
  if (!existeTurno(r.linea, clave.fecha, clave.turno)) {
    throw new RechazoCampo("Ese turno ya no existe: la jefatura cambió los turnos. Lo anotado no entró en la ronda; avisa a tu jefatura.");
  }
  if (!r.haceRondaEn(inicio)) throw new RechazoCampo("En ese turno esta sede no hacía ronda.");
  // Sin señal, la ronda se empezó con el recorrido que traía el celular: el modelo o el propio de la sede.
  // Si la sede sacó su recorrido propio mientras tanto, la ronda se abre con aquel y lo anotado cuadra.
  const pedido = Number(op.rondaId);
  const conQueSeAnoto = r.recorridos.find((x) => x.id === pedido && (x.sucursalId == null || x.sucursalId === clave.sucursalId));
  const { ejecucion } = await abrirEjecucion(db, { rondaId: conQueSeAnoto?.id ?? r.ronda.id, ...clave, usuarioId: user.id, momento: m.iso });
  return ejecucion;
}

/**
 * La marca de un paso sobre la orden como está guardada. Si el paso cambió en la ficha mientras tanto (K17, K17b),
 * se rechaza con su frase y no se escribe nada, tampoco en el libro de marcas.
 */
async function aplicarMarcaDePaso(ctx: APIContext, db: Db, user: Usuario, orden: typeof ordenes.$inferSelect, op: OperacionCampo, idx: number, estado: string, m: Momento) {
  let o = orden;
  exigirEjecutor(user, o);
  // Un número que se puede leer de dos formas («1,200») se rechaza con su frase. El mismo texto que ya
  // estaba guardado en el paso, comparado recortado, no es un cambio: no se rechaza y queda como estaba.
  const escrito = leerNumero(op.valor);
  const mismoTexto = typeof op.valor === "string" && op.valor.trim() === textoGuardadoDePaso(o.checklistEjecucion, idx);
  if (escrito.tipo === "ambiguo" && !mismoTexto) throw new RechazoCampo(escrito.mensaje);
  const leido = escrito.tipo === "ambiguo" ? ({ tipo: "texto" } as const) : escrito;
  o = await sembrarAccionesEop(ctx, db, o, accionesDeOp(o, op));
  let lista: any[];
  try { lista = JSON.parse(o.checklistEjecucion ?? "[]"); } catch { throw new RechazoCampo("El checklist de esta orden no se pudo leer."); }
  if (!Array.isArray(lista) || !Number.isInteger(idx) || !lista[idx]) throw new RechazoCampo("Ese paso ya no existe en la orden.");
  const it = lista[idx];
  if (typeof it !== "object" || it === null) throw new RechazoCampo("Ese paso tiene un formato antiguo. Ábrelo en la ficha completa.");
  if (typeof op.texto === "string" && op.texto !== it.texto) throw new RechazoCampo("El checklist cambió en la oficina. Actualiza para ver la versión vigente.", 409);
  // Un paso con rango se juzga por su número: lo escrito en él es el número que marcó el instrumento.
  // Un texto que no es número se rechaza sin guardar nada; el mismo texto que ya estaba guardado no es un cambio.
  const guardado = typeof it.valorMedido === "string" ? it.valorMedido.trim() : null;
  if (leido.tipo === "texto" && String(op.valor).trim() !== guardado && pasoConRango({ esperadoMin: limiteDePaso(it.esperadoMin), esperadoMax: limiteDePaso(it.esperadoMax) })) {
    throw new RechazoCampo(MENSAJE_PASO_SIN_NUMERO);
  }
  const base = baseDeLaMarca(o.checklistEjecucion, idx, op.antes);
  const cambioEnLaFicha = pasoCambioEnLaFicha(o.tipo === "emergencia", idx);
  // K17b · Volver a guardar lo que mostraba el celular sobre un estado o una lectura que la ficha cambió no se aplica.
  if (conAntes(op.antes) && marcaSobreCambioDeLaFicha(it, op.antes, estado, op.valor)) throw new RechazoCampo(cambioEnLaFicha, 409);
  it.estado = estado;
  delete it.hecho;
  // El número se guarda como número: «14,5» queda 14.5 y 12.345 no vuelve a leerse como «12.345», que sería ambiguo.
  // Lo que no es un número queda escrito tal cual, como antes. En el libro, el número va con textoDeNumero.
  const valor = leido.tipo === "numero" ? textoDeNumero(leido.valor) : leido.tipo === "texto" ? String(op.valor).trim() : null;
  if (leido.tipo === "numero") it.valorMedido = leido.valor;
  else if (valor !== null) it.valorMedido = valor;
  if (typeof op.nota === "string") it.notas = op.nota.trim() || undefined;
  if (estado !== "pendiente") { it.hora = horaSV(m.iso); it.iniciales = iniciales(user.nombre); }
  // Si alguien cambió ese paso en la ficha mientras tanto (K11), queda como está guardado y la marca se
  // rechaza: no se escribe nada, tampoco en el libro de marcas.
  const r = await cambiarOrden(ctx, user, o.id, { checklistEjecucion: JSON.stringify(lista), ...(base !== null ? { checklistBase: base } : {}) }, m.iso);
  if (base !== null && Array.isArray(r?.pasosSinAplicar) && r.pasosSinAplicar.includes(idx)) throw new RechazoCampo(cambioEnLaFicha, 409);
  await db.insert(ordenPasoMarcas).values({
    ordenId: o.id, pasoIdx: idx, pasoTexto: String(it.texto ?? "").slice(0, 500), estado, valor,
    nota: typeof op.nota === "string" ? op.nota.trim() || null : null,
    ocurridoEn: m.iso, recibidoEn: m.recibido, sinSenal: m.sinSenal, usuarioId: user.id, opId: op.opId,
  });
}

/** Lo que manda el celular por cada paso que dio por conforme al enviar: cuál es y cómo lo mostraba. */
type PasoConforme = { idx: number; texto?: string; antes?: unknown };
/** Tope de pasos de un «Todo conforme»: ningún checklist real se acerca. */
const MAX_CONFORMES = 200;
/** La más tardía de varias horas; null si no hay ninguna. */
const laMasTardia = (horas: Array<string | null | undefined>) =>
  horas.reduce<string | null>((max, h) => (h && Number.isFinite(Date.parse(h)) && (!max || Date.parse(h) > Date.parse(max)) ? h : max), null);
/**
 * La bitácora de los pasos que un envío dio por conformes, como una sola sentencia para el lote del envío: se
 * escribe solo si la guarda del lote pasó. Así un corte después de guardar no deja la orden enviada con la bitácora
 * a medias, y reintentar el envío no la repite. Las filas viajan como un texto: no topan con el límite de valores.
 */
function bitacoraDeConformes(db: Db, ordenId: number, usuarioId: number, opId: string, marcas: Array<{ idx: number; texto: string }>, m: Momento, guard: SQL) {
  const filas = db.select({
    id: sql<number>`null`.as("id"),
    ordenId: sql<number>`${ordenId}`.as("orden_id"),
    pasoIdx: sql<number>`json_extract(j.value, '$.idx')`.as("paso_idx"),
    pasoTexto: sql<string>`json_extract(j.value, '$.texto')`.as("paso_texto"),
    estado: sql<string>`'ok'`.as("estado"),
    valor: sql<string | null>`null`.as("valor"),
    nota: sql<string | null>`null`.as("nota"),
    ocurridoEn: sql<string>`${m.iso}`.as("ocurrido_en"),
    recibidoEn: sql<string>`${m.recibido}`.as("recibido_en"),
    sinSenal: sql<boolean>`${m.sinSenal ? 1 : 0}`.as("sin_senal"),
    usuarioId: sql<number>`${usuarioId}`.as("usuario_id"),
    opId: sql<string>`${opId}`.as("op_id"),
  }).from(sql`json_each(${JSON.stringify(marcas)}) j`).where(guard);
  return db.insert(ordenPasoMarcas).select(filas as any);
}
function conformesDeOp(op: OperacionCampo): PasoConforme[] {
  if (!Array.isArray(op.conforme)) return [];
  const vistos = new Set<number>();
  const lista: PasoConforme[] = [];
  for (const c of op.conforme.slice(0, MAX_CONFORMES) as any[]) {
    const idx = Number(c?.idx);
    if (typeof c !== "object" || c === null || !Number.isInteger(idx) || idx < 0 || vistos.has(idx)) continue;
    vistos.add(idx);
    lista.push({ idx, texto: typeof c.texto === "string" ? c.texto : undefined, antes: c.antes });
  }
  return lista;
}
/**
 * Cierre en dos pasos · «Todo conforme»: los pasos que el celular mostraba pendientes quedan hechos en la misma
 * operación que envía la orden, para que no quede a medias. Devuelve el checklist con esos pasos hechos, la base
 * (cómo los mostraba el celular) y las marcas para la bitácora; no escribe nada. Un paso que la ficha cambió
 * mientras tanto no se pisa: el envío entero se rechaza nombrándolo (K17) y el celular lleva al técnico a revisarlo.
 * Uno que ya no está pendiente queda como está: «todo conforme» nunca borra un problema anotado.
 */
function conformarPasos(o: typeof ordenes.$inferSelect, user: Usuario, conformes: PasoConforme[], m: Momento) {
  let lista: any[];
  try { lista = JSON.parse(o.checklistEjecucion ?? "[]"); } catch { throw new RechazoCampo("El checklist de esta orden no se pudo leer."); }
  if (!Array.isArray(lista)) throw new RechazoCampo("El checklist de esta orden no se pudo leer.");
  const base = [...lista];
  const cambiados: number[] = [];
  const marcas: Array<{ idx: number; texto: string }> = [];
  for (const c of conformes) {
    const it = lista[c.idx];
    if (!it) throw new RechazoCampo("Un paso ya no existe en la orden. Actualiza para ver la versión vigente.", 409);
    if (typeof it !== "object") throw new RechazoCampo("Un paso tiene un formato antiguo. Abre la orden en la ficha completa.");
    if (typeof c.texto === "string" && c.texto !== it.texto) throw new RechazoCampo("El checklist cambió en la oficina. Actualiza para ver la versión vigente.", 409);
    if (conAntes(c.antes) && marcaSobreCambioDeLaFicha(it, c.antes, "ok", undefined)) { cambiados.push(c.idx); continue; }
    if (estadoComparable(it) !== "pendiente") continue;
    if (conAntes(c.antes)) base[c.idx] = pasoComoLoMostraba(it, c.antes);
    const hecho: Record<string, unknown> = { ...it, estado: "ok", hora: horaSV(m.iso), iniciales: iniciales(user.nombre) };
    delete hecho.hecho;
    lista[c.idx] = hecho;
    marcas.push({ idx: c.idx, texto: String(it.texto ?? "").slice(0, 500) });
  }
  if (cambiados.length) throw new RechazoCampo(envioConPasosCambiados(o.tipo === "emergencia", cambiados.sort((a, b) => a - b)), 409);
  return { checklist: JSON.stringify(lista), base: JSON.stringify(base), marcas };
}

async function ejecutar(ctx: APIContext, db: Db, user: Usuario, op: OperacionCampo): Promise<{ datos?: unknown; ordenId?: number | null; m: Momento }> {
  switch (op.tipo) {
    case "orden.iniciar": {
      const o = await ordenDeOp(db, op);
      const m = momentoCapturado(op.at);
      if (o.estado !== "en_proceso") {
        exigirEjecutor(user, o, { tomarLibre: true });
        // Una emergencia sin pasos guarda primero las acciones de su EOP: las que ya vio el técnico.
        await sembrarAccionesEop(ctx, db, o, accionesDeOp(o, op));
        await cambiarOrden(ctx, user, o.id, { estado: "en_proceso" }, m.iso);
      }
      return { ordenId: o.id, m };
    }
    case "orden.pausar": {
      const o = await ordenDeOp(db, op);
      const m = momentoCapturado(op.at, o.iniciadaEn);
      const motivo = String(op.motivo ?? "").trim();
      if (!motivo) throw new RechazoCampo("Escribe por qué se pausa.");
      if (o.estado !== "en_espera") await cambiarOrden(ctx, user, o.id, { estado: "en_espera", motivo }, m.iso);
      return { ordenId: o.id, m };
    }
    case "orden.reanudar": {
      const o = await ordenDeOp(db, op);
      const m = momentoCapturado(op.at, o.pausadaEn ?? o.iniciadaEn);
      if (o.estado !== "en_proceso") await cambiarOrden(ctx, user, o.id, { estado: "en_proceso" }, m.iso);
      return { ordenId: o.id, m };
    }
    case "orden.paso": {
      let o = await ordenDeOp(db, op);
      const m = momentoCapturado(op.at, o.iniciadaEn);
      const idx = Number(op.idx);
      const estado = String(op.estado ?? "");
      if (!["ok", "na", "desviacion", "pendiente"].includes(estado)) throw new RechazoCampo("Estado de paso inválido.");
      try {
        await aplicarMarcaDePaso(ctx, db, user, o, op, idx, estado, m);
      } catch (e) {
        // K17c · Con «antes», otra escritura del checklist entre la lectura y el guardado: se lee la orden otra vez y
        // se arma de nuevo la marca con su base, una sola vez. Si vuelve a pasar, el paso cambió mientras tanto.
        if (!(e instanceof RechazoCampo) || e.motivo !== "otra-escritura" || !conAntes(op.antes)) throw e;
        o = await ordenDeOp(db, op);
        try {
          await aplicarMarcaDePaso(ctx, db, user, o, op, idx, estado, m);
        } catch (e2) {
          if (e2 instanceof RechazoCampo && e2.motivo === "otra-escritura") throw new RechazoCampo(pasoCambioEnLaFicha(o.tipo === "emergencia", idx), 409);
          throw e2;
        }
      }
      return { ordenId: o.id, m };
    }
    case "orden.terminar":
    // «orden.enviar» es el mismo envío, con el nombre que usa el celular del cierre en dos pasos. Un servidor de
    // antes no lo conoce y lo rechaza: no da por enviada una orden cuyos pasos no sabe dar por conformes.
    case "orden.enviar": {
      let o = await ordenDeOp(db, op);
      const [ultima] = await db.select({ en: ordenPasoMarcas.ocurridoEn }).from(ordenPasoMarcas).where(eq(ordenPasoMarcas.ordenId, o.id)).orderBy(desc(ordenPasoMarcas.ocurridoEn)).limit(1);
      // El envío no queda antes de lo que ya pasó en la orden: su última marca, su inicio o un toque de la emergencia.
      const m = momentoCapturado(op.at, laMasTardia([ultima?.en ?? o.iniciadaEn, o.horaLlegada, o.horaMitigacion, o.horaRestablecimiento]));
      if (!["completada", "verificada", "cerrada"].includes(o.estado)) {
        // K19 · Un paso cuya marca se rechazó porque cambió en la ficha no se envía como lo dejó la ficha: primero el
        // técnico lo revisa y lo marca otra vez. No se escribe nada.
        const porRevisar = await pasosCambiadosSinMarcar(db, user, o);
        if (porRevisar.length) throw new RechazoCampo(envioConPasosCambiados(o.tipo === "emergencia", porRevisar), 409);
        // Cierre en dos pasos · Los pasos que el técnico dio por conformes al enviar. La emergencia que todavía no
        // tiene sus acciones en el checklist las recibe aquí, como en la primera marca.
        const conformes = conformesDeOp(op);
        if (conformes.length) {
          exigirEjecutor(user, o);
          o = await sembrarAccionesEop(ctx, db, o, accionesDeOp(o, op));
        }
        const nota = typeof op.nota === "string" ? op.nota : null;
        // La causa raíz la escribe la jefatura. Si un celular viejo la manda, lo que el técnico vio queda en los trabajos.
        const causa = typeof op.causaRaiz === "string" ? op.causaRaiz.trim() : "";
        const liberaciones = o.tipo === "intervencion"
          ? await db.select({ etiqueta: ordenLiberaciones.etiqueta, unidad: ordenLiberaciones.unidad, valorMedido: ordenLiberaciones.valorMedido, valorMedidoTexto: ordenLiberaciones.valorMedidoTexto })
              .from(ordenLiberaciones).where(eq(ordenLiberaciones.ordenId, o.id)).orderBy(asc(ordenLiberaciones.orden), asc(ordenLiberaciones.id))
          : [];
        // Las marcas, su bitácora y el envío van en una sola escritura: o la orden queda enviada con todos sus pasos, o no cambia.
        const enviar = async (orden: typeof ordenes.$inferSelect) => {
          const hecho = conformes.length ? conformarPasos(orden, user, conformes, m) : null;
          const marcas = hecho?.marcas ?? [];
          // Enviar una emergencia dice que ya está controlada y que el servicio volvió: el toque que no se dio lleva la
          // hora del envío, en la misma escritura. Si el envío no entra, la hora tampoco queda. La llegada no se supone,
          // ni la hora en que se controló si el servicio ya había vuelto antes: esas las pone la jefatura.
          const horas = orden.tipo === "emergencia" && EN_CURSO.includes(orden.estado)
            ? { ...(orden.horaMitigacion || orden.horaRestablecimiento ? {} : { horaMitigacion: m.iso }), ...(orden.horaRestablecimiento ? {} : { horaRestablecimiento: m.iso }) }
            : {};
          const texto = textoDeTrabajos(hecho?.checklist ?? orden.checklistEjecucion, orden.titulo, nota, {
            liberaciones, reversa: orden.reversaEjecutada ? orden.reversaNotas : null, causaTecnico: esJefatura(user) ? null : causa, emergencia: orden.tipo === "emergencia",
          }) || orden.trabajosRealizados || "";
          try {
            await cambiarOrden(ctx, user, orden.id, {
              estado: "completada", trabajosRealizados: texto, ...horas,
              ...(hecho && marcas.length ? { checklistEjecucion: hecho.checklist, checklistBase: hecho.base } : {}),
              ...(causa && esJefatura(user) ? { causaRaiz: causa } : {}),
            }, m.iso, marcas.length ? (guard) => [bitacoraDeConformes(db, orden.id, user.id, op.opId, marcas, m, guard)] : undefined);
          } catch (e) {
            // K17 · La ficha cambió uno de esos pasos entre la lectura y el guardado: el envío vuelve nombrándolo.
            if (e instanceof RechazoCampo && e.motivo === "paso-cambio" && e.pasos?.length) {
              throw new RechazoCampo(envioConPasosCambiados(orden.tipo === "emergencia", [...e.pasos].sort((a, b) => a - b)), 409);
            }
            throw e;
          }
        };
        try {
          await enviar(o);
        } catch (e) {
          // Otra escritura entre la lectura y el guardado: con pasos por marcar se lee la orden otra vez, una sola vez.
          if (!(e instanceof RechazoCampo) || e.motivo !== "otra-escritura" || !conformes.length) throw e;
          o = await ordenDeOp(db, op);
          if (["completada", "verificada", "cerrada"].includes(o.estado)) return { ordenId: o.id, m };
          await enviar(o);
        }
      }
      return { ordenId: o.id, m };
    }
    case "emergencia.hito": {
      const o = await ordenDeOp(db, op);
      if (o.tipo !== "emergencia") throw new RechazoCampo("Esta orden no es una emergencia.");
      if (!esHitoEop(op.hito)) throw new RechazoCampo("Ese registro de la emergencia no existe.");
      const campo = HITOS_EOP[op.hito];
      const m = momentoCapturado(op.at, minimoDeHito(o, op.hito));
      const tomar = exigirEjecutor(user, o, { tomarLibre: true });
      // El primer toque manda: una hora ya registrada no se mueve. La jefatura la corrige en la ficha.
      if (o[campo]) return { ordenId: o.id, m, datos: { yaRegistrada: true } };
      if (!EN_CURSO.includes(o.estado)) throw new RechazoCampo(`${yaNoEnCurso(o.estado)} Esa hora la registra la jefatura en la ficha.`, 409);
      // «Llegué» no inicia la orden: el celular manda también orden.iniciar.
      await cambiarOrden(ctx, user, o.id, { [campo]: m.iso, ...(tomar ? { asignadoA: user.id } : {}) }, m.iso);
      return { ordenId: o.id, m };
    }
    case "mop.prerrequisito": {
      let o = await ordenDeOp(db, op);
      const m = momentoCapturado(op.at);
      const itemId = Number(op.prerrequisitoId);
      if (!Number.isInteger(itemId) || itemId <= 0) throw new RechazoCampo("Prerrequisito inválido.");
      const referencia = typeof op.referencia === "string" ? op.referencia.trim() : "";
      if (referencia.length < 2) throw new RechazoCampo("Escribe la referencia antes de marcarlo cumplido (n.º de permiso, clase de la ICRA, id del candado, hora del aviso…).");
      if (exigirEjecutor(user, o, { tomarLibre: true })) {
        // Una intervención libre la toma quien empieza por sus prerrequisitos.
        const [existe] = await db.select({ id: ordenPrerrequisitos.id }).from(ordenPrerrequisitos).where(and(eq(ordenPrerrequisitos.id, itemId), eq(ordenPrerrequisitos.ordenId, o.id))).limit(1);
        if (!existe) throw new RechazoCampo("Prerrequisito no encontrado en esta orden.", 404);
        await cambiarOrden(ctx, user, o.id, { asignadoA: user.id }, m.iso);
        o = { ...o, asignadoA: user.id };
      }
      await enMop(() => cambiarPrerrequisito(ctx, db, o, user, { itemId, cumplido: true, referencia }, m.iso));
      return { ordenId: o.id, m };
    }
    case "mop.liberacion": {
      const o = await ordenDeOp(db, op);
      const m = momentoCapturado(op.at, o.iniciadaEn);
      const itemId = Number(op.liberacionId);
      if (!Number.isInteger(itemId) || itemId <= 0) throw new RechazoCampo("Lectura inválida.");
      const lectura = lecturaEscrita(op.valor);
      if (lectura.valorMedido === null && lectura.valorMedidoTexto === null) throw new RechazoCampo("Escribe la lectura que mediste.");
      const row = await enMop(() => registrarLiberacion(ctx, db, o, user, { itemId, ...lectura }, m.iso));
      return { ordenId: o.id, m, datos: { conforme: row.conforme ?? null } };
    }
    case "mop.reversa": {
      const o = await ordenDeOp(db, op);
      const m = momentoCapturado(op.at, o.iniciadaEn);
      const notas = typeof op.notas === "string" ? op.notas.trim().slice(0, 2000) : "";
      if (notas.length < 10) throw new RechazoCampo("Describe qué se revirtió y cómo quedó el sistema (mínimo 10 letras).");
      exigirEjecutor(user, o);
      if (o.reversaEjecutada) {
        // Ya está marcada, por la jefatura en la ficha o por un envío anterior: la marca no se toca.
        // Lo que el técnico escribió se agrega debajo de lo que había, si no estaba ya.
        const antes = (o.reversaNotas ?? "").trim();
        if (antes.includes(notas)) return { ordenId: o.id, m, datos: { yaRegistrada: true } };
        if (!["en_proceso", "en_espera"].includes(o.estado)) {
          // Ya enviada o cerrada, la evidencia no se cambia; las notas le llegan a la jefatura y quedan en el registro.
          await avisarJefatura(ctx, db, `Notas de la reversa de ${etiquetaOT(o)} que llegaron después del envío`, `${user.nombre}: ${notas.slice(0, 160)}`, `/ordenes/${o.id}`);
          return { ordenId: o.id, m, datos: { yaRegistrada: true, notasTardias: notas } };
        }
        await cambiarOrden(ctx, user, o.id, { reversaNotas: `${antes ? `${antes}\n\n` : ""}Técnico (celular): ${notas}` }, m.iso);
        await avisarJefatura(ctx, db, `Notas del técnico en la reversa de ${etiquetaOT(o)}`, `${user.nombre}: ${notas.slice(0, 160)}`, `/ordenes/${o.id}`);
        return { ordenId: o.id, m, datos: { yaRegistrada: true } };
      }
      if (!["en_proceso", "en_espera"].includes(o.estado)) {
        throw new RechazoCampo(o.estado === "abierta" ? "La reversa se marca después de empezar la intervención." : `${yaNoEnCurso(o.estado)} La reversa la registra la jefatura en la ficha.`, 409);
      }
      await cambiarOrden(ctx, user, o.id, { reversaEjecutada: true, reversaNotas: notas }, m.iso);
      // «Cualquier reversa se informa a la jefatura antes de cerrar».
      await avisarJefatura(ctx, db, `Reversa ejecutada en ${etiquetaOT(o)}`, `${user.nombre}: ${notas.slice(0, 160)}`, `/ordenes/${o.id}`);
      return { ordenId: o.id, m };
    }
    case "emergencia.abrir":
    case "correctivo.abrir": {
      const m = momentoCapturado(op.at);
      const r = await abrirOrdenDeFalla(ctx, db, user, op, m);
      return { ordenId: r.ordenId, datos: r, m };
    }
    case "aop.abrir": {
      const m = momentoCapturado(op.at);
      const procedimientoId = Number(op.procedimientoId);
      if (!Number.isInteger(procedimientoId) || procedimientoId <= 0) throw new RechazoCampo("Falta el documento que rige la desviación.");
      const activoId = op.activoId ? Number(op.activoId) : null;
      let ubicacionId = op.ubicacionId ? Number(op.ubicacionId) : null;
      if (activoId) {
        const [a] = await db.select({ ubicacionId: activos.ubicacionId }).from(activos).where(eq(activos.id, activoId)).limit(1);
        if (!a) throw new RechazoCampo("Ese equipo ya no existe.", 404);
        ubicacionId = a.ubicacionId ?? ubicacionId;
      }
      const leido = numeroEscrito(op.valor);
      const [umbral] = await db.select({ id: aopUmbrales.id }).from(aopUmbrales).where(eq(aopUmbrales.procedimientoId, procedimientoId)).limit(1);
      const r = await abrirEvento(db, {
        procedimientoId, umbralId: umbral?.id ?? null, activoId, ubicacionId,
        sucursalId: op.sucursalId ? Number(op.sucursalId) : null,
        valorDetectado: leido.tipo === "numero" ? leido.valor : null,
        unidad: typeof op.unidad === "string" ? op.unidad : null,
        detectadoEn: m.iso, detectadoPor: user.id, origen: "manual",
      });
      const nota = typeof op.nota === "string" ? op.nota.trim() : "";
      await avisarJefatura(ctx, db, `Desviación reportada por ${user.nombre}`, nota.slice(0, 160) || undefined, `/aop/${r.evento.id}`);
      return { datos: { eventoId: r.evento.id, yaExistia: r.yaExistia }, m };
    }
    case "ronda.iniciar": {
      const m = momentoCapturado(op.at);
      const ejecucion = await ejecucionDeOp(db, op, user, m);
      return { datos: { ejecucionId: ejecucion.id }, m };
    }
    case "ronda.lectura": {
      const m = momentoCapturado(op.at);
      const leido = numeroEscrito(op.valor);
      const ejecucion = await ejecucionDeOp(db, op, user, m);
      const puntoId = Number(op.puntoId);
      const punto = recorridoDe(ejecucion)?.find((p) => p.id === puntoId) ?? (await paradasDeEjecucion(db, ejecucion)).find((p) => p.id === puntoId);
      if (!punto) throw new RechazoCampo("Esa parada ya no está en el recorrido.");
      const resultado = String(op.resultado ?? "");
      if (!["ok", "fuera", "no_verificado"].includes(resultado)) throw new RechazoCampo("Resultado inválido.");
      const valido = leido.tipo === "numero" ? leido.valor : null;
      const nota = typeof op.nota === "string" ? op.nota.trim() || null : null;
      if (resultado === "no_verificado" && (nota?.length ?? 0) < 3) throw new RechazoCampo("Escribe por qué no se pudo verificar.");
      if (resultado === "ok" && punto.requiereValor && valido === null) throw new RechazoCampo("Falta la lectura de esta parada.");
      if (resultado === "fuera" && valido === null && (nota?.length ?? 0) < 3) throw new RechazoCampo("Escribe qué viste.");
      const r = await registrarLectura(db, ejecucion, punto, { resultado: resultado as any, valor: valido, nota, usuarioId: user.id, momento: m, opId: op.opId });
      if (r.eventoId && r.eventoNuevo) await avisarJefatura(ctx, db, `Desviación en ronda: ${punto.etiqueta}`, `${user.nombre}${valido !== null ? ` · leído ${textoDeNumero(valido)}${punto.unidad ? ` ${punto.unidad}` : ""}` : ""}${nota ? ` · ${nota.slice(0, 120)}` : ""}`, `/aop/${r.eventoId}`);
      else if (resultado === "no_verificado" && punto.critico) await avisarJefatura(ctx, db, `Parada crítica sin verificar: ${punto.etiqueta}`, `${user.nombre} · ${nota}`, `/ronda/${ejecucion.id}`);
      return { datos: { ejecucionId: ejecucion.id, eventoId: r.eventoId, ...(r.tardia ? { tardia: true } : {}) }, m };
    }
    case "ronda.cerrar": {
      const clave = claveRonda(op);
      const ejecucion = await buscarEjecucion(db, clave);
      if (!ejecucion) throw new RechazoCampo("Esa ronda no se había iniciado.");
      const m = momentoCapturado(op.at, ejecucion.iniciadaEn);
      if (ejecucion.estado === "completada") {
        // Otro técnico ya firmó. Lo firmado no se toca, pero esta entrega no se pierde: queda en el registro y le llega a la jefatura.
        const notasTardias = typeof op.notas === "string" ? op.notas.trim().slice(0, 2000) : "";
        if (notasTardias && notasTardias !== (ejecucion.notas ?? "")) await avisarJefatura(ctx, db, "Entrega de turno que llegó después de la firma", `${user.nombre}: ${notasTardias.slice(0, 200)}`, `/ronda/${ejecucion.id}`);
        return { datos: { ejecucionId: ejecucion.id, yaCerrada: true, ...(notasTardias ? { notasTardias } : {}) }, m };
      }
      if (op.firma !== true) throw new RechazoCampo("La ronda no se cierra sin firma.");
      const r = await cerrarEjecucion(db, ejecucion, user, typeof op.notas === "string" ? op.notas.trim().slice(0, 2000) || null : null, m);
      if (!r.ok) throw new RechazoCampo(r.error ?? "No se pudo cerrar la ronda.");
      if (r.fuera || r.sinVerificar) await avisarJefatura(ctx, db, `Ronda de ${laHora(clave.turno)} cerrada con novedades`, `${user.nombre} · ${r.fuera ?? 0} fuera de rango · ${r.sinVerificar ?? 0} sin verificar`, `/ronda/${ejecucion.id}`);
      return { datos: { ejecucionId: ejecucion.id }, m };
    }
    default:
      throw new RechazoCampo(`Operación desconocida: ${op.tipo}`);
  }
}

/** Un error de datos se repetiría igual en cada reintento y bloquearía toda la cola del celular. */
const esErrorDeDatos = (e: unknown) => /constraint|no se edita|no se borra/i.test(String((e as Error)?.message ?? e));

/**
 * Aplica una operación una sola vez. Un rechazo por regla de negocio queda
 * registrado y se le muestra al técnico. Un fallo del servidor no se registra:
 * el celular reintentará la misma operación.
 */
export async function aplicarOperacion(ctx: APIContext, db: Db, user: Usuario, op: OperacionCampo): Promise<ResultadoOperacion> {
  if (typeof op.opId !== "string" || op.opId.length < 8 || op.opId.length > 80) return { opId: String(op.opId), ok: false, error: "Operación sin identificador." };
  const [previa] = await db.select().from(campoOperaciones).where(eq(campoOperaciones.opId, op.opId)).limit(1);
  if (previa) {
    if (previa.usuarioId !== user.id) return { opId: op.opId, ok: false, error: "Operación de otra persona." };
    return { opId: op.opId, ok: previa.resultado === "ok", repetida: true, error: previa.resultado === "ok" ? undefined : previa.detalle ?? "Rechazada", datos: previa.resultado === "ok" && previa.detalle ? JSON.parse(previa.detalle) : undefined };
  }
  const recibido = new Date().toISOString();
  const capturado = typeof op.at === "string" ? op.at.slice(0, 40) : recibido;
  try {
    const r = await ejecutar(ctx, db, user, op);
    await db.insert(campoOperaciones).values({ opId: op.opId, usuarioId: user.id, tipo: op.tipo, ordenId: r.ordenId ?? null, capturadoEn: r.m.iso, recibidoEn: r.m.recibido, resultado: "ok", detalle: r.datos ? JSON.stringify(r.datos) : null }).onConflictDoNothing();
    return { opId: op.opId, ok: true, datos: r.datos };
  } catch (e) {
    if (e instanceof RechazoCampo || esErrorDeDatos(e)) {
      const motivo = e instanceof RechazoCampo ? e.message : "El servidor no pudo guardar este registro. Quedó guardado para que tu jefatura lo revise.";
      if (!(e instanceof RechazoCampo)) console.error("campo_op_rechazada", op.tipo, e);
      await db.insert(campoOperaciones).values({ opId: op.opId, usuarioId: user.id, tipo: op.tipo, ordenId: Number(op.ordenId) || null, capturadoEn: capturado, recibidoEn: recibido, resultado: "rechazada", detalle: motivo.slice(0, 1000), payload: JSON.stringify(op).slice(0, 4000) }).onConflictDoNothing();
      return { opId: op.opId, ok: false, error: motivo };
    }
    throw e;
  }
}
