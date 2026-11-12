// Fase 59 · Requisito 9: historial del equipo.
// Una sola lista de eventos sirve a la línea de tiempo (/activos/{id}/historial), a su
// CSV y a la hoja de vida: lo que se ve, lo que se imprime y lo que se exporta no
// difieren. Los datos los arma src/lib/historial-equipo-db.ts (un solo cargador).
//
// Puro: sin base de datos, Drizzle ni Astro. Lo empaqueta scripts/test-bio-historial.mjs
// con esbuild. Las fechas sin hora ('AAAA-MM-DD') nunca pasan por new Date(); las
// marcas de tiempo (UTC) se pasan al día y la hora de El Salvador con biomedico.ts.
import {
  APLICABILIDAD_LABEL, DESTINOS_BAJA, ESTADO_ALERTA_LABEL, FUENTE_ALERTA_LABEL, MOTIVOS_BAJA,
  RESULTADO_SE_LABEL, TIPO_ALERTA_LABEL, TIPO_PRUEBA_ELECTRICA_LABEL,
  diaSV, esFechaISO, etiquetaCategoriaDocumento, fechaCorta, folioActaBaja, horaSV,
} from "./biomedico";
import { etiquetaOT } from "./orden-codigo";

// ═══ Etiquetas ═══════════════════════════════════════════════════════════════

export type TipoEvento =
  | "ot_creada" | "ot_completada" | "ot_cerrada" | "comentario" | "repuesto" | "incidente"
  | "calibracion" | "documento" | "alerta" | "alerta_cerrada" | "capacitacion"
  | "seguridad_electrica" | "baja" | "baja_revertida" | "bitacora";

export const TIPO_EVENTO_LABEL: Record<TipoEvento, string> = {
  ot_creada: "Orden creada",
  ot_completada: "Orden completada",
  ot_cerrada: "Orden cerrada",
  comentario: "Comentario",
  repuesto: "Repuesto usado",
  incidente: "Incidente avisado a Calidad",
  calibracion: "Calibración",
  documento: "Documento cargado",
  alerta: "Alerta o retiro",
  alerta_cerrada: "Alerta cerrada",
  capacitacion: "Capacitación",
  seguridad_electrica: "Prueba de seguridad eléctrica",
  baja: "Baja del equipo",
  baja_revertida: "Baja revertida",
  bitacora: "Cambio en el registro",
};
export const TIPOS_EVENTO = Object.keys(TIPO_EVENTO_LABEL) as TipoEvento[];

export const RESULTADO_CALIBRACION_LABEL: Record<string, string> = {
  conforme: "Conforme", conforme_con_ajuste: "Conforme con ajuste", no_conforme: "No conforme",
};
export const PRIORIDAD_LABEL: Record<string, string> = { baja: "Baja", media: "Media", alta: "Alta", urgente: "Urgente" };
// Copia de las etiquetas de capacitaciones.ts (WP-D), que se escribe en paralelo.
const TIPO_CAPACITACION_LABEL: Record<string, string> = {
  induccion: "Inducción", uso_seguro: "Uso seguro del equipo", actualizacion: "Actualización",
  limpieza_desinfeccion: "Limpieza y desinfección", otro: "Otro",
};
const ACCION_BITACORA: Record<string, string> = {
  create: "Creó el registro", update: "Modificó el registro", delete: "Eliminó", estado: "Cambió el estado", asignacion: "Asignó",
};
const etiquetaDe = (mapa: Record<string, string>, clave: string | null | undefined) => (clave ? mapa[clave] ?? clave : "");

/** Copia de la acreditación guardada con la calibración: 1 sí, 0 no, NULL no consta. */
export function textoLabAcreditado(v: boolean | number | null | undefined): "Acreditado" | "No acreditado" | "No consta" {
  if (v === null || v === undefined) return "No consta";
  return v ? "Acreditado" : "No acreditado";
}

// ═══ Datos que entrega el cargador ═══════════════════════════════════════════
// Nombres de personas y etiquetas ya resueltos; fechas tal como se guardan.

export interface IncidenteH { numeroReporte: string | null; fechaNotificacion: string; nota: string | null; marcadoPor: string | null }
export interface OtH {
  id: number; codigo: string | null; titulo: string; descripcion: string | null;
  tipo: string; tipoLabel: string; prioridad: string; estado: string; estadoLabel: string;
  createdAt: string; completadaEn: string | null; verificadoEn: string | null; cerradoEn: string | null;
  trabajosRealizados: string | null; causaRaiz: string | null; solucionAplicada: string | null; verificacionNotas: string | null;
  horasTrabajadas: number | null;
  asignadoId: number | null; creador: string | null; asignado: string | null; verificador: string | null; cerrador: string | null;
  /** Quienes registraron la ejecución (orden_verificacion). */
  ejecutores: string[];
  firmaTecnicoNombre: string | null;
  incidente: IncidenteH | null;
}
export interface ComentarioH { id: number; ordenId: number; ordenCodigo: string | null; texto: string; usuario: string | null; createdAt: string }
export interface RepuestoH {
  id: number; ordenId: number; ordenCodigo: string | null; codigo: string | null; nombre: string | null;
  cantidad: number; unidad: string | null; precioUnitario: number | null; registradoPor: string | null; createdAt: string;
}
export interface CalibracionH {
  id: number; fechaCalibracion: string; proximaCalibracion: string | null; resultado: string;
  /** Nombre del laboratorio de la lista o el escrito a mano. */
  laboratorio: string | null; laboratorioExterno: boolean;
  labAcreditado: boolean | null; labAcreditacionRef: string | null;
  numeroCertificado: string | null; tieneCertificado: boolean;
  patron: { id: number; codigo: string; nombre: string; serial: string | null } | null;
  /** ¿El patrón de la lista tenía calibración vigente en la fecha? null sin patrón de la lista. */
  patronVigente: boolean | null; patronHasta: string | null;
  patronReferencia: string | null; incertidumbre: string | null; realizadoPor: string | null; notas: string | null;
  registradoPor: string | null; createdAt: string; corregidaEn: string | null; corregidaPor: string | null;
}
export interface DocumentoH {
  id: number; nombre: string; categoria: string | null; version: string | null; fechaVersion: string | null;
  fechaVencimiento: string | null; nota: string | null; tamano: number; subidoPor: string | null; createdAt: string;
}
export interface AlertaH {
  id: number; tipo: string; fuente: string; titulo: string; referencia: string | null; fechaAlerta: string;
  estado: string; aplicabilidad: string; accionTomada: string | null; fechaCierre: string | null;
  cerradaEn: string | null; cerradaPor: string | null;
}
export interface CapacitacionH {
  id: number; fecha: string; tema: string; tipo: string; instructorNombre: string; instructorEntidad: string | null;
  asistentes: number; listaFirmada: boolean; registradoPor: string | null;
}
export interface PruebaSEH {
  id: number; fecha: string; tipo: string; resultado: string; estado: string;
  analizadorDescripcion: string; analizadorSerie: string; realizadoPor: string; empresaExterna: string | null;
  proximaFecha: string; tieneInforme: boolean; motivoAnulacion: string | null; anuladaEn: string | null;
  ordenId: number | null; registradoPor: string | null;
}
export interface BajaH {
  id: number; estado: string; fechaBaja: string; motivo: string; motivoDetalle: string; evaluacionTecnica: string;
  evaluadoPor: string; autorizaNombre: string; autorizaCargo: string; destinoFinal: string; destinoDetalle: string | null;
  registradoPorNombre: string; createdAt: string; revertidaEn: string | null; revertidaPorNombre: string | null;
  reversionMotivo: string | null;
}
export interface CambioH { campo: string; etiqueta: string; antes: string; despues: string }
export interface BitacoraH { id: number; createdAt: string; accion: string; resumen: string | null; usuario: string | null; cambios: CambioH[] }

export interface HistorialEquipo {
  activoId: number;
  ots: OtH[];
  comentarios: ComentarioH[];
  repuestos: RepuestoH[];
  calibraciones: CalibracionH[];
  documentos: DocumentoH[];
  alertas: AlertaH[];
  capacitaciones: CapacitacionH[];
  pruebasSE: PruebaSEH[];
  /** Todas las bajas del equipo (vigente y revertidas), la más nueva primero. */
  bajas: BajaH[];
  /** Toda la bitácora del equipo (audit_log, entidad «activo»), sin límite. */
  bitacora: BitacoraH[];
}

// ═══ Eventos ═════════════════════════════════════════════════════════════════

export interface EventoHistorial {
  /** 'AAAA-MM-DD' o marca de tiempo UTC, como está guardada. */
  fecha: string;
  tipo: TipoEvento;
  /** Tipo de orden, resultado de la calibración o de la prueba (para el color). */
  subtipo: string | null;
  titulo: string;
  detalle: string;
  responsable: string | null;
  /** Etiqueta de la orden (OT-MB0001) si el evento es de una orden. */
  orden: string | null;
  resultado: string | null;
  /** Marca de incidente de la orden (K-G1). */
  incidente: { numero: string | null; fecha: string } | null;
  /** Página o archivo; las rutas /api/ son archivos. */
  link: string | null;
  /** Registro anulado (se muestra tachado). */
  anulado: boolean;
}

const unir = (partes: Array<string | null | undefined | false>, sep = " · ") =>
  partes.filter((p): p is string => typeof p === "string" && p.trim() !== "").join(sep);

function textoCantidad(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

/** Opciones: cómo se escriben las fechas dentro de los textos (pantalla DD/MM/AAAA; CSV AAAA-MM-DD). */
export interface OpcionesEventos { fecha?: (valor: string | null | undefined) => string }

/** Formato de fechas para el CSV: AAAA-MM-DD (día de El Salvador). */
export const fechaCsv = (valor: string | null | undefined): string => diaSV(valor) ?? "";

/** Todos los eventos del equipo, sin ordenar (usa ordenarEventos). */
export function construirEventos(h: HistorialEquipo, opciones: OpcionesEventos = {}): EventoHistorial[] {
  const F = opciones.fecha ?? ((v: string | null | undefined) => fechaCorta(v));
  const ev: EventoHistorial[] = [];
  const base = { subtipo: null, responsable: null, orden: null, resultado: null, incidente: null, link: null, anulado: false };
  const otPorId = new Map(h.ots.map((o) => [o.id, o]));
  const incidenteDe = (ordenId: number) => {
    const inc = otPorId.get(ordenId)?.incidente;
    return inc ? { numero: inc.numeroReporte, fecha: inc.fechaNotificacion } : null;
  };

  for (const o of h.ots) {
    const etq = etiquetaOT(o);
    const incidente = incidenteDe(o.id);
    const link = `/ordenes/${o.id}`;
    ev.push({
      ...base, fecha: o.createdAt, tipo: "ot_creada", subtipo: o.tipo,
      titulo: `${etq}: ${o.titulo}`,
      detalle: unir([
        unir([o.tipoLabel, `prioridad ${etiquetaDe(PRIORIDAD_LABEL, o.prioridad).toLowerCase()}`, o.asignado && `asignada a ${o.asignado}`]),
        o.descripcion,
      ], "\n"),
      responsable: o.creador, orden: etq, resultado: o.estadoLabel, incidente, link,
    });
    if (o.completadaEn) {
      const ej = quienEjecuto(o);
      ev.push({
        ...base, fecha: o.completadaEn, tipo: "ot_completada", subtipo: o.tipo,
        titulo: `Completada ${etq}`,
        detalle: unir([
          o.trabajosRealizados && `Trabajos realizados: ${o.trabajosRealizados}`,
          o.causaRaiz && `Causa raíz: ${o.causaRaiz}`,
          o.solucionAplicada && `Solución aplicada: ${o.solucionAplicada}`,
          o.horasTrabajadas != null && `${textoCantidad(o.horasTrabajadas)} h trabajadas`,
        ], "\n"),
        responsable: ej.nombre ? `${ej.nombre}${ej.fuente === "asignado" ? " (asignado)" : ""}` : null,
        orden: etq, incidente, link,
      });
    }
    if (o.cerradoEn) {
      ev.push({
        ...base, fecha: o.cerradoEn, tipo: "ot_cerrada", subtipo: o.tipo,
        titulo: `Cerrada ${etq}`,
        detalle: o.verificacionNotas ? `Verificación: ${o.verificacionNotas}` : "",
        responsable: o.verificador ?? o.cerrador, orden: etq, incidente, link,
      });
    }
    if (o.incidente) {
      ev.push({
        ...base, fecha: o.incidente.fechaNotificacion, tipo: "incidente",
        titulo: `Incidente avisado a Calidad · ${etq}`,
        detalle: unir([`Reporte de Calidad ${o.incidente.numeroReporte ?? "pendiente"}`, o.incidente.nota]),
        responsable: o.incidente.marcadoPor, orden: etq, incidente, link: `/incidentes?activo=${h.activoId}`,
      });
    }
  }

  for (const c of h.comentarios) {
    const etq = etiquetaOT({ id: c.ordenId, codigo: c.ordenCodigo });
    ev.push({
      ...base, fecha: c.createdAt, tipo: "comentario", titulo: `Comentario en ${etq}`, detalle: c.texto,
      responsable: c.usuario, orden: etq, incidente: incidenteDe(c.ordenId), link: `/ordenes/${c.ordenId}`,
    });
  }

  for (const r of h.repuestos) {
    const etq = etiquetaOT({ id: r.ordenId, codigo: r.ordenCodigo });
    ev.push({
      ...base, fecha: r.createdAt, tipo: "repuesto",
      titulo: `Repuesto: ${unir([r.codigo, r.nombre], " ") || "sin nombre"}`,
      detalle: `${textoCantidad(r.cantidad)}${r.unidad ? ` ${r.unidad}` : ""}${r.precioUnitario != null ? ` × $${r.precioUnitario.toFixed(2)}` : ""}`,
      responsable: r.registradoPor, orden: etq, incidente: incidenteDe(r.ordenId), link: `/ordenes/${r.ordenId}`,
    });
  }

  for (const c of h.calibraciones) {
    const resultado = etiquetaDe(RESULTADO_CALIBRACION_LABEL, c.resultado);
    ev.push({
      ...base, fecha: c.fechaCalibracion, tipo: "calibracion", subtipo: c.resultado,
      titulo: `Calibración: ${resultado}`,
      detalle: unir([
        c.laboratorio && `Laboratorio: ${c.laboratorio} (${textoLabAcreditado(c.labAcreditado).toLowerCase()})`,
        c.numeroCertificado
          ? `Certificado N.º ${c.numeroCertificado}${c.tieneCertificado ? "" : " (sin archivo)"}`
          : c.tieneCertificado ? "Certificado adjunto" : "Sin certificado",
        c.proximaCalibracion && `Próxima: ${F(c.proximaCalibracion)}`,
        c.patron && `Patrón: ${c.patron.codigo} ${c.patron.nombre}${c.patronVigente === false ? " (sin calibración vigente en esa fecha)" : ""}`,
        c.patronReferencia && `Trazabilidad: ${c.patronReferencia}`,
        c.incertidumbre && `Incertidumbre: ${c.incertidumbre}`,
        c.notas && `Notas: ${c.notas}`,
        c.corregidaEn && `Corregida el ${F(c.corregidaEn)}${c.corregidaPor ? ` por ${c.corregidaPor}` : ""}`,
      ]),
      responsable: c.realizadoPor ?? c.laboratorio, resultado,
      link: c.tieneCertificado ? `/api/calibraciones/certificado/${c.id}` : null,
    });
  }

  for (const d of h.documentos) {
    ev.push({
      ...base, fecha: d.createdAt, tipo: "documento", subtipo: d.categoria,
      titulo: `Documento cargado: ${d.nombre}`,
      detalle: unir([
        etiquetaCategoriaDocumento(d.categoria),
        d.version && `v${d.version}`,
        d.fechaVersion && `versión del ${F(d.fechaVersion)}`,
        d.fechaVencimiento && `vence el ${F(d.fechaVencimiento)}`,
        d.nota,
      ]),
      responsable: d.subidoPor, link: `/api/activos/documento/${d.id}`,
    });
  }

  for (const a of h.alertas) {
    const link = `/alertas/${a.id}`;
    ev.push({
      ...base, fecha: a.fechaAlerta, tipo: "alerta", subtipo: a.tipo,
      titulo: `${etiquetaDe(TIPO_ALERTA_LABEL, a.tipo)}: ${a.titulo}`,
      detalle: unir([
        `Fuente: ${etiquetaDe(FUENTE_ALERTA_LABEL, a.fuente)}`,
        a.referencia && `Referencia: ${a.referencia}`,
        `Aplicabilidad: ${etiquetaDe(APLICABILIDAD_LABEL, a.aplicabilidad)}`,
      ]),
      resultado: etiquetaDe(ESTADO_ALERTA_LABEL, a.estado), link,
    });
    const cierre = a.fechaCierre ?? a.cerradaEn;
    if (a.estado === "cerrada" && cierre) {
      ev.push({
        ...base, fecha: cierre, tipo: "alerta_cerrada", subtipo: a.tipo,
        titulo: `Alerta cerrada: ${a.titulo}`,
        detalle: a.accionTomada ? `Acción tomada: ${a.accionTomada}` : "Sin acción registrada.",
        responsable: a.cerradaPor, resultado: etiquetaDe(ESTADO_ALERTA_LABEL, "cerrada"), link,
      });
    }
  }

  for (const c of h.capacitaciones) {
    ev.push({
      ...base, fecha: c.fecha, tipo: "capacitacion", subtipo: c.tipo,
      titulo: `Capacitación: ${c.tema}`,
      detalle: unir([
        etiquetaDe(TIPO_CAPACITACION_LABEL, c.tipo),
        `${c.asistentes} asistente${c.asistentes === 1 ? "" : "s"}`,
        c.listaFirmada ? "lista firmada adjunta" : "sin lista firmada",
      ]),
      responsable: unir([c.instructorNombre, c.instructorEntidad && `(${c.instructorEntidad})`], " "),
      link: `/capacitaciones/${c.id}`,
    });
  }

  for (const p of h.pruebasSE) {
    const anulada = p.estado === "anulada";
    ev.push({
      ...base, fecha: p.fecha, tipo: "seguridad_electrica", subtipo: anulada ? "anulada" : p.resultado,
      titulo: `Prueba de seguridad eléctrica · ${etiquetaDe(TIPO_PRUEBA_ELECTRICA_LABEL, p.tipo)}${anulada ? " (anulada)" : ""}`,
      detalle: unir([
        `Analizador: ${unir([p.analizadorDescripcion, p.analizadorSerie && `S/N ${p.analizadorSerie}`], " ")}`,
        p.empresaExterna && `Empresa: ${p.empresaExterna}`,
        `Próxima: ${F(p.proximaFecha)}`,
        p.tieneInforme ? "con informe" : null,
        anulada && `Anulada${p.motivoAnulacion ? `: ${p.motivoAnulacion}` : ""}`,
      ]),
      responsable: p.realizadoPor,
      resultado: anulada ? "Anulada" : etiquetaDe(RESULTADO_SE_LABEL, p.resultado),
      link: `/seguridad-electrica/${p.id}`, anulado: anulada,
    });
  }

  for (const b of h.bajas) {
    const folio = folioActaBaja(b.id);
    ev.push({
      ...base, fecha: b.fechaBaja, tipo: "baja", subtipo: b.estado,
      titulo: `Baja del equipo (${folio}) · ${etiquetaDe(MOTIVOS_BAJA, b.motivo)}`,
      detalle: unir([
        b.motivoDetalle,
        `Destino: ${etiquetaDe(DESTINOS_BAJA, b.destinoFinal)}${b.destinoDetalle ? ` (${b.destinoDetalle})` : ""}`,
        `Autorizó: ${unir([b.autorizaNombre, b.autorizaCargo], ", ")}`,
      ]),
      responsable: b.registradoPorNombre,
      resultado: b.estado === "revertida" ? "Revertida" : "Vigente",
      link: `/activos/${h.activoId}/acta-baja?baja=${b.id}`, anulado: b.estado === "revertida",
    });
    if (b.revertidaEn) {
      ev.push({
        ...base, fecha: b.revertidaEn, tipo: "baja_revertida", subtipo: "revertida",
        titulo: `Baja revertida (${folio})`,
        detalle: b.reversionMotivo ? `Motivo: ${b.reversionMotivo}` : "",
        responsable: b.revertidaPorNombre, resultado: "Revertida", link: `/activos/${h.activoId}/baja`,
      });
    }
  }

  for (const r of h.bitacora) {
    ev.push({
      ...base, fecha: r.createdAt, tipo: "bitacora", subtipo: r.accion,
      titulo: r.resumen?.trim() || etiquetaDe(ACCION_BITACORA, r.accion) || "Cambio",
      detalle: r.cambios.map((c) => `${c.etiqueta}: ${c.antes} → ${c.despues}`).join("; "),
      responsable: r.usuario ?? "Sistema", resultado: etiquetaDe(ACCION_BITACORA, r.accion),
    });
  }
  return ev;
}

// ═══ Tiempo y período ════════════════════════════════════════════════════════

const RE_MARCA = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * Milisegundos para ordenar. Una fecha sola es el inicio del día en El Salvador
 * (AAAA-MM-DDT06:00:00Z); una marca sin zona es UTC (así guarda SQLite); ilegible = 0.
 */
export function claveTiempo(fecha: string | null | undefined): number {
  if (typeof fecha !== "string" || !diaSV(fecha)) return 0;
  const v = fecha.trim();
  if (esFechaISO(v)) return Date.parse(`${v}T06:00:00Z`);
  const m = RE_MARCA.exec(v);
  if (!m) return 0;
  const zona = !m[6] || m[6].toUpperCase() === "Z" ? "Z" : m[6].length === 5 ? `${m[6].slice(0, 3)}:${m[6].slice(3)}` : m[6];
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4] ?? "00"}${m[5] ?? ""}${zona}`);
  return Number.isFinite(ms) ? ms : 0;
}

/** Del más nuevo al más viejo; si empatan, conserva el orden de entrada. */
export function ordenarEventos<T extends { fecha: string }>(eventos: readonly T[]): T[] {
  return eventos
    .map((e, i) => ({ e, i, k: claveTiempo(e.fecha) }))
    .sort((a, b) => b.k - a.k || a.i - b.i)
    .map((x) => x.e);
}

/** ¿El día (en El Salvador) cae en el período? Sin filtro, todo entra; con filtro, una fecha ilegible no. */
export function enPeriodo(fecha: string | null | undefined, desde: string | null, hasta: string | null): boolean {
  if (!desde && !hasta) return true;
  const dia = diaSV(fecha);
  if (!dia) return false;
  return (!desde || dia >= desde) && (!hasta || dia <= hasta);
}

/** Desde y hasta de la URL ('AAAA-MM-DD' o vacío). Con error no se filtra. */
export function periodoValido(desde: string | null | undefined, hasta: string | null | undefined): { desde: string | null; hasta: string | null; error: string | null } {
  const d = String(desde ?? "").trim() || null;
  const h = String(hasta ?? "").trim() || null;
  if ((d && !esFechaISO(d)) || (h && !esFechaISO(h))) return { desde: null, hasta: null, error: "La fecha no es válida." };
  if (d && h && d > h) return { desde: null, hasta: null, error: "La fecha «Desde» es posterior a «Hasta»." };
  return { desde: d, hasta: h, error: null };
}

/** 'del 01/05/2026 al 31/05/2026' · 'desde el …' · 'hasta el …' · '' sin período. */
export function textoPeriodo(desde: string | null, hasta: string | null): string {
  if (desde && hasta) return `del ${fechaCorta(desde)} al ${fechaCorta(hasta)}`;
  if (desde) return `desde el ${fechaCorta(desde)}`;
  if (hasta) return `hasta el ${fechaCorta(hasta)}`;
  return "";
}

// ═══ CSV ═════════════════════════════════════════════════════════════════════

/** Para que Excel no tome la celda por fórmula: antepone ' si empieza con = + @ (o tabulador) o con «-» seguido de algo que no es cifra. */
export function celdaSegura(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /^[=+@\t\r]/.test(s) || /^-(?!\d)/.test(s) ? `'${s}` : s;
}

export const COLUMNAS_CSV_HISTORIAL: { key: string; label: string }[] = [
  { key: "fecha", label: "Fecha" },
  { key: "hora", label: "Hora" },
  { key: "evento", label: "Evento" },
  { key: "orden", label: "Orden" },
  { key: "descripcion", label: "Descripción" },
  { key: "detalle", label: "Detalle" },
  { key: "responsable", label: "Responsable" },
  { key: "resultado", label: "Resultado o estado" },
  { key: "incidente", label: "Incidente (reporte de Calidad)" },
  { key: "equipo", label: "Código del equipo" },
];

/** Texto del incidente en pantalla e impresión (K-G1). */
export function textoIncidente(inc: { numero: string | null; fecha: string } | null | undefined): string {
  if (!inc) return "";
  return `Incidente · reporte de Calidad ${inc.numero ?? "pendiente"} · aviso ${fechaCorta(inc.fecha)}`;
}

/** Fila del CSV: fecha AAAA-MM-DD y hora HH:MM de El Salvador en columnas aparte. */
export function filaCsv(e: EventoHistorial, codigoEquipo: string): Record<string, string> {
  return {
    fecha: fechaCsv(e.fecha),
    hora: horaSV(e.fecha),
    evento: celdaSegura(TIPO_EVENTO_LABEL[e.tipo]),
    orden: celdaSegura(e.orden),
    descripcion: celdaSegura(e.titulo),
    detalle: celdaSegura(e.detalle),
    responsable: celdaSegura(e.responsable),
    resultado: celdaSegura(e.resultado),
    incidente: e.incidente ? celdaSegura(`${e.incidente.numero ?? "pendiente"} (${fechaCsv(e.incidente.fecha)})`) : "",
    equipo: celdaSegura(codigoEquipo),
  };
}

// ═══ Órdenes en la hoja de vida ══════════════════════════════════════════════

/** «Ejecutó»: lo registrado en la verificación; si no, la firma del técnico; si no, el asignado. */
export function quienEjecuto(o: { ejecutores: readonly string[]; firmaTecnicoNombre: string | null; asignado: string | null }):
  { nombre: string | null; fuente: "registro" | "firma" | "asignado" | null } {
  const ejecutores = [...new Set(o.ejecutores.map((s) => String(s ?? "").trim()).filter(Boolean))];
  if (ejecutores.length) return { nombre: ejecutores.join(", "), fuente: "registro" };
  const firma = String(o.firmaTecnicoNombre ?? "").trim();
  if (firma) return { nombre: firma, fuente: "firma" };
  const asignado = String(o.asignado ?? "").trim();
  if (asignado) return { nombre: asignado, fuente: "asignado" };
  return { nombre: null, fuente: null };
}

/** 'REP-01 Fusible 10 A × 2 unidad; REP-02 Filtro × 1'; sin repuestos → ''. */
export function textoRepuestos(r: ReadonlyArray<{ codigo: string | null; nombre: string | null; cantidad: number; unidad: string | null }>): string {
  return r
    .map((x) => `${unir([x.codigo, x.nombre], " ") || "Repuesto"} × ${textoCantidad(x.cantidad)}${x.unidad ? ` ${x.unidad}` : ""}`)
    .join("; ");
}

export const ESTADOS_OT_CONCLUIDA = ["completada", "verificada", "cerrada"] as const;

/** Conteos de la sección de intervenciones. */
export function resumenOts(ots: ReadonlyArray<{ tipo: string; estado: string }>): { total: number; concluidas: number; correctivas: number; emergencias: number } {
  return {
    total: ots.length,
    concluidas: ots.filter((o) => (ESTADOS_OT_CONCLUIDA as readonly string[]).includes(o.estado)).length,
    correctivas: ots.filter((o) => o.tipo === "correctivo").length,
    emergencias: ots.filter((o) => o.tipo === "emergencia").length,
  };
}

/** Órdenes creadas en el período (día de El Salvador), las más nuevas primero, hasta `tope`. */
export function otsDelPeriodo<T extends { id: number; createdAt: string }>(ots: readonly T[], desde: string | null, hasta: string | null, tope = 1000):
  { filas: T[]; total: number; recortado: boolean } {
  const dentro = ots.filter((o) => enPeriodo(o.createdAt, desde, hasta));
  const orden = [...dentro].sort((a, b) => claveTiempo(b.createdAt) - claveTiempo(a.createdAt) || b.id - a.id);
  return { filas: orden.slice(0, tope), total: dentro.length, recortado: dentro.length > tope };
}

/** Borde de la tarjeta en la línea de tiempo. */
export function colorEvento(e: Pick<EventoHistorial, "tipo" | "subtipo">): string {
  switch (e.tipo) {
    case "ot_creada":
      return e.subtipo === "correctivo" || e.subtipo === "emergencia" ? "border-red-400" : e.subtipo === "preventivo" ? "border-emerald-400" : "border-purple-400";
    case "ot_completada": return "border-emerald-500";
    case "ot_cerrada": return "border-slate-400";
    case "comentario": return "border-blue-300";
    case "repuesto": return "border-amber-400";
    case "incidente": return "border-red-500";
    case "calibracion": return e.subtipo === "no_conforme" ? "border-red-500" : "border-purple-500";
    case "documento": return "border-indigo-400";
    case "alerta": return "border-orange-400";
    case "alerta_cerrada": return "border-orange-300";
    case "capacitacion": return "border-cyan-400";
    case "seguridad_electrica": return e.subtipo === "pasa" ? "border-emerald-500" : e.subtipo === "anulada" ? "border-slate-300" : "border-red-500";
    case "baja":
    case "baja_revertida": return "border-slate-500";
    default: return "border-slate-300";
  }
}
