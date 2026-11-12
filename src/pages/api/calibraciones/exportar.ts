// CSV de Calibraciones (K-B5), con los mismos filtros y la misma regla que la pantalla.
// vista=equipos (estado por equipo) · registros (historial; desde/hasta opcionales) ·
// patrones · laboratorios. Fechas AAAA-MM-DD; Sí/No.
import type { APIRoute } from "astro";
import { getDb } from "@/lib/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { ROLES_BIO_VER, esFechaISO, hoySV } from "@/lib/biomedico";
import {
  COLUMNAS_CSV_EQUIPOS, COLUMNAS_CSV_LABS, COLUMNAS_CSV_PATRONES, COLUMNAS_CSV_REGISTROS,
  filaCsvEquipo, filaCsvLab, filaCsvPatron, filaCsvRegistro, leerFiltrosCal, ordenarFilasCal, pasaFiltrosCal,
} from "@/lib/metrologia";
import { cargarFilasCal, cargarLaboratorios, cargarRegistrosCal, errorJson, exigirRol, listarPatrones } from "@/lib/metrologia-db";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_VER);
  if (!user) return response;
  const q = ctx.url.searchParams;
  const vista = q.get("vista") ?? "";
  const hoy = hoySV();
  const sufijo = hoy.replaceAll("-", "");
  const db = getDb(ctx);

  if (vista === "equipos" || vista === "registros") {
    const filtros = leerFiltrosCal(q);
    const filas = ordenarFilasCal((await cargarFilasCal(db, { hoy })).filter((f) => pasaFiltrosCal(f, filtros)));
    if (vista === "equipos") return csvResponse(`calibraciones_equipos_${sufijo}.csv`, toCsv(filas.map(filaCsvEquipo), COLUMNAS_CSV_EQUIPOS));
    const desde = (q.get("desde") ?? "").trim() || null;
    const hasta = (q.get("hasta") ?? "").trim() || null;
    if ((desde && !esFechaISO(desde)) || (hasta && !esFechaISO(hasta))) return errorJson("Fecha no válida.", 400);
    const registros = await cargarRegistrosCal(db, { desde, hasta, activoIds: new Set(filas.map((f) => f.activoId)) });
    return csvResponse(`calibraciones_registros_${sufijo}.csv`, toCsv(registros.map(filaCsvRegistro), COLUMNAS_CSV_REGISTROS));
  }
  if (vista === "patrones") {
    const patrones = await listarPatrones(db, hoy);
    return csvResponse(`equipos_patron_${sufijo}.csv`, toCsv(patrones.map(filaCsvPatron), COLUMNAS_CSV_PATRONES));
  }
  if (vista === "laboratorios") {
    const labs = await cargarLaboratorios(db, hoy);
    return csvResponse(`laboratorios_calibracion_${sufijo}.csv`, toCsv(labs.map(filaCsvLab), COLUMNAS_CSV_LABS));
  }
  return errorJson("Vista no válida.", 400);
};
