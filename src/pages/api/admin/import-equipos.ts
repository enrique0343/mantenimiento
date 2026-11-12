import type { APIRoute } from "astro";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { and, eq, ne, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { activos, auditLog, centrosCosto, proveedores, sucursales, ubicaciones } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { AREA_KEYS, parseArea } from "@/lib/areas";
import { csvResponse } from "@/lib/csv";
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
    modo, area, hoy: hoySV(), activos: activosCtx, ubicaciones: ubicacionesCtx, sucursales: sucursalesCtx,
    centros: centrosCtx, proveedores: proveedoresCtx,
  });
  if (plan.error) return Response.json({ error: plan.error }, { status: 400 });

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
          db.insert(activos).values(r.nuevo!),
          db.insert(auditLog).values({
            entidad: "activo", entidadId: sql`(SELECT id FROM activos WHERE codigo = ${r.codigo})`, accion: "create",
            usuarioId: user.id, cambios: null, resumen: resumenAltaCarga(archivo),
          }),
        ];
      }
      const set = Object.fromEntries(Object.entries(r.cambios ?? {}).map(([campo, c]) => [campo, c.despues]));
      return [
        db.update(activos).set(set).where(and(eq(activos.id, r.activoId!), "estado" in set ? ne(activos.estado, "baja") : undefined)),
        db.insert(auditLog).values({
          entidad: "activo", entidadId: r.activoId!, accion: "update", usuarioId: user.id,
          cambios: JSON.stringify(r.cambiosBitacora ?? r.cambios ?? {}), resumen: resumenActualizacionCarga(r.cambiosLegibles ?? []),
        }),
      ];
    };
    const contar = (filas: ResultadoFila[]) => {
      for (const r of filas) { if (r.accion === "crear") insertados++; else actualizados++; }
    };
    const grabar = (lista: BatchItem<"sqlite">[]) => db.batch(lista as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    const aplicar = rango.filter((r) => r.accion === "crear" || r.accion === "actualizar");
    for (let i = 0; i < aplicar.length; i += LOTE_FILAS_IMPORTACION) {
      const lote = aplicar.slice(i, i + LOTE_FILAS_IMPORTACION);
      try {
        await grabar(lote.flatMap(sentencias));
        contar(lote);
      } catch {
        for (const r of lote) {
          try { await grabar(sentencias(r)); contar([r]); }
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
