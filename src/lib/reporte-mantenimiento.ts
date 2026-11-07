// El reporte de mantenimiento se escribe solo con lo que el técnico ya registró
// al trabajar: inicio, cada paso con su hora, pausas, lecturas, fotos y fin.
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import {
  activos, adjuntos, items, ordenPasoMarcas, ordenRepuestos, ordenVerificacion, ordenVerificacionEventos, ordenes,
  planesMantenimiento, sucursales, ubicaciones, usuarios,
} from "./schema";
import { evaluarValorChecklist, minutosEstimadosChecklist, parseChecklist } from "./ordenes";
import { etiquetaOT } from "./orden-codigo";
import type { getDb } from "./db";

type Db = ReturnType<typeof getDb>;

export const TIPO_ORDEN: Record<string, string> = {
  preventivo: "Preventivo", correctivo: "Correctivo", predictivo: "Predictivo", intervencion: "Intervención planificada", emergencia: "Emergencia",
};
export const ESTADO_ORDEN: Record<string, string> = {
  abierta: "Abierta", en_proceso: "En proceso", en_espera: "En espera", completada: "Pendiente de verificación", verificada: "Verificada", cerrada: "Cerrada", cancelada: "Cancelada",
};
const ESTADO_PASO: Record<string, string> = { ok: "Realizado", na: "No aplica", desviacion: "Con novedad", pendiente: "Pendiente" };
const ACCION_EVENTO: Record<string, string> = {
  estado: "Cambio de estado", bloqueo: "Pausa", ejecucion_completada: "Enviada a verificación", verificacion_cierre: "Verificada y cerrada",
  devolucion: "Devuelta al técnico", reapertura: "Reabierta", devolucion_solicitante: "Devuelta por quien la pidió", designacion_revisor: "Revisor designado", reprogramacion: "Reprogramada",
};

/** Minutos entre dos momentos, sin contar lo que estuvo en pausa. */
function minutosSinPausa(desde: number, hasta: number, pausas: Array<[number, number]>) {
  let ms = hasta - desde;
  for (const [a, b] of pausas) ms -= Math.max(0, Math.min(hasta, b) - Math.max(desde, a));
  return Math.max(0, ms / 60000);
}

export function etiquetaMinutos(min: number | null | undefined) {
  if (min == null) return "—";
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}

export async function reporteDeOrden(db: Db, id: number) {
  const [fila] = await db
    .select({
      o: ordenes,
      a: { id: activos.id, codigo: activos.codigo, nombre: activos.nombre, marca: activos.marca, modelo: activos.modelo, serial: activos.serial },
      ubicacion: ubicaciones.nombre,
      sedeUb: ubicaciones.sucursalId,
    })
    .from(ordenes)
    .leftJoin(activos, eq(activos.id, ordenes.activoId))
    .leftJoin(ubicaciones, sql`${ubicaciones.id} = coalesce(${activos.ubicacionId}, ${ordenes.ubicacionId})`)
    .where(eq(ordenes.id, id))
    .limit(1);
  if (!fila) return null;
  const o = fila.o;

  const sedeId = fila.sedeUb ?? o.sucursalId;
  const sede = sedeId ? (await db.select({ nombre: sucursales.nombre }).from(sucursales).where(eq(sucursales.id, sedeId)).limit(1))[0]?.nombre ?? null : null;
  const idsPersonas = [o.asignadoA, o.verificadoPor, o.cerradoPor].filter((x): x is number => x != null);
  const personas = idsPersonas.length ? await db.select({ id: usuarios.id, nombre: usuarios.nombre }).from(usuarios).where(inArray(usuarios.id, idsPersonas)) : [];
  const nombre = (pid: number | null | undefined) => personas.find((p) => p.id === pid)?.nombre ?? null;
  const plan = o.planId ? (await db.select({ titulo: planesMantenimiento.titulo, frecuencia: planesMantenimiento.frecuencia, horas: planesMantenimiento.horasEstimadas }).from(planesMantenimiento).where(eq(planesMantenimiento.id, o.planId)).limit(1))[0] ?? null : null;
  const [control] = await db.select({ ciclo: ordenVerificacion.ciclo }).from(ordenVerificacion).where(eq(ordenVerificacion.ordenId, id)).limit(1);

  const marcas = await db.select().from(ordenPasoMarcas).where(eq(ordenPasoMarcas.ordenId, id)).orderBy(asc(ordenPasoMarcas.ocurridoEn), asc(ordenPasoMarcas.id));
  const eventos = await db
    .select({ accion: ordenVerificacionEventos.accion, antes: ordenVerificacionEventos.estadoAntes, despues: ordenVerificacionEventos.estadoDespues, quien: ordenVerificacionEventos.actorNombre, cuando: ordenVerificacionEventos.ocurridoEn, motivo: ordenVerificacionEventos.motivo })
    .from(ordenVerificacionEventos)
    .where(eq(ordenVerificacionEventos.ordenId, id))
    .orderBy(asc(ordenVerificacionEventos.id));

  // Tramos en pausa, para que un paso no cargue con el tiempo detenido.
  const pausas: Array<[number, number]> = [];
  let abierta: number | null = null;
  for (const ev of eventos) {
    if (ev.despues === "en_espera" && abierta == null) abierta = Date.parse(ev.cuando);
    else if (ev.antes === "en_espera" && ev.despues !== "en_espera" && abierta != null) { pausas.push([abierta, Date.parse(ev.cuando)]); abierta = null; }
  }
  const finMs = o.completadaEn ? Date.parse(o.completadaEn) : Date.now();
  if (abierta != null) pausas.push([abierta, finMs]);

  const inicioMs = o.iniciadaEn ? Date.parse(o.iniciadaEn) : null;
  const items_ = parseChecklist(o.checklistEjecucion);
  // Duración de cada paso: desde la marca anterior hasta la suya, una sola vez por paso.
  const primera = new Map<number, (typeof marcas)[number]>();
  const ultima = new Map<number, (typeof marcas)[number]>();
  for (const m of marcas) { if (!primera.has(m.pasoIdx)) primera.set(m.pasoIdx, m); ultima.set(m.pasoIdx, m); }
  const duraciones = new Map<number, number>();
  let previo = inicioMs;
  for (const m of [...primera.values()].sort((a, b) => Date.parse(a.ocurridoEn) - Date.parse(b.ocurridoEn))) {
    const t = Date.parse(m.ocurridoEn);
    if (previo != null) duraciones.set(m.pasoIdx, minutosSinPausa(previo, t, pausas));
    previo = t;
  }
  const pasos = items_.map((it, i) => {
    const marca = ultima.get(i);
    const ev = evaluarValorChecklist(it);
    return {
      n: i + 1,
      texto: it.texto,
      critico: !!it.bloqueante,
      estado: it.estado,
      estadoLabel: ESTADO_PASO[it.estado] ?? it.estado,
      hora: marca?.ocurridoEn ?? null,
      horaTexto: it.hora ?? null,
      iniciales: it.iniciales ?? null,
      minutos: duraciones.has(i) ? duraciones.get(i)! : null,
      estimado: it.minutos ?? null,
      valor: it.valorMedido ?? null,
      unidad: it.unidad ?? null,
      rango: ev.rangoTexto,
      dentro: ev.dentro,
      nota: it.notas ?? null,
      sinSenal: !!marca?.sinSenal,
    };
  });

  const pausaMin = o.tiempoPausadoMin ?? 0;
  const efectivoMin = inicioMs != null && o.completadaEn ? Math.max(0, (finMs - inicioMs) / 60000 - pausaMin) : null;
  const estimadoMin = minutosEstimadosChecklist(items_) || (plan?.horas ? Math.round(plan.horas * 60) : null);

  const repuestos = await db
    .select({ codigo: items.codigo, nombre: items.nombre, unidad: items.unidad, cantidad: ordenRepuestos.cantidad, notas: ordenRepuestos.notas })
    .from(ordenRepuestos)
    .leftJoin(items, eq(items.id, ordenRepuestos.itemId))
    .where(eq(ordenRepuestos.ordenId, id))
    .orderBy(asc(ordenRepuestos.id));
  const fotos = await db
    .select({ id: adjuntos.id, nombre: adjuntos.nombre, categoria: adjuntos.categoria, contentType: adjuntos.contentType })
    .from(adjuntos)
    .where(eq(adjuntos.ordenId, id))
    .orderBy(asc(adjuntos.id));

  return {
    orden: o,
    codigo: etiquetaOT(o),
    version: control?.ciclo ?? 1,
    activo: fila.a?.id ? fila.a : null,
    ubicacion: fila.ubicacion ?? o.ubicacionDetalle ?? null,
    sede,
    plan,
    tecnico: nombre(o.asignadoA),
    verificador: nombre(o.verificadoPor),
    tipoLabel: TIPO_ORDEN[o.tipo] ?? o.tipo,
    estadoLabel: ESTADO_ORDEN[o.estado] ?? o.estado,
    tiempos: {
      inicio: o.iniciadaEn ?? null,
      fin: o.completadaEn ?? null,
      efectivoMin,
      pausaMin,
      estimadoMin,
      diferenciaMin: efectivoMin != null && estimadoMin ? Math.round(efectivoMin - estimadoMin) : null,
      marcasSinSenal: marcas.filter((m) => m.sinSenal).length,
    },
    pasos,
    novedades: pasos.filter((p) => p.estado === "desviacion"),
    lecturas: pasos.filter((p) => p.valor != null),
    repuestos,
    fotos: fotos.filter((f) => f.contentType?.startsWith("image/")),
    documentos: fotos.filter((f) => !f.contentType?.startsWith("image/")),
    historial: eventos
      .filter((ev) => ev.accion in ACCION_EVENTO)
      .filter((ev) => ev.accion !== "estado" || ev.despues === "en_proceso")
      .map((ev) => ({
        titulo: ev.accion === "estado" ? (ev.antes === "en_espera" ? "Reanudó" : ev.antes === "abierta" ? "Inició" : "Volvió a proceso") : ACCION_EVENTO[ev.accion],
        cuando: ev.cuando,
        quien: ev.quien,
        motivo: ev.motivo,
      })),
  };
}

// ── Consolidado ─────────────────────────────────────────────────────────────
export interface FiltrosConsolidado {
  desde?: string | null;
  hasta?: string | null;
  sede?: number | null;
  rubro?: string | null;
  tecnico?: number | null;
  tipo?: string | null;
}

/** Inicio y fin del día en El Salvador (UTC-6), para comparar contra fechas guardadas en UTC. */
export const inicioDiaSV = (d: string) => `${d}T06:00:00.000Z`;
export const finDiaSV = (d: string) => new Date(Date.parse(`${d}T06:00:00.000Z`) + 86_400_000 - 1).toISOString();

export async function consolidadoMantenimiento(db: Db, f: FiltrosConsolidado) {
  const conds = [isNotNull(ordenes.completadaEn)];
  if (f.desde) conds.push(gte(ordenes.completadaEn, inicioDiaSV(f.desde)));
  if (f.hasta) conds.push(lte(ordenes.completadaEn, finDiaSV(f.hasta)));
  if (f.rubro) conds.push(eq(ordenes.rubro, f.rubro as any));
  if (f.tecnico) conds.push(eq(ordenes.asignadoA, f.tecnico));
  if (f.tipo) conds.push(eq(ordenes.tipo, f.tipo as any));
  const filas = await db
    .select({
      id: ordenes.id, codigoOrden: ordenes.codigo, titulo: ordenes.titulo, tipo: ordenes.tipo, estado: ordenes.estado, rubro: ordenes.rubro,
      iniciadaEn: ordenes.iniciadaEn, completadaEn: ordenes.completadaEn, pausaMin: ordenes.tiempoPausadoMin, checklist: ordenes.checklistEjecucion,
      sucursalOrden: ordenes.sucursalId, codigo: activos.codigo, equipo: activos.nombre, ubicacion: ubicaciones.nombre, sedeUb: ubicaciones.sucursalId, tecnico: usuarios.nombre,
    })
    .from(ordenes)
    .leftJoin(activos, eq(activos.id, ordenes.activoId))
    .leftJoin(ubicaciones, sql`${ubicaciones.id} = coalesce(${activos.ubicacionId}, ${ordenes.ubicacionId})`)
    .leftJoin(usuarios, eq(usuarios.id, ordenes.asignadoA))
    .where(and(...conds))
    .orderBy(desc(ordenes.completadaEn))
    .limit(2000);
  const sedes = new Map((await db.select({ id: sucursales.id, nombre: sucursales.nombre }).from(sucursales)).map((s) => [s.id, s.nombre]));
  const filasOut = filas
    .map((x) => {
      const sedeId = x.sedeUb ?? x.sucursalOrden;
      const pasos = parseChecklist(x.checklist);
      const pausaMin = x.pausaMin ?? 0;
      const efectivoMin = x.iniciadaEn && x.completadaEn ? Math.max(0, Math.round((Date.parse(x.completadaEn) - Date.parse(x.iniciadaEn)) / 60000 - pausaMin)) : null;
      const estimadoMin = minutosEstimadosChecklist(pasos) || null;
      return {
        id: x.id,
        registro: etiquetaOT({ id: x.id, codigo: x.codigoOrden }),
        titulo: x.titulo,
        tipo: x.tipo,
        tipoLabel: TIPO_ORDEN[x.tipo] ?? x.tipo,
        estado: x.estado,
        estadoLabel: ESTADO_ORDEN[x.estado] ?? x.estado,
        codigo: x.codigo,
        equipo: x.equipo,
        ubicacion: x.ubicacion,
        sedeId,
        sede: sedeId ? sedes.get(sedeId) ?? null : null,
        tecnico: x.tecnico,
        inicio: x.iniciadaEn,
        fin: x.completadaEn,
        efectivoMin,
        pausaMin,
        estimadoMin,
        pasos: pasos.length,
        novedades: pasos.filter((p) => p.estado === "desviacion").length,
      };
    })
    .filter((x) => !f.sede || x.sedeId === f.sede);
  const conTiempo = filasOut.filter((x) => x.efectivoMin != null);
  const totalMin = conTiempo.reduce((s, x) => s + (x.efectivoMin ?? 0), 0);
  const conAmbos = conTiempo.filter((x) => x.estimadoMin);
  return {
    filas: filasOut,
    resumen: {
      ordenes: filasOut.length,
      minutosEfectivos: totalMin,
      promedioMin: conTiempo.length ? Math.round(totalMin / conTiempo.length) : null,
      novedades: filasOut.reduce((s, x) => s + x.novedades, 0),
      estimadoMin: conAmbos.reduce((s, x) => s + (x.estimadoMin ?? 0), 0),
      realContraEstimadoMin: conAmbos.reduce((s, x) => s + (x.efectivoMin ?? 0), 0),
    },
  };
}
