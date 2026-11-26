import type { APIRoute } from "astro";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import {
  ordenRepuestos, items, stock, movimientosInventario, usuarios,
} from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { ErrorAlcanceOrden, guardAlcanceD1, leerOrdenConAlcance } from "@/lib/orden-alcance";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const ordenId = Number(ctx.params.id);
  const db = getDb(ctx);
  const rows = await db
    .select({ rep: ordenRepuestos, it: items, u: usuarios })
    .from(ordenRepuestos)
    .leftJoin(items, eq(items.id, ordenRepuestos.itemId))
    .leftJoin(usuarios, eq(usuarios.id, ordenRepuestos.registradoPor))
    .where(eq(ordenRepuestos.ordenId, ordenId))
    .orderBy(desc(ordenRepuestos.id));
  return Response.json({
    repuestos: rows.map((r) => ({
      ...r.rep,
      item: r.it ? { id: r.it.id, codigo: r.it.codigo, nombre: r.it.nombre, unidad: r.it.unidad } : null,
      registrado: r.u ? { id: r.u.id, nombre: r.u.nombre } : null,
    })),
  });
};

const consumoSchema = z.object({
  itemId: z.number().int().positive(),
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

  let alcance;
  try { alcance = await leerOrdenConAlcance(db, ordenId, user, { roles: ["admin", "jefe", "tecnico"] }); }
  catch (error) {
    if (error instanceof ErrorAlcanceOrden) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
  const { orden } = alcance;
  if (orden.estado === "cerrada" || orden.estado === "cancelada") {
    return Response.json({ error: "No se pueden consumir repuestos en una orden cerrada/cancelada" }, { status: 400 });
  }

  // Verifica stock disponible (bodega única)
  const [actual] = await db.select().from(stock).where(eq(stock.itemId, parsed.data.itemId)).limit(1);
  const disponible = actual?.cantidad ?? 0;
  if (disponible < parsed.data.cantidad) {
    const [it] = await db.select({ unidad: items.unidad }).from(items).where(eq(items.id, parsed.data.itemId)).limit(1);
    return Response.json(
      { error: `Stock insuficiente: hay ${disponible} ${it?.unidad ?? ""} disponibles en bodega` },
      { status: 400 }
    );
  }

  // El alcance se vuelve a comprobar dentro de la misma transacción que consume
  // stock. Una derivación o un consumo concurrente no deja descuentos huérfanos.
  const DB = getEnv(ctx).DB;
  const guard = guardAlcanceD1(db, alcance.guard);
  const { itemId, cantidad } = parsed.data;
  const result = await DB.batch([
    DB.prepare(`UPDATE stock SET cantidad=cantidad-?,updated_at=?
      WHERE id=? AND item_id=? AND cantidad>=? AND (${guard.sql})`)
      .bind(cantidad, new Date().toISOString(), actual!.id, itemId, cantidad, ...guard.params),
    DB.prepare(`INSERT INTO orden_repuestos(orden_id,item_id,cantidad,precio_unitario,notas,registrado_por)
      SELECT ?,?,?,?,?,? WHERE changes()=1 RETURNING id`)
      .bind(ordenId, itemId, cantidad, parsed.data.precioUnitario ?? null, parsed.data.notas ?? null, user.id),
    DB.prepare(`INSERT INTO movimientos_inventario(item_id,tipo,cantidad,motivo,referencia,orden_id,usuario_id)
      SELECT ?,'salida',?,'consumo_ot',?,?,? WHERE changes()=1`)
      .bind(itemId, cantidad, `orden:${ordenId}`, ordenId, user.id),
  ]);
  if (!result[0].meta.changes) return Response.json({ error: "La orden o las existencias cambiaron. Actualiza la página antes de registrar el consumo." }, { status: 409 });
  const repuestoId = Number((result[1].results[0] as { id: number }).id);
  const [rep] = await db.select().from(ordenRepuestos).where(eq(ordenRepuestos.id, repuestoId)).limit(1);

  return Response.json({ repuesto: rep }, { status: 201 });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const url = new URL(ctx.request.url);
  const repuestoId = Number(url.searchParams.get("repuesto_id"));
  if (!repuestoId) return Response.json({ error: "repuesto_id requerido" }, { status: 400 });

  const db = getDb(ctx);
  const [rep] = await db.select().from(ordenRepuestos).where(eq(ordenRepuestos.id, repuestoId)).limit(1);
  if (!rep) return Response.json({ error: "Consumo no existe" }, { status: 404 });

  // Devuelve al stock (bodega única)
  const [actual] = await db.select().from(stock).where(eq(stock.itemId, rep.itemId)).limit(1);
  if (actual) {
    await db.update(stock)
      .set({ cantidad: actual.cantidad + rep.cantidad, updatedAt: new Date().toISOString() })
      .where(eq(stock.id, actual.id));
  } else {
    await db.insert(stock).values({ itemId: rep.itemId, cantidad: rep.cantidad });
  }

  await db.insert(movimientosInventario).values({
    itemId: rep.itemId,
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
