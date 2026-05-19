import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, max as sqlMax } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { proyectoHitos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

const schema = z.object({
  titulo: z.string().min(1),
  descripcion: z.string().nullable().optional(),
  fechaObjetivo: z.string().nullable().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const proyectoId = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [{ ord }] = await db.select({ ord: sqlMax(proyectoHitos.orden) }).from(proyectoHitos).where(eq(proyectoHitos.proyectoId, proyectoId));
  const siguienteOrden = (ord ?? -1) + 1;

  const [hito] = await db.insert(proyectoHitos).values({
    proyectoId,
    titulo: parsed.data.titulo,
    descripcion: parsed.data.descripcion ?? null,
    fechaObjetivo: parsed.data.fechaObjetivo ?? null,
    orden: siguienteOrden,
  }).returning();
  return Response.json({ hito }, { status: 201 });
};
