import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { tickets, ordenes, ticketAdjuntos, adjuntos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const prerender = false;

const schema = z.object({
  asignadoA: z.number().int().nullable().optional(),
  vencimiento: z.string().nullable().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [t] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  if (!t) return Response.json({ error: "Ticket no encontrado" }, { status: 404 });
  if (t.otId) return Response.json({ error: "Ticket ya tiene OT asociada" }, { status: 400 });

  const desc = `${t.descripcion}\n\n— Ticket #${t.id} de ${t.solicitanteNombre} <${t.solicitanteEmail}>`;
  const [orden] = await db
    .insert(ordenes)
    .values({
      titulo: `[Ticket #${t.id}] ${t.asunto}`,
      descripcion: desc,
      tipo: "correctivo",
      prioridad: t.prioridad,
      estado: "abierta",
      activoId: t.activoId,
      asignadoA: parsed.data.asignadoA ?? null,
      creadoPor: user.id,
      vencimiento: parsed.data.vencimiento ?? t.vencimientoSla,
    })
    .returning();

  await db
    .update(tickets)
    .set({
      otId: orden.id,
      estado: "asignado",
      asignadoA: parsed.data.asignadoA ?? t.asignadoA,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(tickets.id, id));

  // Copiar fotos del ticket como adjuntos "antes" de la OT
  try {
    const tas = await db.select().from(ticketAdjuntos).where(eq(ticketAdjuntos.ticketId, id));
    if (tas.length > 0) {
      const env = getEnv(ctx);
      for (const ta of tas) {
        // Copia el objeto en R2 a la nueva ruta de la OT
        const newKey = `ordenes/${orden.id}/antes/${Date.now()}-${crypto.randomUUID()}-${ta.nombre.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        try {
          const obj = await env.R2.get(ta.r2Key);
          if (obj) {
            await env.R2.put(newKey, obj.body, { httpMetadata: { contentType: ta.contentType } });
            await db.insert(adjuntos).values({
              ordenId: orden.id,
              usuarioId: user.id,
              nombre: ta.nombre,
              contentType: ta.contentType,
              tamano: ta.tamano,
              r2Key: newKey,
              categoria: "antes",
            });
          }
        } catch (e) { console.error("copy ticket photo:", e); }
      }
    }
  } catch (e) { console.error("ticket photos transfer:", e); }

  // Audit con info del solicitante original
  await logAudit(ctx, {
    entidad: "orden", entidadId: orden.id, accion: "create",
    resumen: `OT generada desde Ticket #${t.id} de ${t.solicitanteNombre} <${t.solicitanteEmail}>`,
  });
  if (orden.asignadoA) {
    await logAudit(ctx, {
      entidad: "orden", entidadId: orden.id, accion: "asignacion",
      resumen: `Asignada al técnico (id: ${orden.asignadoA}) en la conversión`,
    });
  }

  return Response.json({ orden, ticketId: id }, { status: 201 });
};
