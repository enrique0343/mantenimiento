import type { APIRoute } from "astro";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { toCsv, csvResponse } from "@/lib/csv";
import { hoySV } from "@/lib/biomedico";
import { cargarDatosCumplimiento } from "@/lib/cumplimiento-bio";
import { armarCumplimiento } from "@/lib/cumplimiento-reglas";

export const prerender = false;

const COLUMNAS = [
  { key: "indicador", label: "Indicador" },
  { key: "situacion", label: "Situación" },
  { key: "codigo", label: "Código" },
  { key: "nombre", label: "Equipo / registro" },
  { key: "sede", label: "Sede" },
  { key: "ubicacion", label: "Ubicación" },
  { key: "detalle", label: "Detalle" },
  { key: "fecha", label: "Fecha" },
];

/** K-E3: todo el detalle del panel de cumplimiento (admin, jefe y visualizador). Fechas AAAA-MM-DD. */
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "visualizador"]);
  if (!user) return response;
  const hoy = hoySV();
  const { indicadores, hallazgos } = armarCumplimiento(await cargarDatosCumplimiento(getDb(ctx), hoy));
  const titulo = new Map(indicadores.map((i) => [i.clave, i.titulo]));
  const filas = hallazgos.map((h) => ({
    indicador: titulo.get(h.indicador) ?? h.indicador,
    situacion: h.nivel === "falla" ? "Falla" : "Aviso",
    codigo: h.codigo,
    nombre: h.nombre,
    sede: h.sede ?? "",
    ubicacion: h.ubicacion ?? "",
    detalle: h.detalle,
    fecha: h.fecha ?? "",
  }));
  return csvResponse(`cumplimiento_biomedico_${hoy.replace(/-/g, "")}.csv`, toCsv(filas, COLUMNAS));
};
