import { z } from "zod";
import type { RubroKey } from "./rubros";

const textoTecnico = z.string().trim().max(200).nullable().optional();
const camposTecnicos = z.object({
  tipoUnidad: textoTecnico,
  capacidadBtuH: z.number().finite().positive().max(10000000).nullable().optional(),
  refrigerante: textoTecnico,
  tipoInstalacion: textoTecnico,
  sector: textoTecnico,
  servicio: textoTecnico,
}).strict();

// Acepta objetos desde formularios/API y JSON desde almacenamiento/importaciones.
const parsearDatosTecnicos = (value: unknown) => {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
};
export const datosTecnicosSchema = z.preprocess(parsearDatosTecnicos, camposTecnicos.nullable().optional());

// Validate the final stored length after Unicode uppercasing. Reading legacy
// data continues to use its original schema and never rewrites prior values.
const textoTecnicoRegistro = z.string().trim().toUpperCase().max(200).nullable().optional();
export const datosTecnicosRegistroSchema = z.preprocess(parsearDatosTecnicos, camposTecnicos.extend({
  tipoUnidad: textoTecnicoRegistro, refrigerante: textoTecnicoRegistro,
  tipoInstalacion: textoTecnicoRegistro, sector: textoTecnicoRegistro, servicio: textoTecnicoRegistro,
}).nullable().optional());

export type DatosTecnicos = z.infer<typeof camposTecnicos>;
const camposPorArea: Record<RubroKey, (keyof DatosTecnicos)[]> = {
  aires: ["tipoUnidad", "capacidadBtuH", "refrigerante"],
  infraestructura: ["tipoInstalacion", "sector"],
  equipo_general: ["servicio"],
  biomedico: ["servicio"],
};

export function leerDatosTecnicos(value: unknown): DatosTecnicos {
  const result = datosTecnicosSchema.safeParse(value);
  return result.success && result.data ? result.data : {};
}

export function datosTecnicosValidosParaArea(area: RubroKey, datos: DatosTecnicos | null | undefined): boolean {
  return !datos || Object.entries(datos).every(([key, value]) => value == null || value === "" || camposPorArea[area].includes(key as keyof DatosTecnicos));
}

export function serializarDatosTecnicos(area: RubroKey, datos: DatosTecnicos | null | undefined): string | null {
  const entries = Object.entries(datos ?? {}).filter(([key, value]) => camposPorArea[area].includes(key as keyof DatosTecnicos) && value != null && value !== "");
  return entries.length ? JSON.stringify(Object.fromEntries(entries.map(([key, value]) => [key, typeof value === "string" ? value.trim().toUpperCase() : value]))) : null;
}
