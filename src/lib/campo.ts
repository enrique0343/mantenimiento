// ─── Modo técnico · lo que el celular pide y lo que el celular envía ─────────
//
// El celular trabaja primero y sincroniza después. Por eso cada cambio viaja
// como una operación con identificador propio y con la hora real en que se
// capturó: si se corta la señal, se guarda en el teléfono y llega cuando vuelva,
// con su hora verdadera y sin aplicarse dos veces.
//
// Nada de esto relaja las reglas: cada operación sobre una orden pasa por
// aplicarCambioOrden, el mismo camino de la ficha completa.
import type { APIContext } from "astro";
import { and, asc, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  activos, aopAcciones, aopEventos, aopUmbrales, campoOperaciones, checklistPlantillaItems, checklistPlantillas,
  eopFicha, ordenPasoMarcas, ordenVerificacion, ordenVerificacionEventos, ordenes, planesMantenimiento, procedimientos, rondaEjecuciones,
  rondaLecturas, sucursales, tickets, ubicaciones, usuarios,
} from "@/lib/schema";
import { aplicarCambioOrden } from "@/lib/orden-cambio";
import { MIN_CAUSA_RAIZ, minutosEstimadosChecklist, parseChecklist, requiereCausaRaiz, validarAreaTrabajo, vencimientoCausaRaiz } from "@/lib/ordenes";
import { crearNotificacion } from "@/lib/notif-app";
import { logAudit } from "@/lib/audit";
import { queSigue } from "@/lib/resolver";
import {
  abrirEjecucion, buscarEjecucion, cerrarEjecucion, parsearTurnos, puntosDeRonda, registrarLectura,
  rondaDeSede, turnoActual, etiquetaTurno,
} from "@/lib/ronda-turno";
import { abrirEvento, ESTADOS_AOP_ABIERTOS } from "@/lib/aop";

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

/** Lo que tiene riesgo propio se trabaja en la ficha completa: permisos, liberaciones y tiempos del EOP. */
const tipoEnFicha = (tipo: string) => tipo === "intervencion" || tipo === "emergencia";

function ordenParaCampo(fila: FilaOrden, ubis: MapaUbicaciones, sedes: Map<number, string>, extra: { devuelta?: string | null; motivoPausa?: string | null; ultimas?: Record<string, string> } = {}) {
  const { o, a } = fila;
  const ubId = a?.ubicacionId ?? o.ubicacionId ?? null;
  const ub = ubId ? ubis.get(ubId) : undefined;
  const sedeId = ub?.sucursalId ?? o.sucursalId ?? null;
  const pasos = parseChecklist(o.checklistEjecucion);
  return {
    id: o.id,
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
    causaRaiz: o.causaRaiz ?? null,
    pideCausaRaiz: requiereCausaRaiz(o.tipo, a?.criticidad).requiere,
    minCausaRaiz: MIN_CAUSA_RAIZ,
    modo: tipoEnFicha(o.tipo) ? "ficha" : "pasos",
    devuelta: extra.devuelta ?? null,
    motivoPausa: extra.motivoPausa ?? null,
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

async function rondaParaSede(db: Db, sedeId: number) {
  const ronda = await rondaDeSede(db, sedeId);
  if (!ronda) return null;
  const t = turnoActual(parsearTurnos(ronda.turnos));
  const ejec = await buscarEjecucion(db, { rondaId: ronda.id, sucursalId: sedeId, fecha: t.fecha, turno: t.turno });
  const puntos = await puntosDeRonda(db, ronda.id);
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
    rondaId: ronda.id,
    sucursalId: sedeId,
    nombre: ronda.nombre,
    fecha: t.fecha,
    turno: t.turno,
    etiqueta: etiquetaTurno(t.turno),
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
      ultima: ultimas.has(p.id) ? String(ultimas.get(p.id)) : null,
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

  const armar = async (f: FilaOrden) => {
    const conLectura = parseChecklist(f.o.checklistEjecucion).some((p) => p.requiereValor);
    const ultimas = conLectura && f.o.planId ? await ultimasLecturasDelPlan(db, f.o.planId, f.o.id) : {};
    return ordenParaCampo(f, ubis, sedes, { devuelta: devueltas.get(f.o.id) ?? null, motivoPausa: f.o.estado === "en_espera" ? pausas.get(f.o.id) ?? null : null, ultimas });
  };
  const ordenesVista = [];
  for (const f of mias) ordenesVista.push(await armar(f));
  const libresVista = [];
  for (const f of libres) libresVista.push(await armar(f));

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

  // Rondas programadas por jefatura en /rondas, cuando las tiene a su cargo.
  let rondasAsignadas: any[] = [];
  try {
    rondasAsignadas = (await db.all(sql`
      SELECT id, name, scheduled_date AS fecha, shift AS turno, due_at AS vence, status AS estado
      FROM rondas_executions
      WHERE (owner_id = ${user.id} OR backup_id = ${user.id}) AND status IN ('pendiente','en_curso','devuelta')
      ORDER BY due_at LIMIT 12`)) as any[];
  } catch {
    rondasAsignadas = [];
  }

  // Si jefatura le pidió verificar a este técnico, también le toca verlo aquí.
  const porVerificar = await db
    .select({ id: ordenes.id, titulo: ordenes.titulo, completadaEn: ordenes.completadaEn })
    .from(ordenVerificacion)
    .innerJoin(ordenes, eq(ordenes.id, ordenVerificacion.ordenId))
    .where(and(or(eq(ordenVerificacion.revisorId, user.id), eq(ordenVerificacion.revisorSuplenteId, user.id)), eq(ordenes.estado, "completada")))
    .orderBy(asc(ordenes.completadaEn))
    .limit(12);

  const hoySV = new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
  const inicioHoy = new Date(`${hoySV}T06:00:00.000Z`).toISOString();
  const hechasHoy = await db
    .select({ id: ordenes.id, titulo: ordenes.titulo, estado: ordenes.estado, completadaEn: ordenes.completadaEn })
    .from(ordenes)
    .where(and(eq(ordenes.asignadoA, user.id), inArray(ordenes.estado, ["completada", "verificada", "cerrada"]), gte(ordenes.completadaEn, inicioHoy)))
    .orderBy(desc(ordenes.completadaEn))
    .limit(30);

  // Los EOP viajan con el paquete: una emergencia no espera a que vuelva la señal.
  const eops = await db
    .select({ id: procedimientos.id, codigo: procedimientos.codigoCorto, titulo: procedimientos.titulo, sistema: procedimientos.sistema, a1: eopFicha.accion1, a2: eopFicha.accion2, a3: eopFicha.accion3 })
    .from(procedimientos)
    .innerJoin(eopFicha, eq(eopFicha.procedimientoId, procedimientos.id))
    .where(and(eq(procedimientos.tipo, "eop"), eq(procedimientos.activo, true)))
    .orderBy(asc(procedimientos.codigoCorto));

  return {
    generadoEn: new Date().toISOString(),
    usuario: { id: user.id, nombre: user.nombre, rol: user.rol, sucursalId: yo?.sucursalId ?? null },
    sedes: sedesFilas,
    sedeId,
    ronda: sedeId ? await rondaParaSede(db, sedeId) : null,
    rondasAsignadas,
    ordenes: ordenesVista,
    libres: libresVista,
    tickets: misTickets,
    desviaciones,
    porVerificar,
    hechasHoy,
    emergencias: eops.map((e) => ({ id: e.id, codigo: e.codigo, titulo: e.titulo, sistema: e.sistema, acciones: [e.a1, e.a2, e.a3].filter(Boolean) })),
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
    .select({ id: ordenes.id, titulo: ordenes.titulo, estado: ordenes.estado, tipo: ordenes.tipo, asignadoA: ordenes.asignadoA, asignado: usuarios.nombre, planId: ordenes.planId })
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
  const plantillas = await db.select({ id: checklistPlantillas.id, nombre: checklistPlantillas.nombre, tipo: checklistPlantillas.tipoDocumento }).from(checklistPlantillas).where(and(eq(checklistPlantillas.activa, true), ne(checklistPlantillas.tipoDocumento, "mop"))).orderBy(asc(checklistPlantillas.nombre)).limit(40);
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
    plantillas,
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

export class RechazoCampo extends Error {
  constructor(message: string, public status = 400) { super(message); }
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
    const [enRevision] = await db.select({ id: ordenes.id }).from(ordenes).where(and(eq(ordenes.planId, plan.id), inArray(ordenes.estado, ["completada", "verificada"]))).limit(1);
    if (enRevision) throw new RechazoCampo(`Este plan ya tiene la orden #${enRevision.id} esperando verificación.`, 409);
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
  return ordenParaCampo(f, new Map(ubisFilas.map((u) => [u.id, { nombre: u.nombre, sucursalId: u.sucursalId }])), new Map(sedesFilas.map((s) => [s.id, s.nombre])), { ultimas });
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

async function cambiarOrden(ctx: APIContext, user: Usuario, id: number, cuerpo: Record<string, unknown>, momento: string) {
  const res = await aplicarCambioOrden(ctx, user, id, cuerpo, { momento });
  const j: any = await res.json().catch(() => ({}));
  if (res.status >= 500) throw new Error(typeof j.error === "string" ? j.error : "Error del servidor");
  if (!res.ok) {
    const msg = typeof j.error === "string" ? j.error : "No se pudo guardar.";
    throw new RechazoCampo(msg, res.status);
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

/** Trabajos realizados, escritos a partir de lo que el técnico ya marcó. */
export function textoDeTrabajos(checklist: string | null | undefined, titulo: string, nota?: string | null) {
  const pasos = parseChecklist(checklist);
  const limpio = titulo.replace(/^\[[^\]]+\]\s*/, "").replace(/\s+-\s+\S+$/, "").trim() || "Mantenimiento";
  const partes: string[] = [];
  if (pasos.length) {
    const ok = pasos.filter((p) => p.estado === "ok").length;
    const na = pasos.filter((p) => p.estado === "na").length;
    const nov = pasos.filter((p) => p.estado === "desviacion");
    partes.push(`${limpio}: ${ok + nov.length} de ${pasos.length} puntos realizados${nov.length ? `, ${nov.length} con novedad` : " sin novedad"}${na ? `, ${na} no aplica` : ""}.`);
    const lect = pasos.filter((p) => p.valorMedido).map((p) => `${p.texto}: ${p.valorMedido}${p.unidad ? ` ${p.unidad}` : ""}`);
    if (lect.length) partes.push(`Lecturas: ${lect.join("; ")}.`);
    for (const n of nov) if (n.notas) partes.push(`Novedad en «${n.texto}»: ${n.notas.replace(/\.+\s*$/, "")}.`);
  }
  if (nota?.trim()) partes.push(nota.trim());
  return partes.join(" ");
}

const SISTEMA_A_AREA: Record<string, "aires" | "infraestructura"> = { hvac: "aires" };

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
  if (activoId) {
    const [a] = await db.select({ codigo: activos.codigo, ubicacionId: activos.ubicacionId }).from(activos).where(eq(activos.id, activoId)).limit(1);
    if (!a) throw new RechazoCampo("Ese equipo ya no existe.", 404);
    ubicacionId = a.ubicacionId ?? ubicacionId;
    etiqueta = a.codigo;
  }
  const sucursalId = (await sucursalDeUbicacion(db, ubicacionId)) ?? (op.sucursalId ? Number(op.sucursalId) : null);
  const rubroPedido = typeof op.rubro === "string" ? op.rubro : eop ? SISTEMA_A_AREA[eop.sistema] ?? "infraestructura" : null;
  const area = await validarAreaTrabajo(db, { rubro: activoId ? undefined : rubroPedido, activoId, sucursalId, ubicacionId } as any);
  if ("error" in area) throw new RechazoCampo(area.error);
  const base = eop?.titulo ?? (nota.slice(0, 120) || "Falla reportada desde el celular");
  const titulo = `${emergencia ? "[Emergencia]" : "[Correctivo]"} ${base}${etiqueta ? ` - ${etiqueta}` : ""}`.slice(0, 200);
  const [orden] = await db.insert(ordenes).values({
    titulo,
    descripcion: nota || null,
    tipo: emergencia ? "emergencia" : "correctivo",
    rubro: area.rubro,
    prioridad: emergencia ? "urgente" : "alta",
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
  await avisarJefatura(ctx, db, emergencia ? `Emergencia: ${base}` : `Falla reportada: ${base}`, `${user.nombre}${etiqueta ? ` · ${etiqueta}` : ""}${nota ? ` · ${nota.slice(0, 120)}` : ""}`, `/ordenes/${orden.id}`);
  return { ordenId: orden.id };
}

const claveRonda = (op: OperacionCampo) => {
  const rondaId = Number(op.rondaId), sucursalId = Number(op.sucursalId);
  const fecha = String(op.fecha ?? ""), turno = String(op.turno ?? "");
  if (!Number.isInteger(rondaId) || !Number.isInteger(sucursalId) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(turno)) throw new RechazoCampo("Ronda inválida.");
  return { rondaId, sucursalId, fecha, turno };
};

async function ejecutar(ctx: APIContext, db: Db, user: Usuario, op: OperacionCampo): Promise<{ datos?: unknown; ordenId?: number | null; m: Momento }> {
  switch (op.tipo) {
    case "orden.iniciar": {
      const o = await ordenDeOp(db, op);
      const m = momentoCapturado(op.at);
      if (o.estado !== "en_proceso") await cambiarOrden(ctx, user, o.id, { estado: "en_proceso" }, m.iso);
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
      const o = await ordenDeOp(db, op);
      const m = momentoCapturado(op.at, o.iniciadaEn);
      const idx = Number(op.idx);
      const estado = String(op.estado ?? "");
      if (!["ok", "na", "desviacion", "pendiente"].includes(estado)) throw new RechazoCampo("Estado de paso inválido.");
      let lista: any[];
      try { lista = JSON.parse(o.checklistEjecucion ?? "[]"); } catch { throw new RechazoCampo("El checklist de esta orden no se pudo leer."); }
      if (!Array.isArray(lista) || !Number.isInteger(idx) || !lista[idx]) throw new RechazoCampo("Ese paso ya no existe en la orden.");
      const it = lista[idx];
      if (typeof it !== "object" || it === null) throw new RechazoCampo("Ese paso tiene un formato antiguo. Ábrelo en la ficha completa.");
      if (typeof op.texto === "string" && op.texto !== it.texto) throw new RechazoCampo("El checklist cambió en la oficina. Actualiza para ver la versión vigente.", 409);
      it.estado = estado;
      delete it.hecho;
      const valor = op.valor === null || op.valor === undefined || op.valor === "" ? null : String(op.valor).replace(",", ".");
      if (valor !== null) it.valorMedido = valor;
      if (typeof op.nota === "string") it.notas = op.nota.trim() || undefined;
      if (estado !== "pendiente") { it.hora = horaSV(m.iso); it.iniciales = iniciales(user.nombre); }
      await cambiarOrden(ctx, user, o.id, { checklistEjecucion: JSON.stringify(lista) }, m.iso);
      await db.insert(ordenPasoMarcas).values({
        ordenId: o.id, pasoIdx: idx, pasoTexto: String(it.texto ?? "").slice(0, 500), estado, valor,
        nota: typeof op.nota === "string" ? op.nota.trim() || null : null,
        ocurridoEn: m.iso, recibidoEn: m.recibido, sinSenal: m.sinSenal, usuarioId: user.id, opId: op.opId,
      });
      return { ordenId: o.id, m };
    }
    case "orden.terminar": {
      const o = await ordenDeOp(db, op);
      const [ultima] = await db.select({ en: ordenPasoMarcas.ocurridoEn }).from(ordenPasoMarcas).where(eq(ordenPasoMarcas.ordenId, o.id)).orderBy(desc(ordenPasoMarcas.ocurridoEn)).limit(1);
      const m = momentoCapturado(op.at, ultima?.en ?? o.iniciadaEn);
      if (!["completada", "verificada", "cerrada"].includes(o.estado)) {
        const nota = typeof op.nota === "string" ? op.nota : null;
        const texto = textoDeTrabajos(o.checklistEjecucion, o.titulo, nota) || o.trabajosRealizados || "";
        const causa = typeof op.causaRaiz === "string" ? op.causaRaiz.trim() : "";
        await cambiarOrden(ctx, user, o.id, { estado: "completada", trabajosRealizados: texto, ...(causa ? { causaRaiz: causa } : {}) }, m.iso);
      }
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
      const [umbral] = await db.select({ id: aopUmbrales.id }).from(aopUmbrales).where(eq(aopUmbrales.procedimientoId, procedimientoId)).limit(1);
      const valor = op.valor === null || op.valor === undefined || op.valor === "" ? null : Number(String(op.valor).replace(",", "."));
      const r = await abrirEvento(db, {
        procedimientoId, umbralId: umbral?.id ?? null, activoId, ubicacionId,
        sucursalId: op.sucursalId ? Number(op.sucursalId) : null,
        valorDetectado: valor !== null && Number.isFinite(valor) ? valor : null,
        unidad: typeof op.unidad === "string" ? op.unidad : null,
        detectadoEn: m.iso, detectadoPor: user.id, origen: "manual",
      });
      const nota = typeof op.nota === "string" ? op.nota.trim() : "";
      await avisarJefatura(ctx, db, `Desviación reportada por ${user.nombre}`, nota.slice(0, 160) || undefined, `/aop/${r.evento.id}`);
      return { datos: { eventoId: r.evento.id, yaExistia: r.yaExistia }, m };
    }
    case "ronda.iniciar": {
      const clave = claveRonda(op);
      const m = momentoCapturado(op.at);
      const { ejecucion } = await abrirEjecucion(db, { ...clave, usuarioId: user.id, momento: m.iso });
      return { datos: { ejecucionId: ejecucion.id }, m };
    }
    case "ronda.lectura": {
      const clave = claveRonda(op);
      const m = momentoCapturado(op.at);
      const { ejecucion } = await abrirEjecucion(db, { ...clave, usuarioId: user.id, momento: m.iso });
      if (ejecucion.estado === "completada") throw new RechazoCampo("Esa ronda ya estaba cerrada.", 409);
      const puntoId = Number(op.puntoId);
      const puntos = await puntosDeRonda(db, clave.rondaId);
      if (!puntos.some((p) => p.id === puntoId)) throw new RechazoCampo("Esa parada ya no está en el recorrido.");
      const resultado = String(op.resultado ?? "");
      if (!["ok", "fuera", "no_verificado"].includes(resultado)) throw new RechazoCampo("Resultado inválido.");
      const valor = op.valor === null || op.valor === undefined || op.valor === "" ? null : Number(op.valor);
      const r = await registrarLectura(db, {
        ejecucionId: ejecucion.id, puntoId, resultado: resultado as any,
        valor: valor !== null && Number.isFinite(valor) ? valor : null,
        nota: typeof op.nota === "string" ? op.nota.trim() || null : null,
        usuarioId: user.id, momento: m.iso,
      });
      return { datos: { ejecucionId: ejecucion.id, eventoId: r.eventoId }, m };
    }
    case "ronda.cerrar": {
      const clave = claveRonda(op);
      const m = momentoCapturado(op.at);
      const { ejecucion } = await abrirEjecucion(db, { ...clave, usuarioId: user.id, momento: m.iso });
      const r = await cerrarEjecucion(db, ejecucion.id, user.id, typeof op.notas === "string" ? op.notas.trim() || null : null, m.iso);
      if (!r.ok) throw new RechazoCampo(r.error ?? "No se pudo cerrar la ronda.");
      return { datos: { ejecucionId: ejecucion.id }, m };
    }
    default:
      throw new RechazoCampo(`Operación desconocida: ${op.tipo}`);
  }
}

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
    if (e instanceof RechazoCampo) {
      await db.insert(campoOperaciones).values({ opId: op.opId, usuarioId: user.id, tipo: op.tipo, ordenId: Number(op.ordenId) || null, capturadoEn: capturado, recibidoEn: recibido, resultado: "rechazada", detalle: e.message.slice(0, 1000), payload: JSON.stringify(op).slice(0, 4000) }).onConflictDoNothing();
      return { opId: op.opId, ok: false, error: e.message };
    }
    throw e;
  }
}
