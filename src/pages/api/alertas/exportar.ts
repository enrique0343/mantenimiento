import type { APIRoute } from "astro";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { toCsv, csvResponse } from "@/lib/csv";
import {
  APLICABILIDAD_LABEL, ESTADO_ALERTA_LABEL, FUENTE_ALERTA_LABEL, ROLES_BIO_VER, TIPO_ALERTA_LABEL, diaSV, hoySV,
} from "@/lib/biomedico";
import { folioAlerta, leerFiltrosAlertas, pasaFiltrosAlertas } from "@/lib/alertas";
import { cargarListaAlertas, mapaUsuarios } from "@/lib/alertas-datos";

export const prerender = false;

const COLUMNAS = [
  { key: "folio", label: "N.º" },
  { key: "tipo", label: "Tipo" },
  { key: "fuente", label: "Fuente" },
  { key: "titulo", label: "Título" },
  { key: "referencia", label: "Referencia" },
  { key: "emision", label: "Fecha de emisión" },
  { key: "registro", label: "Registró" },
  { key: "fechaRegistro", label: "Fecha de registro" },
  { key: "aplicabilidad", label: "Aplicabilidad" },
  { key: "evaluo", label: "Evaluó" },
  { key: "fechaEvaluacion", label: "Fecha de evaluación" },
  { key: "analisis", label: "Análisis" },
  { key: "equipos", label: "Equipos afectados" },
  { key: "nEquipos", label: "N.º de equipos" },
  { key: "estado", label: "Estado" },
  { key: "accion", label: "Acción tomada" },
  { key: "fechaCierre", label: "Fecha de cierre" },
  { key: "cerro", label: "Cerró" },
  { key: "reabierta", label: "Veces reabierta" },
  { key: "archivos", label: "Archivos" },
];

/** Registro de alertas con los mismos filtros que la lista. Fechas AAAA-MM-DD. */
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ROLES_BIO_VER);
  if (!user) return response;
  const db = getDb(ctx);
  const filtros = leerFiltrosAlertas(ctx.url.searchParams);
  const [{ alertas, equipos, archivos }, nombres] = await Promise.all([cargarListaAlertas(db), mapaUsuarios(db)]);
  const nombre = (id: number | null) => (id ? nombres.get(id) ?? "" : "");
  const filas = alertas.filter((a) => pasaFiltrosAlertas(a, filtros)).map((a) => {
    const eqs = equipos.get(a.id) ?? [];
    return {
      folio: folioAlerta(a.id),
      tipo: TIPO_ALERTA_LABEL[a.tipo] ?? a.tipo,
      fuente: FUENTE_ALERTA_LABEL[a.fuente] ?? a.fuente,
      titulo: a.titulo,
      referencia: a.referencia ?? "",
      emision: a.fechaAlerta,
      registro: nombre(a.creadoPor),
      fechaRegistro: diaSV(a.createdAt) ?? "",
      aplicabilidad: APLICABILIDAD_LABEL[a.aplicabilidad] ?? a.aplicabilidad,
      evaluo: nombre(a.aplicabilidadPor),
      fechaEvaluacion: a.aplicabilidadFecha ?? "",
      analisis: a.aplicabilidadAnalisis ?? "",
      equipos: eqs.map((e) => e.codigo).join("; "),
      nEquipos: eqs.length,
      estado: ESTADO_ALERTA_LABEL[a.estado] ?? a.estado,
      accion: a.accionTomada ?? "",
      fechaCierre: a.estado === "cerrada" ? (a.fechaCierre ?? diaSV(a.cerradaEn) ?? "") : "",
      cerro: a.estado === "cerrada" ? nombre(a.cerradaPor) : "",
      reabierta: a.vecesReabierta ?? 0,
      archivos: archivos.get(a.id) ?? 0,
    };
  });
  return csvResponse(`alertas_${hoySV().replace(/-/g, "")}.csv`, toCsv(filas, COLUMNAS));
};
