// Fase 59 · Cargador único del historial del equipo: lo usan la línea de tiempo
// (/activos/{id}/historial), su CSV (GET /api/activos/{id}/historial) y la hoja de
// vida, así lo impreso y lo exportado no pueden diferir.
//
// Límites de D1: cada consulta filtra por activo_id con JOIN o subconsulta (nunca
// listas de ids: D1 acepta 100 parámetros) y elige columnas (D1 corta a 100).
// Lee las tablas de otros paquetes directamente (CONTRATO §c); no importa sus bibliotecas.
import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  activoBajas, activoDocumentos, activos, alertasEquipo, alertasEquipoActivos, auditLog, calibraciones,
  capacitacionEquipos, capacitaciones, comentarios, items, ordenIncidentes, ordenRepuestos, ordenVerificacion,
  ordenes, proveedores, pruebasSeguridadElectrica, usuarios,
} from "./schema";
import { labelCampo } from "@/lib/audit";
import { ESTADO_ORDEN, TIPO_ORDEN } from "./reporte-mantenimiento";
import { patronVigenteEn, type CalMin } from "./biomedico";
import type { getDb } from "./db";
import type { BitacoraH, CambioH, HistorialEquipo } from "./historial-equipo";

type Db = ReturnType<typeof getDb>;

/** Valor de la bitácora en texto legible. */
function textoValor(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(vacío)";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (typeof v === "object") { try { return JSON.stringify(v); } catch { return String(v); } }
  return String(v);
}

/** Cambios guardados en audit_log.cambios ({campo: {antes, despues}}). */
export function cambiosDeBitacora(json: string | null): CambioH[] {
  if (!json) return [];
  try {
    const obj = JSON.parse(json) as Record<string, { antes?: unknown; despues?: unknown } | null>;
    if (!obj || typeof obj !== "object") return [];
    return Object.entries(obj).map(([campo, val]) => ({
      campo, etiqueta: labelCampo(campo), antes: textoValor(val?.antes), despues: textoValor(val?.despues),
    }));
  } catch {
    return [];
  }
}

function idsDeJson(json: string | null | undefined): number[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : [];
  } catch {
    return [];
  }
}

export async function cargarHistorialEquipo(db: Db, activoId: number): Promise<HistorialEquipo> {
  const patron = alias(activos, "patron");
  const [gente, ots, coms, reps, cals, calsPatrones, docs, alertas, caps, pruebas, bajas, bitacora] = await Promise.all([
    // Pocas filas: evita listas de ids para los nombres.
    db.select({ id: usuarios.id, nombre: usuarios.nombre }).from(usuarios),
    db.select({
      id: ordenes.id, codigo: ordenes.codigo, titulo: ordenes.titulo, descripcion: ordenes.descripcion,
      tipo: ordenes.tipo, prioridad: ordenes.prioridad, estado: ordenes.estado,
      createdAt: ordenes.createdAt, completadaEn: ordenes.completadaEn, verificadoEn: ordenes.verificadoEn, cerradoEn: ordenes.cerradoEn,
      trabajosRealizados: ordenes.trabajosRealizados, causaRaiz: ordenes.causaRaiz, solucionAplicada: ordenes.solucionAplicada,
      verificacionNotas: ordenes.verificacionNotas, horasTrabajadas: ordenes.horasTrabajadas,
      creadoPor: ordenes.creadoPor, asignadoA: ordenes.asignadoA, verificadoPor: ordenes.verificadoPor, cerradoPor: ordenes.cerradoPor,
      firmaTecnicoNombre: ordenes.firmaTecnicoNombre,
      ejecutadoPor: ordenVerificacion.ejecutadoPor, executoresJson: ordenVerificacion.executoresJson,
      incNumero: ordenIncidentes.numeroReporte, incFecha: ordenIncidentes.fechaNotificacion, incNota: ordenIncidentes.nota, incPor: ordenIncidentes.marcadoPor,
    })
      .from(ordenes)
      .leftJoin(ordenVerificacion, eq(ordenVerificacion.ordenId, ordenes.id))
      .leftJoin(ordenIncidentes, eq(ordenIncidentes.ordenId, ordenes.id))
      .where(eq(ordenes.activoId, activoId))
      .orderBy(desc(ordenes.id)),
    db.select({
      id: comentarios.id, ordenId: comentarios.ordenId, ordenCodigo: ordenes.codigo, texto: comentarios.texto,
      usuarioId: comentarios.usuarioId, createdAt: comentarios.createdAt,
    })
      .from(comentarios)
      .innerJoin(ordenes, eq(ordenes.id, comentarios.ordenId))
      .where(eq(ordenes.activoId, activoId))
      .orderBy(desc(comentarios.id)),
    db.select({
      id: ordenRepuestos.id, ordenId: ordenRepuestos.ordenId, ordenCodigo: ordenes.codigo,
      codigo: items.codigo, nombre: items.nombre, unidad: items.unidad,
      cantidad: ordenRepuestos.cantidad, precioUnitario: ordenRepuestos.precioUnitario,
      registradoPor: ordenRepuestos.registradoPor, createdAt: ordenRepuestos.createdAt,
    })
      .from(ordenRepuestos)
      .innerJoin(ordenes, eq(ordenes.id, ordenRepuestos.ordenId))
      .leftJoin(items, eq(items.id, ordenRepuestos.itemId))
      .where(eq(ordenes.activoId, activoId))
      .orderBy(desc(ordenRepuestos.id)),
    db.select({
      id: calibraciones.id, fechaCalibracion: calibraciones.fechaCalibracion, proximaCalibracion: calibraciones.proximaCalibracion,
      resultado: calibraciones.resultado, laboratorioExterno: calibraciones.laboratorioExterno, labNombre: proveedores.nombre,
      labAcreditado: calibraciones.labAcreditado, labAcreditacionRef: calibraciones.labAcreditacionRef,
      numeroCertificado: calibraciones.numeroCertificado, certificadoR2Key: calibraciones.certificadoR2Key,
      patronActivoId: calibraciones.patronActivoId, patronCodigo: patron.codigo, patronNombre: patron.nombre, patronSerial: patron.serial,
      patronReferencia: calibraciones.patronReferencia, incertidumbre: calibraciones.incertidumbre,
      realizadoPor: calibraciones.realizadoPor, notas: calibraciones.notas, usuarioId: calibraciones.usuarioId,
      createdAt: calibraciones.createdAt, corregidaEn: calibraciones.corregidaEn, corregidaPor: calibraciones.corregidaPor,
    })
      .from(calibraciones)
      .leftJoin(proveedores, eq(proveedores.id, calibraciones.laboratorioId))
      .leftJoin(patron, eq(patron.id, calibraciones.patronActivoId))
      .where(eq(calibraciones.activoId, activoId))
      .orderBy(desc(calibraciones.fechaCalibracion), desc(calibraciones.id)),
    // Calibraciones de los patrones que se usaron con este equipo (vigencia en cada fecha).
    db.select({
      id: calibraciones.id, activoId: calibraciones.activoId, fechaCalibracion: calibraciones.fechaCalibracion,
      proximaCalibracion: calibraciones.proximaCalibracion, resultado: calibraciones.resultado, certificadoR2Key: calibraciones.certificadoR2Key,
    })
      .from(calibraciones)
      .where(sql`${calibraciones.activoId} in (select patron_activo_id from calibraciones where activo_id = ${activoId} and patron_activo_id is not null)`),
    db.select({
      id: activoDocumentos.id, nombre: activoDocumentos.nombre, categoria: activoDocumentos.categoria, version: activoDocumentos.version,
      fechaVersion: activoDocumentos.fechaVersion, fechaVencimiento: activoDocumentos.fechaVencimiento, nota: activoDocumentos.nota,
      tamano: activoDocumentos.tamano, usuarioId: activoDocumentos.usuarioId, createdAt: activoDocumentos.createdAt,
    })
      .from(activoDocumentos)
      .where(eq(activoDocumentos.activoId, activoId))
      .orderBy(desc(activoDocumentos.id)),
    db.select({
      id: alertasEquipo.id, tipo: alertasEquipo.tipo, fuente: alertasEquipo.fuente, titulo: alertasEquipo.titulo,
      referencia: alertasEquipo.referencia, fechaAlerta: alertasEquipo.fechaAlerta, estado: alertasEquipo.estado,
      aplicabilidad: alertasEquipo.aplicabilidad, accionTomada: alertasEquipo.accionTomada, fechaCierre: alertasEquipo.fechaCierre,
      cerradaEn: alertasEquipo.cerradaEn, cerradaPor: alertasEquipo.cerradaPor,
    })
      .from(alertasEquipoActivos)
      .innerJoin(alertasEquipo, eq(alertasEquipo.id, alertasEquipoActivos.alertaId))
      .where(eq(alertasEquipoActivos.activoId, activoId))
      .orderBy(desc(alertasEquipo.fechaAlerta), desc(alertasEquipo.id)),
    db.select({
      id: capacitaciones.id, fecha: capacitaciones.fecha, tema: capacitaciones.tema, tipo: capacitaciones.tipo,
      instructorNombre: capacitaciones.instructorNombre, instructorEntidad: capacitaciones.instructorEntidad, usuarioId: capacitaciones.usuarioId,
      asistentes: sql<number>`(select count(*) from capacitacion_asistentes ca where ca.capacitacion_id = ${capacitaciones.id})`,
      listaFirmada: sql<number>`exists(select 1 from capacitacion_archivos cf where cf.capacitacion_id = ${capacitaciones.id} and cf.categoria = 'lista_firmada')`,
    })
      .from(capacitacionEquipos)
      .innerJoin(capacitaciones, eq(capacitaciones.id, capacitacionEquipos.capacitacionId))
      .where(eq(capacitacionEquipos.activoId, activoId))
      .orderBy(desc(capacitaciones.fecha), desc(capacitaciones.id)),
    db.select({
      id: pruebasSeguridadElectrica.id, fecha: pruebasSeguridadElectrica.fecha, tipo: pruebasSeguridadElectrica.tipo,
      resultado: pruebasSeguridadElectrica.resultado, estado: pruebasSeguridadElectrica.estado,
      analizadorDescripcion: pruebasSeguridadElectrica.analizadorDescripcion, analizadorSerie: pruebasSeguridadElectrica.analizadorSerie,
      realizadoPor: pruebasSeguridadElectrica.realizadoPor, empresaExterna: pruebasSeguridadElectrica.empresaExterna,
      proximaFecha: pruebasSeguridadElectrica.proximaFecha, informeR2Key: pruebasSeguridadElectrica.informeR2Key,
      motivoAnulacion: pruebasSeguridadElectrica.motivoAnulacion, anuladaEn: pruebasSeguridadElectrica.anuladaEn,
      ordenId: pruebasSeguridadElectrica.ordenId, registradoPor: pruebasSeguridadElectrica.registradoPor,
    })
      .from(pruebasSeguridadElectrica)
      .where(eq(pruebasSeguridadElectrica.activoId, activoId))
      .orderBy(desc(pruebasSeguridadElectrica.fecha), desc(pruebasSeguridadElectrica.id)),
    db.select({
      id: activoBajas.id, estado: activoBajas.estado, fechaBaja: activoBajas.fechaBaja, motivo: activoBajas.motivo,
      motivoDetalle: activoBajas.motivoDetalle, evaluacionTecnica: activoBajas.evaluacionTecnica, evaluadoPor: activoBajas.evaluadoPor,
      autorizaNombre: activoBajas.autorizaNombre, autorizaCargo: activoBajas.autorizaCargo, destinoFinal: activoBajas.destinoFinal,
      destinoDetalle: activoBajas.destinoDetalle, registradoPorNombre: activoBajas.registradoPorNombre, createdAt: activoBajas.createdAt,
      revertidaEn: activoBajas.revertidaEn, revertidaPorNombre: activoBajas.revertidaPorNombre, reversionMotivo: activoBajas.reversionMotivo,
    })
      .from(activoBajas)
      .where(eq(activoBajas.activoId, activoId))
      .orderBy(desc(activoBajas.id)),
    db.select({
      id: auditLog.id, accion: auditLog.accion, resumen: auditLog.resumen, cambios: auditLog.cambios,
      usuarioId: auditLog.usuarioId, createdAt: auditLog.createdAt,
    })
      .from(auditLog)
      .where(and(eq(auditLog.entidad, "activo"), eq(auditLog.entidadId, activoId)))
      .orderBy(desc(auditLog.id)),
  ]);

  const nombres = new Map(gente.map((u) => [u.id, u.nombre]));
  const nombre = (id: number | null | undefined) => (id == null ? null : nombres.get(id) ?? null);

  const calibsPorPatron = new Map<number, CalMin[]>();
  for (const c of calsPatrones) {
    const lista = calibsPorPatron.get(c.activoId) ?? [];
    lista.push({ id: c.id, fechaCalibracion: c.fechaCalibracion, proximaCalibracion: c.proximaCalibracion, resultado: c.resultado, certificadoR2Key: c.certificadoR2Key });
    calibsPorPatron.set(c.activoId, lista);
  }

  const bitacoraH: BitacoraH[] = bitacora.map((r) => ({
    id: r.id, createdAt: r.createdAt, accion: r.accion, resumen: r.resumen, usuario: nombre(r.usuarioId), cambios: cambiosDeBitacora(r.cambios),
  }));

  return {
    activoId,
    ots: ots.map((o) => {
      const ids = [...new Set([...idsDeJson(o.executoresJson), ...(o.ejecutadoPor != null ? [o.ejecutadoPor] : [])])];
      return {
        id: o.id, codigo: o.codigo, titulo: o.titulo, descripcion: o.descripcion,
        tipo: o.tipo, tipoLabel: TIPO_ORDEN[o.tipo] ?? o.tipo, prioridad: o.prioridad, estado: o.estado, estadoLabel: ESTADO_ORDEN[o.estado] ?? o.estado,
        createdAt: o.createdAt, completadaEn: o.completadaEn, verificadoEn: o.verificadoEn, cerradoEn: o.cerradoEn,
        trabajosRealizados: o.trabajosRealizados, causaRaiz: o.causaRaiz, solucionAplicada: o.solucionAplicada,
        verificacionNotas: o.verificacionNotas, horasTrabajadas: o.horasTrabajadas,
        asignadoId: o.asignadoA, creador: nombre(o.creadoPor), asignado: nombre(o.asignadoA),
        verificador: nombre(o.verificadoPor), cerrador: nombre(o.cerradoPor),
        ejecutores: ids.map((id) => nombre(id)).filter((x): x is string => !!x),
        firmaTecnicoNombre: o.firmaTecnicoNombre,
        incidente: o.incFecha ? { numeroReporte: o.incNumero, fechaNotificacion: o.incFecha, nota: o.incNota, marcadoPor: nombre(o.incPor) } : null,
      };
    }),
    comentarios: coms.map((c) => ({ id: c.id, ordenId: c.ordenId, ordenCodigo: c.ordenCodigo, texto: c.texto, usuario: nombre(c.usuarioId), createdAt: c.createdAt })),
    repuestos: reps.map((r) => ({
      id: r.id, ordenId: r.ordenId, ordenCodigo: r.ordenCodigo, codigo: r.codigo, nombre: r.nombre, cantidad: r.cantidad,
      unidad: r.unidad, precioUnitario: r.precioUnitario, registradoPor: nombre(r.registradoPor), createdAt: r.createdAt,
    })),
    calibraciones: cals.map((c) => {
      const vig = c.patronActivoId != null ? patronVigenteEn(calibsPorPatron.get(c.patronActivoId) ?? [], c.fechaCalibracion) : null;
      return {
        id: c.id, fechaCalibracion: c.fechaCalibracion, proximaCalibracion: c.proximaCalibracion, resultado: c.resultado,
        laboratorio: c.labNombre ?? c.laboratorioExterno ?? null, laboratorioExterno: !c.labNombre && !!c.laboratorioExterno,
        labAcreditado: c.labAcreditado, labAcreditacionRef: c.labAcreditacionRef,
        numeroCertificado: c.numeroCertificado, tieneCertificado: !!c.certificadoR2Key,
        patron: c.patronActivoId != null && c.patronCodigo ? { id: c.patronActivoId, codigo: c.patronCodigo, nombre: c.patronNombre ?? "", serial: c.patronSerial } : null,
        patronVigente: vig ? vig.vigente : null, patronHasta: vig ? vig.hasta : null,
        patronReferencia: c.patronReferencia, incertidumbre: c.incertidumbre, realizadoPor: c.realizadoPor, notas: c.notas,
        registradoPor: nombre(c.usuarioId), createdAt: c.createdAt, corregidaEn: c.corregidaEn, corregidaPor: nombre(c.corregidaPor),
      };
    }),
    documentos: docs.map((d) => ({
      id: d.id, nombre: d.nombre, categoria: d.categoria, version: d.version, fechaVersion: d.fechaVersion,
      fechaVencimiento: d.fechaVencimiento, nota: d.nota, tamano: d.tamano, subidoPor: nombre(d.usuarioId), createdAt: d.createdAt,
    })),
    alertas: alertas.map((a) => ({
      id: a.id, tipo: a.tipo, fuente: a.fuente, titulo: a.titulo, referencia: a.referencia, fechaAlerta: a.fechaAlerta,
      estado: a.estado, aplicabilidad: a.aplicabilidad, accionTomada: a.accionTomada, fechaCierre: a.fechaCierre,
      cerradaEn: a.cerradaEn, cerradaPor: nombre(a.cerradaPor),
    })),
    capacitaciones: caps.map((c) => ({
      id: c.id, fecha: c.fecha, tema: c.tema, tipo: c.tipo, instructorNombre: c.instructorNombre, instructorEntidad: c.instructorEntidad,
      asistentes: Number(c.asistentes) || 0, listaFirmada: !!Number(c.listaFirmada), registradoPor: nombre(c.usuarioId),
    })),
    pruebasSE: pruebas.map((p) => ({
      id: p.id, fecha: p.fecha, tipo: p.tipo, resultado: p.resultado, estado: p.estado,
      analizadorDescripcion: p.analizadorDescripcion, analizadorSerie: p.analizadorSerie, realizadoPor: p.realizadoPor,
      empresaExterna: p.empresaExterna, proximaFecha: p.proximaFecha, tieneInforme: !!p.informeR2Key,
      motivoAnulacion: p.motivoAnulacion, anuladaEn: p.anuladaEn, ordenId: p.ordenId, registradoPor: nombre(p.registradoPor),
    })),
    bajas: bajas.map((b) => ({ ...b })),
    bitacora: bitacoraH,
  };
}
