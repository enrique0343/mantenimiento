// Audit log helpers: registra cambios en entidades importantes para trazabilidad.
import type { APIContext } from "astro";
import { getDb } from "./db";
import { auditLog } from "./schema";

export type Accion = "create" | "update" | "delete" | "estado" | "asignacion";
export type Entidad = "activo" | "plan" | "orden" | "extintor" | "actividad" | "vehiculo" | "proyecto" | "contrato";

export interface DiffEntry {
  antes: unknown;
  despues: unknown;
}

// Genera un diff de los campos que cambiaron entre dos objetos.
// Solo considera campos en el segundo objeto (los actualizables).
export function calcularDiff(
  antes: Record<string, unknown>,
  despues: Record<string, unknown>,
  campos?: string[]
): Record<string, DiffEntry> {
  const diff: Record<string, DiffEntry> = {};
  const keys = campos ?? Object.keys(despues);
  for (const k of keys) {
    if (despues[k] === undefined) continue; // si no se mandó, no se cambió
    const a = antes[k] ?? null;
    const b = despues[k] ?? null;
    // Comparación simple para tipos primitivos
    if (a !== b) diff[k] = { antes: a, despues: b };
  }
  return diff;
}

// Etiquetas legibles para campos comunes
const CAMPO_LABEL: Record<string, string> = {
  codigo: "Código",
  nombre: "Nombre",
  descripcion: "Descripción",
  ubicacion: "Ubicación",
  ubicacionId: "Ubicación",
  estado: "Estado",
  marca: "Marca",
  modelo: "Modelo",
  serial: "Serie",
  anio: "Año",
  categoria: "Categoría",
  tipo: "Tipo",
  proveedorId: "Proveedor",
  // Plan
  titulo: "Título",
  frecuencia: "Frecuencia",
  proximaFecha: "Próxima fecha",
  alertaDiasAntes: "Alerta días antes",
  prioridad: "Prioridad",
  asignadoA: "Técnico asignado",
  horasEstimadas: "Horas estimadas",
  activo: "Activo",
  // Orden
  vencimiento: "Vencimiento",
  trabajosRealizados: "Trabajos realizados",
};

export function labelCampo(campo: string): string {
  return CAMPO_LABEL[campo] ?? campo;
}

// Genera resumen legible del cambio
export function resumenCambios(diff: Record<string, DiffEntry>): string {
  const partes = Object.keys(diff).map((k) => labelCampo(k));
  if (partes.length === 0) return "Sin cambios";
  if (partes.length === 1) return `Modificó ${partes[0]}`;
  if (partes.length <= 3) return `Modificó ${partes.join(", ")}`;
  return `Modificó ${partes.slice(0, 3).join(", ")} y ${partes.length - 3} más`;
}

// Registra un evento en audit_log (best-effort: si falla, no rompe la operación)
export async function logAudit(
  ctx: APIContext,
  args: {
    entidad: Entidad;
    entidadId: number;
    accion: Accion;
    cambios?: Record<string, DiffEntry>;
    resumen?: string;
  }
): Promise<void> {
  try {
    const user = ctx.locals.user;
    const db = getDb(ctx);
    const cambiosJson = args.cambios && Object.keys(args.cambios).length > 0
      ? JSON.stringify(args.cambios)
      : null;
    const resumen = args.resumen ?? (args.cambios ? resumenCambios(args.cambios) : null);
    await db.insert(auditLog).values({
      entidad: args.entidad,
      entidadId: args.entidadId,
      accion: args.accion,
      usuarioId: user?.id ?? null,
      cambios: cambiosJson,
      resumen,
    });
  } catch {
    // No bloqueamos la operación principal si falla el log
  }
}
