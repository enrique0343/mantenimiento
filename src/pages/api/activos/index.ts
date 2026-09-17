import type { APIRoute } from "astro";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { activos, planesMantenimiento } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { desc, sql } from "drizzle-orm";
import { siguienteFecha, type Frecuencia } from "@/lib/frecuencias";
import { activoAreaCondition, parseArea, AREA_KEYS } from "@/lib/areas";
import { rubroDeActivo } from "@/lib/rubros";
import { datosTecnicosRegistroSchema as datosTecnicosSchema, datosTecnicosValidosParaArea, serializarDatosTecnicos } from "@/lib/activo-area";
import { textoRegistro, generarCodigoActivo, nombrePendienteActivo, esCodigoDuplicado } from "@/lib/registro-activos";
import { modeloAireParaAlta, snapshotModeloAire, errorCatalogoAire, respuestaErrorCatalogoAire } from "@/lib/catalogo-aires";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const requestedArea = new URL(ctx.request.url).searchParams.get("area");
  const area = parseArea(requestedArea);
  if (requestedArea && !area) return Response.json({ error: "Área de mantenimiento inválida" }, { status: 400 });
  const db = getDb(ctx);
  const rows = await db.select().from(activos).where(area ? activoAreaCondition(area) : undefined).orderBy(desc(activos.id));
  return Response.json({ activos: rows });
};

const baseSchema = {
  codigo: textoRegistro,
  nombre: textoRegistro,
  descripcion: textoRegistro,
  ubicacion: textoRegistro,
  estado: z.enum(["operativo", "averiado", "mantenimiento", "baja"]).optional(),
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
  claseRiesgo: z.enum(["I", "IIa", "IIb", "III"]).nullable().optional(),
  ultimaCalibracion: z.string().nullable().optional(),
  proximaCalibracion: z.string().nullable().optional(),
  fechaAdquisicion: z.string().nullable().optional(),
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
  // Configuración opcional de mantenimiento preventivo automático
  mantenimientoFrecuencia: z.enum(["diaria", "semanal", "quincenal", "mensual", "bimestral", "trimestral", "semestral", "anual"]).optional().nullable(),
  mantenimientoProximaFecha: z.string().optional().nullable(),
  mantenimientoTitulo: textoRegistro,
  mantenimientoPrioridad: z.enum(["baja", "media", "alta", "urgente"]).optional(),
}).refine(value => (value.modeloAireId === undefined) === (value.modeloAireVersion === undefined),
  "Selecciona una ficha con su versión actual");

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "tecnico"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const { mantenimientoFrecuencia, mantenimientoProximaFecha, mantenimientoTitulo, mantenimientoPrioridad,
    modeloAireId, modeloAireVersion, ...datosUnidad } = parsed.data;
  let activoData = datosUnidad;
  const rubro = rubroDeActivo(activoData.rubro, activoData.tipo);
  const tipo = rubro === "biomedico" ? "biomedico" : "general";
  if (activoData.tipo && activoData.tipo !== tipo) return Response.json({ error: "El tipo de equipo no corresponde al área seleccionada" }, { status: 400 });
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
  const automatico = !activoData.codigo;
  if (!automatico) {
    // SQLite upper() handles ASCII only. Legacy identifiers may contain Ñ or
    // accented letters, so compare with the same Unicode rules as new values.
    const existentes = await db.select({ codigo: activos.codigo }).from(activos);
    if (existentes.some(a => a.codigo.trim().toUpperCase() === activoData.codigo)) return Response.json({ error: "Codigo o QR ya existe" }, { status: 409 });
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
          proximaFecha: mantenimientoProximaFecha || siguienteFecha(new Date(), mantenimientoFrecuencia as Frecuencia),
          prioridad: mantenimientoPrioridad ?? "media",
        })]);
        row = rows[0];
      } else {
        [row] = await registro;
      }
      return Response.json({ activo: row }, { status: 201 });
    } catch (error) {
      const catalogoError = errorCatalogoAire(error);
      if (catalogoError) return respuestaErrorCatalogoAire(catalogoError);
      if (!esCodigoDuplicado(error)) throw error;
      if (!automatico) return Response.json({ error: "Codigo o QR ya existe" }, { status: 409 });
    }
  }
  return Response.json({ error: "No se pudo asignar un código único. Vuelve a guardar el equipo." }, { status: 409 });
};
