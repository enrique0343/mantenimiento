import type { APIRoute } from "astro";
import { z } from "zod";
import { desc, eq, and } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  recepciones, recepcionItems, movimientosInventario, stock,
  items as itemsTable, proveedores, sucursales, usuarios,
} from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const db = getDb(ctx);
  const rows = await db
    .select({ r: recepciones, p: proveedores, s: sucursales, u: usuarios })
    .from(recepciones)
    .leftJoin(proveedores, eq(proveedores.id, recepciones.proveedorId))
    .leftJoin(sucursales, eq(sucursales.id, recepciones.sucursalId))
    .leftJoin(usuarios, eq(usuarios.id, recepciones.recibidoPor))
    .orderBy(desc(recepciones.id));
  return Response.json({
    recepciones: rows.map((r) => ({
      ...r.r,
      proveedor: r.p ? { id: r.p.id, nombre: r.p.nombre } : null,
      sucursal: r.s ? { id: r.s.id, nombre: r.s.nombre } : null,
      recibido: r.u ? { id: r.u.id, nombre: r.u.nombre } : null,
    })),
  });
};

const itemLineSchema = z.object({
  itemId: z.number().int().positive(),
  cantidad: z.number().positive(),
  precioUnitario: z.number().nonnegative().optional().nullable(),
});

const createSchema = z.object({
  proveedorId: z.number().int().positive().optional().nullable(),
  sucursalId: z.number().int().positive(),
  numeroFactura: z.string().optional().nullable(),
  fecha: z.string().min(1), // YYYY-MM-DD
  notas: z.string().optional().nullable(),
  items: z.array(itemLineSchema).min(1),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const total = parsed.data.items.reduce(
    (s, li) => s + (li.precioUnitario ?? 0) * li.cantidad,
    0
  );

  const [recep] = await db
    .insert(recepciones)
    .values({
      proveedorId: parsed.data.proveedorId ?? null,
      sucursalId: parsed.data.sucursalId,
      numeroFactura: parsed.data.numeroFactura ?? null,
      fecha: parsed.data.fecha,
      total: total > 0 ? total : null,
      notas: parsed.data.notas ?? null,
      recibidoPor: user.id,
    })
    .returning();

  // Por cada linea: registra recepcion_item + movimiento ENTRADA + actualiza stock
  for (const li of parsed.data.items) {
    await db.insert(recepcionItems).values({
      recepcionId: recep.id,
      itemId: li.itemId,
      cantidad: li.cantidad,
      precioUnitario: li.precioUnitario ?? null,
    });

    await db.insert(movimientosInventario).values({
      itemId: li.itemId,
      sucursalId: parsed.data.sucursalId,
      tipo: "entrada",
      cantidad: li.cantidad,
      motivo: "recepcion",
      referencia: `recepcion:${recep.id}`,
      recepcionId: recep.id,
      usuarioId: user.id,
    });

    // Upsert stock
    const [actual] = await db
      .select()
      .from(stock)
      .where(and(eq(stock.itemId, li.itemId), eq(stock.sucursalId, parsed.data.sucursalId)))
      .limit(1);
    if (actual) {
      await db
        .update(stock)
        .set({ cantidad: actual.cantidad + li.cantidad, updatedAt: new Date().toISOString() })
        .where(eq(stock.id, actual.id));
    } else {
      await db.insert(stock).values({
        itemId: li.itemId,
        sucursalId: parsed.data.sucursalId,
        cantidad: li.cantidad,
      });
    }
  }

  return Response.json({ recepcion: recep }, { status: 201 });
};
