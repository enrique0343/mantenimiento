import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { planesMantenimiento, activos, ordenes } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

import { parseArea } from "@/lib/areas";
import { rubroDeActivo } from "@/lib/rubros";
export const prerender = false;

// Genera una OT preventiva inmediatamente para el plan dado, sin esperar al cron.
// Solo admin/jefe. Marca ultimaGeneracion para evitar duplicados con el cron.
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;

  const id = Number(ctx.params.id);
  const areaParam = ctx.url.searchParams.get("area");
  const area = parseArea(areaParam);
  if (areaParam && !area) return Response.json({ error: "Área no válida" }, { status: 400 });
  const db = getDb(ctx);

  const [row] = await db
    .select({ p: planesMantenimiento, a: activos })
    .from(planesMantenimiento)
    .leftJoin(activos, eq(activos.id, planesMantenimiento.activoId))
    .where(eq(planesMantenimiento.id, id))
    .limit(1);
  if (!row || (area && (!row.a || rubroDeActivo(row.a.rubro, row.a.tipo) !== area))) return Response.json({ error: "Plan no encontrado en esta área" }, { status: 404 });
  if (!row.p.activo) return Response.json({ error: "El plan está inactivo" }, { status: 400 });

  const p = row.p;
  // Si ya hay OT generada para este ciclo, no duplicar
  if (p.ultimaGeneracion && p.ultimaGeneracion.slice(0, 10) >= p.proximaFecha) {
    return Response.json({ error: "Ya existe una OT abierta para el ciclo actual de este plan" }, { status: 409 });
  }

  const codigoActivo = row.a?.codigo ?? `Activo #${p.activoId}`;
  const titulo = `[Preventivo] ${p.titulo} - ${codigoActivo}`;
  const venc = new Date(p.proximaFecha);
  venc.setUTCDate(venc.getUTCDate() + p.alertaDiasAntes);
  const now = new Date().toISOString();

  const [orden] = await db
    .insert(ordenes)
    .values({
      titulo,
      descripcion: p.descripcion ?? null,
      tipo: "preventivo",
      rubro: rubroDeActivo(row.a?.rubro, row.a?.tipo),
      prioridad: p.prioridad,
      estado: "abierta",
      activoId: p.activoId,
      asignadoA: p.asignadoA,
      asignadoEn: p.asignadoA ? new Date().toISOString() : null,
      creadoPor: user.id,
      planId: p.id,
      vencimiento: venc.toISOString(),
      checklistEjecucion: p.checklist ?? null,
    })
    .returning();

  await db
    .update(planesMantenimiento)
    .set({ ultimaGeneracion: now })
    .where(eq(planesMantenimiento.id, p.id));

  return Response.json({ orden }, { status: 201 });
};
