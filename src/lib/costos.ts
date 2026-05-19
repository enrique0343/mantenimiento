// Cálculo de costo de OT: mano de obra + repuestos consumidos.

import type { APIContext } from "astro";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { ordenes, usuarios, ordenRepuestos, items } from "./schema";

export interface CostoOT {
  manoObra: number;
  repuestos: number;
  total: number;
  detalleHoras: { horas: number; tarifa: number };
  detalleRepuestos: Array<{
    codigo: string | null;
    nombre: string | null;
    cantidad: number;
    precioUnit: number | null;
    subtotal: number;
  }>;
}

export async function calcularCostoOT(ctx: APIContext, ordenId: number): Promise<CostoOT> {
  const db = getDb(ctx);
  const [ot] = await db
    .select({ horas: ordenes.horasTrabajadas, tarifa: usuarios.tarifaHora })
    .from(ordenes)
    .leftJoin(usuarios, eq(usuarios.id, ordenes.asignadoA))
    .where(eq(ordenes.id, ordenId))
    .limit(1);

  const horas = Number(ot?.horas ?? 0);
  const tarifa = Number(ot?.tarifa ?? 0);
  const manoObra = horas * tarifa;

  const reps = await db
    .select({
      codigo: items.codigo,
      nombre: items.nombre,
      cantidad: ordenRepuestos.cantidad,
      precioUnit: ordenRepuestos.precioUnitario,
      precioRef: items.precioReferencia,
    })
    .from(ordenRepuestos)
    .leftJoin(items, eq(items.id, ordenRepuestos.itemId))
    .where(eq(ordenRepuestos.ordenId, ordenId));

  let totalRep = 0;
  const detalleRepuestos = reps.map((r) => {
    const precio = r.precioUnit ?? r.precioRef ?? 0;
    const subtotal = Number(r.cantidad) * Number(precio);
    totalRep += subtotal;
    return {
      codigo: r.codigo,
      nombre: r.nombre,
      cantidad: Number(r.cantidad),
      precioUnit: r.precioUnit ?? r.precioRef ?? null,
      subtotal,
    };
  });

  return {
    manoObra,
    repuestos: totalRep,
    total: manoObra + totalRep,
    detalleHoras: { horas, tarifa },
    detalleRepuestos,
  };
}
