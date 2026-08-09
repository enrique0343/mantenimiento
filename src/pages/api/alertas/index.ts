import type { APIRoute } from "astro";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { alertasEquipo, alertasEquipoActivos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

const createSchema = z.object({
  tipo: z.enum(["retiro", "alerta", "aviso"]),
  fuente: z.enum(["fabricante", "regulador", "proveedor", "interna"]),
  titulo: z.string().min(1),
  descripcion: z.string().nullable().optional(),
  referencia: z.string().nullable().optional(),
  fechaAlerta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  activoIds: z.array(z.number().int().positive()).default([]),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;

  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const { activoIds, ...datos } = parsed.data;
  const [alerta] = await db.insert(alertasEquipo).values({ ...datos, creadoPor: user.id }).returning();
  if (activoIds.length > 0) {
    await db.insert(alertasEquipoActivos).values(activoIds.map((activoId) => ({ alertaId: alerta.id, activoId })));
  }
  return Response.json({ alerta }, { status: 201 });
};
