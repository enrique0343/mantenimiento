import type { APIRoute } from "astro";
import { eq, lte, and } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { planesMantenimiento, ordenes, activos, actividades, actividadCategorias } from "@/lib/schema";
import { siguienteFecha } from "@/lib/frecuencias";

export const prerender = false;

// Endpoint llamado por el Cron Worker. Protegido por header X-Cron-Secret.
// Genera órdenes preventivas para:
//   1) Planes de mantenimiento (planes_mantenimiento) cuyo proximaFecha <= hoy
//   2) Actividades recurrentes (actividades) cuyo proximaFecha <= hoy
export const POST: APIRoute = async (ctx) => {
  const env = getEnv(ctx);
  const expected = (env as any).CRON_SECRET as string | undefined;
  const got = ctx.request.headers.get("x-cron-secret");
  if (!expected || got !== expected) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const db = getDb(ctx);
  const hoy = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  let creadas = 0;
  const detalles: Array<{ origen: string; refId: number; ordenId: number; descripcion: string }> = [];

  // ── 1) Planes de mantenimiento de equipos ──────────────────────────────────
  const planesRows = await db
    .select({ p: planesMantenimiento, a: activos })
    .from(planesMantenimiento)
    .leftJoin(activos, eq(activos.id, planesMantenimiento.activoId))
    .where(and(eq(planesMantenimiento.activo, true), lte(planesMantenimiento.proximaFecha, hoy)));

  for (const r of planesRows) {
    const p = r.p;
    const codigoActivo = r.a?.codigo ?? `Activo #${p.activoId}`;
    const titulo = `[Preventivo] ${p.titulo} - ${codigoActivo}`;
    const venc = new Date(p.proximaFecha);
    venc.setUTCDate(venc.getUTCDate() + p.alertaDiasAntes);

    const [orden] = await db
      .insert(ordenes)
      .values({
        titulo,
        descripcion: p.descripcion ?? null,
        tipo: "preventivo",
        prioridad: p.prioridad,
        estado: "abierta",
        activoId: p.activoId,
        asignadoA: null,
        creadoPor: null,
        planId: p.id,
        vencimiento: venc.toISOString(),
        checklistEjecucion: p.checklist ?? null,
      })
      .returning({ id: ordenes.id });

    const proxima = siguienteFecha(p.proximaFecha, p.frecuencia as any);
    await db
      .update(planesMantenimiento)
      .set({ proximaFecha: proxima, ultimaGeneracion: now })
      .where(eq(planesMantenimiento.id, p.id));

    creadas++;
    detalles.push({ origen: "equipo", refId: p.id, ordenId: orden.id, descripcion: codigoActivo });
  }

  // ── 2) Actividades recurrentes ─────────────────────────────────────────────
  const actRows = await db
    .select({ a: actividades, c: actividadCategorias })
    .from(actividades)
    .leftJoin(actividadCategorias, eq(actividadCategorias.id, actividades.categoriaId))
    .where(and(eq(actividades.activo, true), lte(actividades.proximaFecha, hoy)));

  for (const r of actRows) {
    const a = r.a;
    const cat = r.c;
    const titulo = `[Actividad${cat ? ` · ${cat.icono ?? ""} ${cat.nombre}` : ""}] ${a.titulo}`;
    const venc = new Date(a.proximaFecha);
    venc.setUTCDate(venc.getUTCDate() + a.alertaDiasAntes);

    const [orden] = await db
      .insert(ordenes)
      .values({
        titulo,
        descripcion: a.descripcion ?? null,
        tipo: "preventivo",
        prioridad: a.prioridad,
        estado: "abierta",
        actividadId: a.id,
        asignadoA: a.asignadoA,
        creadoPor: null,
        vencimiento: venc.toISOString(),
        checklistEjecucion: a.checklist ?? null,
      })
      .returning({ id: ordenes.id });

    const proxima = siguienteFecha(a.proximaFecha, a.frecuencia as any);
    await db
      .update(actividades)
      .set({ proximaFecha: proxima, ultimaGeneracion: now })
      .where(eq(actividades.id, a.id));

    creadas++;
    detalles.push({ origen: "actividad", refId: a.id, ordenId: orden.id, descripcion: a.titulo });
  }

  return Response.json({ ok: true, fecha: hoy, creadas, detalles });
};
