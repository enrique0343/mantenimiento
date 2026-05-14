import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, max as sqlMax } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { proyectoPresupuestoItems } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

const schema = z.object({
  descripcion: z.string().min(1),
  categoria: z.string().nullable().optional(),
  cantidad: z.number().positive().default(1),
  unidad: z.string().nullable().optional(),
  precioEstimado: z.number().min(0).default(0),
  precioReal: z.number().min(0).nullable().optional(),
  proveedorId: z.number().int().positive().nullable().optional(),
  notas: z.string().nullable().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const proyectoId = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  // Calcular orden = max + 1
  const [{ ord }] = await db.select({ ord: sqlMax(proyectoPresupuestoItems.orden) }).from(proyectoPresupuestoItems).where(eq(proyectoPresupuestoItems.proyectoId, proyectoId));
  const siguienteOrden = (ord ?? -1) + 1;

  const [item] = await db.insert(proyectoPresupuestoItems).values({
    proyectoId,
    descripcion: parsed.data.descripcion,
    categoria: parsed.data.categoria ?? null,
    cantidad: parsed.data.cantidad,
    unidad: parsed.data.unidad ?? null,
    precioEstimado: parsed.data.precioEstimado,
    precioReal: parsed.data.precioReal ?? null,
    proveedorId: parsed.data.proveedorId ?? null,
    notas: parsed.data.notas ?? null,
    orden: siguienteOrden,
  }).returning();

  return Response.json({ item }, { status: 201 });
};
