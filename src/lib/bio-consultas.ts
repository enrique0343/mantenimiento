// Fase 59 · WP-D: consultas de documentos, expediente técnico, licencias y
// capacitaciones para las páginas y componentes de WP-D. Servidor.
//
// D1: hasta 100 columnas por resultado y 100 parámetros por consulta. Aquí se
// eligen las columnas, se une por tabla en vez de pasar listas de ids y los
// selects con uniones no van en db.batch (D1 devuelve objetos y dos columnas
// «nombre» se pisarían).
import { and, asc, desc, eq, gte, inArray, lte, ne, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { getDb } from "./db";
import {
  activos, activoDocumentos, activoExpedienteNa, auditLog, capacitaciones, capacitacionArchivos, capacitacionAsistentes,
  capacitacionEquipos, licenciaArchivos, licencias, proveedores, sucursales, ubicaciones, usuarios,
} from "./schema";
import { activoAreaCondition } from "./areas";
import { rubroDeActivo } from "./rubros";
import {
  CATEGORIAS_DOCUMENTO, completitudExpediente, diasEntre, etiquetaCategoriaDocumento, normalizarTexto,
  type CompletitudExpediente,
} from "./biomedico";
import { vencimientosVigentes, type FilaExpediente } from "./inventario-jci";
import type { DatosLicencia, FilaLicencia } from "./licencias";
import type { Asistente, EquipoCapacitacion, FilaCapacitacion } from "./capacitaciones";

type Db = ReturnType<typeof getDb>;

// ═══ Documentos y expediente ════════════════════════════════════════════════

export interface DocumentoEquipo {
  id: number; nombre: string; contentType: string; tamano: number; categoria: string | null; etiquetaCategoria: string;
  version: string | null; fechaDocumento: string | null; fechaVencimiento: string | null; nota: string | null;
  asBuilt: boolean; subidoPor: string | null; subidoEn: string;
}

const ORDEN_CATEGORIA = new Map<string, number>(CATEGORIAS_DOCUMENTO.map((c, i) => [c.clave, i]));
const posCategoria = (c: string | null) => ORDEN_CATEGORIA.get(c ?? "otro") ?? ORDEN_CATEGORIA.size;

/** Documentos del equipo en el orden de las categorías y, dentro, el más reciente primero. */
export async function documentosDeActivo(db: Db, activoId: number): Promise<DocumentoEquipo[]> {
  const filas = await db
    .select({
      id: activoDocumentos.id, nombre: activoDocumentos.nombre, contentType: activoDocumentos.contentType,
      tamano: activoDocumentos.tamano, categoria: activoDocumentos.categoria, version: activoDocumentos.version,
      fechaDocumento: activoDocumentos.fechaVersion, fechaVencimiento: activoDocumentos.fechaVencimiento,
      nota: activoDocumentos.nota, asBuilt: activoDocumentos.asBuilt, subidoPor: usuarios.nombre,
      subidoEn: activoDocumentos.createdAt,
    })
    .from(activoDocumentos)
    .leftJoin(usuarios, eq(usuarios.id, activoDocumentos.usuarioId))
    .where(eq(activoDocumentos.activoId, activoId))
    .orderBy(desc(activoDocumentos.id));
  return filas
    .map((f) => ({ ...f, etiquetaCategoria: etiquetaCategoriaDocumento(f.categoria) }))
    .sort((a, b) => posCategoria(a.categoria) - posCategoria(b.categoria) || b.id - a.id);
}

export interface NoAplicaExpediente { requisito: string; motivo: string; usuario: string | null; fecha: string }

export interface ExpedienteActivo {
  activo: { id: number; codigo: string; nombre: string; area: string; estado: string; aceptacionFecha: string | null };
  esBio: boolean;
  documentos: DocumentoEquipo[];
  /** Solo biomédicos. */
  completitud: CompletitudExpediente | null;
  noAplica: NoAplicaExpediente[];
}

/** Documentos, «No aplica» y completitud del expediente de un equipo; null si no existe. */
export async function expedienteDeActivo(db: Db, activoId: number, hoy: string): Promise<ExpedienteActivo | null> {
  const [a] = await db
    .select({
      id: activos.id, codigo: activos.codigo, nombre: activos.nombre, rubro: activos.rubro, tipo: activos.tipo,
      estado: activos.estado, aceptacionFecha: activos.aceptacionFecha,
    })
    .from(activos).where(eq(activos.id, activoId)).limit(1);
  if (!a) return null;
  const area = rubroDeActivo(a.rubro, a.tipo);
  const esBio = area === "biomedico";
  const [documentos, noAplica] = await Promise.all([
    documentosDeActivo(db, activoId),
    db.select({ requisito: activoExpedienteNa.requisito, motivo: activoExpedienteNa.motivo, usuario: usuarios.nombre, fecha: activoExpedienteNa.createdAt })
      .from(activoExpedienteNa)
      .leftJoin(usuarios, eq(usuarios.id, activoExpedienteNa.usuarioId))
      .where(eq(activoExpedienteNa.activoId, activoId)),
  ]);
  const completitud = esBio ? completitudExpediente({ documentos, aceptacionFecha: a.aceptacionFecha, noAplica, hoy }) : null;
  return {
    activo: { id: a.id, codigo: a.codigo, nombre: a.nombre, area, estado: a.estado, aceptacionFecha: a.aceptacionFecha },
    esBio, documentos, completitud, noAplica,
  };
}

/**
 * Una fila por equipo biomédico (sin bajas, salvo que se pidan) con su expediente.
 * Tres consultas: equipos, sus documentos y sus «No aplica», unidos por tabla.
 */
export async function expedientesBiomedicos(db: Db, opciones: { hoy: string; incluirBajas?: boolean }): Promise<FilaExpediente[]> {
  const { hoy } = opciones;
  const cond = opciones.incluirBajas ? activoAreaCondition("biomedico") : and(activoAreaCondition("biomedico"), ne(activos.estado, "baja"));
  const [equipos, docs, nas] = await Promise.all([
    db.select({
      activoId: activos.id, codigo: activos.codigo, nombre: activos.nombre, marca: activos.marca, modelo: activos.modelo,
      serial: activos.serial, estado: activos.estado, subcategoria: activos.subcategoria, criticidad: activos.criticidadOperacional,
      aceptacionFecha: activos.aceptacionFecha, ubicacionTexto: activos.ubicacion, sucursalId: ubicaciones.sucursalId,
      sede: sucursales.nombre, ubicacion: ubicaciones.nombre,
    })
      .from(activos)
      .leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId))
      .leftJoin(sucursales, eq(sucursales.id, ubicaciones.sucursalId))
      .where(cond),
    db.select({ activoId: activoDocumentos.activoId, id: activoDocumentos.id, categoria: activoDocumentos.categoria, fechaVencimiento: activoDocumentos.fechaVencimiento })
      .from(activoDocumentos)
      .innerJoin(activos, eq(activos.id, activoDocumentos.activoId))
      .where(cond),
    db.select({ activoId: activoExpedienteNa.activoId, requisito: activoExpedienteNa.requisito, motivo: activoExpedienteNa.motivo })
      .from(activoExpedienteNa)
      .innerJoin(activos, eq(activos.id, activoExpedienteNa.activoId))
      .where(cond),
  ]);
  const docsPor = agrupar(docs, (d) => d.activoId);
  const naPor = agrupar(nas, (n) => n.activoId);
  return equipos
    .map((e) => {
      const documentos = docsPor.get(e.activoId) ?? [];
      const completitud = completitudExpediente({ documentos, aceptacionFecha: e.aceptacionFecha, noAplica: naPor.get(e.activoId) ?? [], hoy });
      const vencimientos = vencimientosVigentes(documentos).map((v) => ({ ...v, dias: diasEntre(hoy, v.fecha) }));
      const proximo = vencimientos[0] ?? null;
      return {
        activoId: e.activoId, codigo: e.codigo, nombre: e.nombre, marca: e.marca, modelo: e.modelo, serial: e.serial,
        estado: e.estado, subcategoria: e.subcategoria, criticidad: e.criticidad, sucursalId: e.sucursalId ?? null,
        sede: e.sede ?? null, ubicacion: e.ubicacion ?? e.ubicacionTexto ?? null, aceptacionFecha: e.aceptacionFecha,
        documentos: documentos.length, completitud,
        proximoVencimiento: proximo
          ? { fecha: proximo.fecha, categoria: proximo.categoria, etiquetaCategoria: etiquetaCategoriaDocumento(proximo.categoria), dias: proximo.dias }
          : null,
        porVencer90: vencimientos.filter((v) => v.dias <= 90).length,
      };
    })
    .sort((a, b) => a.codigo.localeCompare(b.codigo, "es", { numeric: true }));
}

/** Documentos de los equipos biomédicos para el CSV de detalle (con quién los subió). */
export async function documentosBiomedicos(db: Db, opciones: { incluirBajas?: boolean }) {
  const cond = opciones.incluirBajas ? activoAreaCondition("biomedico") : and(activoAreaCondition("biomedico"), ne(activos.estado, "baja"));
  return db
    .select({
      activoId: activoDocumentos.activoId, id: activoDocumentos.id, codigo: activos.codigo, equipo: activos.nombre,
      categoria: activoDocumentos.categoria, nombre: activoDocumentos.nombre, version: activoDocumentos.version,
      fechaVersion: activoDocumentos.fechaVersion, fechaVencimiento: activoDocumentos.fechaVencimiento,
      nota: activoDocumentos.nota, subidoPor: usuarios.nombre, createdAt: activoDocumentos.createdAt,
    })
    .from(activoDocumentos)
    .innerJoin(activos, eq(activos.id, activoDocumentos.activoId))
    .leftJoin(usuarios, eq(usuarios.id, activoDocumentos.usuarioId))
    .where(cond)
    .orderBy(asc(activos.codigo), asc(activoDocumentos.id));
}

// ═══ Licencias ══════════════════════════════════════════════════════════════

const responsableLic = alias(usuarios, "lic_responsable");

function selectLicencias(db: Db) {
  return db
    .select({
      id: licencias.id, entidad: licencias.entidad, entidadOtra: licencias.entidadOtra, tipo: licencias.tipo,
      nombre: licencias.nombre, numero: licencias.numero, ambito: licencias.ambito, sucursalId: licencias.sucursalId,
      sede: sucursales.nombre, servicio: licencias.servicio, activoId: licencias.activoId, equipoCodigo: activos.codigo,
      equipoNombre: activos.nombre, titular: licencias.titular, fechaEmision: licencias.fechaEmision,
      fechaVencimiento: licencias.fechaVencimiento, responsableId: licencias.responsableId, responsable: responsableLic.nombre,
      estado: licencias.estado, reemplazaAId: licencias.reemplazaAId, notas: licencias.notas, createdAt: licencias.createdAt,
      archivos: sql<number>`(SELECT COUNT(*) FROM licencia_archivos la WHERE la.licencia_id = ${licencias.id})`,
      renovacionEnTramite: sql<number>`EXISTS (SELECT 1 FROM licencias r WHERE r.reemplaza_a_id = ${licencias.id} AND r.estado = 'en_tramite')`,
    })
    .from(licencias)
    .leftJoin(sucursales, eq(sucursales.id, licencias.sucursalId))
    .leftJoin(activos, eq(activos.id, licencias.activoId))
    .leftJoin(responsableLic, eq(responsableLic.id, licencias.responsableId));
}

type FilaLicenciaCruda = Awaited<ReturnType<typeof selectLicencias>>[number];
const aFilaLicencia = (r: FilaLicenciaCruda): FilaLicencia => ({
  ...r, sede: r.sede ?? null, equipoCodigo: r.equipoCodigo ?? null, equipoNombre: r.equipoNombre ?? null,
  responsable: r.responsable ?? null, archivos: Number(r.archivos) || 0, renovacionEnTramite: !!Number(r.renovacionEnTramite),
});

/** Todas las licencias (la tabla es pequeña); filtra y ordena licencias.ts. */
export async function listarLicencias(db: Db): Promise<FilaLicencia[]> {
  return (await selectLicencias(db).orderBy(desc(licencias.id))).map(aFilaLicencia);
}

/** Licencias de un equipo (todas, también reemplazadas y anuladas). */
export async function licenciasDeActivo(db: Db, activoId: number): Promise<FilaLicencia[]> {
  return (await selectLicencias(db).where(eq(licencias.activoId, activoId)).orderBy(desc(licencias.id))).map(aFilaLicencia);
}

/**
 * Revisa que el equipo, la sede y el responsable existan. En el ámbito «equipo», la sede
 * sale de la ubicación del equipo.
 */
export async function completarReferenciasLicencia(db: Db, datos: DatosLicencia): Promise<{ ok: true; datos: DatosLicencia } | { ok: false; error: string }> {
  const d: DatosLicencia = { ...datos };
  if (d.ambito === "equipo" && d.activoId) {
    const [e] = await db.select({ id: activos.id, sucursalId: ubicaciones.sucursalId })
      .from(activos).leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId))
      .where(eq(activos.id, d.activoId)).limit(1);
    if (!e) return { ok: false, error: "El equipo ya no existe. Recarga la página." };
    d.sucursalId = e.sucursalId ?? null;
  }
  if (d.sucursalId) {
    const [s] = await db.select({ id: sucursales.id }).from(sucursales).where(eq(sucursales.id, d.sucursalId)).limit(1);
    if (!s) return { ok: false, error: "La sede ya no existe. Recarga la página." };
  }
  if (d.responsableId) {
    const [u] = await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.id, d.responsableId)).limit(1);
    if (!u) return { ok: false, error: "El responsable ya no existe. Recarga la página." };
  }
  return { ok: true, datos: d };
}

/** Usuarios activos que pueden ser responsables de una licencia (admin, jefe y técnico). */
export function responsablesLicencia(db: Db) {
  return db.select({ id: usuarios.id, nombre: usuarios.nombre })
    .from(usuarios)
    .where(and(eq(usuarios.activo, true), inArray(usuarios.rol, ["admin", "jefe", "tecnico"])))
    .orderBy(asc(usuarios.nombre));
}

export interface EntradaHistorial { id: number; accion: string; resumen: string | null; cuando: string; usuario: string | null }

/** Bitácora de una licencia, capacitación u otra entidad (la más reciente primero, hasta 100). */
export async function historialDe(db: Db, entidad: string, entidadId: number): Promise<EntradaHistorial[]> {
  return db
    .select({ id: auditLog.id, accion: auditLog.accion, resumen: auditLog.resumen, cuando: auditLog.createdAt, usuario: usuarios.nombre })
    .from(auditLog)
    .leftJoin(usuarios, eq(usuarios.id, auditLog.usuarioId))
    .where(and(eq(auditLog.entidad, entidad), eq(auditLog.entidadId, entidadId)))
    .orderBy(desc(auditLog.id))
    .limit(100);
}

/** Licencia con sus archivos, la que renueva, las que la renuevan y su historial; null si no existe. */
export async function licenciaConDetalle(db: Db, id: number) {
  const [cruda] = await selectLicencias(db).where(eq(licencias.id, id)).limit(1);
  if (!cruda) return null;
  const licencia = aFilaLicencia(cruda);
  const resumenLic = { id: licencias.id, nombre: licencias.nombre, numero: licencias.numero, estado: licencias.estado, fechaVencimiento: licencias.fechaVencimiento };
  const [archivos, anterior, renovaciones, historial] = await Promise.all([
    db.select({
      id: licenciaArchivos.id, nombre: licenciaArchivos.nombre, contentType: licenciaArchivos.contentType, tamano: licenciaArchivos.tamano,
      categoria: licenciaArchivos.categoria, createdAt: licenciaArchivos.createdAt, usuario: usuarios.nombre,
    })
      .from(licenciaArchivos)
      .leftJoin(usuarios, eq(usuarios.id, licenciaArchivos.usuarioId))
      .where(eq(licenciaArchivos.licenciaId, id))
      .orderBy(desc(licenciaArchivos.id)),
    licencia.reemplazaAId ? db.select(resumenLic).from(licencias).where(eq(licencias.id, licencia.reemplazaAId)).limit(1) : Promise.resolve([]),
    db.select(resumenLic).from(licencias).where(eq(licencias.reemplazaAId, id)).orderBy(desc(licencias.id)),
    historialDe(db, "licencia", id),
  ]);
  return { licencia, archivos, reemplazaA: anterior[0] ?? null, renovaciones, historial };
}

// ═══ Capacitaciones ═════════════════════════════════════════════════════════

const columnasCapacitacion = {
  id: capacitaciones.id, fecha: capacitaciones.fecha, tema: capacitaciones.tema, tipo: capacitaciones.tipo,
  instructorTipo: capacitaciones.instructorTipo, instructorNombre: capacitaciones.instructorNombre,
  proveedorId: capacitaciones.proveedorId, proveedor: proveedores.nombre, instructorEntidad: capacitaciones.instructorEntidad,
  modeloCubierto: capacitaciones.modeloCubierto, duracionMinutos: capacitaciones.duracionMinutos,
  sucursalId: capacitaciones.sucursalId, sede: sucursales.nombre, lugar: capacitaciones.lugar,
  servicio: capacitaciones.servicio, notas: capacitaciones.notas,
};

/**
 * Capacitaciones entre `desde` y `hasta` (y del equipo, si se pide) con sus equipos,
 * asistentes y archivos. Cuatro consultas unidas por tabla; el resto de los filtros los
 * aplica filtrarCapacitaciones.
 */
export async function listarCapacitaciones(db: Db, f: { desde: string; hasta: string | null; activo: number | null }): Promise<FilaCapacitacion[]> {
  const conds: SQL[] = [gte(capacitaciones.fecha, f.desde)];
  if (f.hasta) conds.push(lte(capacitaciones.fecha, f.hasta));
  if (f.activo !== null) {
    conds.push(sql`EXISTS (SELECT 1 FROM capacitacion_equipos ce WHERE ce.capacitacion_id = ${capacitaciones.id} AND ce.activo_id = ${f.activo})`);
  }
  const donde = and(...conds);
  const [sesiones, equipos, asistentes, archivos] = await Promise.all([
    db.select(columnasCapacitacion)
      .from(capacitaciones)
      .leftJoin(proveedores, eq(proveedores.id, capacitaciones.proveedorId))
      .leftJoin(sucursales, eq(sucursales.id, capacitaciones.sucursalId))
      .where(donde)
      .orderBy(desc(capacitaciones.fecha), desc(capacitaciones.id)),
    db.select({ capacitacionId: capacitacionEquipos.capacitacionId, id: activos.id, codigo: activos.codigo, nombre: activos.nombre, marca: activos.marca, modelo: activos.modelo })
      .from(capacitacionEquipos)
      .innerJoin(capacitaciones, eq(capacitaciones.id, capacitacionEquipos.capacitacionId))
      .innerJoin(activos, eq(activos.id, capacitacionEquipos.activoId))
      .where(donde)
      .orderBy(asc(activos.codigo)),
    db.select({ capacitacionId: capacitacionAsistentes.capacitacionId, nombre: capacitacionAsistentes.nombre, cargo: capacitacionAsistentes.cargo, servicio: capacitacionAsistentes.servicio })
      .from(capacitacionAsistentes)
      .innerJoin(capacitaciones, eq(capacitaciones.id, capacitacionAsistentes.capacitacionId))
      .where(donde)
      .orderBy(asc(capacitacionAsistentes.capacitacionId), asc(capacitacionAsistentes.orden), asc(capacitacionAsistentes.id)),
    db.select({ capacitacionId: capacitacionArchivos.capacitacionId, categoria: capacitacionArchivos.categoria, n: sql<number>`COUNT(*)` })
      .from(capacitacionArchivos)
      .innerJoin(capacitaciones, eq(capacitaciones.id, capacitacionArchivos.capacitacionId))
      .where(donde)
      .groupBy(capacitacionArchivos.capacitacionId, capacitacionArchivos.categoria),
  ]);
  const equiposPor = agrupar(equipos, (e) => e.capacitacionId);
  const asistentesPor = agrupar(asistentes, (a) => a.capacitacionId);
  const listas = new Map<number, number>(), totalArchivos = new Map<number, number>();
  for (const a of archivos) {
    const n = Number(a.n) || 0;
    totalArchivos.set(a.capacitacionId, (totalArchivos.get(a.capacitacionId) ?? 0) + n);
    if (a.categoria === "lista_firmada") listas.set(a.capacitacionId, (listas.get(a.capacitacionId) ?? 0) + n);
  }
  return sesiones.map((s) => ({
    ...s, proveedor: s.proveedor ?? null, sede: s.sede ?? null,
    equipos: (equiposPor.get(s.id) ?? []).map(({ id, codigo, nombre, marca, modelo }): EquipoCapacitacion => ({ id, codigo, nombre, marca, modelo })),
    asistentes: (asistentesPor.get(s.id) ?? []).map(({ nombre, cargo, servicio }): Asistente => ({ nombre, cargo, servicio })),
    listasFirmadas: listas.get(s.id) ?? 0,
    archivos: totalArchivos.get(s.id) ?? 0,
  }));
}

/** Una capacitación con equipos, asistentes, archivos e historial; null si no existe. */
export async function capacitacionConDetalle(db: Db, id: number) {
  const registrador = alias(usuarios, "cap_registrador");
  const [c] = await db
    .select({ ...columnasCapacitacion, registradoPor: registrador.nombre, createdAt: capacitaciones.createdAt, updatedAt: capacitaciones.updatedAt })
    .from(capacitaciones)
    .leftJoin(proveedores, eq(proveedores.id, capacitaciones.proveedorId))
    .leftJoin(sucursales, eq(sucursales.id, capacitaciones.sucursalId))
    .leftJoin(registrador, eq(registrador.id, capacitaciones.usuarioId))
    .where(eq(capacitaciones.id, id))
    .limit(1);
  if (!c) return null;
  const sedeEquipo = alias(sucursales, "cap_sede_equipo");
  const [equipos, asistentes, archivos, historial] = await Promise.all([
    db.select({
      id: activos.id, codigo: activos.codigo, nombre: activos.nombre, marca: activos.marca, modelo: activos.modelo,
      serial: activos.serial, estado: activos.estado, ubicacionTexto: activos.ubicacion, ubicacion: ubicaciones.nombre,
      sede: sedeEquipo.nombre, sucursalId: ubicaciones.sucursalId,
    })
      .from(capacitacionEquipos)
      .innerJoin(activos, eq(activos.id, capacitacionEquipos.activoId))
      .leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId))
      .leftJoin(sedeEquipo, eq(sedeEquipo.id, ubicaciones.sucursalId))
      .where(eq(capacitacionEquipos.capacitacionId, id))
      .orderBy(asc(activos.codigo)),
    db.select({ id: capacitacionAsistentes.id, nombre: capacitacionAsistentes.nombre, cargo: capacitacionAsistentes.cargo, servicio: capacitacionAsistentes.servicio })
      .from(capacitacionAsistentes)
      .where(eq(capacitacionAsistentes.capacitacionId, id))
      .orderBy(asc(capacitacionAsistentes.orden), asc(capacitacionAsistentes.id)),
    db.select({
      id: capacitacionArchivos.id, nombre: capacitacionArchivos.nombre, contentType: capacitacionArchivos.contentType,
      tamano: capacitacionArchivos.tamano, categoria: capacitacionArchivos.categoria, createdAt: capacitacionArchivos.createdAt,
      usuario: usuarios.nombre,
    })
      .from(capacitacionArchivos)
      .leftJoin(usuarios, eq(usuarios.id, capacitacionArchivos.usuarioId))
      .where(eq(capacitacionArchivos.capacitacionId, id))
      .orderBy(asc(capacitacionArchivos.id)),
    historialDe(db, "capacitacion", id),
  ]);
  return { capacitacion: { ...c, proveedor: c.proveedor ?? null, sede: c.sede ?? null, registradoPor: c.registradoPor ?? null }, equipos, asistentes, archivos, historial };
}

/** Capacitaciones donde está enlazado el equipo, con el conteo de asistentes y de listas firmadas. */
export async function capacitacionesDeActivo(db: Db, activoId: number, hoy: string) {
  const [filas, nombres] = await Promise.all([
    db.select({
      id: capacitaciones.id, fecha: capacitaciones.fecha, tema: capacitaciones.tema, tipo: capacitaciones.tipo,
      instructorNombre: capacitaciones.instructorNombre,
      asistentes: sql<number>`(SELECT COUNT(*) FROM capacitacion_asistentes a WHERE a.capacitacion_id = ${capacitaciones.id})`,
      listasFirmadas: sql<number>`(SELECT COUNT(*) FROM capacitacion_archivos f WHERE f.capacitacion_id = ${capacitaciones.id} AND f.categoria = 'lista_firmada')`,
    })
      .from(capacitacionEquipos)
      .innerJoin(capacitaciones, eq(capacitaciones.id, capacitacionEquipos.capacitacionId))
      .where(eq(capacitacionEquipos.activoId, activoId))
      .orderBy(desc(capacitaciones.fecha), desc(capacitaciones.id)),
    db.select({ nombre: capacitacionAsistentes.nombre })
      .from(capacitacionAsistentes)
      .innerJoin(capacitacionEquipos, eq(capacitacionEquipos.capacitacionId, capacitacionAsistentes.capacitacionId))
      .innerJoin(capacitaciones, eq(capacitaciones.id, capacitacionAsistentes.capacitacionId))
      .where(and(eq(capacitacionEquipos.activoId, activoId), lte(capacitaciones.fecha, hoy))),
  ]);
  const lista = filas.map((f) => ({ ...f, asistentes: Number(f.asistentes) || 0, listasFirmadas: Number(f.listasFirmadas) || 0 }));
  const hechas = lista.filter((f) => f.fecha <= hoy);
  return {
    total: lista.length,
    ultima: hechas[0]?.fecha ?? null,
    asistentes: new Set(nombres.map((n) => normalizarTexto(n.nombre))).size,
    filas: lista,
  };
}

/** Sugerencias para «servicio»: lo ya escrito en capacitaciones, asistentes y licencias, y las áreas activas. */
export async function sugerenciasServicio(db: Db): Promise<string[]> {
  const filas = await db.all<{ v: string | null }>(sql`
    SELECT v FROM (
      SELECT servicio AS v FROM capacitaciones WHERE servicio IS NOT NULL AND TRIM(servicio) <> ''
      UNION SELECT servicio FROM capacitacion_asistentes WHERE servicio IS NOT NULL AND TRIM(servicio) <> ''
      UNION SELECT servicio FROM licencias WHERE servicio IS NOT NULL AND TRIM(servicio) <> ''
      UNION SELECT nombre FROM ubicaciones WHERE tipo = 'area' AND activa = 1
    ) ORDER BY v COLLATE NOCASE LIMIT 600`);
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const { v } of filas) {
    const t = String(v ?? "").replace(/\s+/g, " ").trim();
    const clave = normalizarTexto(t);
    if (!t || vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(t);
    if (salida.length >= 200) break;
  }
  return salida;
}

// ═══ Listas para los formularios ════════════════════════════════════════════

/** Sedes activas. */
export function sedesActivas(db: Db) {
  return db.select({ id: sucursales.id, nombre: sucursales.nombre }).from(sucursales).where(eq(sucursales.activa, true)).orderBy(asc(sucursales.nombre));
}

/**
 * Equipos sin baja para elegir en una capacitación (solo biomédicos) o en una licencia, más los
 * que ya están enlazados aunque se hayan dado de baja (así editar no los quita sin querer).
 */
export async function equiposParaElegir(db: Db, opciones: { soloBiomedicos: boolean; capacitacionId?: number | null; activoId?: number | null }) {
  const base = opciones.soloBiomedicos ? and(activoAreaCondition("biomedico"), ne(activos.estado, "baja"))! : ne(activos.estado, "baja");
  const extra: SQL[] = [];
  if (opciones.capacitacionId) {
    extra.push(sql`${activos.id} IN (SELECT ce.activo_id FROM capacitacion_equipos ce WHERE ce.capacitacion_id = ${opciones.capacitacionId})`);
  }
  if (opciones.activoId) extra.push(eq(activos.id, opciones.activoId));
  const cond = extra.length ? sql`(${base}) OR ${sql.join(extra, sql` OR `)}` : base;
  return db
    .select({
      id: activos.id, codigo: activos.codigo, nombre: activos.nombre, marca: activos.marca, modelo: activos.modelo,
      estado: activos.estado, sucursalId: ubicaciones.sucursalId,
    })
    .from(activos)
    .leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId))
    .where(cond)
    .orderBy(asc(activos.codigo));
}

// ═══ Utilidades ═════════════════════════════════════════════════════════════

function agrupar<T, K>(filas: readonly T[], clave: (f: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const f of filas) {
    const k = clave(f);
    const lista = m.get(k);
    if (lista) lista.push(f);
    else m.set(k, [f]);
  }
  return m;
}

// D1 acepta hasta 100 parámetros por consulta: las listas largas van en tandas de 90, en un solo batch.
const TANDA = 90;
async function enTandas<T>(db: Db, ids: readonly number[], consulta: (parte: number[]) => any): Promise<T[]> {
  if (!ids.length) return [];
  if (ids.length <= TANDA) return (await consulta([...ids])) as T[];
  const partes: any[] = [];
  for (let i = 0; i < ids.length; i += TANDA) partes.push(consulta(ids.slice(i, i + TANDA)));
  return ((await db.batch(partes as [any, ...any[]])) as T[][]).flat();
}

/** De estos ids, los que son equipos biomédicos (en tandas de 90). */
export async function idsBiomedicosExistentes(db: Db, ids: readonly number[]): Promise<Set<number>> {
  const filas = await enTandas<{ id: number }>(db, ids, (parte) =>
    db.select({ id: activos.id }).from(activos).where(and(inArray(activos.id, parte), activoAreaCondition("biomedico"))));
  return new Set(filas.map((f) => f.id));
}

/** Los equipos tienen que existir y ser biomédicos; el proveedor y la sede, existir. */
export async function revisarReferenciasCapacitacion(
  db: Db, datos: { proveedorId: number | null; sucursalId: number | null }, equipoIds: readonly number[],
): Promise<string | null> {
  const existentes = await idsBiomedicosExistentes(db, equipoIds);
  if (equipoIds.some((id) => !existentes.has(id))) return "Uno de los equipos ya no existe. Recarga la página.";
  if (datos.proveedorId) {
    const [p] = await db.select({ id: proveedores.id }).from(proveedores).where(eq(proveedores.id, datos.proveedorId)).limit(1);
    if (!p) return "El proveedor ya no existe. Recarga la página.";
  }
  if (datos.sucursalId) {
    const [s] = await db.select({ id: sucursales.id }).from(sucursales).where(eq(sucursales.id, datos.sucursalId)).limit(1);
    if (!s) return "La sede ya no existe. Recarga la página.";
  }
  return null;
}

/**
 * INSERT de asistentes (18 por sentencia: 5 parámetros cada uno = 90) y de equipos (45 por
 * sentencia: 2 parámetros = 90), para ir en un db.batch.
 */
export function insercionesCapacitacion(db: Db, capacitacionId: number, asistentes: readonly Asistente[], equipoIds: readonly number[]) {
  const sentencias = [];
  for (let i = 0; i < asistentes.length; i += 18) {
    sentencias.push(db.insert(capacitacionAsistentes).values(asistentes.slice(i, i + 18).map((a, j) => ({
      capacitacionId, orden: i + j + 1, nombre: a.nombre, cargo: a.cargo, servicio: a.servicio,
    }))));
  }
  for (let i = 0; i < equipoIds.length; i += 45) {
    sentencias.push(db.insert(capacitacionEquipos).values(equipoIds.slice(i, i + 45).map((activoId) => ({ capacitacionId, activoId }))));
  }
  return sentencias;
}
