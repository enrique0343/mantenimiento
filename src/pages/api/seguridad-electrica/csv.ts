// CSV de seguridad eléctrica, con los mismos filtros que la pantalla.
//   ?alcance=clase3|biomedicos&estado=&sucursal=  → un renglón por equipo (tablero)
//   ?activoId=ID                                 → todas las pruebas de un equipo
// Fechas AAAA-MM-DD (Excel las reconoce en cualquier idioma); Sí/No en los booleanos.
import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { activos } from "@/lib/schema";
import { csvResponse, toCsv } from "@/lib/csv";
import {
  CLASE_PROTECCION_LABEL, ESTADO_ACTIVO_LABEL, ESTADO_SEG_ELEC_LABEL, METODO_FUGA_LABEL, PARTE_APLICADA_LABEL,
  RESULTADO_SE_LABEL, ROLES_BIO_VER, TIPO_PRUEBA_ELECTRICA_LABEL, diaSV, etiquetaClaseRiesgo, horaSV, hoySV, nombreSeguroR2,
  type ClaseProteccion, type EstadoActivo, type EstadoSeguridadElectrica, type MetodoFuga, type ParteAplicada,
  type ResultadoPruebaElectrica, type TipoPruebaElectrica,
} from "@/lib/biomedico";
import { errorJson, exigirRol, idPositivo, leerAlcance, pruebasDeActivo, tableroSeguridadElectrica } from "@/lib/seguridad-electrica";

export const prerender = false;

const siNo = (v: boolean) => (v ? "Sí" : "No");
const conformidad = (v: string) => (v === "conforme" ? "Conforme" : v === "no_conforme" ? "No conforme" : v);
const ESTADOS: readonly EstadoSeguridadElectrica[] = ["vigente", "por_vencer", "vencida", "no_pasa", "sin_prueba"];

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ROLES_BIO_VER);
  if (!user) return response;
  const url = new URL(ctx.request.url);
  const db = getDb(ctx);
  const sello = hoySV().replace(/-/g, "");

  // ── Pruebas de un equipo ──
  if (url.searchParams.has("activoId")) {
    const activoId = idPositivo(url.searchParams.get("activoId"));
    const [equipo] = activoId ? await db.select({ id: activos.id, codigo: activos.codigo }).from(activos).where(eq(activos.id, activoId)).limit(1) : [];
    if (!equipo) return errorJson(404, "Equipo no encontrado");
    const pruebas = await pruebasDeActivo(db, equipo.id);
    const filas = pruebas.map((p) => ({
      fecha: p.fecha,
      tipo: TIPO_PRUEBA_ELECTRICA_LABEL[p.tipo as TipoPruebaElectrica] ?? p.tipo,
      orden: p.ordenEtiqueta ?? "",
      clase: CLASE_PROTECCION_LABEL[p.claseProteccion as ClaseProteccion] ?? p.claseProteccion,
      parte: PARTE_APLICADA_LABEL[p.parteAplicada as ParteAplicada] ?? p.parteAplicada,
      metodo: METODO_FUGA_LABEL[p.metodoFuga as MetodoFuga] ?? p.metodoFuga,
      visual: conformidad(p.inspeccionVisual),
      tierra: p.tierraOhm, limTierra: p.limiteTierraOhm,
      aislamiento: p.aislamientoMohm, limAislamiento: p.limiteAislamientoMohm,
      fugaEquipo: p.fugaEquipoUa, limFugaEquipo: p.limiteFugaEquipoUa,
      fugaParte: p.fugaParteUa, limFugaParte: p.limiteFugaParteUa,
      funcional: conformidad(p.pruebaFuncional),
      calculado: RESULTADO_SE_LABEL[p.resultadoCalculado as ResultadoPruebaElectrica] ?? p.resultadoCalculado,
      resultado: RESULTADO_SE_LABEL[p.resultado as ResultadoPruebaElectrica] ?? p.resultado,
      motivo: p.motivoResultado ?? "",
      analizador: p.analizadorDescripcion,
      serie: p.analizadorSerie,
      calVence: p.analizadorCalVence,
      realizo: p.realizadoPor,
      empresa: p.empresaExterna ?? "",
      registro: p.registradoPorNombre ?? "",
      registradoEl: diaSV(p.createdAt) ?? "",
      horaRegistro: horaSV(p.createdAt),
      proxima: p.proximaFecha,
      informe: siNo(!!p.informeR2Key),
      estado: p.estado === "anulada" ? "Anulada" : "Válida",
      anuladaEl: diaSV(p.anuladaEn) ?? "",
      motivoAnulacion: p.motivoAnulacion ?? "",
      notas: p.notas ?? "",
    }));
    const csv = toCsv(filas, [
      { key: "fecha", label: "Fecha" }, { key: "tipo", label: "Tipo" }, { key: "orden", label: "Orden" },
      { key: "clase", label: "Clase de protección" }, { key: "parte", label: "Parte aplicada" }, { key: "metodo", label: "Método" },
      { key: "visual", label: "Inspección visual" },
      { key: "tierra", label: "Tierra (Ω)" }, { key: "limTierra", label: "Límite tierra" },
      { key: "aislamiento", label: "Aislamiento (MΩ)" }, { key: "limAislamiento", label: "Límite aislamiento" },
      { key: "fugaEquipo", label: "Fuga equipo (µA)" }, { key: "limFugaEquipo", label: "Límite fuga equipo" },
      { key: "fugaParte", label: "Fuga parte aplicada (µA)" }, { key: "limFugaParte", label: "Límite fuga parte" },
      { key: "funcional", label: "Prueba funcional" }, { key: "calculado", label: "Resultado calculado" },
      { key: "resultado", label: "Resultado" }, { key: "motivo", label: "Motivo" },
      { key: "analizador", label: "Analizador" }, { key: "serie", label: "Serie" }, { key: "calVence", label: "Calibración vence" },
      { key: "realizo", label: "Realizó" }, { key: "empresa", label: "Empresa" }, { key: "registro", label: "Registró" },
      { key: "registradoEl", label: "Registrado el" }, { key: "horaRegistro", label: "Hora de registro" },
      { key: "proxima", label: "Próxima" }, { key: "informe", label: "Informe" },
      { key: "estado", label: "Registro (Válida/Anulada)" }, { key: "anuladaEl", label: "Anulada el" },
      { key: "motivoAnulacion", label: "Motivo de anulación" }, { key: "notas", label: "Notas" },
    ]);
    return csvResponse(`seguridad-electrica-${nombreSeguroR2(equipo.codigo, 40)}_${sello}.csv`, csv);
  }

  // ── Tablero ──
  const alcance = leerAlcance(url.searchParams.get("alcance"));
  const estadoFiltro = url.searchParams.get("estado");
  const estado = ESTADOS.includes(estadoFiltro as EstadoSeguridadElectrica) ? (estadoFiltro as EstadoSeguridadElectrica) : null;
  const sucursalId = idPositivo(url.searchParams.get("sucursal"));
  const tablero = await tableroSeguridadElectrica(db, { alcance, sucursalId });
  const filas = tablero.filas
    .filter((f) => !estado || f.estado === estado)
    .map((f) => ({
      codigo: f.codigo,
      equipo: f.nombre,
      marca: f.marca ?? "",
      modelo: f.modelo ?? "",
      serie: f.serial ?? "",
      numeroActivo: f.numeroActivo ?? "",
      sede: f.sucursal ?? "",
      ubicacion: f.ubicacion ?? "",
      claseRiesgo: f.claseRiesgo ? etiquetaClaseRiesgo(f.claseRiesgo) : "Sin clasificar",
      estadoEquipo: ESTADO_ACTIVO_LABEL[f.estadoEquipo as EstadoActivo] ?? f.estadoEquipo,
      claseProteccion: f.ultima ? CLASE_PROTECCION_LABEL[f.ultima.claseProteccion] : "",
      parteAplicada: f.ultima ? PARTE_APLICADA_LABEL[f.ultima.parteAplicada] : "",
      ultima: f.ultima?.fecha ?? "",
      tipo: f.ultima ? TIPO_PRUEBA_ELECTRICA_LABEL[f.ultima.tipo] : "",
      resultado: f.ultima ? RESULTADO_SE_LABEL[f.ultima.resultado] : "",
      analizador: f.ultima?.analizadorDescripcion ?? "",
      serieAnalizador: f.ultima?.analizadorSerie ?? "",
      calAnalizador: f.ultima?.analizadorCalVence ?? "",
      realizo: f.ultima?.realizadoPor ?? "",
      proxima: f.ultima?.proximaFecha ?? "",
      estado: ESTADO_SEG_ELEC_LABEL[f.estado],
      informe: f.ultima ? siNo(f.ultima.tieneInforme) : "",
    }));
  const csv = toCsv(filas, [
    { key: "codigo", label: "Código" }, { key: "equipo", label: "Equipo" }, { key: "marca", label: "Marca" },
    { key: "modelo", label: "Modelo" }, { key: "serie", label: "Serie" }, { key: "numeroActivo", label: "Nº de activo" },
    { key: "sede", label: "Sede" }, { key: "ubicacion", label: "Ubicación" }, { key: "claseRiesgo", label: "Clase de riesgo" },
    { key: "estadoEquipo", label: "Estado del equipo" }, { key: "claseProteccion", label: "Clase de protección" },
    { key: "parteAplicada", label: "Parte aplicada" }, { key: "ultima", label: "Última prueba" }, { key: "tipo", label: "Tipo de prueba" },
    { key: "resultado", label: "Resultado" }, { key: "analizador", label: "Analizador" }, { key: "serieAnalizador", label: "Serie del analizador" },
    { key: "calAnalizador", label: "Calibración del analizador vence" }, { key: "realizo", label: "Realizó" },
    { key: "proxima", label: "Próxima prueba" }, { key: "estado", label: "Estado de la prueba" }, { key: "informe", label: "Informe adjunto" },
  ]);
  return csvResponse(`seguridad-electrica-${alcance}_${sello}.csv`, csv);
};
