import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, asc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { checklistPlantillas, checklistPlantillaItems } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  const [plantilla] = await db.select().from(checklistPlantillas).where(eq(checklistPlantillas.id, id)).limit(1);
  if (!plantilla) return Response.json({ error: "No encontrada" }, { status: 404 });
  const items = await db
    .select()
    .from(checklistPlantillaItems)
    .where(eq(checklistPlantillaItems.plantillaId, id))
    .orderBy(asc(checklistPlantillaItems.orden), asc(checklistPlantillaItems.id));
  return Response.json({ plantilla: { ...plantilla, items } });
};

const itemSchema = z.union([
  z.string().min(1),
  z.object({
    texto: z.string().min(1),
    criterioAceptacion: z.string().nullable().optional(),
    bloqueante: z.boolean().optional(),
    minutosEstimados: z.number().int().positive().nullable().optional(),
    materiales: z.string().nullable().optional(),
  }),
]);

function normalizarItem(raw: z.infer<typeof itemSchema>, orden: number, plantillaId: number) {
  const it = typeof raw === "string" ? { texto: raw } : raw;
  return {
    plantillaId,
    texto: it.texto,
    criterioAceptacion: ("criterioAceptacion" in it ? it.criterioAceptacion : null) ?? null,
    bloqueante: ("bloqueante" in it ? it.bloqueante : false) ?? false,
    minutosEstimados: ("minutosEstimados" in it ? it.minutosEstimados : null) ?? null,
    materiales: ("materiales" in it ? it.materiales : null) ?? null,
    orden,
  };
}

const patchSchema = z.object({
  nombre: z.string().min(1).optional(),
  descripcion: z.string().nullable().optional(),
  activa: z.boolean().optional(),
  items: z.array(itemSchema).optional(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const data: Record<string, unknown> = {};
  if (parsed.data.nombre !== undefined) data.nombre = parsed.data.nombre;
  if (parsed.data.descripcion !== undefined) data.descripcion = parsed.data.descripcion;
  if (parsed.data.activa !== undefined) data.activa = parsed.data.activa;

  if (Object.keys(data).length > 0) {
    await db.update(checklistPlantillas).set(data).where(eq(checklistPlantillas.id, id));
  }

  // Reemplazar items si se enviaron
  if (parsed.data.items !== undefined) {
    await db.delete(checklistPlantillaItems).where(eq(checklistPlantillaItems.plantillaId, id));
    if (parsed.data.items.length) {
      await db.insert(checklistPlantillaItems).values(
        parsed.data.items.map((raw, orden) => normalizarItem(raw, orden, id))
      );
    }
  }

  const [plantilla] = await db.select().from(checklistPlantillas).where(eq(checklistPlantillas.id, id)).limit(1);
  return Response.json({ plantilla });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  await db.delete(checklistPlantillas).where(eq(checklistPlantillas.id, id));
  return Response.json({ ok: true });
};
