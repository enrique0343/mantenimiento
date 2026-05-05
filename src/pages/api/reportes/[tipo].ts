import type { APIRoute } from "astro";
import { eq, gte, lte, and, desc, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  ordenes, activos, usuarios, items, stock, movimientosInventario,
  requisiciones, requisicionItems, proveedores, encuestasSatisfaccion,
  ubicaciones, sucursales,
} from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { toCsv, csvResponse, rangoFechas } from "@/lib/csv";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const tipo = ctx.params.tipo!;
  const url = new URL(ctx.request.url);
  const { desde, hasta } = rangoFechas(url);
  const db = getDb(ctx);

  if (tipo === "ordenes") {
    const conds: any[] = [];
    if (desde) conds.push(gte(ordenes.createdAt, desde));
    if (hasta) conds.push(lte(ordenes.createdAt, hasta + "T23:59:59"));
    const estado = url.searchParams.get("estado");
    if (estado) conds.push(eq(ordenes.estado, estado as any));

    const rows = await db
      .select({
        id: ordenes.id,
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
      { key: "id", label: "OT" },
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
        usuario: usuarios.nombre,
        notas: movimientosInventario.notas,
      })
      .from(movimientosInventario)
      .leftJoin(items, eq(items.id, movimientosInventario.itemId))
      .leftJoin(usuarios, eq(usuarios.id, movimientosInventario.usuarioId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(movimientosInventario.id));

    const cols = [
      { key: "fecha", label: "Fecha" },
      { key: "codigo", label: "Código" },
      { key: "item", label: "Item" },
      { key: "unidad", label: "Unidad" },
      { key: "tipo", label: "Movimiento" },
      { key: "cantidad", label: "Cantidad" },
      { key: "motivo", label: "Motivo" },
      { key: "referencia", label: "Referencia" },
      { key: "ordenId", label: "OT" },
      { key: "usuario", label: "Usuario" },
      { key: "notas", label: "Notas" },
    ];
    return csvResponse(`movimientos_${stamp()}.csv`, toCsv(rows, cols));
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
    const conds: any[] = [];
    if (desde) conds.push(gte(encuestasSatisfaccion.enviadaEn, desde));
    if (hasta) conds.push(lte(encuestasSatisfaccion.enviadaEn, hasta + "T23:59:59"));

    const rows = await db
      .select({
        ordenId: encuestasSatisfaccion.ordenId,
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
      { key: "ordenId", label: "OT" },
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
    const rows = await db
      .select({
        codigo: activos.codigo,
        nombre: activos.nombre,
        tipo: activos.tipo,
        categoria: activos.categoria,
        marca: activos.marca,
        modelo: activos.modelo,
        serial: activos.serial,
        anio: activos.anio,
        estado: activos.estado,
        ubicacion: ubicaciones.nombre,
        sucursal: sucursales.nombre,
        slaUrgenteHoras: activos.slaUrgenteHoras,
        slaAltaHoras: activos.slaAltaHoras,
        slaMediaHoras: activos.slaMediaHoras,
        slaBajaHoras: activos.slaBajaHoras,
        registroSanitario: activos.registroSanitario,
        claseRiesgo: activos.claseRiesgo,
        ultimaCalibracion: activos.ultimaCalibracion,
        proximaCalibracion: activos.proximaCalibracion,
      })
      .from(activos)
      .leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId))
      .leftJoin(sucursales, eq(sucursales.id, ubicaciones.sucursalId))
      .orderBy(activos.codigo);

    const cols = [
      { key: "codigo", label: "Código" },
      { key: "nombre", label: "Nombre" },
      { key: "tipo", label: "Tipo" },
      { key: "categoria", label: "Categoría" },
      { key: "marca", label: "Marca" },
      { key: "modelo", label: "Modelo" },
      { key: "serial", label: "Serial" },
      { key: "anio", label: "Año" },
      { key: "estado", label: "Estado" },
      { key: "sucursal", label: "Sucursal" },
      { key: "ubicacion", label: "Ubicación" },
      { key: "slaUrgenteHoras", label: "SLA Urgente (h)" },
      { key: "slaAltaHoras", label: "SLA Alta (h)" },
      { key: "slaMediaHoras", label: "SLA Media (h)" },
      { key: "slaBajaHoras", label: "SLA Baja (h)" },
      { key: "registroSanitario", label: "Registro DNM" },
      { key: "claseRiesgo", label: "Clase riesgo" },
      { key: "ultimaCalibracion", label: "Última calibración" },
      { key: "proximaCalibracion", label: "Próxima calibración" },
    ];
    return csvResponse(`equipos_${stamp()}.csv`, toCsv(rows, cols));
  }

  return Response.json({ error: "Tipo de reporte no válido" }, { status: 404 });
};

function stamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
