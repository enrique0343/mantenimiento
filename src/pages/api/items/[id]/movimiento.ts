import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { items, stock, movimientosInventario } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

const movSchema = z.object({
  sucursalId: z.number().int().positive(),
  tipo: z.enum(["entrada", "salida", "ajuste"]),
  cantidad: z.number().positive(),
  motivo: z.string().optional().nullable(),
  notas: z.string().optional().nullable(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const itemId = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = movSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const { sucursalId, tipo, cantidad, motivo, notas } = parsed.data;

  const db = getDb(ctx);

  const [it] = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  if (!it) return Response.json({ error: "Item no existe" }, { status: 404 });

  // Stock actual
  const [actual] = await db
    .select()
    .from(stock)
    .where(and(eq(stock.itemId, itemId), eq(stock.sucursalId, sucursalId)))
    .limit(1);
  const cantidadActual = actual?.cantidad ?? 0;

  // Calcula nueva cantidad segun tipo
  let nuevaCantidad: number;
  if (tipo === "entrada") nuevaCantidad = cantidadActual + cantidad;
  else if (tipo === "salida") nuevaCantidad = cantidadActual - cantidad;
  else nuevaCantidad = cantidad; // ajuste = nueva cantidad absoluta

  if (tipo === "salida" && nuevaCantidad < 0) {
    return Response.json(
      { error: `Stock insuficiente: hay ${cantidadActual} ${it.unidad} disponibles` },
      { status: 400 }
    );
  }

  // Upsert stock
  if (actual) {
    await db
      .update(stock)
      .set({ cantidad: nuevaCantidad, updatedAt: new Date().toISOString() })
      .where(eq(stock.id, actual.id));
  } else {
    await db.insert(stock).values({ itemId, sucursalId, cantidad: nuevaCantidad });
  }

  // Registra movimiento
  const [mov] = await db
    .insert(movimientosInventario)
    .values({
      itemId,
      sucursalId,
      tipo,
      cantidad: tipo === "ajuste" ? nuevaCantidad - cantidadActual : cantidad,
      motivo: motivo ?? "ajuste_manual",
      usuarioId: user.id,
      notas: notas ?? null,
    })
    .returning();

  return Response.json({ movimiento: mov, stockNuevo: nuevaCantidad }, { status: 201 });
};
