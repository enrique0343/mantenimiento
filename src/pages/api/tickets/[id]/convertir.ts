import { crearOrdenDeTicketAtomica, ConflictoTicket } from "@/lib/ticket-orden-atomica";
import { espacioDeTrabajoGuardado, bloqueoEspacio, asignadoFueraDeEspacio, mensajeAsignadoFuera } from "@/lib/espacio-db";
import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { tickets, ticketAdjuntos, adjuntos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

import { conCodigo, validarAreaTrabajo, validarContextoArea } from "@/lib/ordenes";
import { rechazoOrdenEquipoBaja } from "@/lib/equipo-baja";

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
  const espacio = await espacioDeTrabajoGuardado(db, t.rubro, t.activoId);
  const bloqueo = bloqueoEspacio(user, espacio);
  if (bloqueo) return bloqueo;
  const fuera = await asignadoFueraDeEspacio(db, parsed.data.asignadoA, [espacio]);
  if (fuera) return Response.json({ error: mensajeAsignadoFuera(fuera) }, { status: 400 });
  const contextError = validarContextoArea(ctx.request, t.rubro);
  if (contextError) return contextError;
  const areaResult = await validarAreaTrabajo(db, t);
  if ("error" in areaResult) return Response.json({ error: areaResult.error }, { status: 400 });
  if (t.otId) return Response.json({ error: "Ticket ya tiene OT asociada" }, { status: 400 });
  // Fase 59 · requisito 13: el equipo de la solicitud está dado de baja → 409 y la solicitud no cambia.
  const rechazoBaja = await rechazoOrdenEquipoBaja(db, t.activoId);
  if (rechazoBaja) return rechazoBaja;

  const desc = `${t.descripcion}\n\n— Ticket #${t.id} de ${t.solicitanteNombre} <${t.solicitanteEmail}>`;
  let orden;
  try {
    ({ orden } = await crearOrdenDeTicketAtomica(ctx, t, {
      estado: "asignado", asignadoA: parsed.data.asignadoA ?? t.asignadoA, updatedAt: new Date().toISOString(),
    }, {
      titulo: `[Ticket #${t.id}] ${t.asunto}`, descripcion: desc, prioridad: t.prioridad, rubro: areaResult.rubro,
      activoId: t.activoId, sucursalId: t.sucursalId, ubicacionId: t.ubicacionId, ubicacionDetalle: t.ubicacion,
      asignadoA: parsed.data.asignadoA ?? null, creadoPor: user.id, vencimiento: parsed.data.vencimiento ?? t.vencimientoSla,
    }, `OT generada desde Ticket #${t.id} de ${t.solicitanteNombre} <${t.solicitanteEmail}>`));
  } catch (error) {
    if (error instanceof ConflictoTicket) return Response.json({ error: error.message }, { status: 409 });
    console.error("No se pudo convertir la solicitud en orden", error instanceof Error ? error.message : "error");
    return Response.json({ error: "No se pudo crear la orden. La solicitud no se modificó; vuelve a intentarlo." }, { status: 500 });
  }

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

  return Response.json({ orden: await conCodigo(db, orden), ticketId: id }, { status: 201 });
};
