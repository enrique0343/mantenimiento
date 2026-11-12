import type { APIRoute } from "astro";
import { asc, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "@/lib/db";
import { checklistPlantillas, checklistPlantillaItems } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { exigirRol } from "@/lib/seguridad-electrica";
import { logAudit } from "@/lib/audit";
import { crearPlantillaSchema, filasDeReemplazo, mensajeErrorPlantilla, tandasDeFilas } from "@/lib/plantillas-checklist";
import { ROLES_PLANTILLAS, mensajeNombreRepetido, plantillaConNombre } from "@/lib/plantillas-checklist-editor";

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

// POST: crear plantilla (admin y jefe), con sus pasos y su constancia. Un nombre
// por plantilla (sin contar tildes ni mayúsculas): así la plantilla sugerida del
// editor se crea una sola vez y la lista de rutinas no ofrece dos iguales.
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, [...ROLES_PLANTILLAS]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = crearPlantillaSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: mensajeErrorPlantilla(parsed.error) }, { status: 400 });

  const db = getDb(ctx);
  const noSeGuardo = () => Response.json({ error: "No se pudo guardar la plantilla. Intenta de nuevo." }, { status: 500 });
  const nombre = parsed.data.nombre;
  const descripcion = parsed.data.descripcion?.trim() || null;
  const repetida = async () => {
    const todas = await db.select({ id: checklistPlantillas.id, nombre: checklistPlantillas.nombre }).from(checklistPlantillas);
    return plantillaConNombre(todas, nombre);
  };
  const yaExiste = (p: { id: number; nombre: string }) =>
    Response.json({ error: mensajeNombreRepetido(p.nombre), id: p.id }, { status: 409 });

  let plantilla: typeof checklistPlantillas.$inferSelect | undefined;
  try {
    const antes = await repetida();
    if (antes) return yaExiste(antes);
    // Dos envíos a la vez con el mismo nombre (doble clic, dos pestañas): la
    // sentencia solo inserta si no hay otra con ese nombre, y la segunda no crea nada.
    const r = await db.run(sql`INSERT INTO checklist_plantillas (nombre, descripcion)
      SELECT ${nombre}, ${descripcion}
      WHERE NOT EXISTS (SELECT 1 FROM checklist_plantillas WHERE nombre = ${nombre})`);
    if (!Number(r.meta?.changes)) {
      const otra = await repetida();
      return otra ? yaExiste(otra) : noSeGuardo();
    }
    [plantilla] = await db.select().from(checklistPlantillas).where(eq(checklistPlantillas.id, Number(r.meta.last_row_id))).limit(1);
  } catch {
    return noSeGuardo();
  }
  if (!plantilla) return noSeGuardo();

  const filas = filasDeReemplazo(parsed.data.items, [], plantilla.id);
  if (filas.length) {
    const inserts = tandasDeFilas(filas).map((t) => db.insert(checklistPlantillaItems).values(t));
    try {
      await db.batch(inserts as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    } catch {
      // Sin pasos la plantilla no sirve: se quita la cabecera recién creada.
      await db.delete(checklistPlantillas).where(eq(checklistPlantillas.id, plantilla.id)).catch(() => {});
      return noSeGuardo();
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
