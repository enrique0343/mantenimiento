import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { proyectos, ordenes } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { disparadorProyecto } from "@/lib/notificaciones";

export const prerender = false;

const schema = z.object({
  titulo: z.string().min(1),
  descripcion: z.string().nullable().optional(),
  tipo: z.enum(["preventivo", "correctivo", "predictivo"]).default("correctivo"),
  prioridad: z.enum(["baja", "media", "alta", "urgente"]).default("media"),
  asignadoA: z.number().int().positive().nullable().optional(),
  vencimiento: z.string().nullable().optional(),
  activoId: z.number().int().positive().nullable().optional(),
});

// Genera una OT asociada al proyecto (proyectoId = id). El proyecto debe
// estar al menos en estado aprobado/en_ejecucion.
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;

  const proyectoId = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [p] = await db.select().from(proyectos).where(eq(proyectos.id, proyectoId)).limit(1);
  if (!p) return Response.json({ error: "Proyecto no encontrado" }, { status: 404 });
  if (!["aprobado", "en_ejecucion", "en_pausa"].includes(p.estado)) {
    return Response.json({ error: "El proyecto debe estar aprobado o en ejecución para generar OTs" }, { status: 400 });
  }

  // Si el proyecto está aprobado y se genera primera OT, pasar a en_ejecucion
  const ahora = new Date().toISOString();
  if (p.estado === "aprobado") {
    await db.update(proyectos).set({
      estado: "en_ejecucion",
      fechaInicioReal: p.fechaInicioReal ?? ahora,
    }).where(eq(proyectos.id, proyectoId));
    await logAudit(ctx, {
      entidad: "proyecto", entidadId: proyectoId, accion: "estado",
      resumen: "Iniciado en ejecución al generar primera OT",
      cambios: { estado: { antes: "aprobado", despues: "en_ejecucion" } },
    });
    await disparadorProyecto(ctx, { ...p, estado: "en_ejecucion" } as any, "aprobado", "en_ejecucion").catch((e) => console.error("dispatch proyecto:", e));
  }

  const [orden] = await db.insert(ordenes).values({
    titulo: `[${p.codigo}] ${parsed.data.titulo}`,
    descripcion: parsed.data.descripcion ?? null,
    tipo: parsed.data.tipo,
    prioridad: parsed.data.prioridad,
    estado: "abierta",
    proyectoId,
    activoId: parsed.data.activoId ?? p.activoId,
    sucursalId: p.sucursalId,
    ubicacionId: p.ubicacionId,
    ubicacionDetalle: p.ubicacionDetalle,
    asignadoA: parsed.data.asignadoA ?? null,
    creadoPor: user.id,
    vencimiento: parsed.data.vencimiento ?? p.fechaFinEstimada ?? null,
  } as any).returning();

  await logAudit(ctx, {
    entidad: "orden", entidadId: orden.id, accion: "create",
    resumen: `OT generada desde proyecto ${p.codigo}`,
  });

  return Response.json({ orden }, { status: 201 });
};
