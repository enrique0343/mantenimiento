// Fase 59 · Plan anual de mantenimiento (requisito 6): calendario del año, horas,
// modalidad con proveedor, aprobación vigente y CSV. Puro: lo usan la página del
// plan, la exportación y las pruebas (scripts/test-bio-plan-anual.mjs). La página
// y el CSV leen las rutinas con cargarRutinasPlan (plan-anual-datos.ts), así
// cuentan igual.
import { proyectarFechas } from "./frecuencias";
import { etiquetaFrecuencia } from "./biomedico";
import { MODALIDAD_LABEL, rubroLabel } from "./rubros";

export const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"] as const;

export const PRIORIDAD_LABEL: Record<string, string> = { urgente: "Urgente", alta: "Alta", media: "Media", baja: "Baja" };

/** Una rutina del plan: plan preventivo de un equipo o actividad recurrente. */
export interface RutinaPlan {
  tipo: "equipo" | "actividad";
  id: number;
  activoId: number | null;
  area: string;
  /** Agrupación de la sección «Equipos con plan preventivo» (subcategoría o categoría). */
  grupo: string;
  codigo: string;
  nombre: string;
  sede: string | null;
  sedeId: number | null;
  ubicacion: string | null;
  rutina: string;
  frecuencia: string;
  proximaFecha: string;
  horasEstimadas: number | null;
  prioridad: string;
  modalidad: string;
  proveedor: string | null;
  contrato: string | null;
  contratoVigencia: { inicio: string; fin: string } | null;
  responsable: string | null;
  critico: boolean;
}

export interface CalendarioAnual { fechas: string[]; porMes: number[]; veces: number }

/** Fechas proyectadas de la rutina en el año, cuántas caen en cada mes y el total. */
export function calendarioAnual(proximaFecha: string, frecuencia: string, anio: number): CalendarioAnual {
  const fechas = proyectarFechas(proximaFecha, frecuencia, `${anio}-01-01`, `${anio + 1}-01-01`, 400);
  const porMes = Array.from({ length: 12 }, () => 0);
  for (const f of fechas) porMes[Number(f.slice(5, 7)) - 1]++;
  return { fechas, porMes, veces: fechas.length };
}

/** Las fechas que caen en el mes (1 a 12). */
export const fechasDelMes = (fechas: readonly string[], mes: number): string[] =>
  fechas.filter((f) => Number(f.slice(5, 7)) === mes);

/** Celda del calendario: '' · '5' · '5 · 19' · '4×' (más de dos en el mes). */
export function celdaMes(fechas: readonly string[]): string {
  if (fechas.length === 0) return "";
  if (fechas.length > 2) return `${fechas.length}×`;
  return fechas.map((f) => String(Number(f.slice(8, 10)))).join(" · ");
}

/** Horas del año = horas por ejecución × veces, con un decimal; sin horas → null. */
export function horasEnAnio(horas: number | null | undefined, veces: number): number | null {
  if (horas === null || horas === undefined || !Number.isFinite(horas) || horas <= 0) return null;
  // toFixed(6) quita el error binario (0.35 × 3 = 1.0499…) antes de redondear a un decimal.
  return Math.round(Number((horas * veces).toFixed(6)) * 10) / 10;
}

/**
 * Texto de «Modalidad y proveedor». Interno → 'Personal propio'; contratado →
 * 'Empresa externa: X (CT-001)'; mixto → 'Mixto: X'. Externa o mixta sin proveedor
 * se marca con `faltaProveedor`.
 */
export function modalidadTexto(modalidad: string | null | undefined, proveedor: string | null | undefined, contrato: string | null | undefined): { texto: string; faltaProveedor: boolean } {
  if (modalidad !== "contratado" && modalidad !== "mixto") return { texto: "Personal propio", faltaProveedor: false };
  const prov = proveedor?.trim();
  if (!prov) return { texto: modalidad === "mixto" ? "Mixto (falta proveedor)" : "Empresa externa (falta proveedor)", faltaProveedor: true };
  const base = modalidad === "mixto" ? `Mixto: ${prov}` : `Empresa externa: ${prov}`;
  return { texto: contrato?.trim() ? `${base} (${contrato.trim()})` : base, faltaProveedor: false };
}

export interface AprobacionMin { id: number; anio: number; area: string; fechaAprobacion: string; anuladaEn: string | null }

/** La aprobación vigente del año y área: la no anulada de fecha mayor (empate: id mayor). */
export function aprobacionVigente<T extends AprobacionMin>(filas: readonly T[], anio: number, area: string): T | null {
  let vigente: T | null = null;
  for (const f of filas) {
    if (f.anio !== anio || f.area !== area || f.anuladaEn) continue;
    if (!vigente || f.fechaAprobacion > vigente.fechaAprobacion || (f.fechaAprobacion === vigente.fechaAprobacion && f.id > vigente.id)) vigente = f;
  }
  return vigente;
}

/** Más de estas fechas no caben en una celda: el CSV remite a las columnas por mes. */
export const MAX_FECHAS_CSV = 24;

export function columnasCsvPlan(anio: number): { key: string; label: string }[] {
  return [
    { key: "tipo", label: "Tipo" },
    { key: "area", label: "Área" },
    { key: "sede", label: "Sede" },
    { key: "ubicacion", label: "Ubicación" },
    { key: "codigo", label: "Código" },
    { key: "nombre", label: "Equipo / actividad" },
    { key: "rutina", label: "Rutina" },
    { key: "frecuencia", label: "Frecuencia" },
    { key: "modalidad", label: "Modalidad" },
    { key: "proveedor", label: "Proveedor" },
    { key: "contrato", label: "Contrato" },
    { key: "horas", label: "Horas por ejecución" },
    { key: "prioridad", label: "Prioridad" },
    { key: "responsable", label: "Responsable" },
    { key: "proxima", label: "Próxima fecha" },
    { key: "veces", label: `Veces ${anio}` },
    { key: "horasAnio", label: `Horas ${anio}` },
    ...MESES_CORTOS.map((m, i) => ({ key: `m${i + 1}`, label: m })),
    { key: "fechas", label: "Fechas proyectadas" },
  ];
}

/** Filas del CSV: fechas en AAAA-MM-DD, una por rutina, en el orden recibido. */
export function filasCsvPlan(rutinas: readonly RutinaPlan[], anio: number): Record<string, string | number | null>[] {
  return rutinas.map((r) => {
    const cal = calendarioAnual(r.proximaFecha, r.frecuencia, anio);
    const fila: Record<string, string | number | null> = {
      tipo: r.tipo === "equipo" ? "Equipo" : "Actividad",
      area: rubroLabel(r.area),
      sede: r.sede ?? "",
      ubicacion: r.ubicacion ?? "",
      codigo: r.codigo,
      nombre: r.nombre,
      rutina: r.rutina,
      frecuencia: etiquetaFrecuencia(r.frecuencia),
      modalidad: MODALIDAD_LABEL[r.modalidad] ?? r.modalidad,
      proveedor: r.proveedor ?? "",
      contrato: r.contrato ?? "",
      horas: r.horasEstimadas ?? null,
      prioridad: PRIORIDAD_LABEL[r.prioridad] ?? r.prioridad,
      responsable: r.responsable ?? "",
      proxima: r.proximaFecha,
      veces: cal.veces,
      horasAnio: horasEnAnio(r.horasEstimadas, cal.veces),
      fechas: cal.fechas.length > MAX_FECHAS_CSV ? "Ver columnas por mes" : cal.fechas.join("; "),
    };
    cal.porMes.forEach((n, i) => { fila[`m${i + 1}`] = n; });
    return fila;
  });
}
