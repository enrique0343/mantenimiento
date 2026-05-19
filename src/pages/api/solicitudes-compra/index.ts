import type { APIRoute } from "astro";
import { z } from "zod";
import { desc, eq, like } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { solicitudesCompra, solicitudCompraItems, usuarios, ordenes } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const db = getDb(ctx);
  const rows = await db
    .select({ s: solicitudesCompra, u: usuarios, o: ordenes })
    .from(solicitudesCompra)
    .leftJoin(usuarios, eq(usuarios.id, solicitudesCompra.creadoPor))
    .leftJoin(ordenes, eq(ordenes.id, solicitudesCompra.ordenId))
    .orderBy(desc(solicitudesCompra.id));
  return Response.json({
    solicitudes: rows.map((r) => ({
      ...r.s,
      creadoPorNombre: r.u?.nombre ?? null,
      ordenTitulo: r.o?.titulo ?? null,
    })),
  });
};

const createSchema = z.object({
  titulo: z.string().min(1),
  descripcion: z.string().nullable().optional(),
  ordenId: z.number().int().positive().nullable().optional(),
  items: z.array(z.object({
    descripcion: z.string().min(1),
    cantidad: z.number().positive().default(1),
    unidad: z.string().nullable().optional(),
    notas: z.string().nullable().optional(),
  })).min(1, "Debe incluir al menos un ítem"),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;

  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);

  // Validar que la OT esté en_proceso si se vincula
  if (parsed.data.ordenId) {
    const [ot] = await db.select({ estado: ordenes.estado }).from(ordenes).where(eq(ordenes.id, parsed.data.ordenId)).limit(1);
    if (!ot) return Response.json({ error: "OT no encontrada" }, { status: 404 });
    if (ot.estado !== "en_proceso" && ot.estado !== "en_espera") {
      return Response.json({ error: "La OT debe estar en proceso para generar una solicitud de compra." }, { status: 400 });
    }
  }

  // Auto-generar código SC-XXXX
  const ultimas = await db.select({ codigo: solicitudesCompra.codigo }).from(solicitudesCompra).where(like(solicitudesCompra.codigo, "SC-%"));
  let max = 0;
  for (const { codigo: c } of ultimas) {
    const m = c.match(/^SC-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const codigo = `SC-${String(max + 1).padStart(4, "0")}`;

  const [row] = await db.insert(solicitudesCompra).values({
    codigo,
    titulo: parsed.data.titulo,
    descripcion: parsed.data.descripcion ?? null,
    ordenId: parsed.data.ordenId ?? null,
    creadoPor: user.id,
  }).returning();

  // Insertar ítems
  if (parsed.data.items.length) {
    await db.insert(solicitudCompraItems).values(
      parsed.data.items.map((item, i) => ({
        solicitudId: row.id,
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        unidad: item.unidad ?? null,
        notas: item.notas ?? null,
        orden: i,
      }))
    );
  }

  return Response.json({ solicitud: row }, { status: 201 });
};
