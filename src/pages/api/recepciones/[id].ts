import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { recepciones, recepcionItems, items as itemsTable, proveedores, usuarios } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);

  const [r] = await db
    .select({ rec: recepciones, p: proveedores, u: usuarios })
    .from(recepciones)
    .leftJoin(proveedores, eq(proveedores.id, recepciones.proveedorId))
    .leftJoin(usuarios, eq(usuarios.id, recepciones.recibidoPor))
    .where(eq(recepciones.id, id))
    .limit(1);
  if (!r) return Response.json({ error: "No encontrado" }, { status: 404 });

  const lineas = await db
    .select({ li: recepcionItems, it: itemsTable })
    .from(recepcionItems)
    .leftJoin(itemsTable, eq(itemsTable.id, recepcionItems.itemId))
    .where(eq(recepcionItems.recepcionId, id));

  return Response.json({
    recepcion: {
      ...r.rec,
      proveedor: r.p ? { id: r.p.id, nombre: r.p.nombre } : null,
      recibido: r.u ? { id: r.u.id, nombre: r.u.nombre } : null,
    },
    items: lineas.map((l) => ({
      ...l.li,
      item: l.it ? { id: l.it.id, codigo: l.it.codigo, nombre: l.it.nombre, unidad: l.it.unidad } : null,
    })),
  });
};
