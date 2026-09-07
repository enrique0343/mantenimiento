// Helpers del módulo Actividades recurrentes.
import { eq } from "drizzle-orm";
import { actividadCategorias, ubicaciones, sucursales } from "@/lib/schema";
import type { getDb } from "@/lib/db";
import { parseArea } from "@/lib/areas";

export const areaDeActividad = (rubro?: string | null, categoriaRubro?: string | null) =>
  parseArea(rubro) ?? parseArea(categoriaRubro);

// Una rutina por ubicación conserva su propia área aunque no tenga categoría.
export async function validarContextoActividad(
  db: ReturnType<typeof getDb>,
  data: { rubro?: string | null; categoriaId?: number | null; ubicacionId?: number | null; sucursalId?: number | null },
) {
  const rubro = parseArea(data.rubro);
  if (!rubro) return { error: "Selecciona el área de mantenimiento." };
  if (data.categoriaId) {
    const [categoria] = await db.select().from(actividadCategorias).where(eq(actividadCategorias.id, data.categoriaId)).limit(1);
    if (!categoria?.activo) return { error: "La categoría no está disponible." };
    if (categoria.rubro && categoria.rubro !== rubro) return { error: "La categoría corresponde a otra área." };
  }
  let sucursalId = data.sucursalId ?? null;
  if (data.ubicacionId) {
    const [ubicacion] = await db.select().from(ubicaciones).where(eq(ubicaciones.id, data.ubicacionId)).limit(1);
    if (!ubicacion?.activa) return { error: "La ubicación no está disponible." };
    if (sucursalId && ubicacion.sucursalId !== sucursalId) return { error: "La ubicación no pertenece a la sucursal seleccionada." };
    sucursalId = ubicacion.sucursalId;
  }
  if (sucursalId) {
    const [sucursal] = await db.select().from(sucursales).where(eq(sucursales.id, sucursalId)).limit(1);
    if (!sucursal?.activa) return { error: "La sucursal no está disponible." };
  }
  return { rubro, sucursalId };
}

export function puedeVerActividades(rol: string): boolean {
  return rol !== "motorista" && rol !== "proveedor";
}

export function puedeAdministrarActividades(rol: string): boolean {
  return rol === "admin" || rol === "jefe" || rol === "tecnico";
}

export function diasParaFecha(fecha: string | null | undefined): number | null {
  if (!fecha) return null;
  return Math.ceil((new Date(fecha + "T00:00:00").getTime() - Date.now()) / 86400_000);
}

export type EstadoFecha = "ok" | "proximo" | "vencido";

export function estadoFecha(fecha: string | null | undefined, alertaDiasAntes = 7): EstadoFecha {
  const d = diasParaFecha(fecha);
  if (d == null) return "ok";
  if (d < 0) return "vencido";
  if (d <= alertaDiasAntes) return "proximo";
  return "ok";
}

export const ESTADO_FECHA_COLOR: Record<EstadoFecha, string> = {
  ok: "text-emerald-600",
  proximo: "text-amber-600",
  vencido: "text-red-600 font-bold",
};

export const FRECUENCIA_LABEL: Record<string, string> = {
  diaria: "Diaria",
  semanal: "Semanal",
  quincenal: "Quincenal",
  mensual: "Mensual",
  bimestral: "Bimestral",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
};
