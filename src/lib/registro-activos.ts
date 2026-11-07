import { z } from "zod";
import type { RubroKey } from "./rubros";

// Only descriptive fields use this schema; enums, URLs and credentials retain
// their original representation.
export const textoRegistro = z.string().trim().toUpperCase().nullable().optional();

const prefijos: Record<RubroKey, string> = {
  biomedico: "BIO", equipo_general: "EQ", aires: "AC", infraestructura: "INF",
};

export function generarCodigoActivo(area: RubroKey): string {
  // No shared counters or MAX+1 reads: concurrent requests can allocate codes
  // independently. The database unique constraint is the final guard.
  return `${prefijos[area]}-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}

export function nombrePendienteActivo(area: RubroKey): string {
  const tipo = area === "aires" ? "UNIDAD DE AIRE" : area === "infraestructura" ? "INSTALACIÓN" : area === "biomedico" ? "EQUIPO BIOMÉDICO" : "EQUIPO";
  return `${tipo} PENDIENTE DE IDENTIFICAR`;
}

export function esCodigoDuplicado(error: unknown): boolean {
  // Drizzle wraps D1's error in `cause`.
  for (let current: unknown = error, depth = 0; current && depth < 5; depth++) {
    if (/UNIQUE constraint failed: activos\.(codigo|qr_code)/i.test(String((current as Error).message ?? current))) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
