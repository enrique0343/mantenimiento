import type { APIRoute } from "astro";
import { z } from "zod";
import { desc, eq, like } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { requisiciones, requisicionItems, proveedores, usuarios } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const db = getDb(ctx);
  const rows = await db
    .select({ r: requisiciones, p: proveedores, u: usuarios })
    .from(requisiciones)
    .leftJoin(proveedores, eq(proveedores.id, requisiciones.proveedorId))
    .leftJoin(usuarios, eq(usuarios.id, requisiciones.creadoPor))
    .orderBy(desc(requisiciones.id));
  return Response.json({
    requisiciones: rows.map((r) => ({
      ...r.r,
      proveedor: r.p ? { id: r.p.id, nombre: r.p.nombre } : null,
      creado: r.u ? { id: r.u.id, nombre: r.u.nombre } : null,
    })),
  });
};

const lineaSchema = z.object({
  itemId: z.number().int().positive(),
  cantidad: z.number().positive(),
  precioUnitario: z.number().nonnegative().optional().nullable(),
  notas: z.string().optional().nullable(),
});

const createSchema = z.object({
  proveedorId: z.number().int().positive().optional().nullable(),
  fechaNecesidad: z.string().optional().nullable(),
  notas: z.string().optional().nullable(),
  origen: z.enum(["manual", "auto_stock_minimo"]).default("manual"),
  items: z.array(lineaSchema).min(1),
});

async function siguienteNumero(db: ReturnType<typeof getDb>): Promise<string> {
  const ultimas = await db.select({ numero: requisiciones.numero }).from(requisiciones).where(like(requisiciones.numero, "REQ-%"));
  let max = 0;
  for (const { numero } of ultimas) {
    const m = numero.match(/^REQ-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `REQ-${String(max + 1).padStart(5, "0")}`;
}

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const total = parsed.data.items.reduce((s, li) => s + (li.precioUnitario ?? 0) * li.cantidad, 0);
  const numero = await siguienteNumero(db);

  const [req] = await db.insert(requisiciones).values({
    numero,
    estado: "borrador",
    proveedorId: parsed.data.proveedorId ?? null,
    fechaNecesidad: parsed.data.fechaNecesidad ?? null,
    notas: parsed.data.notas ?? null,
    origen: parsed.data.origen,
    total: total > 0 ? total : null,
    creadoPor: user.id,
  }).returning();

  for (const li of parsed.data.items) {
    await db.insert(requisicionItems).values({
      requisicionId: req.id,
      itemId: li.itemId,
      cantidad: li.cantidad,
      precioUnitario: li.precioUnitario ?? null,
      notas: li.notas ?? null,
    });
  }

  return Response.json({ requisicion: req }, { status: 201 });
};
