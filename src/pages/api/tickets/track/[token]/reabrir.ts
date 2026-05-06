import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tickets, ordenes, comentarios, ticketComentarios, usuarios } from "@/lib/schema";
import { sendMail, emailLayout } from "@/lib/email";
import { sendTelegram } from "@/lib/telegram";
import { crearNotificacion } from "@/lib/notif-app";
import { logAudit } from "@/lib/audit";

export const prerender = false;

const VENTANA_HORAS = 48;

const schema = z.object({
  motivo: z.string().min(10, "Por favor describe qué notaste con al menos 10 caracteres"),
});

// Endpoint público: el solicitante reporta inconformidad y reabre la OT.
// Requisitos:
//   - Token válido del ticket
//   - OT en completada o verificada (no cerrada ni cancelada)
//   - Dentro de la ventana de 48h desde completadaEn
export const POST: APIRoute = async (ctx) => {
  const token = ctx.params.token;
  if (!token) return Response.json({ error: "Token requerido" }, { status: 400 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors.motivo?.[0] ?? "Motivo requerido" }, { status: 400 });
  }

  const db = getDb(ctx);
  const [t] = await db.select().from(tickets).where(eq(tickets.trackingToken, token)).limit(1);
  if (!t) return Response.json({ error: "Token inválido" }, { status: 404 });
  if (!t.otId) return Response.json({ error: "Este ticket no tiene una orden asociada todavía." }, { status: 400 });

  const [ot] = await db.select().from(ordenes).where(eq(ordenes.id, t.otId)).limit(1);
  if (!ot) return Response.json({ error: "Orden no encontrada" }, { status: 404 });

  if (ot.estado !== "completada" && ot.estado !== "verificada") {
    return Response.json({
      error: ot.estado === "cerrada" || ot.estado === "cancelada"
        ? "Esta orden ya fue cerrada definitivamente. Por favor, crea un nuevo ticket si el problema persiste."
        : "Esta orden todavía está en proceso. No es necesario reportar inconformidad.",
    }, { status: 400 });
  }

  // Validar ventana de 48h desde completadaEn
  if (ot.completadaEn) {
    const horas = (Date.now() - new Date(ot.completadaEn).getTime()) / 3_600_000;
    if (horas > VENTANA_HORAS) {
      return Response.json({
        error: `La ventana para reportar inconformidad fue de ${VENTANA_HORAS} horas y ya pasó. Por favor, crea un nuevo ticket si el problema persiste.`,
      }, { status: 400 });
    }
  }

  const now = new Date().toISOString();
  const motivo = parsed.data.motivo.trim();

  // 1) Reabrir OT a en_proceso, limpiar timestamps post
  await db.update(ordenes).set({
    estado: "en_proceso",
    completadaEn: null,
    verificadoPor: null,
    verificadoEn: null,
  }).where(eq(ordenes.id, ot.id));

  // 2) Comentario en la OT (autor: sistema, ya que el solicitante público no
  //    es un usuario interno)
  try {
    // Encontrar un usuario para asociar (el creador de la OT, fallback al primer admin)
    let autorId = ot.creadoPor;
    if (!autorId) {
      const [admin] = await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.rol, "admin")).limit(1);
      autorId = admin?.id ?? null;
    }
    if (autorId) {
      await db.insert(comentarios).values({
        ordenId: ot.id,
        usuarioId: autorId,
        texto: `🔁 INCONFORMIDAD REPORTADA POR EL SOLICITANTE\n\n${t.solicitanteNombre} <${t.solicitanteEmail}> reabrió la orden con el siguiente motivo:\n\n${motivo}`,
      });
    }
  } catch (e) { console.error("comentario reapertura:", e); }

  // 3) Comentario público en el ticket
  try {
    await db.insert(ticketComentarios).values({
      ticketId: t.id,
      autorExterno: t.solicitanteNombre,
      texto: `Reporté inconformidad: ${motivo}`,
      publico: true,
    });
  } catch {}

  // 4) Cambiar estado del ticket a en_proceso
  await db.update(tickets).set({
    estado: "en_proceso",
    resueltoEn: null,
    updatedAt: now,
  }).where(eq(tickets.id, t.id));

  // 5) Audit log
  await logAudit(ctx, {
    entidad: "orden", entidadId: ot.id, accion: "estado",
    resumen: `Reabierta por inconformidad del solicitante (${t.solicitanteEmail})`,
    cambios: { estado: { antes: ot.estado, despues: "en_proceso" } },
  });

  // 6) Notificar al técnico y al jefe
  try {
    const env = (ctx.locals as any)?.runtime?.env ?? {};
    const baseUrl = env.APP_URL || "https://mantenimiento-49c.pages.dev";
    const otUrl = `${baseUrl}/ordenes/${ot.id}`;

    // Técnico asignado
    if (ot.asignadoA) {
      const [tec] = await db.select().from(usuarios).where(eq(usuarios.id, ot.asignadoA)).limit(1);
      if (tec?.email) {
        const primerNombreTec = (tec.nombre ?? "").split(" ")[0] || tec.nombre;
        ctx.locals.runtime.ctx.waitUntil(
          sendMail(ctx, {
            to: tec.email,
            subject: `[OT #${ot.id}] Necesitamos una segunda visita — ${ot.titulo}`,
            html: emailLayout(
              "Volvamos al sitio para terminar bien",
              `<p>Hola <strong>${primerNombreTec}</strong>,</p>
               <p>El solicitante de la <strong>OT #${ot.id} — ${ot.titulo}</strong> nos compartió que el problema no quedó completamente resuelto después de tu intervención. La orden volvió a estado <strong>en proceso</strong> para que puedas completarla.</p>

               <h3 style="margin:18px 0 8px 0;color:#0a4082;font-size:15px">Lo que el solicitante observó al verificar:</h3>
               <p style="white-space:pre-wrap;background:#fef2f2;padding:12px;border-left:3px solid #dc2626;border-radius:4px;margin:0 0 18px 0">${motivo}</p>

               <h3 style="margin:18px 0 8px 0;color:#0a4082;font-size:15px">Cómo leer este reabrimiento</h3>
               <p>Esto no es una observación contra tu trabajo. El trabajo que ejecutaste está registrado y sigue siendo válido. Lo que el solicitante está señalando es un alcance adicional que probablemente no era visible al momento del diagnóstico inicial, o que se manifestó después.</p>
               <p>Estos casos pasan. El sistema de reabrimiento existe precisamente para que casos como este se resuelvan dentro de la misma OT, sin generar tickets nuevos ni perder la trazabilidad del trabajo ya hecho.</p>

               <h3 style="margin:18px 0 8px 0;color:#0a4082;font-size:15px">Próximos pasos sugeridos</h3>
               <p>Cuando regreses al sitio, te sugerimos verificar tres cosas: el estado real del problema bajo las condiciones actuales, los componentes adicionales que pudieran estar relacionados con el síntoma, y cualquier otro elemento del sistema que pueda estar contribuyendo al caso.</p>
               <p>Si al diagnosticar de nuevo encuentras un alcance distinto al original (por ejemplo, repuesto adicional, falla en otro componente, intervención mayor), regístralo en la orden antes de intervenir. Si al evaluar consideras que el caso ya excede mantenimiento correctivo y requiere apoyo de jefatura o de un especialista externo, escálalo. Esto no es retroceso; es buen criterio.</p>

               <p style="margin:22px 0"><a href="${otUrl}" style="display:inline-block;padding:10px 22px;background:#0a4082;color:#fff;border-radius:6px;text-decoration:none;font-weight:500">Abrir orden →</a></p>
               <p style="margin-top:14px"><em>Gracias por tomar este reabrimiento como lo que es: una oportunidad de cerrar bien un caso que importa.</em></p>`
            ),
            tipo: "ot_reabierta",
            referencia: `orden:${ot.id}`,
          }).catch(() => {})
        );
      }
      if (tec?.telegramChatId) {
        ctx.locals.runtime.ctx.waitUntil(
          sendTelegram(env, tec.telegramChatId,
            `🔁 <b>OT #${ot.id} reabierta por inconformidad</b>\n${ot.titulo}\n<i>${motivo.slice(0, 200)}</i>`,
            { linkUrl: otUrl, linkLabel: "Abrir orden" }
          )
        );
      }
      await crearNotificacion(ctx, {
        usuarioId: ot.asignadoA, tipo: "ot_reabierta",
        titulo: `OT #${ot.id} reabierta por inconformidad`,
        mensaje: motivo,
        link: `/ordenes/${ot.id}`,
      });
    }

    // Jefes
    const jefes = await db.select().from(usuarios).where(eq(usuarios.rol, "jefe"));
    // Datos para los correos a jefes (técnico responsable, fechas)
    const fechaCierre = ot.completadaEn
      ? new Date(ot.completadaEn).toLocaleString("es", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
      : "—";
    const fechaReabrimiento = new Date().toLocaleString("es", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
    let nombreTecnico = "el técnico asignado";
    if (ot.asignadoA) {
      const [tecRow] = await db.select({ nombre: usuarios.nombre }).from(usuarios).where(eq(usuarios.id, ot.asignadoA)).limit(1);
      if (tecRow?.nombre) nombreTecnico = tecRow.nombre;
    }

    for (const jefe of jefes) {
      const primerNombreJefe = (jefe.nombre ?? "").split(" ")[0] || jefe.nombre;
      if (jefe.email) {
        ctx.locals.runtime.ctx.waitUntil(
          sendMail(ctx, {
            to: jefe.email,
            subject: `[OT #${ot.id}] Reabrimiento de OT — Aviso para tu monitoreo`,
            html: emailLayout(
              "Aviso de gobierno",
              `<p>Hola <strong>${primerNombreJefe}</strong>,</p>
               <p>Te enviamos este aviso para tu monitoreo, no para que intervengas.</p>
               <p>La <strong>OT #${ot.id} — ${ot.titulo}</strong>, que cerró <strong>${nombreTecnico}</strong>, fue reabierta por inconformidad del solicitante.</p>

               <h3 style="margin:18px 0 10px 0;color:#0a4082;font-size:15px">Datos clave</h3>
               <ul style="margin:0 0 14px 0;padding-left:20px;line-height:1.7">
                 <li><strong>Solicitante:</strong> ${t.solicitanteNombre} &lt;${t.solicitanteEmail}&gt;</li>
                 <li><strong>Técnico asignado:</strong> ${nombreTecnico}</li>
                 <li><strong>Fecha de cierre original:</strong> ${fechaCierre}</li>
                 <li><strong>Fecha de reabrimiento:</strong> ${fechaReabrimiento}</li>
               </ul>

               <h3 style="margin:18px 0 8px 0;color:#0a4082;font-size:15px">Lo que reportó el solicitante</h3>
               <p style="white-space:pre-wrap;background:#fef2f2;padding:12px;border-left:3px solid #dc2626;border-radius:4px;margin:0 0 18px 0">${motivo}</p>

               <h3 style="margin:18px 0 8px 0;color:#0a4082;font-size:15px">Estado actual</h3>
               <p>La OT regresó a estado <strong>en proceso</strong>. ${nombreTecnico.split(" ")[0]} ya fue notificado y volverá al sitio bajo flujo estándar.</p>
               <p>Si después de revisar el caso consideras que requiere tu intervención, puedes hacerlo desde la orden. Si no, basta con que quede registrado para tu visibilidad.</p>

               <p style="margin:22px 0"><a href="${otUrl}" style="display:inline-block;padding:10px 22px;background:#0a4082;color:#fff;border-radius:6px;text-decoration:none;font-weight:500">Abrir orden →</a></p>`
            ),
            tipo: "ot_reabierta_jefe",
            referencia: `orden:${ot.id}`,
          }).catch(() => {})
        );
      }
      await crearNotificacion(ctx, {
        usuarioId: jefe.id, tipo: "ot_reabierta",
        titulo: `Inconformidad en OT #${ot.id}`,
        mensaje: `${t.solicitanteNombre}: ${motivo.slice(0, 100)}`,
        link: `/ordenes/${ot.id}`,
      });
    }
  } catch (e) {
    console.error("notif inconformidad:", e);
  }

  return Response.json({ ok: true, ordenId: ot.id });
};
