import { sql } from "drizzle-orm";
import { activos } from "./schema";

export const AREA_KEYS = ["aires", "infraestructura", "equipo_general", "biomedico"] as const;
export type AreaKey = (typeof AREA_KEYS)[number];
export const AREAS = {
  aires: { label: "Aire acondicionado", description: "Unidades, climatización y sus servicios de mantenimiento.", inventoryLabel: "Unidades", createLabel: "Registrar unidad", icon: "wind" },
  infraestructura: { label: "Infraestructura", description: "Edificios, techos, redes eléctricas e instalaciones.", inventoryLabel: "Instalaciones", createLabel: "Registrar instalación", icon: "building" },
  equipo_general: { label: "Equipos generales", description: "Equipos de apoyo, bombas, generadores e impresoras.", inventoryLabel: "Equipos", createLabel: "Registrar equipo", icon: "equipment" },
  biomedico: { label: "Equipos biomédicos", description: "Equipos clínicos, verificaciones y calibraciones.", inventoryLabel: "Equipos", createLabel: "Registrar equipo", icon: "heart" },
} as const;

export function parseArea(value: string | null | undefined): AreaKey | null {
  return AREA_KEYS.includes(value as AreaKey) ? value as AreaKey : null;
}

export function areaHref(path: string, area: string | null | undefined): string {
  const url = new URL(path, "https://mantenimiento.local");
  const key = parseArea(area);
  if (key) url.searchParams.set("area", key);
  else url.searchParams.delete("area");
  return url.pathname + url.search + url.hash;
}

/** The same fallback as rubroDeActivo, including unclassified legacy records. */
export const activoAreaExpression = sql<string>`CASE WHEN ${activos.rubro} IN ('aires','infraestructura','equipo_general','biomedico') THEN ${activos.rubro} WHEN ${activos.tipo} = 'biomedico' THEN 'biomedico' ELSE 'equipo_general' END`;
export const activoAreaCondition = (area: AreaKey) => sql`${activoAreaExpression} = ${area}`;
