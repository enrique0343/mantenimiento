import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  requisiciones, requisicionItems, recepciones, recepcionItems,
  movimientosInventario, stock,
} from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

const recibirSchema = z.object({
  numeroFactura: z.string().optional().nullable(),
  fecha: z.string().min(1),
  notas: z.string().optional().nullable(),
  // Cantidades recibidas por linea
  recepciones: z.array(z.object({
    lineaId: z.number().int().positive(),
    cantidad: z.number().nonnegative(),
    precioUnitario: z.number().nonnegative().optional().nullable(),
  })).min(1),
});

// Convierte una requisición aprobada en recepción de inventario
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;

  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = recibirSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [req] = await db.select().from(requisiciones).where(eq(requisiciones.id, id)).limit(1);
  if (!req) return Response.json({ error: "Requisición no existe" }, { status: 404 });
  if (req.estado !== "aprobada" && req.estado !== "recibida_parcial") {
    return Response.json({ error: `No se puede recibir en estado "${req.estado}"` }, { status: 400 });
  }

  // Cargar líneas
  const lineas = await db.select().from(requisicionItems).where(eq(requisicionItems.requisicionId, id));
  const lineaMap = new Map(lineas.map((l) => [l.id, l]));

  // Validar cantidades a recibir vs cantidades pendientes
  for (const rec of parsed.data.recepciones) {
    const linea = lineaMap.get(rec.lineaId);
    if (!linea) return Response.json({ error: `Línea ${rec.lineaId} no existe` }, { status: 400 });
    const pendiente = linea.cantidad - linea.cantidadRecibida;
    if (rec.cantidad > pendiente) {
      return Response.json(
        { error: `Línea ${rec.lineaId}: cantidad ${rec.cantidad} excede pendiente (${pendiente})` },
        { status: 400 }
      );
    }
  }

  // Crear recepcion (sin sucursal — bodega única)
  const totalRecep = parsed.data.recepciones.reduce(
    (s, r) => s + (r.precioUnitario ?? 0) * r.cantidad, 0
  );
  const [recep] = await db.insert(recepciones).values({
    proveedorId: req.proveedorId ?? null,
    numeroFactura: parsed.data.numeroFactura ?? null,
    fecha: parsed.data.fecha,
    total: totalRecep > 0 ? totalRecep : null,
    notas: parsed.data.notas ?? `Recepción de requisición ${req.numero}`,
    recibidoPor: user.id,
  }).returning();

  // Para cada linea recibida: crea recepcion_item, actualiza stock, registra movimiento
  for (const rec of parsed.data.recepciones) {
    if (rec.cantidad <= 0) continue;
    const linea = lineaMap.get(rec.lineaId)!;

    await db.insert(recepcionItems).values({
      recepcionId: recep.id,
      itemId: linea.itemId,
      cantidad: rec.cantidad,
      precioUnitario: rec.precioUnitario ?? linea.precioUnitario ?? null,
    });

    await db.insert(movimientosInventario).values({
      itemId: linea.itemId,
      tipo: "entrada",
      cantidad: rec.cantidad,
      motivo: "recepcion",
      referencia: `req:${req.numero} recep:${recep.id}`,
      recepcionId: recep.id,
      usuarioId: user.id,
    });

    // Upsert stock
    const [actual] = await db.select().from(stock).where(eq(stock.itemId, linea.itemId)).limit(1);
    if (actual) {
      await db.update(stock)
        .set({ cantidad: actual.cantidad + rec.cantidad, updatedAt: new Date().toISOString() })
        .where(eq(stock.id, actual.id));
    } else {
      await db.insert(stock).values({ itemId: linea.itemId, cantidad: rec.cantidad });
    }

    // Actualizar cantidad_recibida en la linea
    await db.update(requisicionItems)
      .set({ cantidadRecibida: linea.cantidadRecibida + rec.cantidad })
      .where(eq(requisicionItems.id, linea.id));
  }

  // Actualizar estado de la requisición
  const lineasActualizadas = await db.select().from(requisicionItems).where(eq(requisicionItems.requisicionId, id));
  const todasCompletas = lineasActualizadas.every((l) => l.cantidadRecibida >= l.cantidad);
  await db.update(requisiciones)
    .set({
      estado: todasCompletas ? "recibida" : "recibida_parcial",
      recepcionId: req.recepcionId ?? recep.id,
    })
    .where(eq(requisiciones.id, id));

  return Response.json({ recepcion: recep, requisicionEstado: todasCompletas ? "recibida" : "recibida_parcial" }, { status: 201 });
};
