// CSV de expedientes técnicos de los equipos biomédicos, con los filtros de la lista.
// Con detalle=documentos: una fila por documento. Fase 59 · WP-D.
import type { APIRoute } from "astro";
import { getDb } from "@/lib/db";
import { toCsv, csvResponse } from "@/lib/csv";
import { ESTADO_ACTIVO_LABEL, ROLES_BIO_VER, diaSV, hoySV } from "@/lib/biomedico";
import { SUBCAT_KEYS, subcatLabel } from "@/lib/rubros";
import {
  COLUMNAS_CSV_DOCUMENTOS, COLUMNAS_CSV_EXPEDIENTES, CRITICIDAD_LABEL, filaCsvDocumento, filaCsvExpediente, filtrarExpedientes,
  leerFiltrosExpediente,
} from "@/lib/inventario-jci";
import { documentosBiomedicos, expedientesBiomedicos } from "@/lib/bio-consultas";
import { exigirRol } from "@/lib/bio-archivos";

export const prerender = false;

const etiquetas = {
  estado: (e: string) => ESTADO_ACTIVO_LABEL[e as keyof typeof ESTADO_ACTIVO_LABEL] ?? e,
  subcategoria: (s: string | null) => subcatLabel(s),
  criticidad: (c: string | null) => (c ? CRITICIDAD_LABEL[c as keyof typeof CRITICIDAD_LABEL] ?? c : "Sin definir"),
};

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_VER);
  if (!user) return response;
  const hoy = hoySV();
  const params = new URL(ctx.request.url).searchParams;
  const filtros = leerFiltrosExpediente(params, SUBCAT_KEYS);
  const db = getDb(ctx);
  const filas = filtrarExpedientes(await expedientesBiomedicos(db, { hoy, incluirBajas: filtros.bajas }), filtros);
  const sufijo = hoy.replaceAll("-", "");
  if (params.get("detalle") === "documentos") {
    const ids = new Set(filas.map((f) => f.activoId));
    const docs = (await documentosBiomedicos(db, { incluirBajas: filtros.bajas })).filter((d) => ids.has(d.activoId));
    const csv = toCsv(docs.map((d) => filaCsvDocumento({ ...d, subidoEl: diaSV(d.createdAt) }, hoy)), [...COLUMNAS_CSV_DOCUMENTOS]);
    return csvResponse(`expedientes_documentos_${sufijo}.csv`, csv);
  }
  return csvResponse(`expedientes_${sufijo}.csv`, toCsv(filas.map((f) => filaCsvExpediente(f, etiquetas)), [...COLUMNAS_CSV_EXPEDIENTES]));
};
