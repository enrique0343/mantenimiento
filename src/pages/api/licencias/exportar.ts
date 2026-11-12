// CSV de licencias y permisos con los mismos filtros que la lista (Fase 59 · WP-D).
import type { APIRoute } from "astro";
import { getDb } from "@/lib/db";
import { toCsv, csvResponse } from "@/lib/csv";
import { ROLES_BIO_VER, hoySV } from "@/lib/biomedico";
import { COLUMNAS_CSV_LICENCIAS, filaCsvLicencia, filtrarLicencias, leerFiltrosLicencia } from "@/lib/licencias";
import { listarLicencias } from "@/lib/bio-consultas";
import { exigirRol } from "@/lib/bio-archivos";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_VER);
  if (!user) return response;
  const hoy = hoySV();
  const filtros = leerFiltrosLicencia(new URL(ctx.request.url).searchParams);
  const filas = filtrarLicencias(await listarLicencias(getDb(ctx)), filtros, hoy).map((l) => filaCsvLicencia(l, hoy));
  return csvResponse(`licencias_${hoy.replaceAll("-", "")}.csv`, toCsv(filas, [...COLUMNAS_CSV_LICENCIAS]));
};
