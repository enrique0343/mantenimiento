import type { APIRoute } from "astro";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { activos, planesMantenimiento, centrosCosto, sucursales, ubicaciones } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { desc, eq, sql } from "drizzle-orm";
import { siguienteFecha, type Frecuencia } from "@/lib/frecuencias";
import { activoAreaCondition, parseArea, AREA_KEYS } from "@/lib/areas";
import { rubroDeActivo, SUBCAT_KEYS, type SubcatKey } from "@/lib/rubros";
import { datosTecnicosRegistroSchema as datosTecnicosSchema, datosTecnicosValidosParaArea, serializarDatosTecnicos } from "@/lib/activo-area";
import {
  textoRegistro, generarCodigoActivo, nombrePendienteActivo, esCodigoDuplicado, errorCodigoActivo, mensajeCodigoDuplicado,
  errorDeDatos, errorCentroCostoEquipo, MENSAJE_SOLO_BIOMEDICOS, MENSAJE_CLASE_OBLIGATORIA,
} from "@/lib/registro-activos";
import { modeloAireParaAlta, snapshotModeloAire, errorCatalogoAire, respuestaErrorCatalogoAire } from "@/lib/catalogo-aires";
import { CLASES_RIESGO_VALORES, ESTADOS_ACTIVO, FRECUENCIAS_RUTINA_EQUIPO, esFechaISO, hoySV } from "@/lib/biomedico";
import { logAudit } from "@/lib/audit";
import { condicionActivoEspacio, espacioDeArea, espacioDeLista, puedeEntrar, respuestaOtroEspacio } from "@/lib/espacio";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const requestedArea = new URL(ctx.request.url).searchParams.get("area");
  const area = parseArea(requestedArea);
  if (requestedArea && !area) return Response.json({ error: "Área de mantenimiento inválida" }, { status: 400 });
  const { espacio, permitido } = espacioDeLista(ctx, user, area);
  if (!permitido) return respuestaOtroEspacio(espacio);
  const db = getDb(ctx);
  const rows = await db.select().from(activos).where(area ? activoAreaCondition(area) : condicionActivoEspacio(espacio)).orderBy(desc(activos.id));
  return Response.json({ activos: rows });
};

/** Fecha 'AAAA-MM-DD' real o vacía (null). */
const fechaOpcional = (mensaje: string) =>
  z.preprocess((v) => (v === "" ? null : v), z.string().refine((v) => esFechaISO(v), mensaje).nullable().optional());

// Fase 59: las fechas de calibración (ultimaCalibracion, proximaCalibracion), el
// equipo patrón y «no requiere calibración» ya no se reciben aquí: zod los
// descarta sin error. Solo los escribe Calibraciones (contrato K-A4).
const baseSchema = {
  codigo: textoRegistro,
  nombre: textoRegistro,
  descripcion: textoRegistro,
  ubicacion: textoRegistro,
  estado: z.enum(ESTADOS_ACTIVO).optional(),
  tipo: z.enum(["general", "biomedico"]).optional(),
  rubro: z.enum(AREA_KEYS).optional(),
  datosTecnicos: datosTecnicosSchema,
  categoria: textoRegistro,
  numeroActivo: textoRegistro,
  marca: textoRegistro,
  modelo: textoRegistro,
  serial: textoRegistro,
  anio: z.number().int().nullable().optional(),
  registroSanitario: textoRegistro,
  registroSanitarioEntidad: z.string().trim().toUpperCase().max(60).nullable().optional(),
  registroSanitarioEmision: fechaOpcional("La fecha de emisión del registro no es válida."),
  registroSanitarioVencimiento: fechaOpcional("La fecha de vencimiento del registro no es válida."),
  registroSanitarioNoRequiere: z.boolean().optional(),
  claseRiesgo: z.enum(CLASES_RIESGO_VALORES).nullable().optional(),
  subcategoria: z.enum(SUBCAT_KEYS as [SubcatKey, ...SubcatKey[]]).nullable().optional(),
  centroCostoId: z.number().int().positive().nullable().optional(),
  fechaAdquisicion: fechaOpcional("La fecha de adquisición no es válida."),
  vidaUtilAnios: z.number().int().nonnegative().nullable().optional(),
  valorAdquisicion: z.number().nonnegative().nullable().optional(),
  responsableId: z.number().int().nullable().optional(),
  criticidadOperacional: z.enum(["alta", "media", "baja"]).default("media"),
  requiereCalibracion: z.boolean().optional(),
  ubicacionId: z.number().int().nullable().optional(),
  proveedorId: z.number().int().nullable().optional(),
  slaUrgenteHoras: z.number().int().nonnegative().optional(),
  slaAltaHoras: z.number().int().nonnegative().optional(),
  slaMediaHoras: z.number().int().nonnegative().optional(),
  slaBajaHoras: z.number().int().nonnegative().optional(),
};

const createSchema = z.object({
  ...baseSchema,
  modeloAireId: z.number().int().positive().safe().optional(),
  modeloAireVersion: z.number().int().positive().safe().optional(),
  modeloAireSnapshot: z.never().optional(),
  // Configuración opcional de mantenimiento preventivo automático: las frecuencias
  // de rutina de equipo (con cuatrimestral, sin «Por turno»), como K-E1.
  mantenimientoFrecuencia: z.enum(FRECUENCIAS_RUTINA_EQUIPO).optional().nullable(),
  mantenimientoProximaFecha: fechaOpcional("La fecha del primer mantenimiento no es válida."),
  mantenimientoTitulo: textoRegistro,
  mantenimientoPrioridad: z.enum(["baja", "media", "alta", "urgente"]).optional(),
}).refine(value => (value.modeloAireId === undefined) === (value.modeloAireVersion === undefined),
  "Selecciona una ficha con su versión actual");

export const POST: APIRoute = async (ctx) => {
  // Fase 59: el jefe también registra equipos (D2).
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: errorDeDatos(parsed.error) }, { status: 400 });
  const db = getDb(ctx);
  const { mantenimientoFrecuencia, mantenimientoProximaFecha, mantenimientoTitulo, mantenimientoPrioridad,
    modeloAireId, modeloAireVersion, ...datosUnidad } = parsed.data;
  let activoData = datosUnidad;
  const rubro = rubroDeActivo(activoData.rubro, activoData.tipo);
  const tipo = rubro === "biomedico" ? "biomedico" : "general";
  if (activoData.tipo && activoData.tipo !== tipo) return Response.json({ error: "El tipo de equipo no corresponde al área seleccionada" }, { status: 400 });
  // Un equipo del otro espacio no lo registra quien no entra a ese espacio.
  if (!puedeEntrar(user, espacioDeArea(rubro))) return respuestaOtroEspacio(espacioDeArea(rubro));
  let modeloAireSnapshot: string | null = null;
  if (modeloAireId !== undefined && modeloAireVersion !== undefined) {
    if (rubro !== "aires") return Response.json({ error: "Las fichas del catálogo solo se pueden usar para aires acondicionados" }, { status: 400 });
    try {
      const ficha = await modeloAireParaAlta(ctx, modeloAireId, modeloAireVersion);
      modeloAireSnapshot = JSON.stringify(snapshotModeloAire(ficha));
      // Omitted shared data inherits the model; explicit values/null belong to this unit.
      const compartidos = { nombre: ficha.nombre, descripcion: ficha.descripcion, categoria: ficha.categoria,
        marca: ficha.marca, modelo: ficha.modelo };
      activoData = { ...compartidos, ...activoData,
        datosTecnicos: activoData.datosTecnicos === null ? null
          : { ...(ficha.datosTecnicos ?? {}), ...(activoData.datosTecnicos ?? {}) },
      };
    } catch (error) { return respuestaErrorCatalogoAire(error); }
  }
  if (!datosTecnicosValidosParaArea(rubro, activoData.datosTecnicos)) return Response.json({ error: "Los datos técnicos no corresponden al área seleccionada" }, { status: 400 });

  // ── Fase 59: estado, datos biomédicos, registro sanitario y centro de costo ──
  if (activoData.estado === "baja") return Response.json({ error: "Un equipo nuevo no se registra dado de baja." }, { status: 400 });
  const r = activoData;
  const traeRegistro = !!(r.registroSanitario || r.registroSanitarioEntidad || r.registroSanitarioEmision || r.registroSanitarioVencimiento || r.registroSanitarioNoRequiere);
  if (rubro !== "biomedico" && (r.claseRiesgo || r.subcategoria || traeRegistro)) {
    return Response.json({ error: MENSAJE_SOLO_BIOMEDICOS }, { status: 400 });
  }
  // Requisito 16: la clase de riesgo es obligatoria en biomédicos también por la API
  // (antes solo la exigían el formulario y la carga masiva).
  if (rubro === "biomedico" && !r.claseRiesgo) return Response.json({ error: MENSAJE_CLASE_OBLIGATORIA }, { status: 400 });
  if (r.registroSanitarioNoRequiere) {
    activoData = { ...activoData, registroSanitario: null, registroSanitarioEntidad: null, registroSanitarioEmision: null, registroSanitarioVencimiento: null };
  } else if (r.registroSanitarioEmision && r.registroSanitarioVencimiento && r.registroSanitarioVencimiento < r.registroSanitarioEmision) {
    return Response.json({ error: "El vencimiento del registro no puede ser anterior a su emisión." }, { status: 400 });
  }
  if (r.centroCostoId != null) {
    const [centro] = await db.select({ id: centrosCosto.id, codigo: centrosCosto.codigo, activo: centrosCosto.activo, sucursalId: centrosCosto.sucursalId, sedeNombre: sucursales.nombre })
      .from(centrosCosto).leftJoin(sucursales, eq(sucursales.id, centrosCosto.sucursalId)).where(eq(centrosCosto.id, r.centroCostoId)).limit(1);
    const [ubic] = r.ubicacionId != null
      ? await db.select({ sucursalId: ubicaciones.sucursalId, sedeNombre: sucursales.nombre })
        .from(ubicaciones).leftJoin(sucursales, eq(sucursales.id, ubicaciones.sucursalId)).where(eq(ubicaciones.id, r.ubicacionId)).limit(1)
      : [];
    const errorCentro = errorCentroCostoEquipo(centro, ubic, null);
    if (errorCentro) return Response.json({ error: errorCentro }, { status: 400 });
  }

  const automatico = !activoData.codigo;
  if (!automatico) {
    const errorCodigo = errorCodigoActivo(activoData.codigo!);
    if (errorCodigo) return Response.json({ error: errorCodigo }, { status: 400 });
    // SQLite upper() handles ASCII only. Legacy identifiers may contain Ñ or
    // accented letters, so compare with the same Unicode rules as new values.
    const existentes = await db.select({ codigo: activos.codigo }).from(activos);
    if (existentes.some(a => a.codigo.trim().toUpperCase() === activoData.codigo)) return Response.json({ error: mensajeCodigoDuplicado(activoData.codigo!) }, { status: 409 });
  }
  for (let intento = 0; intento < 3; intento++) {
    const codigo = activoData.codigo || generarCodigoActivo(rubro);
    const data: typeof activos.$inferInsert = {
      ...activoData, codigo, nombre: activoData.nombre || nombrePendienteActivo(rubro), rubro, tipo,
      datosTecnicos: serializarDatosTecnicos(rubro, activoData.datosTecnicos), qrCode: `QR-${codigo}`,
      modeloAireId: modeloAireId ?? null, modeloAireSnapshot,
    };
    try {
      const registro = db.insert(activos).values(data).returning();
      let row: typeof activos.$inferSelect;
      if (mantenimientoFrecuencia) {
        // Asset and optional plan commit together. Retrying cannot leave an
        // orphaned asset if plan creation fails.
        const [rows] = await db.batch([registro, db.insert(planesMantenimiento).values({
          activoId: sql`(SELECT id FROM activos WHERE codigo = ${codigo})`,
          titulo: mantenimientoTitulo || `MANTENIMIENTO PREVENTIVO ${mantenimientoFrecuencia.toUpperCase()}`,
          frecuencia: mantenimientoFrecuencia,
          // «Desde hoy» es hoy en El Salvador: con new Date(), después de las 18:00 el
          // plan arrancaba un día más tarde (la fecha UTC ya es mañana).
          proximaFecha: mantenimientoProximaFecha || siguienteFecha(hoySV(), mantenimientoFrecuencia as Frecuencia),
          prioridad: mantenimientoPrioridad ?? "media",
        })]);
        row = rows[0];
      } else {
        [row] = await registro;
      }
      await logAudit(ctx, {
        entidad: "activo", entidadId: row.id, accion: "create",
        resumen: automatico ? "Alta del equipo" : "Alta del equipo con código institucional",
      });
      return Response.json({ activo: row }, { status: 201 });
    } catch (error) {
      const catalogoError = errorCatalogoAire(error);
      if (catalogoError) return respuestaErrorCatalogoAire(catalogoError);
      if (!esCodigoDuplicado(error)) throw error;
      if (!automatico) return Response.json({ error: mensajeCodigoDuplicado(activoData.codigo!) }, { status: 409 });
    }
  }
  return Response.json({ error: "No se pudo asignar un código único. Vuelve a guardar el equipo." }, { status: 409 });
};
