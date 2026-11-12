import type { APIRoute } from "astro";
import { asc, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "@/lib/db";
import { checklistPlantillas, checklistPlantillaItems } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { crearPlantillaSchema, filasDeReemplazo, mensajeErrorPlantilla, tandasDeFilas } from "@/lib/plantillas-checklist";

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
    .where(soloActivas ? eq(checklistPlantillas.activa, true) : undefined)
    .orderBy(asc(checklistPlantillas.nombre));

  if (plantillas.length === 0) return Response.json({ plantillas: [] });
  // Todos los pasos de una vez y se reparten aquí: una lista de ids en la consulta
  // pasaría el límite de 100 parámetros de D1 con muchas plantillas.
  const ids = new Set(plantillas.map((p) => p.id));
  const items = (await db
    .select()
    .from(checklistPlantillaItems)
    .orderBy(asc(checklistPlantillaItems.orden), asc(checklistPlantillaItems.id)))
    .filter((it) => ids.has(it.plantillaId));

  return Response.json({
    plantillas: plantillas.map((p) => ({
      ...p,
      items: items.filter((it) => it.plantillaId === p.id),
    })),
  });
};

// POST: crear plantilla (admin y jefe), con sus pasos y su constancia.
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = crearPlantillaSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: mensajeErrorPlantilla(parsed.error) }, { status: 400 });

  const db = getDb(ctx);
  const [plantilla] = await db.insert(checklistPlantillas).values({
    nombre: parsed.data.nombre,
    descripcion: parsed.data.descripcion?.trim() || null,
  }).returning();

  const filas = filasDeReemplazo(parsed.data.items, [], plantilla.id);
  if (filas.length) {
    const inserts = tandasDeFilas(filas).map((t) => db.insert(checklistPlantillaItems).values(t));
    try {
      await db.batch(inserts as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    } catch (e) {
      // Sin pasos la plantilla no sirve: se quita la cabecera recién creada.
      await db.delete(checklistPlantillas).where(eq(checklistPlantillas.id, plantilla.id)).catch(() => {});
      throw e;
    }
  }
  await logAudit(ctx, {
    entidad: "checklist_plantilla",
    entidadId: plantilla.id,
    accion: "create",
    resumen: `Plantilla «${plantilla.nombre}» creada con ${filas.length} ${filas.length === 1 ? "paso" : "pasos"}`,
  });
  return Response.json({ plantilla }, { status: 201 });
};
