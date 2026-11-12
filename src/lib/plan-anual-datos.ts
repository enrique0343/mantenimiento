// Fase 59 · Datos del plan anual (requisito 6). Lo usan la página del plan y su
// CSV, para que cuenten igual. Columnas explícitas: D1 corta el resultado a 100
// columnas y activos tiene 53. Las rutinas de equipos dados de baja no entran.
import { and, asc, desc, eq, ne, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { getDb } from "./db";
import {
  planesMantenimiento, activos, usuarios, ubicaciones, sucursales, contratosMantenimiento, proveedores,
  actividades, actividadCategorias, planAprobaciones,
} from "./schema";
import { activoAreaCondition, type AreaKey } from "./areas";
import { rubroDeActivo, subcatLabel } from "./rubros";
import { areaDeActividad } from "./actividades";
import { horasSlaPara } from "./sla";
import type { RutinaPlan } from "./plan-anual";

type Db = ReturnType<typeof getDb>;
export interface FiltroPlan { area: AreaKey | null; sedeId: number | null }

/** Rutinas activas del plan: planes de equipos (sin bajas) y actividades recurrentes. */
export async function cargarRutinasPlan(db: Db, { area, sedeId }: FiltroPlan): Promise<RutinaPlan[]> {
  const provPlan = alias(proveedores, "prov_plan");
  const provContrato = alias(proveedores, "prov_contrato");
  const planes = await db
    .select({
      id: planesMantenimiento.id, titulo: planesMantenimiento.titulo, frecuencia: planesMantenimiento.frecuencia,
      proximaFecha: planesMantenimiento.proximaFecha, horasEstimadas: planesMantenimiento.horasEstimadas,
      prioridad: planesMantenimiento.prioridad, modalidad: planesMantenimiento.modalidad,
      activoId: activos.id, codigo: activos.codigo, nombre: activos.nombre, rubro: activos.rubro, tipo: activos.tipo,
      subcategoria: activos.subcategoria, categoria: activos.categoria, criticidad: activos.criticidadOperacional,
      ubicacionTexto: activos.ubicacion, ubicacion: ubicaciones.nombre, sedeId: sucursales.id, sede: sucursales.nombre,
      responsable: usuarios.nombre,
      contratoCodigo: contratosMantenimiento.codigo, contratoInicio: contratosMantenimiento.fechaInicio, contratoFin: contratosMantenimiento.fechaFin,
      proveedorPlan: provPlan.nombre, proveedorContrato: provContrato.nombre,
    })
    .from(planesMantenimiento)
    .innerJoin(activos, eq(activos.id, planesMantenimiento.activoId))
    .leftJoin(usuarios, eq(usuarios.id, planesMantenimiento.asignadoA))
    .leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId))
    .leftJoin(sucursales, eq(sucursales.id, ubicaciones.sucursalId))
    .leftJoin(contratosMantenimiento, eq(contratosMantenimiento.id, planesMantenimiento.contratoId))
    .leftJoin(provPlan, eq(provPlan.id, planesMantenimiento.proveedorId))
    .leftJoin(provContrato, eq(provContrato.id, contratosMantenimiento.proveedorId))
    .where(and(eq(planesMantenimiento.activo, true), ne(activos.estado, "baja"), area ? activoAreaCondition(area) : undefined))
    .orderBy(asc(planesMantenimiento.proximaFecha), asc(activos.codigo));

  const acts = await db
    .select({
      id: actividades.id, codigo: actividades.codigo, titulo: actividades.titulo, rubro: actividades.rubro,
      frecuencia: actividades.frecuencia, proximaFecha: actividades.proximaFecha, horasEstimadas: actividades.horasEstimadas,
      prioridad: actividades.prioridad, sucursalId: actividades.sucursalId, ubicacionDetalle: actividades.ubicacionDetalle,
      proveedorExternoId: actividades.proveedorExternoId,
      categoria: actividadCategorias.nombre, categoriaIcono: actividadCategorias.icono, categoriaRubro: actividadCategorias.rubro,
      sede: sucursales.nombre, ubicacion: ubicaciones.nombre, responsable: usuarios.nombre, proveedor: proveedores.nombre,
    })
    .from(actividades)
    .leftJoin(actividadCategorias, eq(actividadCategorias.id, actividades.categoriaId))
    .leftJoin(sucursales, eq(sucursales.id, actividades.sucursalId))
    .leftJoin(ubicaciones, eq(ubicaciones.id, actividades.ubicacionId))
    .leftJoin(usuarios, eq(usuarios.id, actividades.asignadoA))
    .leftJoin(proveedores, eq(proveedores.id, actividades.proveedorExternoId))
    .where(eq(actividades.activo, true))
    .orderBy(asc(actividades.proximaFecha), asc(actividades.codigo));

  const rutinas: RutinaPlan[] = [];
  for (const p of planes) {
    if (sedeId && p.sedeId !== sedeId) continue;
    const areaEquipo = rubroDeActivo(p.rubro, p.tipo);
    rutinas.push({
      tipo: "equipo", id: p.id, activoId: p.activoId, area: areaEquipo,
      grupo: area === "biomedico"
        ? subcatLabel(p.subcategoria)
        : (p.categoria?.trim() || (p.tipo === "biomedico" ? "Equipo biomédico" : "Sin categoría")),
      codigo: p.codigo, nombre: p.nombre, sede: p.sede ?? null, sedeId: p.sedeId ?? null,
      ubicacion: p.ubicacion ?? p.ubicacionTexto ?? null,
      rutina: p.titulo, frecuencia: p.frecuencia, proximaFecha: p.proximaFecha, horasEstimadas: p.horasEstimadas ?? null,
      prioridad: p.prioridad, modalidad: p.modalidad,
      proveedor: p.proveedorPlan ?? p.proveedorContrato ?? null,
      contrato: p.contratoCodigo ?? null,
      contratoVigencia: p.contratoInicio && p.contratoFin ? { inicio: p.contratoInicio, fin: p.contratoFin } : null,
      responsable: p.responsable ?? null,
      critico: p.criticidad === "alta",
    });
  }
  for (const a of acts) {
    const areaAct = areaDeActividad(a.rubro, a.categoriaRubro);
    if (area && areaAct !== area) continue;
    if (sedeId && a.sucursalId !== sedeId) continue;
    rutinas.push({
      tipo: "actividad", id: a.id, activoId: null, area: areaAct ?? "",
      grupo: a.categoria ? `${a.categoriaIcono ?? ""} ${a.categoria}`.trim() : "Sin categoría",
      codigo: a.codigo, nombre: a.titulo, sede: a.sede ?? null, sedeId: a.sucursalId ?? null,
      ubicacion: a.ubicacion ?? a.ubicacionDetalle ?? null,
      rutina: a.titulo, frecuencia: a.frecuencia, proximaFecha: a.proximaFecha, horasEstimadas: a.horasEstimadas ?? null,
      prioridad: a.prioridad, modalidad: a.proveedorExternoId ? "contratado" : "interno",
      proveedor: a.proveedor ?? null, contrato: null, contratoVigencia: null,
      responsable: a.responsable ?? null, critico: false,
    });
  }
  return rutinas;
}

export interface SlaPropio { id: number; codigo: string; nombre: string; urgente: number; alta: number; media: number; baja: number }

/** Equipos no dados de baja con algún tiempo de atención distinto de los generales. */
export async function cargarSlaPropios(db: Db, { area, sedeId }: FiltroPlan): Promise<SlaPropio[]> {
  const filas = await db
    .select({
      id: activos.id, codigo: activos.codigo, nombre: activos.nombre,
      urgente: activos.slaUrgenteHoras, alta: activos.slaAltaHoras, media: activos.slaMediaHoras, baja: activos.slaBajaHoras,
      sedeId: sucursales.id,
    })
    .from(activos)
    .leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId))
    .leftJoin(sucursales, eq(sucursales.id, ubicaciones.sucursalId))
    .where(and(
      ne(activos.estado, "baja"),
      or(
        ne(activos.slaUrgenteHoras, horasSlaPara(null, "urgente")),
        ne(activos.slaAltaHoras, horasSlaPara(null, "alta")),
        ne(activos.slaMediaHoras, horasSlaPara(null, "media")),
        ne(activos.slaBajaHoras, horasSlaPara(null, "baja")),
      ),
      area ? activoAreaCondition(area) : undefined,
    ))
    .orderBy(asc(activos.codigo));
  return filas
    .filter((f) => !sedeId || f.sedeId === sedeId)
    .map(({ sedeId: _sede, ...f }) => f);
}

export interface AprobacionPlan {
  id: number; anio: number; area: string; version: string; aprobadoPor: string; fechaAprobacion: string; notas: string | null;
  nombreArchivo: string; contentType: string; tamano: number; createdAt: string;
  anuladaEn: string | null; motivoAnulacion: string | null; registradoPor: string | null; anuladaPor: string | null;
}

/** Aprobaciones de un año y área (más recientes primero), con quién las registró y anuló. */
export async function cargarAprobacionesPlan(db: Db, anio: number, area: string): Promise<AprobacionPlan[]> {
  const registro = alias(usuarios, "u_registro");
  const anulacion = alias(usuarios, "u_anulacion");
  const filas = await db
    .select({
      id: planAprobaciones.id, anio: planAprobaciones.anio, area: planAprobaciones.area, version: planAprobaciones.version,
      aprobadoPor: planAprobaciones.aprobadoPor, fechaAprobacion: planAprobaciones.fechaAprobacion, notas: planAprobaciones.notas,
      nombreArchivo: planAprobaciones.nombreArchivo, contentType: planAprobaciones.contentType, tamano: planAprobaciones.tamano,
      createdAt: planAprobaciones.createdAt, anuladaEn: planAprobaciones.anuladaEn, motivoAnulacion: planAprobaciones.motivoAnulacion,
      registradoPor: registro.nombre, anuladaPor: anulacion.nombre,
    })
    .from(planAprobaciones)
    .leftJoin(registro, eq(registro.id, planAprobaciones.registradoPor))
    .leftJoin(anulacion, eq(anulacion.id, planAprobaciones.anuladaPor))
    .where(and(eq(planAprobaciones.anio, anio), eq(planAprobaciones.area, area)))
    .orderBy(desc(planAprobaciones.fechaAprobacion), desc(planAprobaciones.id));
  return filas.map((f) => ({ ...f, registradoPor: f.registradoPor ?? null, anuladaPor: f.anuladaPor ?? null }));
}
