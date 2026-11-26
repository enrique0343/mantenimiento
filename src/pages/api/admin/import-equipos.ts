import type { APIRoute } from "astro";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { activos, auditLog, centrosCosto, proveedores, sucursales, ubicaciones } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { AREA_KEYS, parseArea } from "@/lib/areas";
import { csvResponse } from "@/lib/csv";
import { MENSAJE_TRASLADO_TI } from "@/lib/tecnologia";
import { puedeEntrar, espacioDeActivo, espacioDeArea } from "@/lib/espacio";
import { hoySV } from "@/lib/biomedico";
import {
  planificarImportacion, plantillaCsv, resumenActualizacionCarga, resumenAltaCarga,
  LOTE_FILAS_IMPORTACION, TANDA_FILAS_IMPORTACION, type ResultadoFila,
} from "@/lib/importar-equipos";

export const prerender = false;

// Carga masiva de equipos (Fase 59). El navegador simula el archivo completo y
// después lo graba por tandas de hasta 200 filas (desde/hasta). Cada solicitud
// vuelve a leer el archivo con la base actual, así que repetir una tanda no
// duplica nada: lo ya grabado sale como «ya existe» o «sin cambios».
// El alta y su línea de bitácora van en el mismo lote (son atómicas).

/** GET ?plantilla=1&area= → plantilla CSV con las columnas del área. */
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const url = new URL(ctx.request.url);
  if (url.searchParams.get("plantilla") !== "1") return Response.json({ error: "Pide la plantilla con ?plantilla=1." }, { status: 400 });
  const area = parseArea(url.searchParams.get("area"));
  return csvResponse(`plantilla_equipos_${area ?? "todas"}.csv`, plantillaCsv(area));
};

const bodySchema = z.object({
  csv: z.string().min(10).max(5_000_000),
  modo: z.enum(["crear", "actualizar"]).default("crear"),
  dryRun: z.boolean().optional(),
  area: z.enum(AREA_KEYS).nullable().optional(),
  desde: z.number().int().min(0).optional(),
  hasta: z.number().int().min(0).optional(),
  archivo: z.string().max(200).optional(),
});

/** Mensaje corto de un error de la base. */
function mensajeCorto(error: unknown): string {
  let texto = "";
  for (let actual: unknown = error, i = 0; actual && i < 5; i++) {
    texto = String((actual as Error).message ?? actual);
    actual = (actual as { cause?: unknown }).cause;
  }
  if (/UNIQUE constraint failed: activos\.(codigo|qr_code)/i.test(texto)) return "el código ya está en uso.";
  if (/FOREIGN KEY/i.test(texto)) return "una ubicación, centro o proveedor ya no existe.";
  return texto.replace(/\s+/g, " ").slice(0, 120) || "error de la base de datos.";
}

export const POST: APIRoute = async (ctx) => {
  // Fase 59: admin y jefe (D2).
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const error = issue?.path[0] === "csv"
      ? issue.code === "too_big" ? "El archivo es demasiado grande: divídelo en partes." : "El archivo está vacío."
      : "Datos de la carga no válidos.";
    return Response.json({ error }, { status: 400 });
  }
  const { csv, modo, area = null } = parsed.data;
  if (area && !puedeEntrar(user, espacioDeArea(area))) return Response.json({ error: "No tienes permiso para cargar equipos de ese espacio." }, { status: 403 });
  const dryRun = parsed.data.dryRun ?? false;
  const archivo = parsed.data.archivo?.replace(/[\u0000-\u001f\u007f]/g, "").trim() || null;
  const db = getDb(ctx);

  // ── Cinco consultas de contexto ──
  const [activosCtx, ubicacionesCtx, sucursalesCtx, centrosCtx, proveedoresCtx] = await Promise.all([
    db.select({
      id: activos.id, codigo: activos.codigo, nombre: activos.nombre, numeroActivo: activos.numeroActivo, serial: activos.serial,
      estado: activos.estado, rubro: activos.rubro, tipo: activos.tipo, categoria: activos.categoria, subcategoria: activos.subcategoria,
      marca: activos.marca, modelo: activos.modelo, descripcion: activos.descripcion, anio: activos.anio,
      criticidadOperacional: activos.criticidadOperacional, claseRiesgo: activos.claseRiesgo, centroCostoId: activos.centroCostoId,
      ubicacionId: activos.ubicacionId, ubicacion: activos.ubicacion, registroSanitario: activos.registroSanitario,
      registroSanitarioEntidad: activos.registroSanitarioEntidad, registroSanitarioEmision: activos.registroSanitarioEmision,
      registroSanitarioVencimiento: activos.registroSanitarioVencimiento, registroSanitarioNoRequiere: activos.registroSanitarioNoRequiere,
      fechaAdquisicion: activos.fechaAdquisicion, vidaUtilAnios: activos.vidaUtilAnios, valorAdquisicion: activos.valorAdquisicion,
      proveedorId: activos.proveedorId, datosTecnicos: activos.datosTecnicos,
    }).from(activos),
    db.select({ id: ubicaciones.id, nombre: ubicaciones.nombre, sucursalId: ubicaciones.sucursalId, activa: ubicaciones.activa }).from(ubicaciones),
    db.select({ id: sucursales.id, nombre: sucursales.nombre, codigo: sucursales.codigo }).from(sucursales),
    db.select({ id: centrosCosto.id, codigo: centrosCosto.codigo, nombre: centrosCosto.nombre, sucursalId: centrosCosto.sucursalId, activo: centrosCosto.activo }).from(centrosCosto),
    db.select({ id: proveedores.id, nombre: proveedores.nombre, activo: proveedores.activo }).from(proveedores),
  ]);

  const plan = planificarImportacion(csv, {
    modo, area, hoy: hoySV(), activos: activosCtx.filter((a) => puedeEntrar(user, espacioDeActivo(a))), ubicaciones: ubicacionesCtx, sucursales: sucursalesCtx,
    centros: centrosCtx, proveedores: proveedoresCtx,
  });
  if (plan.error) return Response.json({ error: plan.error }, { status: 400 });


  // Aplicar también al simulador: la importación no es una excepción a permisos ni trazabilidad.
  const equiposPorId = new Map(activosCtx.map((a) => [a.id, a]));
  const equiposPorCodigo = new Map(activosCtx.map((a) => [a.codigo.trim().toUpperCase(), a]));
  for (const fila of plan.resultados) {
    const previo = (fila.activoId ? equiposPorId.get(fila.activoId) : undefined) ?? equiposPorCodigo.get(fila.codigo.trim().toUpperCase());
    if (previo && !puedeEntrar(user, espacioDeActivo(previo))) {
      fila.accion = "error"; fila.detalle = ["No tienes permiso para cargar equipos de ese espacio."]; fila.avisos = [];
      continue;
    }
    if (fila.accion !== "crear" && fila.accion !== "actualizar") continue;
    const destino = fila.nuevo?.rubro ?? fila.cambios?.rubro?.despues ?? previo?.rubro;
    if ((previo && !puedeEntrar(user, espacioDeActivo(previo))) || !puedeEntrar(user, espacioDeArea(typeof destino === "string" ? destino : null))) {
      fila.accion = "error"; fila.detalle = ["No tienes permiso para cargar equipos de ese espacio."];
    } else if (previo?.rubro === "tecnologia" && ("ubicacionId" in (fila.cambios ?? {}) || "ubicacion" in (fila.cambios ?? {}))) {
      fila.accion = "error"; fila.detalle = [MENSAJE_TRASLADO_TI];
    }
  }
  const total = plan.resultados.length;
  const desde = Math.min(parsed.data.desde ?? 0, total);
  const hasta = Math.min(Math.max(parsed.data.hasta ?? total, desde), total);
  const rango = plan.resultados.slice(desde, hasta);
  if (!dryRun && rango.length > TANDA_FILAS_IMPORTACION) {
    return Response.json({ error: `Graba por partes de hasta ${TANDA_FILAS_IMPORTACION} filas.` }, { status: 400 });
  }

  // ── Grabación: lotes de 20 filas (equipo + bitácora); si un lote falla, fila por fila ──
  let insertados = 0;
  let actualizados = 0;
  const fallos = new Map<number, string>();
  if (!dryRun) {
    const sentencias = (r: ResultadoFila): BatchItem<"sqlite">[] => {
      if (r.accion === "crear") {
        return [
          db.insert(activos).values(r.nuevo!).returning({ id: activos.id }),
          db.insert(auditLog).values({
            entidad: "activo", entidadId: sql`(SELECT id FROM activos WHERE codigo = ${r.codigo})`, accion: "create",
            usuarioId: user.id, cambios: null, resumen: resumenAltaCarga(archivo),
          }),
        ];
      }
      const set = Object.fromEntries(Object.entries(r.cambios ?? {}).map(([campo, c]) => [campo, c.despues]));
      const previo = equiposPorId.get(r.activoId!)!;
      // El área y los valores usados al simular siguen vigentes al escribir. Un
      // traslado/reclasificación concurrente no convierte una carga autorizada
      // en una escritura de otro espacio ni deja un "antes" falso en bitácora.
      const donde = and(
        eq(activos.id, r.activoId!), eq(activos.codigo, previo.codigo),
        previo.rubro == null ? isNull(activos.rubro) : eq(activos.rubro, previo.rubro),
        eq(activos.tipo, previo.tipo),
        ...Object.entries(r.cambios ?? {}).map(([campo, cambio]) => {
          const columna = activos[campo as keyof typeof activos.$inferSelect];
          return cambio.antes == null ? isNull(columna) : eq(columna, cambio.antes as any);
        }),
        "centroCostoId" in set ? (previo.ubicacionId == null ? isNull(activos.ubicacionId) : eq(activos.ubicacionId, previo.ubicacionId)) : undefined,
        "estado" in set ? ne(activos.estado, "baja") : undefined,
      )!;
      // Ambas sentencias comparten guarda y transacción. Si pierde la carrera,
      // no se escribe ni auditoría ni activo, y RETURNING permite contarlo bien.
      return [
        db.insert(auditLog).select(db.select({
          id: sql<number>`null`.as("id"), entidad: sql<string>`'activo'`.as("entidad"),
          entidadId: sql<number>`${activos.id}`.as("entidad_id"), accion: sql<string>`'update'`.as("accion"),
          usuarioId: sql<number>`${user.id}`.as("usuario_id"),
          cambios: sql<string>`${JSON.stringify(r.cambiosBitacora ?? r.cambios ?? {})}`.as("cambios"),
          resumen: sql<string>`${resumenActualizacionCarga(r.cambiosLegibles ?? [])}`.as("resumen"),
          createdAt: sql<string>`CURRENT_TIMESTAMP`.as("created_at"),
        }).from(activos).where(donde)),
        db.update(activos).set(set).where(donde).returning({ id: activos.id }),
      ];
    };
    const contar = (filas: ResultadoFila[], resultados: unknown[]) => {
      for (const [i, r] of filas.entries()) {
        const guardadas = resultados[i * 2 + (r.accion === "crear" ? 0 : 1)];
        if (!Array.isArray(guardadas) || guardadas.length !== 1) {
          fallos.set(r.fila, "El equipo cambió mientras se procesaba la carga. Vuelve a simular; esta fila no se modificó.");
        } else if (r.accion === "crear") insertados++;
        else actualizados++;
      }
    };
    const grabar = (lista: BatchItem<"sqlite">[]) => db.batch(lista as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    const aplicar = rango.filter((r) => r.accion === "crear" || r.accion === "actualizar");
    for (let i = 0; i < aplicar.length; i += LOTE_FILAS_IMPORTACION) {
      const lote = aplicar.slice(i, i + LOTE_FILAS_IMPORTACION);
      try {
        const guardados = await grabar(lote.flatMap(sentencias));
        contar(lote, guardados);
      } catch {
        for (const r of lote) {
          try { const guardados = await grabar(sentencias(r)); contar([r], guardados); }
          catch (error) { fallos.set(r.fila, `No se pudo grabar: ${mensajeCorto(error)}`); }
        }
      }
    }
  }

  const resultados = rango.map((r) => {
    const fallo = fallos.get(r.fila);
    return fallo
      ? { fila: r.fila, codigo: r.codigo, accion: "error" as const, detalle: [fallo], avisos: r.avisos }
      : { fila: r.fila, codigo: r.codigo, accion: r.accion, detalle: r.detalle, avisos: r.avisos };
  });
  const cuenta = (accion: ResultadoFila["accion"]) => rango.filter((r) => r.accion === accion).length;
  return Response.json({
    dryRun, modo, filas: plan.filas, desde, hasta,
    aInsertar: cuenta("crear"), aActualizar: cuenta("actualizar"), sinCambios: cuenta("sin_cambios"),
    insertados, actualizados,
    errores: resultados.filter((r) => r.accion === "error").map((r) => ({ fila: r.fila, codigo: r.codigo, error: r.detalle.join(" ") })),
    avisos: resultados.filter((r) => r.avisos.length).map((r) => ({ fila: r.fila, codigo: r.codigo, aviso: r.avisos.join(" ") })),
    resultados, columnasIgnoradas: plan.columnasIgnoradas, notas: plan.notas, separador: plan.separador,
  });
};
