import type { APIRoute } from "astro";
import { z } from "zod";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { activos, procedimientos, tickets, ordenes, proyectos, centrosCosto, sucursales, ubicaciones } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit, calcularDiff } from "@/lib/audit";
import { NIVELES_JERARQUIA, validarPadre } from "@/lib/jerarquia";
import { rubroDeActivo, SUBCAT_KEYS, type SubcatKey } from "@/lib/rubros";
import { activoAreaCondition } from "@/lib/areas";
import { datosTecnicosRegistroSchema as datosTecnicosSchema, datosTecnicosValidosParaArea, serializarDatosTecnicos, leerDatosTecnicos } from "@/lib/activo-area";
import {
  textoRegistro, nombrePendienteActivo, esCodigoDuplicado, errorCodigoActivo, mensajeCodigoDuplicado, errorDeDatos,
  errorCentroCostoEquipo, MENSAJE_SOLO_BIOMEDICOS,
} from "@/lib/registro-activos";
import { errorCatalogoAire, respuestaErrorCatalogoAire } from "@/lib/catalogo-aires";
import { CLASES_RIESGO_VALORES, ESTADOS_ACTIVO, HISTORIAL_ACTIVO, esFechaISO, etiquetaCentroCosto } from "@/lib/biomedico";

export const prerender = false;

/** Fecha 'AAAA-MM-DD' real o vacía (null). */
const fechaOpcional = (mensaje: string) =>
  z.preprocess((v) => (v === "" ? null : v), z.string().refine((v) => esFechaISO(v), mensaje).nullable().optional());

// Fase 59: sin ultimaCalibracion ni proximaCalibracion (las escribe solo
// Calibraciones, contrato K-A4). Editar ya no puede borrarlas: zod las descarta.
const updateSchema = z.object({
  modeloAireId: z.never().optional(),
  modeloAireVersion: z.never().optional(),
  modeloAireSnapshot: z.never().optional(),
  codigo: textoRegistro,
  nombre: textoRegistro,
  descripcion: textoRegistro,
  ubicacion: textoRegistro,
  estado: z.enum(ESTADOS_ACTIVO).optional(),
  tipo: z.enum(["general", "biomedico"]).optional(),
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
  centroCostoId: z.number().int().positive().nullable().optional(),
  fechaAdquisicion: fechaOpcional("La fecha de adquisición no es válida."),
  vidaUtilAnios: z.number().int().nonnegative().nullable().optional(),
  valorAdquisicion: z.number().nonnegative().nullable().optional(),
  responsableId: z.number().int().nullable().optional(),
  criticidadOperacional: z.enum(["alta", "media", "baja"]).optional(),
  rubro: z.enum(["infraestructura", "aires", "equipo_general", "biomedico"]).nullable().optional(),
  datosTecnicos: datosTecnicosSchema,
  subcategoria: z.enum(SUBCAT_KEYS as [SubcatKey, ...SubcatKey[]]).nullable().optional(),
  aceptacionFecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  aceptacionResultado: z.enum(["aprobado", "condicionado", "rechazado"]).nullable().optional(),
  aceptacionNotas: textoRegistro,
  requiereCalibracion: z.boolean().optional(),
  ubicacionId: z.number().int().nullable().optional(),
  proveedorId: z.number().int().nullable().optional(),
  slaUrgenteHoras: z.number().int().nonnegative().optional(),
  slaAltaHoras: z.number().int().nonnegative().optional(),
  slaMediaHoras: z.number().int().nonnegative().optional(),
  slaBajaHoras: z.number().int().nonnegative().optional(),
  // ── SCP · jerarquía y configuración de sitio (Fase 47, GO-GUI-011-2026) ──
  padreId: z.number().int().positive().nullable().optional(),
  nivelJerarquia: z.enum(NIVELES_JERARQUIA).optional(),
  scpProcedimientoId: z.number().int().positive().nullable().optional(),
  scpVersionRef: z.string().nullable().optional(),
});

/** Campos que solo tienen sentido en un equipo biomédico. */
const CAMPOS_BIOMEDICOS = [
  "claseRiesgo", "subcategoria", "registroSanitario", "registroSanitarioEntidad",
  "registroSanitarioEmision", "registroSanitarioVencimiento", "registroSanitarioNoRequiere",
] as const;
const conDato = (v: unknown) => v !== null && v !== undefined && v !== "" && v !== false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  const [row] = await db.select().from(activos).where(eq(activos.id, id)).limit(1);
  if (!row) return Response.json({ error: "No encontrado" }, { status: 404 });
  return Response.json({ activo: row });
};

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: errorDeDatos(parsed.error) }, { status: 400 });
  const db = getDb(ctx);
  const llega = parsed.data;

  // Estado anterior para diff
  const [actual] = await db.select().from(activos).where(eq(activos.id, id)).limit(1);
  if (!actual) return Response.json({ error: "No encontrado" }, { status: 404 });

  // Guarda anti-ciclo de la jerarquía del SCP: ni auto-padre, ni un
  // descendiente como padre, ni más de tres niveles.
  if ("padreId" in llega) {
    const chequeo = await validarPadre(db, id, llega.padreId ?? null);
    if (!chequeo.ok) return Response.json({ error: chequeo.error }, { status: 400 });
  }

  // El SCP vinculado debe ser un procedimiento de tipo scp que exista.
  if (llega.scpProcedimientoId != null) {
    const [proc] = await db
      .select({ id: procedimientos.id, tipo: procedimientos.tipo, version: procedimientos.version })
      .from(procedimientos).where(eq(procedimientos.id, llega.scpProcedimientoId)).limit(1);
    if (!proc) return Response.json({ error: "El procedimiento SCP no existe." }, { status: 404 });
    if (proc.tipo !== "scp") return Response.json({ error: "El procedimiento vinculado debe ser de tipo SCP." }, { status: 400 });
  }

  // Al registrar la inspección de aceptación, se firma con el usuario actual
  const data: Record<string, unknown> = { ...llega };
  const areaActual = rubroDeActivo(actual.rubro, actual.tipo);
  const rubro = rubroDeActivo(llega.rubro === undefined ? actual.rubro : llega.rubro, llega.tipo ?? actual.tipo);
  const cambiaArea = rubro !== areaActual;
  if (actual.modeloAireId !== null && cambiaArea) return Response.json({ error: "Esta unidad proviene de una ficha de aire acondicionado y debe conservar esa área. Puedes editar sus demás datos." }, { status: 409 });
  const tipo = rubro === "biomedico" ? "biomedico" : "general";
  if (llega.tipo && llega.tipo !== tipo) return Response.json({ error: "El tipo de equipo no corresponde al área seleccionada" }, { status: 400 });
  if (!datosTecnicosValidosParaArea(rubro, llega.datosTecnicos)) return Response.json({ error: "Los datos técnicos no corresponden al área seleccionada" }, { status: 400 });
  data.rubro = rubro;
  data.tipo = tipo;

  // ── Código: lo corrigen admin y jefe. Vacío u omitido no borra el código ni su QR ──
  const codigoActual = actual.codigo.trim().toUpperCase();
  if (!llega.codigo || llega.codigo === codigoActual) delete data.codigo;
  else {
    if (user.rol !== "admin" && user.rol !== "jefe") {
      return Response.json({ error: "Solo la jefatura o el administrador pueden cambiar el código del equipo." }, { status: 403 });
    }
    const errorCodigo = errorCodigoActivo(llega.codigo);
    if (errorCodigo) return Response.json({ error: errorCodigo }, { status: 400 });
    const existentes = await db.select({ id: activos.id, codigo: activos.codigo }).from(activos);
    if (existentes.some(a => a.id !== id && a.codigo.trim().toUpperCase() === llega.codigo)) return Response.json({ error: mensajeCodigoDuplicado(llega.codigo) }, { status: 409 });
    data.qrCode = `QR-${llega.codigo}`;
  }

  // ── Estado: «baja» solo desde la pantalla de baja (y se revierte allí) ──
  if (llega.estado !== undefined) {
    if (actual.estado === "baja") {
      if (llega.estado !== "baja") return Response.json({ error: "El equipo está dado de baja. Para devolverlo al servicio usa «Revertir baja»." }, { status: 409 });
      delete data.estado;
    } else if (llega.estado === "baja") {
      return Response.json({ error: "Para dar de baja usa «Dar de baja» en la ficha del equipo." }, { status: 400 });
    }
  }

  if (llega.nombre !== undefined) data.nombre = llega.nombre || nombrePendienteActivo(rubro);
  if (llega.datosTecnicos !== undefined || cambiaArea) {
    data.datosTecnicos = serializarDatosTecnicos(rubro, llega.datosTecnicos === undefined ? leerDatosTecnicos(actual.datosTecnicos) : llega.datosTecnicos);
  }
  if (llega.aceptacionFecha) data.aceptacionPor = user.id;

  // Desvincular el SCP borra también la versión de referencia: la versión del
  // SCP es un atributo del activo y sin procedimiento no significa nada.
  if ("scpProcedimientoId" in llega && llega.scpProcedimientoId == null) {
    data.scpVersionRef = null;
  }

  // ── Clase de riesgo y datos biomédicos, sobre el registro final ──
  // Clasificar cambia el área mandando solo {rubro}; después limpia la clase y la
  // subcategoría por separado. Ese cambio no se valida aquí.
  const soloArea = Object.keys(llega).length === 1 && "rubro" in llega;
  if (!soloArea) {
    if (rubro === "biomedico") {
      if (llega.claseRiesgo === null && actual.claseRiesgo) {
        return Response.json({ error: "La clase de riesgo es obligatoria en equipos biomédicos: elige una." }, { status: 400 });
      }
    } else {
      const traeDatoBio = CAMPOS_BIOMEDICOS.some((k) => k in llega && conDato(llega[k]));
      const conservaDatoBio = cambiaArea && CAMPOS_BIOMEDICOS.some((k) => !(k in llega) && conDato(actual[k]));
      if (traeDatoBio || conservaDatoBio) return Response.json({ error: MENSAJE_SOLO_BIOMEDICOS }, { status: 400 });
    }
  }
  if (llega.registroSanitarioNoRequiere === true) {
    data.registroSanitario = null;
    data.registroSanitarioEntidad = null;
    data.registroSanitarioEmision = null;
    data.registroSanitarioVencimiento = null;
  } else if (llega.registroSanitario && actual.registroSanitarioNoRequiere && llega.registroSanitarioNoRequiere === undefined) {
    // Escribir el número quiere decir que el equipo sí requiere registro.
    data.registroSanitarioNoRequiere = false;
  }
  if ("registroSanitarioEmision" in llega || "registroSanitarioVencimiento" in llega) {
    const emision = ("registroSanitarioEmision" in data ? data.registroSanitarioEmision : actual.registroSanitarioEmision) as string | null;
    const vence = ("registroSanitarioVencimiento" in data ? data.registroSanitarioVencimiento : actual.registroSanitarioVencimiento) as string | null;
    if (emision && vence && vence < emision) {
      return Response.json({ error: "El vencimiento del registro no puede ser anterior a su emisión." }, { status: 400 });
    }
  }

  // ── Centro de costo: existe, activo (o el que ya tenía) y de la misma sede ──
  if ("centroCostoId" in llega || "ubicacionId" in llega) {
    const centroId = "centroCostoId" in llega ? llega.centroCostoId ?? null : actual.centroCostoId;
    const ubicacionId = "ubicacionId" in llega ? llega.ubicacionId ?? null : actual.ubicacionId;
    if (centroId != null) {
      const [centro] = await db.select({ id: centrosCosto.id, codigo: centrosCosto.codigo, activo: centrosCosto.activo, sucursalId: centrosCosto.sucursalId, sedeNombre: sucursales.nombre })
        .from(centrosCosto).leftJoin(sucursales, eq(sucursales.id, centrosCosto.sucursalId)).where(eq(centrosCosto.id, centroId)).limit(1);
      const [ubic] = ubicacionId != null
        ? await db.select({ sucursalId: ubicaciones.sucursalId, sedeNombre: sucursales.nombre })
          .from(ubicaciones).leftJoin(sucursales, eq(sucursales.id, ubicaciones.sucursalId)).where(eq(ubicaciones.id, ubicacionId)).limit(1)
        : [];
      const errorCentro = errorCentroCostoEquipo(centro, ubic, actual.centroCostoId);
      if (errorCentro) return Response.json({ error: errorCentro }, { status: 400 });
    }
  }

  // Los trabajos conservan su área, incluso al cerrarse. La comprobación forma
  // parte de la escritura para no separar el control de vínculos del cambio.
  let row: typeof activos.$inferSelect | undefined;
  try {
    [row] = await db.update(activos).set(data).where(and(
    eq(activos.id, id),
    activoAreaCondition(areaActual),
    cambiaArea ? sql`NOT EXISTS (SELECT 1 FROM ${tickets} WHERE ${tickets.activoId} = ${id})` : undefined,
    cambiaArea ? sql`NOT EXISTS (SELECT 1 FROM ${ordenes} WHERE ${ordenes.activoId} = ${id})` : undefined,
    cambiaArea ? sql`NOT EXISTS (SELECT 1 FROM ${proyectos} WHERE ${proyectos.activoId} = ${id})` : undefined,
    // Un cambio de estado no pisa una baja registrada mientras se editaba.
    data.estado !== undefined ? ne(activos.estado, "baja") : undefined,
    )).returning();
  } catch (error) {
    const catalogoError = errorCatalogoAire(error);
    if (catalogoError) return respuestaErrorCatalogoAire(catalogoError);
    if (esCodigoDuplicado(error)) return Response.json({ error: mensajeCodigoDuplicado(String(llega.codigo ?? "")) }, { status: 409 });
    throw error;
  }
  if (!row) {
    if (data.estado !== undefined) {
      const [ahora] = await db.select({ estado: activos.estado }).from(activos).where(eq(activos.id, id)).limit(1);
      if (ahora?.estado === "baja") return Response.json({ error: "El equipo está dado de baja. Para devolverlo al servicio usa «Revertir baja»." }, { status: 409 });
    }
    return Response.json({ error: cambiaArea
      ? "No se puede cambiar el área porque este activo tiene solicitudes, órdenes o proyectos vinculados, o su área fue modificada por otra persona. Actualiza la página; puedes editar sus demás datos conservando el área."
      : "El área del activo cambió mientras editabas. Actualiza la página antes de guardar.",
    }, { status: 409 });
  }
  // Bitácora: el centro de costo con código y nombre, no con su número interno.
  const diff = { ...calcularDiff(actual as any, data as any) };
  const cambioCentro = diff.centroCostoId as { antes: unknown; despues: unknown } | undefined;
  if (cambioCentro && typeof cambioCentro === "object" && "antes" in cambioCentro) {
    const ids = [cambioCentro.antes, cambioCentro.despues].filter((v): v is number => typeof v === "number");
    const centros = ids.length ? await db.select({ id: centrosCosto.id, codigo: centrosCosto.codigo, nombre: centrosCosto.nombre }).from(centrosCosto).where(inArray(centrosCosto.id, ids)) : [];
    const etiqueta = (v: unknown) => etiquetaCentroCosto(centros.find((c) => c.id === v) ?? null);
    diff.centroCostoId = { antes: etiqueta(cambioCentro.antes), despues: etiqueta(cambioCentro.despues) };
  }
  if (Object.keys(diff).length > 0) {
    await logAudit(ctx, { entidad: "activo", entidadId: id, accion: "update", cambios: diff });
  }

  return Response.json({ activo: row });
};

/** Etiquetas de lo que el equipo tiene en su historial (una sola consulta). */
async function historialDelActivo(db: ReturnType<typeof getDb>, id: number): Promise<string[]> {
  const columnas = HISTORIAL_ACTIVO.map((h, i) =>
    sql`EXISTS(SELECT 1 FROM ${sql.raw(h.tabla)} WHERE ${sql.raw(h.columna)} = ${id}) AS ${sql.raw(`h${i}`)}`);
  const fila = await db.get<Record<string, number>>(sql`SELECT ${sql.join(columnas, sql`, `)}`);
  return HISTORIAL_ACTIVO.filter((_, i) => Number(fila?.[`h${i}`] ?? 0) > 0).map((h) => h.etiqueta);
}

const mensajeHistorial = (etiquetas: string[]) =>
  `No se puede eliminar: el equipo tiene ${etiquetas.join(", ")}. Para retirarlo del servicio usa «Dar de baja».`;

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  // Fase 59: solo se elimina un registro creado por error y sin historial (D15).
  const antes = await historialDelActivo(db, id);
  if (antes.length) return Response.json({ error: mensajeHistorial(antes) }, { status: 409 });
  try {
    // Una sola sentencia: si algo se vinculó entre la revisión y el borrado,
    // las llaves foráneas y los triggers la rechazan y se revisa de nuevo.
    await db.delete(activos).where(eq(activos.id, id));
  } catch (error) {
    const despues = await historialDelActivo(db, id);
    if (despues.length) return Response.json({ error: mensajeHistorial(despues) }, { status: 409 });
    throw error;
  }
  await logAudit(ctx, { entidad: "activo", entidadId: id, accion: "delete", resumen: "Equipo eliminado" });
  return Response.json({ ok: true });
};
