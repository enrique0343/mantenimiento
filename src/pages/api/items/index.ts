import type { APIRoute } from "astro";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { items, stock, proveedores } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const db = getDb(ctx);

  // Items + stock (bodega única, una sola fila por item)
  const baseRows = await db
    .select({
      item: items,
      proveedor: proveedores,
    })
    .from(items)
    .leftJoin(proveedores, eq(proveedores.id, items.proveedorPrincipalId))
    .orderBy(desc(items.id));

  const stockRows = await db
    .select({ itemId: stock.itemId, cantidad: stock.cantidad })
    .from(stock);
  const stockMap = new Map<number, number>();
  for (const s of stockRows) stockMap.set(s.itemId, Number(s.cantidad ?? 0));

  return Response.json({
    items: baseRows.map((r) => ({
      ...r.item,
      proveedor: r.proveedor ? { id: r.proveedor.id, nombre: r.proveedor.nombre } : null,
      stockActual: stockMap.get(r.item.id) ?? 0,
    })),
  });
};

const createSchema = z.object({
  codigo: z.string().min(1),
  nombre: z.string().min(1),
  descripcion: z.string().nullable().optional(),
  categoria: z.string().nullable().optional(),
  unidad: z.string().min(1).default("unidad"),
  stockMinimo: z.number().nonnegative().default(0),
  stockMaximo: z.number().nonnegative().default(0),
  presentacion: z.string().nullable().optional(),
  factorPresentacion: z.number().positive().default(1),
  proveedorPrincipalId: z.number().int().nullable().optional(),
  precioReferencia: z.number().nullable().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  try {
    const [row] = await db.insert(items).values(parsed.data).returning();
    return Response.json({ item: row }, { status: 201 });
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      return Response.json({ error: "Código ya existe" }, { status: 409 });
    }
    throw e;
  }
};
