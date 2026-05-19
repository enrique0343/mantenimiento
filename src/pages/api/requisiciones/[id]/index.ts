import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { requisiciones, requisicionItems, items as itemsTable, proveedores, usuarios } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { transicionesReq, type EstadoReq } from "@/lib/requisiciones";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);

  const [r] = await db
    .select({ rec: requisiciones, p: proveedores, u: usuarios })
    .from(requisiciones)
    .leftJoin(proveedores, eq(proveedores.id, requisiciones.proveedorId))
    .leftJoin(usuarios, eq(usuarios.id, requisiciones.creadoPor))
    .where(eq(requisiciones.id, id))
    .limit(1);
  if (!r) return Response.json({ error: "No encontrada" }, { status: 404 });

  const lineas = await db
    .select({ li: requisicionItems, it: itemsTable })
    .from(requisicionItems)
    .leftJoin(itemsTable, eq(itemsTable.id, requisicionItems.itemId))
    .where(eq(requisicionItems.requisicionId, id));

  return Response.json({
    requisicion: {
      ...r.rec,
      proveedor: r.p ? { id: r.p.id, nombre: r.p.nombre } : null,
      creado: r.u ? { id: r.u.id, nombre: r.u.nombre } : null,
    },
    items: lineas.map((l) => ({
      ...l.li,
      item: l.it ? { id: l.it.id, codigo: l.it.codigo, nombre: l.it.nombre, unidad: l.it.unidad } : null,
    })),
  });
};

const patchSchema = z.object({
  estado: z.enum(["borrador", "enviada", "aprobada", "rechazada", "recibida_parcial", "recibida", "cancelada"]).optional(),
  proveedorId: z.number().int().positive().optional().nullable(),
  fechaNecesidad: z.string().optional().nullable(),
  notas: z.string().optional().nullable(),
  rechazadoMotivo: z.string().optional().nullable(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [actual] = await db.select().from(requisiciones).where(eq(requisiciones.id, id)).limit(1);
  if (!actual) return Response.json({ error: "No encontrada" }, { status: 404 });

  const data: Record<string, unknown> = { ...parsed.data };
  const now = new Date().toISOString();

  if (parsed.data.estado && parsed.data.estado !== actual.estado) {
    const permitidas = transicionesReq(actual.estado as EstadoReq, user.rol);
    if (!permitidas.includes(parsed.data.estado as EstadoReq)) {
      return Response.json(
        { error: `No tienes permiso para mover de "${actual.estado}" a "${parsed.data.estado}"` },
        { status: 403 }
      );
    }
    if (parsed.data.estado === "aprobada") {
      data.aprobadoPor = user.id;
      data.aprobadoEn = now;
    }
  }

  const [row] = await db.update(requisiciones).set(data).where(eq(requisiciones.id, id)).returning();
  return Response.json({ requisicion: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  const [actual] = await db.select().from(requisiciones).where(eq(requisiciones.id, id)).limit(1);
  if (!actual) return Response.json({ error: "No encontrada" }, { status: 404 });
  if (actual.estado !== "borrador" && actual.estado !== "rechazada" && actual.estado !== "cancelada") {
    return Response.json({ error: "Solo se pueden eliminar requisiciones en borrador/rechazada/cancelada" }, { status: 400 });
  }
  await db.delete(requisiciones).where(eq(requisiciones.id, id));
  return Response.json({ ok: true });
};
