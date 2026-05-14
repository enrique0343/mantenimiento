// Helpers para el módulo de Proyectos.
// Cálculos derivados: costos, % avance, comparativos.

import type { APIContext } from "astro";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import {
  proyectos, proyectoPresupuestoItems, proyectoHitos,
  ordenes, ordenRepuestos, usuarios,
} from "./schema";

export interface ResumenProyecto {
  costoEstimado: number;
  costoReal: number;
  desviacionAbs: number;     // costoReal - costoEstimado
  desviacionPct: number;     // % desviación
  avancePct: number;
  avanceFuente: "manual" | "hitos" | "ots" | "ninguno";
  otsTotal: number;
  otsCerradas: number;
  hitosTotal: number;
  hitosCompletados: number;
}

// Estados de OT considerados "cerrados" para conteo de avance
const ESTADOS_OT_CERRADOS = new Set(["cerrada", "verificada", "completada"]);

export async function calcularResumenProyecto(ctx: APIContext, proyectoId: number): Promise<ResumenProyecto> {
  const db = getDb(ctx);

  const [p] = await db.select().from(proyectos).where(eq(proyectos.id, proyectoId)).limit(1);
  if (!p) {
    return {
      costoEstimado: 0, costoReal: 0, desviacionAbs: 0, desviacionPct: 0,
      avancePct: 0, avanceFuente: "ninguno",
      otsTotal: 0, otsCerradas: 0, hitosTotal: 0, hitosCompletados: 0,
    };
  }

  // Items de presupuesto
  const items = await db.select().from(proyectoPresupuestoItems).where(eq(proyectoPresupuestoItems.proyectoId, proyectoId));
  let costoEstimado = 0;
  let costoRealItems = 0;
  for (const it of items) {
    costoEstimado += (it.precioEstimado ?? 0) * (it.cantidad ?? 1);
    if (it.precioReal != null) {
      costoRealItems += it.precioReal * (it.cantidad ?? 1);
    }
  }

  // OTs hijas
  const ots = await db
    .select({ o: ordenes, u: usuarios })
    .from(ordenes)
    .leftJoin(usuarios, eq(usuarios.id, ordenes.asignadoA))
    .where(eq(ordenes.proyectoId, proyectoId));

  const otsTotal = ots.length;
  const otsCerradas = ots.filter((r) => ESTADOS_OT_CERRADOS.has(r.o.estado)).length;

  // Costo real: items con precio_real + mano de obra OTs + repuestos OTs
  let costoManoObra = 0;
  for (const r of ots) {
    const tarifa = Number((r.u as any)?.tarifaHora ?? 0);
    const horas = Number(r.o.horasTrabajadas ?? 0);
    costoManoObra += tarifa * horas;
  }
  let costoRepuestos = 0;
  if (ots.length > 0) {
    const reps = await db
      .select({ rep: ordenRepuestos })
      .from(ordenRepuestos)
      .where(inArray(ordenRepuestos.ordenId, ots.map((r) => r.o.id)));
    for (const r of reps) {
      costoRepuestos += (r.rep.precioUnitario ?? 0) * r.rep.cantidad;
    }
  }
  const costoReal = costoRealItems + costoManoObra + costoRepuestos;

  // Si presupuesto_estimado tiene valor manual, usarlo como referencia
  const presupuestoRef = p.presupuestoEstimado && p.presupuestoEstimado > 0
    ? p.presupuestoEstimado
    : costoEstimado;

  const desviacionAbs = costoReal - presupuestoRef;
  const desviacionPct = presupuestoRef > 0
    ? Math.round((desviacionAbs / presupuestoRef) * 100)
    : 0;

  // Hitos
  const hitos = await db.select().from(proyectoHitos).where(eq(proyectoHitos.proyectoId, proyectoId));
  const hitosTotal = hitos.length;
  const hitosCompletados = hitos.filter((h) => h.completado).length;

  // % avance: prioridad manual > hitos > OTs
  let avancePct = 0;
  let avanceFuente: ResumenProyecto["avanceFuente"] = "ninguno";
  if (p.avanceManual != null && p.avanceManual >= 0) {
    avancePct = Math.min(100, Math.max(0, p.avanceManual));
    avanceFuente = "manual";
  } else if (hitosTotal > 0) {
    avancePct = Math.round((hitosCompletados / hitosTotal) * 100);
    avanceFuente = "hitos";
  } else if (otsTotal > 0) {
    avancePct = Math.round((otsCerradas / otsTotal) * 100);
    avanceFuente = "ots";
  }

  return {
    costoEstimado: Math.round((presupuestoRef) * 100) / 100,
    costoReal: Math.round(costoReal * 100) / 100,
    desviacionAbs: Math.round(desviacionAbs * 100) / 100,
    desviacionPct,
    avancePct,
    avanceFuente,
    otsTotal, otsCerradas, hitosTotal, hitosCompletados,
  };
}

export const ESTADO_PROYECTO_LABEL: Record<string, string> = {
  evaluacion: "En evaluación",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
  en_ejecucion: "En ejecución",
  en_pausa: "En pausa",
  completado: "Completado",
  cancelado: "Cancelado",
};

export const ESTADO_PROYECTO_COLOR: Record<string, string> = {
  evaluacion: "bg-amber-100 text-amber-700",
  aprobado: "bg-blue-100 text-blue-700",
  rechazado: "bg-red-100 text-red-700",
  en_ejecucion: "bg-emerald-100 text-emerald-700",
  en_pausa: "bg-purple-100 text-purple-700",
  completado: "bg-slate-200 text-slate-700",
  cancelado: "bg-slate-100 text-slate-500",
};

// Permisos
export function puedeCrearProyecto(rol: string): boolean {
  return ["admin", "jefe", "tecnico"].includes(rol);
}
export function puedeAprobarProyecto(rol: string): boolean {
  return rol === "admin";
}
export function puedeEditarProyecto(rol: string, proyecto: { creadoPor: number; estado: string }, userId: number): boolean {
  if (rol === "admin") return true;
  if (rol === "jefe") return true;
  if (rol === "tecnico" && proyecto.creadoPor === userId && proyecto.estado === "evaluacion") return true;
  return false;
}
