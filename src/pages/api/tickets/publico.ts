import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tickets, usuarios } from "@/lib/schema";
import { generateTrackingToken, calcularVencimientoSla } from "@/lib/tickets";
import { sendMail, emailLayout } from "@/lib/email";

export const prerender = false;

const createSchema = z.object({
  solicitanteNombre: z.string().min(2),
  solicitanteEmail: z.string().email(),
  solicitanteTelefono: z.string().optional().nullable(),
  asunto: z.string().min(3),
  descripcion: z.string().min(10),
  prioridad: z.enum(["baja", "media", "alta", "urgente"]).default("media"),
  sucursalId: z.number().int().nullable().optional(),
  ubicacion: z.string().optional().nullable(),
  activoId: z.number().int().nullable().optional(),
});

// Endpoint publico: cualquiera puede crear un ticket
export const POST: APIRoute = async (ctx) => {
  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const trackingToken = generateTrackingToken();
  const { slaHoras, vencimiento } = calcularVencimientoSla(parsed.data.prioridad);

  const [row] = await db
    .insert(tickets)
    .values({
      ...parsed.data,
      trackingToken,
      slaHoras,
      vencimientoSla: vencimiento,
      estado: "nuevo",
    })
    .returning();

  // Notifica admins por email (best-effort, no bloquea respuesta)
  try {
    const admins = await db
      .select({ email: usuarios.email })
      .from(usuarios)
      .where(eq(usuarios.activo, true));
    const adminEmails = admins.filter((a) => a.email).map((a) => a.email);
    if (adminEmails.length > 0) {
      ctx.locals.runtime.ctx.waitUntil(
        sendMail(ctx, {
          to: adminEmails,
          subject: `[Soporte] Nuevo ticket #${row.id}: ${row.asunto}`,
          html: emailLayout(
            `Nuevo ticket de soporte`,
            `<p><strong>${row.solicitanteNombre}</strong> (${row.solicitanteEmail}) creó un ticket:</p>
             <h3>${row.asunto}</h3>
             <p style="white-space:pre-wrap">${row.descripcion}</p>
             <p><strong>Prioridad:</strong> ${row.prioridad} · <strong>SLA:</strong> ${row.slaHoras}h</p>
             <p><strong>Token:</strong> <code>${row.trackingToken}</code></p>`
          ),
          tipo: "ticket_nuevo",
          referencia: `ticket:${row.id}`,
        }).catch(() => {})
      );
    }

    // Confirmacion al solicitante
    ctx.locals.runtime.ctx.waitUntil(
      sendMail(ctx, {
        to: row.solicitanteEmail,
        subject: `Tu ticket #${row.id} fue recibido`,
        html: emailLayout(
          `Recibimos tu solicitud`,
          `<p>Hola <strong>${row.solicitanteNombre}</strong>,</p>
           <p>Tu solicitud fue registrada con el código <code>${row.trackingToken}</code>.</p>
           <p>Tiempo estimado de respuesta: <strong>${row.slaHoras} horas</strong>.</p>
           <p>Puedes consultar el estado en cualquier momento desde nuestro portal de soporte.</p>`
        ),
        tipo: "ticket_confirmacion",
        referencia: `ticket:${row.id}`,
      }).catch(() => {})
    );
  } catch {}

  return Response.json(
    {
      ticket: { id: row.id, trackingToken: row.trackingToken, vencimientoSla: row.vencimientoSla },
    },
    { status: 201 }
  );
};
