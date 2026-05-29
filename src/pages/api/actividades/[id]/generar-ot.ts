import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { actividades, actividadCategorias, ordenes } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeAdministrarActividades } from "@/lib/actividades";
import { siguienteFecha } from "@/lib/frecuencias";

export const prerender = false;

// Genera una OT inmediatamente para la actividad y avanza proximaFecha al siguiente ciclo.
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarActividades(user.rol)) return new Response("Sin permisos", { status: 403 });

  const id = Number(ctx.params.id);
  const db = getDb(ctx);

  const [r] = await db
    .select({ a: actividades, c: actividadCategorias })
    .from(actividades)
    .leftJoin(actividadCategorias, eq(actividadCategorias.id, actividades.categoriaId))
    .where(eq(actividades.id, id))
    .limit(1);
  if (!r) return Response.json({ error: "Actividad no existe" }, { status: 404 });
  const a = r.a;
  const cat = r.c;

  const titulo = `[Actividad${cat ? ` · ${cat.icono ?? ""} ${cat.nombre}` : ""}] ${a.titulo}`;
  const venc = new Date(a.proximaFecha);
  venc.setUTCDate(venc.getUTCDate() + a.alertaDiasAntes);
  const now = new Date().toISOString();

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
      asignadoEn: a.asignadoA ? new Date().toISOString() : null,
      creadoPor: user.id,
      vencimiento: venc.toISOString(),
      checklistEjecucion: a.checklist ?? null,
    })
    .returning();

  // Avanza proxima fecha
  const proxima = siguienteFecha(a.proximaFecha, a.frecuencia as any);
  await db.update(actividades).set({ proximaFecha: proxima, ultimaGeneracion: now }).where(eq(actividades.id, id));

  return Response.json({ orden, proximaFecha: proxima }, { status: 201 });
};
