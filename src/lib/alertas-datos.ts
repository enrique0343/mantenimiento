// Fase 59 · Consultas de las alertas y retiros: la lista, la hoja, la API y el CSV
// leen lo mismo. Columnas explícitas y nada de listas de ids en IN () salvo en
// tandas de 90 (D1: 100 parámetros por consulta).
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import type { getDb } from "./db";
import { activos, alertaAdjuntos, alertasEquipo, alertasEquipoActivos, auditLog, sucursales, ubicaciones, usuarios } from "./schema";
import { enTandas } from "./validacion-api";

type Db = ReturnType<typeof getDb>;

/** Cuántos de los ids existen como equipos. */
export async function equiposExistentes(db: Db, ids: readonly number[]): Promise<number> {
  let n = 0;
  for (const tanda of enTandas(ids, 90)) {
    n += (await db.select({ id: activos.id }).from(activos).where(inArray(activos.id, tanda))).length;
  }
  return n;
}

/** Nombres de todos los usuarios (son pocos): un solo mapa para registró, evaluó y cerró. */
export async function mapaUsuarios(db: Db): Promise<Map<number, string>> {
  const filas = await db.select({ id: usuarios.id, nombre: usuarios.nombre }).from(usuarios);
  return new Map(filas.map((u) => [u.id, u.nombre]));
}

export const camposAlerta = {
  id: alertasEquipo.id, tipo: alertasEquipo.tipo, fuente: alertasEquipo.fuente, titulo: alertasEquipo.titulo,
  descripcion: alertasEquipo.descripcion, referencia: alertasEquipo.referencia, fechaAlerta: alertasEquipo.fechaAlerta,
  estado: alertasEquipo.estado, accionTomada: alertasEquipo.accionTomada, cerradaEn: alertasEquipo.cerradaEn,
  cerradaPor: alertasEquipo.cerradaPor, creadoPor: alertasEquipo.creadoPor, createdAt: alertasEquipo.createdAt,
  aplicabilidad: alertasEquipo.aplicabilidad, aplicabilidadAnalisis: alertasEquipo.aplicabilidadAnalisis,
  aplicabilidadFecha: alertasEquipo.aplicabilidadFecha, aplicabilidadPor: alertasEquipo.aplicabilidadPor,
  fechaCierre: alertasEquipo.fechaCierre, reabiertaEn: alertasEquipo.reabiertaEn, reabiertaPor: alertasEquipo.reabiertaPor,
  motivoReapertura: alertasEquipo.motivoReapertura, vecesReabierta: alertasEquipo.vecesReabierta, updatedAt: alertasEquipo.updatedAt,
};

export interface EquipoAlerta { alertaId: number; id: number; codigo: string; nombre: string; estado: string }

/** Todas las alertas (más recientes primero), sus equipos y cuántos archivos tiene cada una. */
export async function cargarListaAlertas(db: Db) {
  const [alertas, vinculos, archivos] = await Promise.all([
    db.select(camposAlerta).from(alertasEquipo).orderBy(desc(alertasEquipo.fechaAlerta), desc(alertasEquipo.id)),
    db.select({ alertaId: alertasEquipoActivos.alertaId, id: activos.id, codigo: activos.codigo, nombre: activos.nombre, estado: activos.estado })
      .from(alertasEquipoActivos)
      .innerJoin(activos, eq(activos.id, alertasEquipoActivos.activoId))
      .orderBy(asc(activos.codigo)),
    db.select({ alertaId: alertaAdjuntos.alertaId, n: count() }).from(alertaAdjuntos).groupBy(alertaAdjuntos.alertaId),
  ]);
  const equipos = new Map<number, EquipoAlerta[]>();
  for (const v of vinculos) {
    const arr = equipos.get(v.alertaId);
    if (arr) arr.push(v); else equipos.set(v.alertaId, [v]);
  }
  return { alertas, equipos, archivos: new Map(archivos.map((a) => [a.alertaId, a.n])) };
}

export type AlertaFila = Awaited<ReturnType<typeof cargarListaAlertas>>["alertas"][number];

/** La hoja de una alerta: datos, equipos con su ubicación, archivos e historial de la bitácora. */
export async function cargarHojaAlerta(db: Db, id: number) {
  const [alerta] = await db.select(camposAlerta).from(alertasEquipo).where(eq(alertasEquipo.id, id)).limit(1);
  if (!alerta) return null;
  const [equipos, archivos, historial] = await Promise.all([
    db.select({
      id: activos.id, codigo: activos.codigo, nombre: activos.nombre, marca: activos.marca, modelo: activos.modelo,
      serial: activos.serial, estado: activos.estado, ubicacionTexto: activos.ubicacion, ubicacion: ubicaciones.nombre, sede: sucursales.nombre,
    })
      .from(alertasEquipoActivos)
      .innerJoin(activos, eq(activos.id, alertasEquipoActivos.activoId))
      .leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId))
      .leftJoin(sucursales, eq(sucursales.id, ubicaciones.sucursalId))
      .where(eq(alertasEquipoActivos.alertaId, id))
      .orderBy(asc(activos.codigo)),
    db.select({
      id: alertaAdjuntos.id, categoria: alertaAdjuntos.categoria, nombre: alertaAdjuntos.nombre, contentType: alertaAdjuntos.contentType,
      tamano: alertaAdjuntos.tamano, usuarioId: alertaAdjuntos.usuarioId, createdAt: alertaAdjuntos.createdAt,
    }).from(alertaAdjuntos).where(eq(alertaAdjuntos.alertaId, id)).orderBy(asc(alertaAdjuntos.createdAt), asc(alertaAdjuntos.id)),
    db.select({ id: auditLog.id, accion: auditLog.accion, usuarioId: auditLog.usuarioId, resumen: auditLog.resumen, createdAt: auditLog.createdAt })
      .from(auditLog)
      .where(and(eq(auditLog.entidad, "alerta"), eq(auditLog.entidadId, id)))
      .orderBy(asc(auditLog.createdAt), asc(auditLog.id)),
  ]);
  return { alerta, equipos, archivos, historial };
}

export type HojaAlerta = NonNullable<Awaited<ReturnType<typeof cargarHojaAlerta>>>;

/** Ids de los equipos afectados de una alerta. */
export async function equiposDeAlerta(db: Db, id: number): Promise<number[]> {
  const filas = await db.select({ activoId: alertasEquipoActivos.activoId }).from(alertasEquipoActivos).where(eq(alertasEquipoActivos.alertaId, id));
  return filas.map((f) => f.activoId);
}
