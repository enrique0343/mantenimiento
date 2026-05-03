import type { APIRoute } from "astro";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  ordenRepuestos, ordenes, items, stock, movimientosInventario, usuarios, sucursales,
} from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const ordenId = Number(ctx.params.id);
  const db = getDb(ctx);
  const rows = await db
    .select({ rep: ordenRepuestos, it: items, suc: sucursales, u: usuarios })
    .from(ordenRepuestos)
    .leftJoin(items, eq(items.id, ordenRepuestos.itemId))
    .leftJoin(sucursales, eq(sucursales.id, ordenRepuestos.sucursalId))
    .leftJoin(usuarios, eq(usuarios.id, ordenRepuestos.registradoPor))
    .where(eq(ordenRepuestos.ordenId, ordenId))
    .orderBy(desc(ordenRepuestos.id));
  return Response.json({
    repuestos: rows.map((r) => ({
      ...r.rep,
      item: r.it ? { id: r.it.id, codigo: r.it.codigo, nombre: r.it.nombre, unidad: r.it.unidad } : null,
      sucursal: r.suc ? { id: r.suc.id, nombre: r.suc.nombre } : null,
      registrado: r.u ? { id: r.u.id, nombre: r.u.nombre } : null,
    })),
  });
};

const consumoSchema = z.object({
  itemId: z.number().int().positive(),
  sucursalId: z.number().int().positive(),
  cantidad: z.number().positive(),
  precioUnitario: z.number().nonnegative().optional().nullable(),
  notas: z.string().optional().nullable(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const ordenId = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = consumoSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);

  // Verifica orden
  const [orden] = await db.select().from(ordenes).where(eq(ordenes.id, ordenId)).limit(1);
  if (!orden) return Response.json({ error: "Orden no existe" }, { status: 404 });
  if (orden.estado === "cerrada" || orden.estado === "cancelada") {
    return Response.json({ error: "No se pueden consumir repuestos en una orden cerrada/cancelada" }, { status: 400 });
  }

  // Verifica stock disponible
  const [actual] = await db
    .select()
    .from(stock)
    .where(and(eq(stock.itemId, parsed.data.itemId), eq(stock.sucursalId, parsed.data.sucursalId)))
    .limit(1);
  const disponible = actual?.cantidad ?? 0;
  if (disponible < parsed.data.cantidad) {
    const [it] = await db.select({ unidad: items.unidad }).from(items).where(eq(items.id, parsed.data.itemId)).limit(1);
    return Response.json(
      { error: `Stock insuficiente: hay ${disponible} ${it?.unidad ?? ""} disponibles en esta sucursal` },
      { status: 400 }
    );
  }

  // Registra el consumo + movimiento de salida + actualiza stock
  const [rep] = await db
    .insert(ordenRepuestos)
    .values({
      ordenId,
      itemId: parsed.data.itemId,
      sucursalId: parsed.data.sucursalId,
      cantidad: parsed.data.cantidad,
      precioUnitario: parsed.data.precioUnitario ?? null,
      notas: parsed.data.notas ?? null,
      registradoPor: user.id,
    })
    .returning();

  await db.insert(movimientosInventario).values({
    itemId: parsed.data.itemId,
    sucursalId: parsed.data.sucursalId,
    tipo: "salida",
    cantidad: parsed.data.cantidad,
    motivo: "consumo_ot",
    referencia: `orden:${ordenId}`,
    ordenId,
    usuarioId: user.id,
  });

  await db
    .update(stock)
    .set({ cantidad: disponible - parsed.data.cantidad, updatedAt: new Date().toISOString() })
    .where(eq(stock.id, actual!.id));

  return Response.json({ repuesto: rep }, { status: 201 });
};

// DELETE: revierte un consumo (devuelve al stock)
export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const url = new URL(ctx.request.url);
  const repuestoId = Number(url.searchParams.get("repuesto_id"));
  if (!repuestoId) return Response.json({ error: "repuesto_id requerido" }, { status: 400 });

  const db = getDb(ctx);
  const [rep] = await db.select().from(ordenRepuestos).where(eq(ordenRepuestos.id, repuestoId)).limit(1);
  if (!rep) return Response.json({ error: "Consumo no existe" }, { status: 404 });

  // Devuelve al stock
  const [actual] = await db
    .select()
    .from(stock)
    .where(and(eq(stock.itemId, rep.itemId), eq(stock.sucursalId, rep.sucursalId)))
    .limit(1);
  if (actual) {
    await db.update(stock)
      .set({ cantidad: actual.cantidad + rep.cantidad, updatedAt: new Date().toISOString() })
      .where(eq(stock.id, actual.id));
  } else {
    await db.insert(stock).values({ itemId: rep.itemId, sucursalId: rep.sucursalId, cantidad: rep.cantidad });
  }

  // Movimiento de devolucion
  await db.insert(movimientosInventario).values({
    itemId: rep.itemId,
    sucursalId: rep.sucursalId,
    tipo: "entrada",
    cantidad: rep.cantidad,
    motivo: "devolucion",
    referencia: `orden:${rep.ordenId}`,
    ordenId: rep.ordenId,
    usuarioId: user.id,
    notas: "Reverso de consumo en OT",
  });

  await db.delete(ordenRepuestos).where(eq(ordenRepuestos.id, repuestoId));

  return Response.json({ ok: true });
};
