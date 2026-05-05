import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { items, stock, proveedores } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

// Devuelve items con stock <= mínimo, calculando cantidad sugerida = máximo - actual
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const db = getDb(ctx);

  const itRows = await db
    .select({ it: items, prov: proveedores })
    .from(items)
    .leftJoin(proveedores, eq(proveedores.id, items.proveedorPrincipalId))
    .where(eq(items.activo, true));

  const stockRows = await db.select().from(stock);
  const stockMap = new Map<number, number>();
  for (const s of stockRows) stockMap.set(s.itemId, s.cantidad);

  const sugerencia = itRows
    .map((r) => {
      const actual = stockMap.get(r.it.id) ?? 0;
      const necesita = actual < r.it.stockMinimo;
      const sugerida = necesita && r.it.stockMaximo > 0
        ? Math.max(0, r.it.stockMaximo - actual)
        : 0;
      return {
        itemId: r.it.id,
        codigo: r.it.codigo,
        nombre: r.it.nombre,
        unidad: r.it.unidad,
        presentacion: r.it.presentacion,
        factorPresentacion: r.it.factorPresentacion,
        precioReferencia: r.it.precioReferencia,
        stockActual: actual,
        stockMinimo: r.it.stockMinimo,
        stockMaximo: r.it.stockMaximo,
        cantidadSugerida: sugerida,
        proveedorId: r.it.proveedorPrincipalId,
        proveedorNombre: r.prov?.nombre ?? null,
      };
    })
    .filter((s) => s.cantidadSugerida > 0);

  return Response.json({ items: sugerencia });
};
