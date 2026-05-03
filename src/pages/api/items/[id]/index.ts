import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { items, stock, sucursales, movimientosInventario, usuarios, proveedores } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);

  const [row] = await db
    .select({ item: items, proveedor: proveedores })
    .from(items)
    .leftJoin(proveedores, eq(proveedores.id, items.proveedorPrincipalId))
    .where(eq(items.id, id))
    .limit(1);
  if (!row) return Response.json({ error: "No encontrado" }, { status: 404 });

  // Stock por sucursal
  const stockRows = await db
    .select({ s: stock, suc: sucursales })
    .from(stock)
    .leftJoin(sucursales, eq(sucursales.id, stock.sucursalId))
    .where(eq(stock.itemId, id));

  // Ultimos 50 movimientos
  const movRows = await db
    .select({ m: movimientosInventario, u: usuarios, suc: sucursales })
    .from(movimientosInventario)
    .leftJoin(usuarios, eq(usuarios.id, movimientosInventario.usuarioId))
    .leftJoin(sucursales, eq(sucursales.id, movimientosInventario.sucursalId))
    .where(eq(movimientosInventario.itemId, id))
    .orderBy(desc(movimientosInventario.id))
    .limit(50);

  return Response.json({
    item: {
      ...row.item,
      proveedor: row.proveedor ? { id: row.proveedor.id, nombre: row.proveedor.nombre } : null,
    },
    stock: stockRows.map((r) => ({ ...r.s, sucursal: r.suc ? { id: r.suc.id, nombre: r.suc.nombre } : null })),
    movimientos: movRows.map((r) => ({
      ...r.m,
      usuario: r.u ? { id: r.u.id, nombre: r.u.nombre } : null,
      sucursal: r.suc ? { id: r.suc.id, nombre: r.suc.nombre } : null,
    })),
  });
};

const updateSchema = z.object({
  codigo: z.string().min(1).optional(),
  nombre: z.string().min(1).optional(),
  descripcion: z.string().nullable().optional(),
  categoria: z.string().nullable().optional(),
  unidad: z.string().min(1).optional(),
  stockMinimo: z.number().nonnegative().optional(),
  proveedorPrincipalId: z.number().int().nullable().optional(),
  precioReferencia: z.number().nullable().optional(),
  activo: z.boolean().optional(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const [row] = await db.update(items).set(parsed.data).where(eq(items.id, id)).returning();
  if (!row) return Response.json({ error: "No encontrado" }, { status: 404 });
  return Response.json({ item: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  // Soft delete (mantener historial de movimientos)
  await db.update(items).set({ activo: false }).where(eq(items.id, id));
  return Response.json({ ok: true });
};
