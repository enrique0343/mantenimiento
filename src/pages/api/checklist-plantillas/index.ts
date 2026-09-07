import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, asc, desc, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { checklistPlantillas, checklistPlantillaItems } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

// GET: lista de plantillas (todos los autenticados pueden leer; el form de
// plan necesita el listado y el detalle para autocompletar el checklist).
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;

  const db = getDb(ctx);
  const url = new URL(ctx.request.url);
  const soloActivas = url.searchParams.get("activas") === "1";

  const plantillas = await db
    .select()
    .from(checklistPlantillas)
    .orderBy(asc(checklistPlantillas.nombre));

  const filtradas = soloActivas ? plantillas.filter((p) => p.activa) : plantillas;

  // Cargar items por plantilla
  if (filtradas.length === 0) return Response.json({ plantillas: [] });
  const items = await db
    .select()
    .from(checklistPlantillaItems)
    .where(inArray(checklistPlantillaItems.plantillaId, filtradas.map((p) => p.id)))
    .orderBy(asc(checklistPlantillaItems.orden), asc(checklistPlantillaItems.id));

  return Response.json({
    plantillas: filtradas.map((p) => ({
      ...p,
      items: items.filter((it) => it.plantillaId === p.id),
    })),
  });
};

// Un item puede venir como string simple (compat) o como objeto enriquecido.
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

const createSchema = z.object({
  nombre: z.string().min(1),
  descripcion: z.string().nullable().optional(),
  items: z.array(itemSchema).default([]),
});

// POST: crear plantilla (solo admin)
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [plantilla] = await db.insert(checklistPlantillas).values({
    nombre: parsed.data.nombre,
    descripcion: parsed.data.descripcion ?? null,
  }).returning();

  if (parsed.data.items.length) {
    await db.insert(checklistPlantillaItems).values(
      parsed.data.items.map((raw, orden) => normalizarItem(raw, orden, plantilla.id))
    );
  }
  return Response.json({ plantilla }, { status: 201 });
};
