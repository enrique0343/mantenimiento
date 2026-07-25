// ─── Control eléctrico: cálculos de carga y disponibilidad ───────────────────
import type { Subestacion, CargaElectrica } from "@/lib/schema";

export type Rol = "admin" | "jefe" | "tecnico" | "solicitante" | "visualizador" | "proveedor" | "motorista";

export const puedeVerElectrico = (rol: string) =>
  ["admin", "jefe", "tecnico", "visualizador"].includes(rol);

export const puedeAdministrarElectrico = (rol: string) =>
  ["admin", "jefe"].includes(rol);

/**
 * kW de una carga: usa potenciaKw si está registrada; si no, la estima desde
 * amperaje × voltaje (× √3 si es trifásica), asumiendo factor de potencia 0.9.
 */
export function kwDeCarga(c: Pick<CargaElectrica, "potenciaKw" | "amperaje" | "voltajeCarga" | "fases">): number {
  if (c.potenciaKw != null && c.potenciaKw > 0) return c.potenciaKw;
  if (c.amperaje != null && c.amperaje > 0 && c.voltajeCarga != null && c.voltajeCarga > 0) {
    const mult = c.fases === 3 ? Math.sqrt(3) : c.fases === 2 ? 2 : 1;
    return (mult * c.voltajeCarga * c.amperaje * 0.9) / 1000;
  }
  return 0;
}

export interface ResumenSubestacion {
  /** kW útiles totales = kVA × factor de potencia */
  capacidadKw: number;
  /** kW máximos recomendados = capacidad × factor de seguridad */
  limiteSeguroKw: number;
  /** Suma de todas las cargas activas conectadas (kW) */
  cargaInstaladaKw: number;
  /** kW aún disponibles respetando el factor de seguridad */
  disponibleKw: number;
  /** % de uso sobre el límite seguro (100% = tope recomendado) */
  pctUso: number;
  /** verde | ambar | rojo según margen restante */
  semaforo: "verde" | "ambar" | "rojo";
}

export function resumenSubestacion(
  s: Pick<Subestacion, "capacidadKva" | "factorPotencia" | "factorSeguridad">,
  cargas: Pick<CargaElectrica, "potenciaKw" | "amperaje" | "voltajeCarga" | "fases">[],
): ResumenSubestacion {
  const capacidadKw = s.capacidadKva * s.factorPotencia;
  const limiteSeguroKw = capacidadKw * s.factorSeguridad;
  const cargaInstaladaKw = cargas.reduce((sum, c) => sum + kwDeCarga(c), 0);
  const disponibleKw = Math.max(0, limiteSeguroKw - cargaInstaladaKw);
  const pctUso = limiteSeguroKw > 0 ? (cargaInstaladaKw / limiteSeguroKw) * 100 : 0;
  const semaforo: ResumenSubestacion["semaforo"] =
    pctUso >= 100 ? "rojo" : pctUso >= 80 ? "ambar" : "verde";
  return { capacidadKw, limiteSeguroKw, cargaInstaladaKw, disponibleKw, pctUso, semaforo };
}

export const fmtKw = (n: number) =>
  n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
