import type { APIRoute } from "astro";
import { eq, gte, lte, and, desc, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  ordenes, activos, usuarios, items, stock, movimientosInventario,
  requisiciones, requisicionItems, proveedores, encuestasSatisfaccion,
  ubicaciones, sucursales, centrosCosto, activoBajas,
} from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { toCsv, csvResponse, rangoFechas } from "@/lib/csv";
import { consolidadoMantenimiento } from "@/lib/reporte-mantenimiento";
import { activoAreaCondition } from "@/lib/areas";
import { ROLES_BIO_VER, hoySV } from "@/lib/biomedico";
import { aFilaInventario, leerFiltrosInventario, pasaFiltros } from "@/lib/inventario-filtros";
import { columnasExportacion, filaExportacion } from "@/lib/importar-equipos";
import { parseArea } from "@/lib/areas";
import { condicionActivoEspacio, espacioDeLista, respuestaOtroEspacio, condicionTrabajoAreaEspacio } from "@/lib/espacio";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const tipo = ctx.params.tipo!;
  // Fase 59: el inventario de equipos lo descargan también técnico y visualizador (D14).
  const { user, response } = await requireUser(ctx, tipo === "equipos" ? ROLES_BIO_VER : ["admin", "jefe"]);
  if (!user) return response;
  const url = new URL(ctx.request.url);
  const { desde, hasta } = rangoFechas(url);
  const db = getDb(ctx);
  // Las exportaciones de órdenes, equipos, encuestas y mantenimiento son del espacio
  // (o del área pedida dentro de él). Inventario, movimientos y requisiciones son comunes.
  const rawArea = url.searchParams.get("area");
  const areaPedida = parseArea(rawArea);
  if (rawArea && !areaPedida) return Response.json({ error: "Área de mantenimiento inválida" }, { status: 400 });
  const { espacio, permitido } = espacioDeLista(ctx, user, areaPedida);
  if (!permitido) return respuestaOtroEspacio(espacio);
  const deOrdenes = condicionTrabajoAreaEspacio(ordenes.rubro, ordenes.activoId, espacio, areaPedida);

  if (tipo === "mantenimiento") {
    const q = url.searchParams;
    const { filas } = await consolidadoMantenimiento(db, {
      desde, hasta,
      sede: Number(q.get("sede")) || null,
      tecnico: Number(q.get("tecnico")) || null,
      rubro: areaPedida,
      tipo: q.get("tipo"),
      espacio,
    });
    const cols = [
      { key: "registro", label: "Orden" },
      { key: "codigo", label: "Código equipo" },
      { key: "equipo", label: "Equipo" },
      { key: "ubicacion", label: "Ubicación" },
      { key: "sede", label: "Sede" },
      { key: "tecnico", label: "Técnico" },
      { key: "tipoLabel", label: "Tipo" },
      { key: "inicio", label: "Inicio" },
      { key: "fin", label: "Fin" },
      { key: "efectivoMin", label: "Minutos de trabajo" },
      { key: "pausaMin", label: "Minutos en pausa" },
      { key: "estimadoMin", label: "Minutos estimados" },
      { key: "pasos", label: "Pasos" },
      { key: "novedades", label: "Novedades" },
      { key: "estadoLabel", label: "Estado" },
    ];
    return csvResponse(`mantenimiento_${stamp()}.csv`, toCsv(filas, cols));
  }

  if (tipo === "ordenes") {
    const conds: any[] = [deOrdenes];
    if (desde) conds.push(gte(ordenes.createdAt, desde));
    if (hasta) conds.push(lte(ordenes.createdAt, hasta + "T23:59:59"));
    const estado = url.searchParams.get("estado");
    if (estado) conds.push(eq(ordenes.estado, estado as any));

    const rows = await db
      .select({
        codigo: ordenes.codigo,
        titulo: ordenes.titulo,
        tipo: ordenes.tipo,
        prioridad: ordenes.prioridad,
        estado: ordenes.estado,
        equipoCodigo: activos.codigo,
        equipoNombre: activos.nombre,
        equipoTipo: activos.tipo,
        sucursalNombre: sucursales.nombre,
        ubicacionNombre: ubicaciones.nombre,
        asignadoNombre: usuarios.nombre,
        createdAt: ordenes.createdAt,
        vencimiento: ordenes.vencimiento,
        completadaEn: ordenes.completadaEn,
        cerradoEn: ordenes.cerradoEn,
        horasTrabajadas: ordenes.horasTrabajadas,
        trabajosRealizados: ordenes.trabajosRealizados,
        causaRaiz: ordenes.causaRaiz,
        solucionAplicada: ordenes.solucionAplicada,
      })
      .from(ordenes)
      .leftJoin(activos, eq(activos.id, ordenes.activoId))
      .leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId))
      .leftJoin(sucursales, eq(sucursales.id, ubicaciones.sucursalId))
      .leftJoin(usuarios, eq(usuarios.id, ordenes.asignadoA))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(ordenes.id));

    const cols = [
      { key: "codigo", label: "OT" },
      { key: "titulo", label: "Título" },
      { key: "tipo", label: "Tipo" },
      { key: "prioridad", label: "Prioridad" },
      { key: "estado", label: "Estado" },
      { key: "equipoCodigo", label: "Código equipo" },
      { key: "equipoNombre", label: "Equipo" },
      { key: "equipoTipo", label: "Tipo equipo" },
      { key: "sucursalNombre", label: "Sucursal" },
      { key: "ubicacionNombre", label: "Ubicación" },
      { key: "asignadoNombre", label: "Asignado a" },
      { key: "createdAt", label: "Creada" },
      { key: "vencimiento", label: "Vencimiento" },
      { key: "completadaEn", label: "Completada" },
      { key: "cerradoEn", label: "Cerrada" },
      { key: "horasTrabajadas", label: "Horas" },
      { key: "trabajosRealizados", label: "Trabajos realizados" },
      { key: "causaRaiz", label: "Causa raíz" },
      { key: "solucionAplicada", label: "Solución aplicada" },
    ];
    return csvResponse(`ordenes_${stamp()}.csv`, toCsv(rows, cols));
  }

  if (tipo === "inventario") {
    // Stock actual + clasificación de alerta
    const itRows = await db
      .select({
        codigo: items.codigo,
        nombre: items.nombre,
        categoria: items.categoria,
        unidad: items.unidad,
        presentacion: items.presentacion,
        factor: items.factorPresentacion,
        stockMinimo: items.stockMinimo,
        stockMaximo: items.stockMaximo,
        precioReferencia: items.precioReferencia,
        proveedorNombre: proveedores.nombre,
        activo: items.activo,
      })
      .from(items)
      .leftJoin(proveedores, eq(proveedores.id, items.proveedorPrincipalId))
      .orderBy(items.codigo);

    const stockRows = await db.select().from(stock);
    const stockMap = new Map(stockRows.map((s) => [s.itemId, s.cantidad]));
    const itRows2 = await db.select({ id: items.id, codigo: items.codigo }).from(items);
    const idByCodigo = new Map(itRows2.map((r) => [r.codigo, r.id]));

    const enriched = itRows.map((r) => {
      const id = idByCodigo.get(r.codigo) ?? 0;
      const stockActual = stockMap.get(id) ?? 0;
      const alerta = stockActual < r.stockMinimo
        ? (stockActual <= 0 ? "SIN STOCK" : "BAJO MÍNIMO")
        : "OK";
      const aComprar = r.stockMaximo > 0 && stockActual < r.stockMinimo
        ? Math.max(0, r.stockMaximo - stockActual)
        : 0;
      return { ...r, stockActual, alerta, aComprar };
    });

    const cols = [
      { key: "codigo", label: "Código" },
      { key: "nombre", label: "Nombre" },
      { key: "categoria", label: "Categoría" },
      { key: "unidad", label: "Unidad" },
      { key: "presentacion", label: "Presentación" },
      { key: "factor", label: "Factor" },
      { key: "stockActual", label: "Stock actual" },
      { key: "stockMinimo", label: "Mínimo" },
      { key: "stockMaximo", label: "Máximo" },
      { key: "aComprar", label: "Sugerido a comprar" },
      { key: "alerta", label: "Alerta" },
      { key: "precioReferencia", label: "Precio ref." },
      { key: "proveedorNombre", label: "Proveedor" },
      { key: "activo", label: "Activo" },
    ];
    return csvResponse(`inventario_${stamp()}.csv`, toCsv(enriched, cols));
  }

  if (tipo === "movimientos") {
    const conds: any[] = [];
    if (desde) conds.push(gte(movimientosInventario.createdAt, desde));
    if (hasta) conds.push(lte(movimientosInventario.createdAt, hasta + "T23:59:59"));

    const rows = await db
      .select({
        id: movimientosInventario.id,
        fecha: movimientosInventario.createdAt,
        codigo: items.codigo,
        item: items.nombre,
        unidad: items.unidad,
        tipo: movimientosInventario.tipo,
        cantidad: movimientosInventario.cantidad,
        motivo: movimientosInventario.motivo,
        referencia: movimientosInventario.referencia,
        ordenId: movimientosInventario.ordenId,
        ordenCodigo: ordenes.codigo,
        usuario: usuarios.nombre,
        notas: movimientosInventario.notas,
      })
      .from(movimientosInventario)
      .leftJoin(items, eq(items.id, movimientosInventario.itemId))
      .leftJoin(usuarios, eq(usuarios.id, movimientosInventario.usuarioId))
      .leftJoin(ordenes, eq(ordenes.id, movimientosInventario.ordenId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(movimientosInventario.id));

    // Un repuesto de orden guarda la referencia "orden:<id>": en el archivo se lee el código.
    const filas = rows.map((r) => (r.ordenCodigo && r.referencia === `orden:${r.ordenId}` ? { ...r, referencia: r.ordenCodigo } : r));

    const cols = [
      { key: "fecha", label: "Fecha" },
      { key: "codigo", label: "Código" },
      { key: "item", label: "Item" },
      { key: "unidad", label: "Unidad" },
      { key: "tipo", label: "Movimiento" },
      { key: "cantidad", label: "Cantidad" },
      { key: "motivo", label: "Motivo" },
      { key: "referencia", label: "Referencia" },
      { key: "ordenCodigo", label: "OT" },
      { key: "usuario", label: "Usuario" },
      { key: "notas", label: "Notas" },
    ];
    return csvResponse(`movimientos_${stamp()}.csv`, toCsv(filas, cols));
  }

  if (tipo === "requisiciones") {
    const conds: any[] = [];
    if (desde) conds.push(gte(requisiciones.fechaSolicitud, desde));
    if (hasta) conds.push(lte(requisiciones.fechaSolicitud, hasta + "T23:59:59"));

    const reqRows = await db
      .select({
        numero: requisiciones.numero,
        estado: requisiciones.estado,
        fechaSolicitud: requisiciones.fechaSolicitud,
        fechaNecesidad: requisiciones.fechaNecesidad,
        proveedor: proveedores.nombre,
        total: requisiciones.total,
        origen: requisiciones.origen,
        creadoPor: usuarios.nombre,
        notas: requisiciones.notas,
      })
      .from(requisiciones)
      .leftJoin(proveedores, eq(proveedores.id, requisiciones.proveedorId))
      .leftJoin(usuarios, eq(usuarios.id, requisiciones.creadoPor))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(requisiciones.id));

    const cols = [
      { key: "numero", label: "Número" },
      { key: "estado", label: "Estado" },
      { key: "fechaSolicitud", label: "Fecha solicitud" },
      { key: "fechaNecesidad", label: "Fecha necesidad" },
      { key: "proveedor", label: "Proveedor" },
      { key: "total", label: "Total" },
      { key: "origen", label: "Origen" },
      { key: "creadoPor", label: "Solicitante" },
      { key: "notas", label: "Notas" },
    ];
    return csvResponse(`requisiciones_${stamp()}.csv`, toCsv(reqRows, cols));
  }

  if (tipo === "encuestas") {
    const conds: any[] = [deOrdenes];
    if (desde) conds.push(gte(encuestasSatisfaccion.enviadaEn, desde));
    if (hasta) conds.push(lte(encuestasSatisfaccion.enviadaEn, hasta + "T23:59:59"));

    const rows = await db
      .select({
        ordenCodigo: ordenes.codigo,
        otTitulo: ordenes.titulo,
        equipo: activos.nombre,
        destinatario: encuestasSatisfaccion.destinatarioNombre,
        email: encuestasSatisfaccion.destinatarioEmail,
        enviadaEn: encuestasSatisfaccion.enviadaEn,
        respondidaEn: encuestasSatisfaccion.respondidaEn,
        calificacion: encuestasSatisfaccion.calificacion,
        comentario: encuestasSatisfaccion.comentario,
      })
      .from(encuestasSatisfaccion)
      .leftJoin(ordenes, eq(ordenes.id, encuestasSatisfaccion.ordenId))
      .leftJoin(activos, eq(activos.id, ordenes.activoId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(encuestasSatisfaccion.id));

    const cols = [
      { key: "ordenCodigo", label: "OT" },
      { key: "otTitulo", label: "Título OT" },
      { key: "equipo", label: "Equipo" },
      { key: "destinatario", label: "Solicitante" },
      { key: "email", label: "Email" },
      { key: "enviadaEn", label: "Enviada" },
      { key: "respondidaEn", label: "Respondida" },
      { key: "calificacion", label: "Calificación" },
      { key: "comentario", label: "Comentario" },
    ];
    return csvResponse(`encuestas_${stamp()}.csv`, toCsv(rows, cols));
  }

  if (tipo === "equipos") {
    // Fase 59: los mismos filtros que la lista y la impresión (contrato K-A2). Por
    // defecto «todos», como lo descargaba Reportes. Columnas elegidas: activos más
    // ubicación, sede, centro, proveedor y baja pasaría el límite de 100 de D1.
    const filtros = leerFiltrosInventario(url.searchParams, { estadoPorDefecto: "todos" });
    const hoy = hoySV();
    const rows = await db
      .select({
        id: activos.id, codigo: activos.codigo, numeroActivo: activos.numeroActivo, nombre: activos.nombre,
        rubro: activos.rubro, tipo: activos.tipo, categoria: activos.categoria, subcategoria: activos.subcategoria,
        marca: activos.marca, modelo: activos.modelo, serial: activos.serial, anio: activos.anio, estado: activos.estado,
        criticidadOperacional: activos.criticidadOperacional, claseRiesgo: activos.claseRiesgo, centroCostoId: activos.centroCostoId,
        ubicacionId: activos.ubicacionId, ubicacionDetalle: activos.ubicacion, datosTecnicos: activos.datosTecnicos,
        registroSanitario: activos.registroSanitario, registroSanitarioEntidad: activos.registroSanitarioEntidad,
        registroSanitarioEmision: activos.registroSanitarioEmision, registroSanitarioVencimiento: activos.registroSanitarioVencimiento,
        registroSanitarioNoRequiere: activos.registroSanitarioNoRequiere, fechaAdquisicion: activos.fechaAdquisicion,
        vidaUtilAnios: activos.vidaUtilAnios, valorAdquisicion: activos.valorAdquisicion,
        ultimaCalibracion: activos.ultimaCalibracion, proximaCalibracion: activos.proximaCalibracion,
        slaUrgenteHoras: activos.slaUrgenteHoras, slaAltaHoras: activos.slaAltaHoras, slaMediaHoras: activos.slaMediaHoras, slaBajaHoras: activos.slaBajaHoras,
        ubicacionNombre: ubicaciones.nombre, sucursalId: sucursales.id, sucursal: sucursales.nombre,
        centroCodigo: centrosCosto.codigo, centroNombre: centrosCosto.nombre, proveedor: proveedores.nombre,
        bajaId: activoBajas.id, bajaFecha: activoBajas.fechaBaja, bajaMotivo: activoBajas.motivo, bajaDestino: activoBajas.destinoFinal,
      })
      .from(activos)
      .leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId))
      .leftJoin(sucursales, eq(sucursales.id, ubicaciones.sucursalId))
      .leftJoin(centrosCosto, eq(centrosCosto.id, activos.centroCostoId))
      .leftJoin(proveedores, eq(proveedores.id, activos.proveedorId))
      .leftJoin(activoBajas, and(eq(activoBajas.activoId, activos.id), eq(activoBajas.estado, "vigente")))
      .where(filtros.area ? activoAreaCondition(filtros.area) : condicionActivoEspacio(espacio))
      .orderBy(activos.codigo);

    const filas = rows.filter((r) => pasaFiltros(aFilaInventario({
      a: { ...r, ubicacion: r.ubicacionDetalle },
      ub: r.ubicacionId != null ? { id: r.ubicacionId, nombre: r.ubicacionNombre ?? "" } : null,
      suc: r.sucursalId != null ? { id: r.sucursalId, nombre: r.sucursal ?? "" } : null,
      cc: r.centroCostoId != null && r.centroCodigo ? { id: r.centroCostoId, codigo: r.centroCodigo, nombre: r.centroNombre ?? "" } : null,
    }), filtros, hoy)).map((r) => filaExportacion(r, hoy));
    const nombre = `equipos_${filtros.area ?? "todas"}_${filtros.estado}_${stamp()}.csv`;
    return csvResponse(nombre, toCsv(filas, columnasExportacion()));
  }

  return Response.json({ error: "Tipo de reporte no válido" }, { status: 404 });
};

/** AAAAMMDD de hoy en El Salvador (no la fecha UTC). */
function stamp(): string {
  return hoySV().replaceAll("-", "");
}
