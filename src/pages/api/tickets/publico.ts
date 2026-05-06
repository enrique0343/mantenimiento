import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tickets, usuarios, activos, sucursales } from "@/lib/schema";
import { generateTrackingToken, calcularVencimientoSla } from "@/lib/tickets";
import { sendMail, emailLayout } from "@/lib/email";
import { jefesNotificar } from "@/lib/especialidad";

export const prerender = false;

const createSchema = z.object({
  solicitanteNombre: z.string().min(2),
  solicitanteEmail: z.string().email(),
  solicitanteTelefono: z.string().optional().nullable(),
  asunto: z.string().min(3),
  descripcion: z.string().min(10),
  prioridad: z.enum(["baja", "media", "alta", "urgente"]).default("media"),
  tipoMantenimiento: z.enum(["general", "biomedico"]).default("general"),
  sucursalId: z.number().int().positive(), // ahora obligatorio
  ubicacionId: z.number().int().nullable().optional(),
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

  // Notifica al jefe correcto según el tipo de equipo del ticket
  try {
    // Tipo: usa el seleccionado por el solicitante, o deriva del activo si lo hay
    let tipoEquipo: "general" | "biomedico" | null = (row.tipoMantenimiento as any) ?? null;
    if (!tipoEquipo && row.activoId) {
      const [a] = await db.select({ tipo: activos.tipo }).from(activos).where(eq(activos.id, row.activoId)).limit(1);
      tipoEquipo = a?.tipo as any ?? null;
    }
    const jefes = await jefesNotificar(ctx, tipoEquipo);
    const jefesEmails = jefes.map((j) => j.email).filter(Boolean);
    if (jefesEmails.length > 0) {
      const tipoLabel = tipoEquipo === "biomedico" ? "🩺 Biomédico" : tipoEquipo === "general" ? "🔧 General" : "Sin clasificar";

      // Resolver sucursal para más contexto
      let sucursalNombre: string | null = null;
      if (row.sucursalId) {
        try {
          const [s] = await db.select({ nombre: sucursales.nombre }).from(sucursales).where(eq(sucursales.id, row.sucursalId)).limit(1);
          sucursalNombre = s?.nombre ?? null;
        } catch {}
      }

      const env = (ctx.locals as any)?.runtime?.env ?? {};
      const baseUrl = env.APP_URL || "https://mantenimiento-49c.pages.dev";
      const ticketUrl = `${baseUrl}/tickets/${row.id}`;

      ctx.locals.runtime.ctx.waitUntil(
        sendMail(ctx, {
          to: jefesEmails,
          subject: `[Soporte ${tipoLabel}] Nuevo ticket #${row.id}: ${row.asunto}`,
          html: emailLayout(
            `Nuevo ticket de soporte`,
            `<h2 style="margin:0 0 8px 0;color:#0a4082;font-size:18px">${row.asunto}</h2>
             <p style="white-space:pre-wrap;background:#f8fafc;padding:12px;border-left:3px solid #0a4082;border-radius:4px;margin:0 0 16px 0">${row.descripcion}</p>
             <table style="width:100%;font-size:13px;border-collapse:collapse;margin:8px 0">
               <tr><td style="padding:4px 0;color:#64748b;width:130px">Solicitante:</td><td><strong>${row.solicitanteNombre}</strong> &lt;${row.solicitanteEmail}&gt;</td></tr>
               ${row.solicitanteTelefono ? `<tr><td style="padding:4px 0;color:#64748b">Teléfono:</td><td>${row.solicitanteTelefono}</td></tr>` : ""}
               <tr><td style="padding:4px 0;color:#64748b">Tipo:</td><td>${tipoLabel}</td></tr>
               ${sucursalNombre ? `<tr><td style="padding:4px 0;color:#64748b">Sucursal:</td><td>${sucursalNombre}</td></tr>` : ""}
               ${row.ubicacion ? `<tr><td style="padding:4px 0;color:#64748b">Ubicación:</td><td>${row.ubicacion}</td></tr>` : ""}
               <tr><td style="padding:4px 0;color:#64748b">Prioridad:</td><td><strong>${row.prioridad}</strong></td></tr>
               <tr><td style="padding:4px 0;color:#64748b">SLA:</td><td>${row.slaHoras}h</td></tr>
             </table>
             <p style="margin-top:18px"><a href="${ticketUrl}" style="display:inline-block;padding:10px 20px;background:#0a4082;color:#fff;border-radius:6px;text-decoration:none;font-weight:500">Ver ticket y asignar →</a></p>`
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
