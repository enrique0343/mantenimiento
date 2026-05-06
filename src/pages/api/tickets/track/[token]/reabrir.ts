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
        ctx.locals.runtime.ctx.waitUntil(
          sendMail(ctx, {
            to: tec.email,
            subject: `[OT #${ot.id}] El solicitante reportó inconformidad — ${ot.titulo}`,
            html: emailLayout(
              "OT reabierta — El solicitante necesita más",
              `<p>Hola <strong>${(tec.nombre ?? "").split(" ")[0] || tec.nombre}</strong>,</p>
               <p>El solicitante de la orden <strong>#${ot.id} — ${ot.titulo}</strong> reportó que el problema no quedó resuelto y la orden fue reabierta.</p>
               <p style="margin:0 0 6px 0"><strong>Lo que reporta:</strong></p>
               <p style="white-space:pre-wrap;background:#fef2f2;padding:12px;border-left:3px solid #dc2626;border-radius:4px;margin:0 0 18px 0">${motivo}</p>
               <p>Por favor revisa lo antes posible y vuelve al sitio para terminar de resolver. La orden está nuevamente en estado <strong>en proceso</strong>.</p>
               <p style="margin:18px 0"><a href="${otUrl}" style="display:inline-block;padding:10px 20px;background:#0a4082;color:#fff;border-radius:6px;text-decoration:none;font-weight:500">Abrir orden →</a></p>`
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
    for (const jefe of jefes) {
      if (jefe.email) {
        ctx.locals.runtime.ctx.waitUntil(
          sendMail(ctx, {
            to: jefe.email,
            subject: `[OT #${ot.id}] Inconformidad reportada — ${ot.titulo}`,
            html: emailLayout(
              "Inconformidad reportada en OT cerrada",
              `<p>El solicitante <strong>${t.solicitanteNombre}</strong> &lt;${t.solicitanteEmail}&gt; reportó que el problema no quedó resuelto en la orden <strong>#${ot.id} — ${ot.titulo}</strong>.</p>
               <p style="margin:0 0 6px 0"><strong>Motivo:</strong></p>
               <p style="white-space:pre-wrap;background:#fef2f2;padding:12px;border-left:3px solid #dc2626;border-radius:4px;margin:0 0 18px 0">${motivo}</p>
               <p>La orden fue reabierta a <strong>en proceso</strong>. El técnico asignado ya fue notificado.</p>
               <p style="margin:18px 0"><a href="${otUrl}" style="display:inline-block;padding:10px 20px;background:#0a4082;color:#fff;border-radius:6px;text-decoration:none;font-weight:500">Abrir orden →</a></p>`
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
