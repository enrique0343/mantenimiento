import type { APIRoute } from "astro";
import { eq, asc } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "@/lib/db";
import { checklistPlantillas, checklistPlantillaItems } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { exigirRol } from "@/lib/seguridad-electrica";
import { logAudit, calcularDiff } from "@/lib/audit";
import { editarPlantillaSchema, errorRangoDePasos, filasDeReemplazo, mensajeErrorPlantilla, tandasDeFilas, tieneVinculos } from "@/lib/plantillas-checklist";

export const prerender = false;

const NO_ENCONTRADA = () => Response.json({ error: "Plantilla no encontrada" }, { status: 404 });
const idDe = (v: string | undefined) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = idDe(ctx.params.id);
  if (id === null) return NO_ENCONTRADA();
  const db = getDb(ctx);
  const [plantilla] = await db.select().from(checklistPlantillas).where(eq(checklistPlantillas.id, id)).limit(1);
  if (!plantilla) return NO_ENCONTRADA();
  const items = await db
    .select()
    .from(checklistPlantillaItems)
    .where(eq(checklistPlantillaItems.plantillaId, id))
    .orderBy(asc(checklistPlantillaItems.orden), asc(checklistPlantillaItems.id));
  return Response.json({ plantilla: { ...plantilla, items } });
};

// PATCH: nombre, descripción, activa y, si vienen, los pasos (se reemplazan todos
// en un solo lote y conservan su lectura, unidad y rango). Admin y jefe.
export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const id = idDe(ctx.params.id);
  if (id === null) return NO_ENCONTRADA();
  const body = await ctx.request.json().catch(() => null);
  const parsed = editarPlantillaSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: mensajeErrorPlantilla(parsed.error) }, { status: 400 });

  const db = getDb(ctx);
  const [antes] = await db.select().from(checklistPlantillas).where(eq(checklistPlantillas.id, id)).limit(1);
  if (!antes) return NO_ENCONTRADA();

  const data: { nombre?: string; descripcion?: string | null; activa?: boolean } = {};
  if (parsed.data.nombre !== undefined) data.nombre = parsed.data.nombre;
  if (parsed.data.descripcion !== undefined) data.descripcion = parsed.data.descripcion?.trim() || null;
  if (parsed.data.activa !== undefined) data.activa = parsed.data.activa;

  const lote: BatchItem<"sqlite">[] = [];
  if (Object.keys(data).length > 0) {
    lote.push(db.update(checklistPlantillas).set(data).where(eq(checklistPlantillas.id, id)) as unknown as BatchItem<"sqlite">);
  }

  let pasos: number | null = null;
  if (parsed.data.items !== undefined) {
    const actuales = await db
      .select()
      .from(checklistPlantillaItems)
      .where(eq(checklistPlantillaItems.plantillaId, id))
      .orderBy(asc(checklistPlantillaItems.orden), asc(checklistPlantillaItems.id));
    if (tieneVinculos(actuales)) {
      return Response.json({
        error: "Esta plantilla tiene pasos con vínculos (variable, procedimiento, equipo, ubicación o acción si no cumple). Para no perderlos, sus pasos no se reemplazan por esta vía.",
      }, { status: 409 });
    }
    const filas = filasDeReemplazo(parsed.data.items, actuales, id);
    // Lo que llega se completa con el paso guardado: el rango final también tiene que ser válido.
    const errorRango = errorRangoDePasos(filas);
    if (errorRango) return Response.json({ error: errorRango }, { status: 400 });
    lote.push(db.delete(checklistPlantillaItems).where(eq(checklistPlantillaItems.plantillaId, id)) as unknown as BatchItem<"sqlite">);
    for (const tanda of tandasDeFilas(filas)) lote.push(db.insert(checklistPlantillaItems).values(tanda) as unknown as BatchItem<"sqlite">);
    pasos = filas.length;
  }

  // Todo o nada: si una sentencia falla, la plantilla queda como estaba.
  if (lote.length > 0) {
    try {
      await db.batch(lote as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    } catch {
      return Response.json({ error: "No se pudo guardar la plantilla. Intenta de nuevo." }, { status: 500 });
    }
  }

  const diff = calcularDiff(antes as unknown as Record<string, unknown>, data, ["nombre", "descripcion", "activa"]);
  const partes: string[] = [];
  if (diff.nombre) partes.push(`nombre «${antes.nombre}» → «${data.nombre}»`);
  if (diff.descripcion) partes.push("descripción cambiada");
  if (diff.activa) partes.push(data.activa ? "activada" : "desactivada");
  if (pasos !== null) partes.push(`pasos reemplazados (${pasos})`);
  if (partes.length > 0) {
    await logAudit(ctx, {
      entidad: "checklist_plantilla",
      entidadId: id,
      accion: "update",
      cambios: Object.keys(diff).length ? diff : undefined,
      resumen: `Plantilla «${data.nombre ?? antes.nombre}»: ${partes.join(" · ")}`,
    });
  }

  const [plantilla] = await db.select().from(checklistPlantillas).where(eq(checklistPlantillas.id, id)).limit(1);
  return Response.json({ plantilla });
};

// DELETE: ya no borra. La plantilla queda inactiva (no se ofrece al crear rutinas
// ni órdenes) y conserva sus pasos; se vuelve a activar con PATCH { activa: true }.
export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await exigirRol(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const id = idDe(ctx.params.id);
  if (id === null) return NO_ENCONTRADA();
  const db = getDb(ctx);
  const [plantilla] = await db.select().from(checklistPlantillas).where(eq(checklistPlantillas.id, id)).limit(1);
  if (!plantilla) return NO_ENCONTRADA();
  if (plantilla.activa) {
    await db.update(checklistPlantillas).set({ activa: false }).where(eq(checklistPlantillas.id, id));
    await logAudit(ctx, {
      entidad: "checklist_plantilla",
      entidadId: id,
      accion: "estado",
      cambios: { activa: { antes: true, despues: false } },
      resumen: `Plantilla «${plantilla.nombre}» desactivada`,
    });
  }
  return Response.json({ ok: true, desactivada: true });
};
