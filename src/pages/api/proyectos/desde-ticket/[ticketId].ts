import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, like } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { proyectos, tickets, ticketAdjuntos, proyectoAdjuntos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeCrearProyecto } from "@/lib/proyectos";
import { logAudit } from "@/lib/audit";
import { notificarProyectoCreado } from "@/lib/notificaciones";

export const prerender = false;

const schema = z.object({
  // Campos opcionales del proyecto al convertir (si no, se infieren del ticket)
  titulo: z.string().min(1).optional(),
  prioridad: z.enum(["baja", "media", "alta", "urgente"]).optional(),
  justificacion: z.string().nullable().optional(),
});

// Convierte un ticket en un proyecto (vs OT). Copia info y adjuntos.
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeCrearProyecto(user.rol)) return Response.json({ error: "Sin permisos" }, { status: 403 });

  const ticketId = Number(ctx.params.ticketId);
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [t] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!t) return Response.json({ error: "Ticket no encontrado" }, { status: 404 });
  if (t.proyectoId) return Response.json({ error: "Este ticket ya está vinculado a un proyecto" }, { status: 400 });
  if (t.otId) return Response.json({ error: "Este ticket ya tiene OT generada. No se puede convertir a proyecto." }, { status: 400 });

  // Auto-generar código PRY-XXXX
  const ultimos = await db.select({ codigo: proyectos.codigo }).from(proyectos).where(like(proyectos.codigo, "PRY-%"));
  let max = 0;
  for (const { codigo } of ultimos) {
    const m = codigo.match(/^PRY-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const codigo = `PRY-${String(max + 1).padStart(4, "0")}`;

  const titulo = parsed.data.titulo ?? `[Ticket #${t.id}] ${t.asunto}`;
  const descripcion = `${t.descripcion}\n\n— Solicitante: ${t.solicitanteNombre} <${t.solicitanteEmail}>`;

  const [proyecto] = await db.insert(proyectos).values({
    codigo,
    titulo,
    descripcion,
    prioridad: parsed.data.prioridad ?? t.prioridad,
    ticketId: t.id,
    sucursalId: t.sucursalId,
    ubicacionId: t.ubicacionId,
    ubicacionDetalle: t.ubicacion,
    activoId: t.activoId,
    justificacion: parsed.data.justificacion ?? null,
    creadoPor: user.id,
  } as any).returning();

  // Vincular el ticket al proyecto y pasarlo a en_proceso
  await db.update(tickets).set({
    proyectoId: proyecto.id,
    estado: "en_proceso",
    updatedAt: new Date().toISOString(),
  }).where(eq(tickets.id, t.id));

  // Copiar fotos del ticket como adjuntos del proyecto
  try {
    const tas = await db.select().from(ticketAdjuntos).where(eq(ticketAdjuntos.ticketId, t.id));
    if (tas.length > 0) {
      const env = getEnv(ctx);
      for (const ta of tas) {
        const newKey = `proyectos/${proyecto.id}/${Date.now()}-${crypto.randomUUID()}-${ta.nombre.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        try {
          const obj = await env.R2.get(ta.r2Key);
          if (obj) {
            await env.R2.put(newKey, obj.body, { httpMetadata: { contentType: ta.contentType } });
            await db.insert(proyectoAdjuntos).values({
              proyectoId: proyecto.id,
              nombre: ta.nombre,
              contentType: ta.contentType,
              tamano: ta.tamano,
              r2Key: newKey,
              categoria: "general",
              usuarioId: user.id,
            });
          }
        } catch (e) { console.error("copy ticket photo to proyecto:", e); }
      }
    }
  } catch (e) { console.error("ticket photos transfer:", e); }

  await logAudit(ctx, {
    entidad: "proyecto", entidadId: proyecto.id, accion: "create",
    resumen: `Proyecto generado desde Ticket #${t.id} de ${t.solicitanteNombre} <${t.solicitanteEmail}>`,
  });

  await notificarProyectoCreado(ctx, proyecto as any).catch((e) => console.error("notif proyecto creado:", e));

  return Response.json({ proyecto }, { status: 201 });
};
