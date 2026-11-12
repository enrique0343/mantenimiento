// CSV de capacitaciones: una fila por sesión o, con detalle=asistentes, una por persona.
// Mismos filtros que la lista (Fase 59 · WP-D).
import type { APIRoute } from "astro";
import { getDb } from "@/lib/db";
import { toCsv, csvResponse } from "@/lib/csv";
import { ROLES_BIO_VER, hoySV } from "@/lib/biomedico";
import {
  COLUMNAS_CSV_ASISTENTES, COLUMNAS_CSV_CAPACITACIONES, filaCsvCapacitacion, filasCsvAsistentes, filtrarCapacitaciones,
  leerFiltrosCapacitacion,
} from "@/lib/capacitaciones";
import { listarCapacitaciones } from "@/lib/bio-consultas";
import { exigirRol } from "@/lib/bio-archivos";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_VER);
  if (!user) return response;
  const hoy = hoySV();
  const params = new URL(ctx.request.url).searchParams;
  const filtros = leerFiltrosCapacitacion(params, hoy);
  const filas = filtrarCapacitaciones(await listarCapacitaciones(getDb(ctx), filtros), filtros);
  const sufijo = hoy.replaceAll("-", "");
  if (params.get("detalle") === "asistentes") {
    return csvResponse(`capacitaciones_asistentes_${sufijo}.csv`, toCsv(filas.flatMap(filasCsvAsistentes), [...COLUMNAS_CSV_ASISTENTES]));
  }
  return csvResponse(`capacitaciones_${sufijo}.csv`, toCsv(filas.map((c) => filaCsvCapacitacion(c, hoy)), [...COLUMNAS_CSV_CAPACITACIONES]));
};
