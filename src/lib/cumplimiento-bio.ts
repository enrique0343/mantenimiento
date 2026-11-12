// Fase 59 · Datos del panel de cumplimiento y de los avisos de vencimiento.
// Lee directamente las tablas de la migración 0059 (contrato §c: sin bibliotecas de
// otros paquetes) con columnas explícitas: D1 corta el resultado a 100 columnas y
// activos tiene 53. Nada de listas de ids en IN (): cada consulta trae la tabla y el
// filtro fino se hace en cumplimiento-reglas.ts. Si una consulta falla, su indicador
// sale «Sin datos todavía» en vez de romper la página o el correo.
import { and, eq, inArray, or } from "drizzle-orm";
import type { getDb } from "./db";
import {
  activos, ubicaciones, sucursales, calibraciones, activoDocumentos, activoExpedienteNa, planesMantenimiento,
  proveedores, licencias, pruebasSeguridadElectrica, capacitaciones, capacitacionEquipos, alertasEquipo, activoBajas,
} from "./schema";
import { activoAreaCondition } from "./areas";
import type { ClaveIndicador, DatosCumplimiento } from "./cumplimiento-reglas";

type Db = ReturnType<typeof getDb>;

/** Ejecuta la consulta; si falla, anota los indicadores que dependen de ella. */
async function leer<T>(consulta: Promise<T[]>, indicadores: ClaveIndicador[], sinDatos: Set<string>): Promise<T[]> {
  try {
    return await consulta;
  } catch (e) {
    console.error("cumplimiento:", indicadores.join(","), e);
    for (const i of indicadores) sinDatos.add(i);
    return [];
  }
}

export async function cargarDatosCumplimiento(db: Db, hoy: string): Promise<DatosCumplimiento> {
  const sinDatos = new Set<string>();
  const todos: ClaveIndicador[] = ["sin_plan", "preventivo_vencido", "inventario", "clase_riesgo", "registro_sanitario", "expediente", "calibracion", "patron", "seguridad_electrica", "capacitacion", "baja_sin_acta"];

  const [equipos, cals, docs, na, planes, labs, lics, pruebas, caps, alertas, bajas] = await Promise.all([
    // Biomédicos (con las bajas) y los equipos de otras áreas que se calibran o son patrón.
    leer(db.select({
      id: activos.id, codigo: activos.codigo, nombre: activos.nombre, rubro: activos.rubro, tipo: activos.tipo, estado: activos.estado,
      marca: activos.marca, modelo: activos.modelo, serial: activos.serial,
      ubicacionId: activos.ubicacionId, ubicacionTexto: activos.ubicacion, ubicacionNombre: ubicaciones.nombre,
      sede: sucursales.nombre, sedeId: sucursales.id,
      subcategoria: activos.subcategoria, criticidadOperacional: activos.criticidadOperacional, claseRiesgo: activos.claseRiesgo,
      centroCostoId: activos.centroCostoId,
      registroSanitario: activos.registroSanitario, registroSanitarioNoRequiere: activos.registroSanitarioNoRequiere,
      registroSanitarioVencimiento: activos.registroSanitarioVencimiento,
      requiereCalibracion: activos.requiereCalibracion, esPatron: activos.esPatron, calibracionNoAplica: activos.calibracionNoAplica,
      aceptacionFecha: activos.aceptacionFecha,
    }).from(activos)
      .leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId))
      .leftJoin(sucursales, eq(sucursales.id, ubicaciones.sucursalId))
      .where(or(activoAreaCondition("biomedico"), eq(activos.requiereCalibracion, true), eq(activos.esPatron, true))), todos, sinDatos),
    leer(db.select({
      id: calibraciones.id, activoId: calibraciones.activoId, fechaCalibracion: calibraciones.fechaCalibracion,
      proximaCalibracion: calibraciones.proximaCalibracion, resultado: calibraciones.resultado, certificadoR2Key: calibraciones.certificadoR2Key,
    }).from(calibraciones), ["calibracion", "patron"], sinDatos),
    leer(db.select({ activoId: activoDocumentos.activoId, categoria: activoDocumentos.categoria, fechaVencimiento: activoDocumentos.fechaVencimiento })
      .from(activoDocumentos), ["expediente", "baja_sin_acta"], sinDatos),
    leer(db.select({ activoId: activoExpedienteNa.activoId, requisito: activoExpedienteNa.requisito, motivo: activoExpedienteNa.motivo })
      .from(activoExpedienteNa), ["expediente"], sinDatos),
    leer(db.select({ activoId: planesMantenimiento.activoId, proximaFecha: planesMantenimiento.proximaFecha })
      .from(planesMantenimiento).where(eq(planesMantenimiento.activo, true)), ["sin_plan", "preventivo_vencido"], sinDatos),
    leer(db.select({
      id: proveedores.id, nombre: proveedores.nombre, esLaboratorioAcreditado: proveedores.esLaboratorioAcreditado,
      acreditacionOrgano: proveedores.acreditacionOrgano, acreditacionNumero: proveedores.acreditacionNumero,
      acreditacionVigencia: proveedores.acreditacionVigencia,
    }).from(proveedores).where(and(eq(proveedores.activo, true), eq(proveedores.esLaboratorioAcreditado, true))), ["laboratorio"], sinDatos),
    leer(db.select({
      id: licencias.id, nombre: licencias.nombre, numero: licencias.numero, entidad: licencias.entidad, estado: licencias.estado,
      fechaVencimiento: licencias.fechaVencimiento, reemplazaAId: licencias.reemplazaAId,
      sede: sucursales.nombre, equipoCodigo: activos.codigo,
    }).from(licencias)
      .leftJoin(sucursales, eq(sucursales.id, licencias.sucursalId))
      .leftJoin(activos, eq(activos.id, licencias.activoId))
      .where(inArray(licencias.estado, ["activa", "en_tramite"])), ["licencia"], sinDatos),
    leer(db.select({
      id: pruebasSeguridadElectrica.id, activoId: pruebasSeguridadElectrica.activoId, fecha: pruebasSeguridadElectrica.fecha,
      resultado: pruebasSeguridadElectrica.resultado, proximaFecha: pruebasSeguridadElectrica.proximaFecha,
    }).from(pruebasSeguridadElectrica).where(eq(pruebasSeguridadElectrica.estado, "valida")), ["seguridad_electrica"], sinDatos),
    leer(db.select({ activoId: capacitacionEquipos.activoId, fecha: capacitaciones.fecha })
      .from(capacitacionEquipos)
      .innerJoin(capacitaciones, eq(capacitaciones.id, capacitacionEquipos.capacitacionId)), ["capacitacion"], sinDatos),
    leer(db.select({
      id: alertasEquipo.id, titulo: alertasEquipo.titulo, tipo: alertasEquipo.tipo, estado: alertasEquipo.estado,
      aplicabilidad: alertasEquipo.aplicabilidad, fechaAlerta: alertasEquipo.fechaAlerta, referencia: alertasEquipo.referencia,
    }).from(alertasEquipo), ["alerta"], sinDatos),
    leer(db.select({ id: activoBajas.id, activoId: activoBajas.activoId, fechaBaja: activoBajas.fechaBaja })
      .from(activoBajas).where(eq(activoBajas.estado, "vigente")), ["baja_sin_acta"], sinDatos),
  ]);

  return {
    hoy,
    equipos: equipos.map((e) => ({
      id: e.id, codigo: e.codigo, nombre: e.nombre, rubro: e.rubro, tipo: e.tipo, estado: e.estado,
      marca: e.marca, modelo: e.modelo, serial: e.serial,
      ubicacionId: e.ubicacionId, ubicacion: e.ubicacionNombre ?? e.ubicacionTexto ?? null, sede: e.sede ?? null, sedeId: e.sedeId ?? null,
      subcategoria: e.subcategoria, criticidadOperacional: e.criticidadOperacional, claseRiesgo: e.claseRiesgo, centroCostoId: e.centroCostoId,
      registroSanitario: e.registroSanitario, registroSanitarioNoRequiere: !!e.registroSanitarioNoRequiere,
      registroSanitarioVencimiento: e.registroSanitarioVencimiento,
      requiereCalibracion: !!e.requiereCalibracion, esPatron: !!e.esPatron, calibracionNoAplica: !!e.calibracionNoAplica,
      aceptacionFecha: e.aceptacionFecha,
    })),
    calibraciones: cals,
    documentos: docs,
    expedienteNa: na,
    planes,
    laboratorios: labs.map((l) => ({ ...l, esLaboratorioAcreditado: !!l.esLaboratorioAcreditado })),
    licencias: lics.map((l) => ({ ...l, sede: l.sede ?? null, equipoCodigo: l.equipoCodigo ?? null })),
    pruebas,
    capacitaciones: caps,
    alertas,
    bajas,
    sinDatos: [...sinDatos],
  };
}
