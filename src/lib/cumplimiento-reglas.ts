// Fase 59 · Panel de cumplimiento del equipo biomédico (JCI FMS.07/FMS.08).
// Reglas puras de los indicadores y de los vencimientos que avisa el resumen diario:
// la pantalla, el CSV y el correo cuentan igual. Las reglas de cada dato son las de
// su dueño en biomedico.ts (calibración de WP-B, expediente de WP-D, seguridad
// eléctrica de WP-F, licencias de WP-D, inventario y registro de WP-A).
// Los datos los carga cumplimiento-bio.ts; las pruebas, scripts/test-bio-cumplimiento.mjs.
import {
  DIAS_AVISO, ESTADO_CALIBRACION_LABEL, ESTADO_SEG_ELEC_LABEL, aplicaCalibracion, capacitacionVigente, completitudExpediente,
  diasEntre, esCritico, estadoAcreditacion, estadoRegistroSanitario, estadoSeguridadElectrica,
  estaAlDia, faltantesInventarioBiomedico, fechaCorta, infoCalibracion, situacionLicencia, textoVence, ultimaPorEquipo,
  type CalMin,
} from "./biomedico";
import { rubroDeActivo } from "./rubros";

// ─── Datos de entrada ────────────────────────────────────────────────────────

export interface EquipoCumplimiento {
  id: number; codigo: string; nombre: string; rubro: string | null; tipo: string | null; estado: string;
  marca: string | null; modelo: string | null; serial: string | null;
  ubicacionId: number | null; ubicacion: string | null; sede: string | null; sedeId: number | null;
  subcategoria: string | null; criticidadOperacional: string | null; claseRiesgo: string | null; centroCostoId: number | null;
  registroSanitario: string | null; registroSanitarioNoRequiere: boolean | null; registroSanitarioVencimiento: string | null;
  requiereCalibracion: boolean | null; esPatron: boolean | null; calibracionNoAplica: boolean | null;
  aceptacionFecha: string | null;
}

export interface DatosCumplimiento {
  hoy: string;
  /** Biomédicos (incluidas las bajas) y los equipos de otras áreas que requieren calibración o son patrón. */
  equipos: EquipoCumplimiento[];
  calibraciones: Array<CalMin & { activoId: number }>;
  documentos: Array<{ activoId: number; categoria: string | null; fechaVencimiento: string | null }>;
  expedienteNa: Array<{ activoId: number; requisito: string; motivo: string | null }>;
  /** Fechas de las rutinas activas. */
  planes: Array<{ activoId: number; proximaFecha: string }>;
  /** Proveedores activos marcados como laboratorio acreditado. */
  laboratorios: Array<{ id: number; nombre: string; esLaboratorioAcreditado: boolean; acreditacionOrgano: string | null; acreditacionNumero: string | null; acreditacionVigencia: string | null }>;
  /** Licencias activas o en trámite. */
  licencias: Array<{ id: number; nombre: string; numero: string | null; entidad: string; estado: string; fechaVencimiento: string | null; reemplazaAId: number | null; sede: string | null; equipoCodigo: string | null }>;
  /** Pruebas de seguridad eléctrica válidas (no anuladas). */
  pruebas: Array<{ id: number; activoId: number; fecha: string; resultado: string; proximaFecha: string | null }>;
  capacitaciones: Array<{ activoId: number; fecha: string }>;
  alertas: Array<{ id: number; titulo: string; tipo: string; estado: string; aplicabilidad: string; fechaAlerta: string; referencia: string | null }>;
  /** Bajas vigentes (activo_bajas.estado = 'vigente'). */
  bajas: Array<{ id: number; activoId: number; fechaBaja: string }>;
  /** Indicadores cuya fuente no se pudo leer: se muestran «Sin datos todavía». */
  sinDatos?: string[];
}

// ─── Salida ──────────────────────────────────────────────────────────────────

export type ClaveIndicador =
  | "sin_plan" | "preventivo_vencido" | "inventario" | "clase_riesgo" | "registro_sanitario" | "expediente"
  | "calibracion" | "patron" | "laboratorio" | "seguridad_electrica" | "capacitacion" | "licencia" | "alerta" | "baja_sin_acta";

/** Otra lista del módulo que muestra una parte de los hallazgos (no se imprime). */
export interface EnlaceIndicador { texto: string; enlace: string }

export interface Indicador {
  clave: ClaveIndicador; titulo: string; descripcion: string;
  universo: number | null; fallas: number; avisos: number; pct: number | null;
  /** Pantalla del módulo donde se corrige (no se imprime). */
  enlace: string; enlaceTexto: string;
  /** Listas que la principal no cubre (p. ej. registros sin número además de los vencidos). */
  extras: ReadonlyArray<EnlaceIndicador>;
  sinDatos: boolean;
}

export interface Hallazgo {
  indicador: ClaveIndicador; nivel: "falla" | "aviso";
  codigo: string; nombre: string; sede: string | null; ubicacion: string | null;
  detalle: string;
  /** AAAA-MM-DD relacionada (vencimiento, emisión…) o null. */
  fecha: string | null;
  enlace: string;
}

/**
 * Títulos y textos de cada indicador, en el orden del panel. Los enlaces usan los
 * filtros de cada dueño (K-A2, K-D2, K-F1): cuando una lista no tiene un valor que
 * junte todas las fallas (registro vencido o sin número; licencias por vencer o
 * vencidas), van como `extras`.
 */
export const INDICADORES: ReadonlyArray<{ clave: ClaveIndicador; titulo: string; descripcion: string; enlace: string; enlaceTexto: string; extras: ReadonlyArray<EnlaceIndicador> }> = [
  { clave: "sin_plan", titulo: "Sin rutina preventiva", descripcion: "Equipos biomédicos vigentes sin ninguna rutina activa.", enlace: "/plan-mantenimiento?area=biomedico", enlaceTexto: "Plan biomédico", extras: [] },
  { clave: "preventivo_vencido", titulo: "Preventivos vencidos", descripcion: "Equipos con alguna rutina cuya próxima fecha ya llegó.", enlace: "/cronograma?area=biomedico", enlaceTexto: "Cronograma", extras: [] },
  { clave: "inventario", titulo: "Datos del inventario incompletos", descripcion: "Falta identificación, marca, modelo, serie, ubicación, centro de costo, clase de riesgo o registro sanitario.", enlace: "/activos?area=biomedico&estado=vigentes", enlaceTexto: "Inventario",
    extras: [{ texto: "Sin centro de costo", enlace: "/activos?area=biomedico&estado=vigentes&centro=sin" }] },
  { clave: "clase_riesgo", titulo: "Sin clase de riesgo", descripcion: "Equipos biomédicos sin clase de riesgo I, IIa, IIb o III.", enlace: "/activos?area=biomedico&clase=sin&estado=vigentes", enlaceTexto: "Equipos sin clase", extras: [] },
  { clave: "registro_sanitario", titulo: "Registro sanitario", descripcion: `Sin número o vencido; aviso ${DIAS_AVISO.registroSanitario} días antes de vencer.`, enlace: "/activos?area=biomedico&registro=vencido&estado=vigentes", enlaceTexto: "Registros vencidos",
    extras: [
      { texto: "Sin registro", enlace: "/activos?area=biomedico&registro=sin_registro&estado=vigentes" },
      { texto: "Por vencer", enlace: "/activos?area=biomedico&registro=por_vencer&estado=vigentes" },
    ] },
  { clave: "expediente", titulo: "Expediente técnico", descripcion: "Manuales, ficha técnica, registro sanitario (si el equipo lo requiere) y acta de aceptación.", enlace: "/expedientes?estado=incompletos", enlaceTexto: "Expedientes", extras: [] },
  { clave: "calibracion", titulo: "Calibración", descripcion: `Misma regla que Calibraciones: última calibración conforme, vigente y con certificado; aviso ${DIAS_AVISO.calibracion} días antes.`, enlace: "/calibraciones", enlaceTexto: "Calibraciones", extras: [] },
  { clave: "patron", titulo: "Equipos patrón", descripcion: "Analizadores y simuladores con calibración al día (también cuentan en Calibración).", enlace: "/calibraciones/patrones", enlaceTexto: "Patrones", extras: [] },
  { clave: "laboratorio", titulo: "Laboratorios acreditados", descripcion: `Acreditación vencida o sin vigencia; aviso ${DIAS_AVISO.acreditacion} días antes.`, enlace: "/calibraciones/laboratorios", enlaceTexto: "Laboratorios", extras: [] },
  { clave: "seguridad_electrica", titulo: "Seguridad eléctrica (Clase III)", descripcion: `Equipos de clase de riesgo III (sin los equipos patrón) con prueba IEC 62353 vigente; aviso ${DIAS_AVISO.seguridadElectrica} días antes.`, enlace: "/seguridad-electrica?alcance=clase3", enlaceTexto: "Seguridad eléctrica",
    extras: [
      { texto: "Vencidas", enlace: "/seguridad-electrica?alcance=clase3&estado=vencida" },
      { texto: "Sin prueba", enlace: "/seguridad-electrica?alcance=clase3&estado=sin_prueba" },
    ] },
  { clave: "capacitacion", titulo: "Capacitación (equipos críticos)", descripcion: "Equipos críticos (soporte de vida, criticidad alta o clase III) con capacitación en los últimos 24 meses.", enlace: "/capacitaciones", enlaceTexto: "Capacitaciones", extras: [] },
  { clave: "licencia", titulo: "Licencias y permisos", descripcion: `Licencias activas vencidas; aviso ${DIAS_AVISO.licencia} días antes.`, enlace: "/licencias?situacion=vence_90", enlaceTexto: "Licencias",
    extras: [{ texto: "Vencidas", enlace: "/licencias?situacion=vencidas" }] },
  { clave: "alerta", titulo: "Alertas y retiros", descripcion: "Alertas abiertas o en proceso, o sin análisis de aplicabilidad.", enlace: "/alertas?estado=abiertas", enlaceTexto: "Alertas", extras: [] },
  { clave: "baja_sin_acta", titulo: "Bajas sin acta", descripcion: "Equipos dados de baja sin registro de baja o sin el acta firmada en sus documentos.", enlace: "/activos?area=biomedico&estado=baja", enlaceTexto: "Equipos de baja", extras: [] },
];

const enlaceEquipo = (id: number) => `/activos/${id}`;
const pct = (universo: number, fallas: number): number | null =>
  universo > 0 ? Math.round(((universo - fallas) / universo) * 100) : null;
/** 'vence el 10/05/2026 (en 5 días)' · 'venció el 10/05/2026'. */
function textoFecha(fecha: string, hoy: string): string {
  const dias = diasEntre(hoy, fecha);
  if (!Number.isFinite(dias)) return fechaCorta(fecha);
  if (dias < 0) return `venció el ${fechaCorta(fecha)}`;
  return `vence el ${fechaCorta(fecha)} (${textoVence(dias).replace(/^vence /, "")})`;
}
const mayuscula = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Biomédico vigente (universo U del panel). */
export const esBiomedicoVigente = (e: { rubro: string | null; tipo: string | null; estado: string }) =>
  e.estado !== "baja" && rubroDeActivo(e.rubro, e.tipo) === "biomedico";

function agrupar<T extends { activoId: number }>(filas: readonly T[]): Map<number, T[]> {
  const m = new Map<number, T[]>();
  for (const f of filas) {
    const arr = m.get(f.activoId);
    if (arr) arr.push(f); else m.set(f.activoId, [f]);
  }
  return m;
}

/** Indicadores y hallazgos (fallas primero, luego avisos; cada grupo por fecha y código). */
export function armarCumplimiento(d: DatosCumplimiento): { indicadores: Indicador[]; hallazgos: Hallazgo[] } {
  const { hoy } = d;
  const sinDatos = new Set(d.sinDatos ?? []);
  const U = d.equipos.filter(esBiomedicoVigente);
  const hallazgos: Hallazgo[] = [];
  const conteo = new Map<ClaveIndicador, { universo: number | null; fallas: number; avisos: number }>();
  const anotar = (clave: ClaveIndicador, universo: number | null) => conteo.set(clave, { universo, fallas: 0, avisos: 0 });
  const hallazgo = (h: Hallazgo) => {
    hallazgos.push(h);
    const c = conteo.get(h.indicador)!;
    if (h.nivel === "falla") c.fallas++; else c.avisos++;
  };
  const deEquipo = (indicador: ClaveIndicador, nivel: Hallazgo["nivel"], e: EquipoCumplimiento, detalle: string, fecha: string | null, enlace = enlaceEquipo(e.id)) =>
    hallazgo({ indicador, nivel, codigo: e.codigo, nombre: e.nombre, sede: e.sede, ubicacion: e.ubicacion, detalle, fecha, enlace });

  const planesPorEquipo = agrupar(d.planes);
  const calsPorEquipo = agrupar(d.calibraciones);
  const docsPorEquipo = agrupar(d.documentos);
  const naPorEquipo = agrupar(d.expedienteNa);
  const capsPorEquipo = agrupar(d.capacitaciones);
  const ultimaPrueba = ultimaPorEquipo(d.pruebas);

  // Sin rutina y preventivos vencidos (como antes: una próxima fecha ≤ hoy).
  anotar("sin_plan", U.length);
  const conPlan = U.filter((e) => (planesPorEquipo.get(e.id) ?? []).length > 0);
  anotar("preventivo_vencido", conPlan.length);
  for (const e of U) {
    const fechas = (planesPorEquipo.get(e.id) ?? []).map((p) => p.proximaFecha).sort();
    if (fechas.length === 0) {
      deEquipo("sin_plan", "falla", e, e.criticidadOperacional === "alta" ? "Sin rutina activa · criticidad alta" : "Sin rutina activa", null);
    } else if (fechas[0] <= hoy) {
      deEquipo("preventivo_vencido", "falla", e, `Rutina vencida desde ${fechaCorta(fechas[0])}`, fechas[0]);
    }
  }

  // Inventario y clase de riesgo (WP-A).
  anotar("inventario", U.length);
  anotar("clase_riesgo", U.length);
  for (const e of U) {
    const falta = faltantesInventarioBiomedico(e);
    if (falta.length) deEquipo("inventario", "falla", e, `Falta: ${falta.join(", ")}`, null);
    if (!String(e.claseRiesgo ?? "").trim()) deEquipo("clase_riesgo", "falla", e, "Sin clasificar", null);
  }

  // Registro sanitario: sin número o vencido = falla; por vencer (90 días) = aviso.
  anotar("registro_sanitario", U.length);
  for (const e of U) {
    const estado = estadoRegistroSanitario(e, hoy, DIAS_AVISO.registroSanitario);
    if (estado === "sin_registro") deEquipo("registro_sanitario", "falla", e, "Sin número de registro sanitario", null);
    else if (estado === "vencido") deEquipo("registro_sanitario", "falla", e, mayuscula(textoFecha(e.registroSanitarioVencimiento!, hoy)), e.registroSanitarioVencimiento);
    else if (estado === "por_vencer") deEquipo("registro_sanitario", "aviso", e, mayuscula(textoFecha(e.registroSanitarioVencimiento!, hoy)), e.registroSanitarioVencimiento);
  }

  // Expediente técnico (regla de WP-D, 5 requisitos con «No aplica»). Un equipo que el
  // inventario marca «No requiere registro sanitario» no debe ese documento.
  anotar("expediente", U.length);
  for (const e of U) {
    const c = completitudExpediente({
      documentos: docsPorEquipo.get(e.id) ?? [],
      aceptacionFecha: e.aceptacionFecha,
      noAplica: naPorEquipo.get(e.id) ?? [],
      registroSanitarioNoRequiere: e.registroSanitarioNoRequiere,
      hoy,
    });
    if (!c.completo) deEquipo("expediente", "falla", e, `Falta: ${c.faltan.join(", ")}`, null, `/activos/${e.id}#documentos`);
  }

  // Calibración (regla de WP-B; universo = el de /calibraciones sin filtros) y patrones.
  const calibrables = d.equipos.filter((e) => aplicaCalibracion(e));
  const patrones = calibrables.filter((e) => e.esPatron);
  anotar("calibracion", calibrables.length);
  anotar("patron", patrones.length);
  const detalleCal = (e: EquipoCumplimiento) => {
    const info = infoCalibracion(e, calsPorEquipo.get(e.id) ?? [], hoy);
    const etiqueta = ESTADO_CALIBRACION_LABEL[info.estado];
    let detalle: string = etiqueta;
    let fecha: string | null = null;
    if (info.estado === "sin_calibracion") detalle = "Sin calibración registrada";
    else if (info.estado === "vencida") { fecha = info.proxima; detalle = info.proxima ? `${etiqueta} · ${textoFecha(info.proxima, hoy)}` : `${etiqueta} · sin próxima fecha`; }
    else if (info.estado === "no_conforme") { fecha = info.ultima; detalle = `${etiqueta} · calibrada el ${fechaCorta(info.ultima)}`; }
    else if (info.estado === "sin_certificado") { fecha = info.proxima ?? info.ultima; detalle = `${etiqueta} · calibrada el ${fechaCorta(info.ultima)}`; }
    else if (info.estado === "por_vencer" && info.proxima) { fecha = info.proxima; detalle = `${etiqueta} · ${textoFecha(info.proxima, hoy)}`; }
    return { info, detalle, fecha };
  };
  for (const e of calibrables) {
    const { info, detalle, fecha } = detalleCal(e);
    const enlace = `/activos/${e.id}#calibraciones`;
    if (!estaAlDia(info.estado)) deEquipo("calibracion", "falla", e, detalle, fecha, enlace);
    else if (info.estado === "por_vencer") deEquipo("calibracion", "aviso", e, detalle, fecha, enlace);
  }
  for (const e of patrones) {
    const { info, detalle, fecha } = detalleCal(e);
    const enlace = `/activos/${e.id}#calibraciones`;
    if (!estaAlDia(info.estado)) deEquipo("patron", "falla", e, detalle, fecha, enlace);
    else if (info.estado === "por_vencer") deEquipo("patron", "aviso", e, detalle, fecha, enlace);
  }

  // Laboratorios acreditados (WP-B, aviso 60 días).
  const labs = d.laboratorios.filter((l) => l.esLaboratorioAcreditado);
  anotar("laboratorio", labs.length);
  for (const l of labs) {
    const estado = estadoAcreditacion(l, hoy);
    const base = { indicador: "laboratorio" as const, codigo: l.acreditacionNumero ?? "—", nombre: l.nombre, sede: null, ubicacion: null, enlace: "/calibraciones/laboratorios" };
    if (estado === "vencida") hallazgo({ ...base, nivel: "falla", detalle: `Acreditación ${textoFecha(l.acreditacionVigencia!, hoy)}`, fecha: l.acreditacionVigencia });
    else if (estado === "sin_vigencia") hallazgo({ ...base, nivel: "falla", detalle: "Acreditación sin vigencia registrada", fecha: null });
    else if (estado === "por_vencer") hallazgo({ ...base, nivel: "aviso", detalle: `Acreditación ${textoFecha(l.acreditacionVigencia!, hoy)}`, fecha: l.acreditacionVigencia });
  }

  // Seguridad eléctrica: equipos de clase de riesgo III (regla de WP-F, última prueba válida),
  // sin los equipos patrón, igual que el tablero /seguridad-electrica?alcance=clase3 que abre
  // el indicador (es_patron = 0): así el número coincide con la lista.
  const claseIII = U.filter((e) => e.claseRiesgo === "III" && !e.esPatron);
  anotar("seguridad_electrica", claseIII.length);
  for (const e of claseIII) {
    const ultima = ultimaPrueba.get(e.id) ?? null;
    const estado = estadoSeguridadElectrica(ultima, hoy, DIAS_AVISO.seguridadElectrica);
    const enlace = `/activos/${e.id}/seguridad-electrica`;
    const etiqueta = ESTADO_SEG_ELEC_LABEL[estado];
    if (estado === "sin_prueba") deEquipo("seguridad_electrica", "falla", e, "Sin prueba registrada", null, enlace);
    else if (estado === "no_pasa") deEquipo("seguridad_electrica", "falla", e, `${etiqueta} · prueba del ${fechaCorta(ultima!.fecha)}`, ultima!.fecha, enlace);
    else if (estado === "vencida") deEquipo("seguridad_electrica", "falla", e, ultima!.proximaFecha ? `${etiqueta} · ${textoFecha(ultima!.proximaFecha, hoy)}` : `${etiqueta} · sin próxima fecha`, ultima!.proximaFecha, enlace);
    else if (estado === "por_vencer") deEquipo("seguridad_electrica", "aviso", e, `${etiqueta} · ${textoFecha(ultima!.proximaFecha!, hoy)}`, ultima!.proximaFecha, enlace);
  }

  // Capacitación: equipos críticos con alguna capacitación en los últimos 24 meses.
  const criticos = U.filter((e) => esCritico(e));
  anotar("capacitacion", criticos.length);
  for (const e of criticos) {
    const fechas = (capsPorEquipo.get(e.id) ?? []).map((c) => c.fecha).sort();
    if (capacitacionVigente(fechas, hoy)) continue;
    const ultima = fechas.at(-1) ?? null;
    deEquipo("capacitacion", "falla", e, ultima ? `Última: ${fechaCorta(ultima)}` : "Sin capacitación registrada", ultima, `/activos/${e.id}#capacitaciones`);
  }

  // Licencias activas (las en trámite y las reemplazadas no cuentan).
  const renovando = new Set(d.licencias.filter((l) => l.estado === "en_tramite" && l.reemplazaAId).map((l) => l.reemplazaAId!));
  const activas = d.licencias.filter((l) => l.estado === "activa");
  anotar("licencia", activas.length);
  for (const l of activas) {
    const s = situacionLicencia(l, hoy, { renovacionEnTramite: renovando.has(l.id) });
    if (s.clave !== "vencida" && s.clave !== "vence_30" && s.clave !== "vence_60" && s.clave !== "vence_90") continue;
    const tramite = renovando.has(l.id) ? " · renovación en trámite" : "";
    hallazgo({
      indicador: "licencia", nivel: s.clave === "vencida" ? "falla" : "aviso",
      codigo: l.numero ?? "Sin número", nombre: l.equipoCodigo ? `${l.nombre} (${l.equipoCodigo})` : l.nombre,
      sede: l.sede, ubicacion: null,
      detalle: `${mayuscula(textoFecha(l.fechaVencimiento!, hoy))}${tramite}`, fecha: l.fechaVencimiento, enlace: `/licencias/${l.id}`,
    });
  }

  // Alertas: abiertas o en proceso, o sin análisis (una fila por alerta).
  anotar("alerta", d.alertas.length);
  for (const a of d.alertas) {
    const abierta = a.estado !== "cerrada";
    const pendiente = a.aplicabilidad === "pendiente";
    if (!abierta && !pendiente) continue;
    const partes: string[] = [];
    if (abierta) {
      const dias = diasEntre(a.fechaAlerta, hoy);
      const quien = a.estado === "en_proceso" ? "En proceso" : "Abierta";
      partes.push(Number.isFinite(dias) ? (dias <= 0 ? `${quien} desde hoy` : `${quien} hace ${dias} ${dias === 1 ? "día" : "días"}`) : quien);
    } else partes.push("Cerrada");
    if (pendiente) partes.push("Sin análisis");
    hallazgo({
      indicador: "alerta", nivel: "falla", codigo: `ALE-${String(a.id).padStart(4, "0")}`, nombre: a.referencia ? `${a.titulo} (${a.referencia})` : a.titulo,
      sede: null, ubicacion: null, detalle: partes.join(" · "), fecha: a.fechaAlerta, enlace: `/alertas/${a.id}`,
    });
  }

  // Bajas: biomédicos dados de baja sin su registro (activo_bajas) o sin el acta firmada.
  const deBaja = d.equipos.filter((e) => e.estado === "baja" && rubroDeActivo(e.rubro, e.tipo) === "biomedico");
  const bajaVigente = new Map(d.bajas.map((b) => [b.activoId, b]));
  anotar("baja_sin_acta", deBaja.length);
  for (const e of deBaja) {
    const registro = bajaVigente.get(e.id) ?? null;
    const conActa = (docsPorEquipo.get(e.id) ?? []).some((doc) => doc.categoria === "acta_baja");
    if (registro && conActa) continue;
    const detalle = !registro && !conActa ? "Falta registro de baja y acta firmada" : !registro ? "Falta registro de baja" : "Falta acta firmada";
    deEquipo("baja_sin_acta", "falla", e, detalle, registro?.fechaBaja ?? null, registro ? `/activos/${e.id}#documentos` : `/activos/${e.id}/baja`);
  }

  const indicadores: Indicador[] = INDICADORES.map((def) => {
    const c = conteo.get(def.clave) ?? { universo: null, fallas: 0, avisos: 0 };
    const vacio = sinDatos.has(def.clave);
    return {
      ...def,
      universo: vacio ? null : c.universo,
      fallas: vacio ? 0 : c.fallas,
      avisos: vacio ? 0 : c.avisos,
      pct: vacio || c.universo === null ? null : pct(c.universo, c.fallas),
      sinDatos: vacio,
    };
  });
  const orden = new Map(INDICADORES.map((i, n) => [i.clave, n]));
  const visibles = hallazgos.filter((h) => !sinDatos.has(h.indicador));
  visibles.sort((a, b) =>
    (orden.get(a.indicador)! - orden.get(b.indicador)!) ||
    (a.nivel === b.nivel ? 0 : a.nivel === "falla" ? -1 : 1) ||
    (a.fecha ?? "9999").localeCompare(b.fecha ?? "9999") ||
    a.codigo.localeCompare(b.codigo, "es"));
  return { indicadores, hallazgos: visibles };
}

// ─── Vencimientos para el resumen diario y el correo a la jefatura ───────────

export type TipoVencimiento = "calibracion" | "seguridad_electrica" | "licencia" | "registro_sanitario" | "acreditacion";

/** En el orden del correo, con la ventana de aviso de cada uno (DIAS_AVISO). */
export const TIPOS_VENCIMIENTO: ReadonlyArray<{ tipo: TipoVencimiento; titulo: string; dias: number; vencidos: [string, string] }> = [
  { tipo: "calibracion", titulo: `Calibraciones (próximos ${DIAS_AVISO.calibracion} días)`, dias: DIAS_AVISO.calibracion, vencidos: ["calibración", "calibraciones"] },
  { tipo: "seguridad_electrica", titulo: `Seguridad eléctrica (${DIAS_AVISO.seguridadElectrica} días)`, dias: DIAS_AVISO.seguridadElectrica, vencidos: ["prueba", "pruebas"] },
  { tipo: "licencia", titulo: `Licencias y permisos (${DIAS_AVISO.licencia} días)`, dias: DIAS_AVISO.licencia, vencidos: ["licencia", "licencias"] },
  { tipo: "registro_sanitario", titulo: `Registros sanitarios (${DIAS_AVISO.registroSanitario} días)`, dias: DIAS_AVISO.registroSanitario, vencidos: ["registro", "registros"] },
  { tipo: "acreditacion", titulo: `Acreditación de laboratorios (${DIAS_AVISO.acreditacion} días)`, dias: DIAS_AVISO.acreditacion, vencidos: ["acreditación", "acreditaciones"] },
];

export interface Vencimiento { tipo: TipoVencimiento; activoId: number | null; codigo: string; nombre: string; vence: string; dias: number; enlace: string }

/**
 * Lo que vence dentro de su ventana (de 0 a DIAS_AVISO días), de lo más cercano a lo
 * más lejano, y cuántos ya vencieron por tipo. Mismas reglas que los indicadores:
 * calibración por vencer, prueba eléctrica por vencer (biomédicos con prueba, sin los
 * equipos patrón, como el tablero de seguridad eléctrica), licencia activa, registro
 * sanitario y acreditación.
 */
export function vencimientosProximos(d: DatosCumplimiento): { items: Vencimiento[]; vencidos: Record<TipoVencimiento, number> } {
  const { hoy } = d;
  const sinDatos = new Set(d.sinDatos ?? []);
  const items: Vencimiento[] = [];
  const vencidos: Record<TipoVencimiento, number> = { calibracion: 0, seguridad_electrica: 0, licencia: 0, registro_sanitario: 0, acreditacion: 0 };
  const agregar = (v: Omit<Vencimiento, "dias">) => {
    const dias = diasEntre(hoy, v.vence);
    if (Number.isFinite(dias)) items.push({ ...v, dias });
  };
  const U = d.equipos.filter(esBiomedicoVigente);

  if (!sinDatos.has("calibracion")) {
    const calsPorEquipo = agrupar(d.calibraciones);
    for (const e of d.equipos) {
      const info = infoCalibracion(e, calsPorEquipo.get(e.id) ?? [], hoy);
      if (info.estado === "vencida") vencidos.calibracion++;
      else if (info.estado === "por_vencer" && info.proxima) agregar({ tipo: "calibracion", activoId: e.id, codigo: e.codigo, nombre: e.nombre, vence: info.proxima, enlace: `/activos/${e.id}#calibraciones` });
    }
  }
  if (!sinDatos.has("seguridad_electrica")) {
    // Biomédicos vigentes sin los patrones: el universo del tablero «Todos los biomédicos».
    const ultima = ultimaPorEquipo(d.pruebas);
    for (const e of U) {
      if (e.esPatron) continue;
      const p = ultima.get(e.id);
      if (!p) continue;
      const estado = estadoSeguridadElectrica(p, hoy, DIAS_AVISO.seguridadElectrica);
      if (estado === "vencida") vencidos.seguridad_electrica++;
      else if (estado === "por_vencer" && p.proximaFecha) agregar({ tipo: "seguridad_electrica", activoId: e.id, codigo: e.codigo, nombre: e.nombre, vence: p.proximaFecha, enlace: `/activos/${e.id}/seguridad-electrica` });
    }
  }
  if (!sinDatos.has("licencia")) {
    for (const l of d.licencias) {
      if (l.estado !== "activa") continue;
      const s = situacionLicencia(l, hoy);
      if (s.clave === "vencida") vencidos.licencia++;
      else if (s.dias !== null && s.dias >= 0 && s.dias <= DIAS_AVISO.licencia && l.fechaVencimiento) {
        agregar({ tipo: "licencia", activoId: null, codigo: l.numero ?? "Sin número", nombre: l.equipoCodigo ? `${l.nombre} (${l.equipoCodigo})` : l.nombre, vence: l.fechaVencimiento, enlace: `/licencias/${l.id}` });
      }
    }
  }
  if (!sinDatos.has("registro_sanitario")) {
    for (const e of U) {
      const estado = estadoRegistroSanitario(e, hoy, DIAS_AVISO.registroSanitario);
      if (estado === "vencido") vencidos.registro_sanitario++;
      else if (estado === "por_vencer" && e.registroSanitarioVencimiento) agregar({ tipo: "registro_sanitario", activoId: e.id, codigo: e.codigo, nombre: e.nombre, vence: e.registroSanitarioVencimiento, enlace: `/activos/${e.id}` });
    }
  }
  if (!sinDatos.has("laboratorio")) {
    for (const l of d.laboratorios) {
      if (!l.esLaboratorioAcreditado) continue;
      const estado = estadoAcreditacion(l, hoy);
      if (estado === "vencida") vencidos.acreditacion++;
      else if (estado === "por_vencer" && l.acreditacionVigencia) agregar({ tipo: "acreditacion", activoId: null, codigo: l.acreditacionNumero ?? "—", nombre: l.nombre, vence: l.acreditacionVigencia, enlace: "/calibraciones/laboratorios" });
    }
  }
  items.sort((a, b) => a.dias - b.dias || a.codigo.localeCompare(b.codigo, "es"));
  return { items, vencidos };
}
