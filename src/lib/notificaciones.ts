// Lógica de notificaciones por email para órdenes de trabajo.
// Centraliza qué se envía a quién en cada cambio de estado.

import type { APIContext } from "astro";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { ordenes, usuarios, tickets, encuestasSatisfaccion } from "./schema";
import { sendMail, emailLayout } from "./email";
import { sendTelegram } from "./telegram";
import { crearNotificacion } from "./notif-app";

// URL base del despliegue. Se puede sobrescribir por env APP_URL.
function appUrl(ctx: APIContext): string {
  const env = (ctx.locals as any)?.runtime?.env ?? {};
  return env.APP_URL || "https://mantenimiento-49c.pages.dev";
}

interface OrdenLite {
  id: number;
  titulo: string;
  descripcion?: string | null;
  tipo: string;
  prioridad: string;
  estado: string;
  asignadoA?: number | null;
  creadoPor?: number | null;
  solucionAplicada?: string | null;
  trabajosRealizados?: string | null;
}

interface SolicitanteData { email: string; nombre: string; usuarioId?: number | null; telegramChatId?: string | null }

async function obtenerSolicitante(ctx: APIContext, orden: OrdenLite): Promise<SolicitanteData | null> {
  const db = getDb(ctx);
  // Si hay ticket vinculado, usar email del solicitante del ticket
  const [t] = await db.select().from(tickets).where(eq(tickets.otId, orden.id)).limit(1);
  if (t) {
    // Si el solicitante también es usuario del sistema, traer chat_id de Telegram
    let telegramChatId: string | null = null;
    if (t.solicitanteUsuarioId) {
      const [u] = await db.select({ tg: usuarios.telegramChatId }).from(usuarios).where(eq(usuarios.id, t.solicitanteUsuarioId)).limit(1);
      telegramChatId = u?.tg ?? null;
    }
    return { email: t.solicitanteEmail, nombre: t.solicitanteNombre, usuarioId: t.solicitanteUsuarioId, telegramChatId };
  }

  // Fallback: usuario que creó la OT
  if (orden.creadoPor) {
    const [u] = await db.select({ email: usuarios.email, nombre: usuarios.nombre, telegramChatId: usuarios.telegramChatId })
      .from(usuarios).where(eq(usuarios.id, orden.creadoPor)).limit(1);
    if (u?.email) return { email: u.email, nombre: u.nombre, usuarioId: orden.creadoPor, telegramChatId: u.telegramChatId };
  }
  return null;
}

async function obtenerAsignado(ctx: APIContext, orden: OrdenLite): Promise<{ email: string; nombre: string; telegramChatId: string | null } | null> {
  if (!orden.asignadoA) return null;
  const db = getDb(ctx);
  const [u] = await db.select({ email: usuarios.email, nombre: usuarios.nombre, telegramChatId: usuarios.telegramChatId })
    .from(usuarios).where(eq(usuarios.id, orden.asignadoA)).limit(1);
  return u?.email ? { email: u.email, nombre: u.nombre, telegramChatId: u.telegramChatId ?? null } : null;
}

// Token aleatorio para encuestas (32 hex)
function generarToken(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const ESTADO_LABEL: Record<string, string> = {
  abierta: "Abierta",
  en_proceso: "En proceso",
  completada: "Completada",
  verificada: "Verificada",
  cerrada: "Cerrada",
  cancelada: "Cancelada",
};

// ─── Notificación: OT iniciada (cambio a en_proceso) ─────────────────────────
export async function notificarOTIniciada(ctx: APIContext, orden: OrdenLite) {
  const sol = await obtenerSolicitante(ctx, orden);
  const asg = await obtenerAsignado(ctx, orden);
  if (!sol) return;
  const env = (ctx.locals as any)?.runtime?.env ?? {};
  const url = `${appUrl(ctx)}/ordenes/${orden.id}`;
  await sendMail(ctx, {
    to: sol.email,
    subject: `[OT #${orden.id}] Iniciado el trabajo: ${orden.titulo}`,
    html: emailLayout(
      "Tu solicitud está en proceso",
      `<p>Hola <strong>${sol.nombre}</strong>,</p>
       <p>El técnico ha comenzado a trabajar en la orden <strong>#${orden.id} - ${orden.titulo}</strong>.</p>
       ${asg ? `<p>Técnico asignado: <strong>${asg.nombre}</strong></p>` : ""}
       <p>Te avisaremos cuando el trabajo esté completado.</p>
       <p><a href="${url}">Ver detalle de la orden →</a></p>`
    ),
    tipo: "ot_iniciada",
    referencia: `orden:${orden.id}`,
  }).catch(() => {});

  if (sol.telegramChatId) {
    await sendTelegram(env, sol.telegramChatId,
      `🛠 <b>Iniciado:</b> OT #${orden.id} - ${orden.titulo}\n${asg ? `Técnico: ${asg.nombre}` : ""}`,
      { linkUrl: url, linkLabel: "Ver orden" }
    );
  }
  if (sol.usuarioId) {
    await crearNotificacion(ctx, {
      usuarioId: sol.usuarioId, tipo: "ot_iniciada",
      titulo: `OT #${orden.id} en proceso`,
      mensaje: `${orden.titulo}${asg ? ` · Técnico: ${asg.nombre}` : ""}`,
      link: `/ordenes/${orden.id}`,
    });
  }
}

// ─── Notificación: OT completada por técnico ─────────────────────────────────
export async function notificarOTCompletada(ctx: APIContext, orden: OrdenLite) {
  const sol = await obtenerSolicitante(ctx, orden);
  if (!sol) return;
  const env = (ctx.locals as any)?.runtime?.env ?? {};
  const url = `${appUrl(ctx)}/ordenes/${orden.id}`;
  await sendMail(ctx, {
    to: sol.email,
    subject: `[OT #${orden.id}] Trabajo completado: ${orden.titulo}`,
    html: emailLayout(
      "Trabajo completado",
      `<p>Hola <strong>${sol.nombre}</strong>,</p>
       <p>El técnico marcó como <strong>completada</strong> la orden <strong>#${orden.id} - ${orden.titulo}</strong>.</p>
       ${orden.solucionAplicada ? `<p><strong>Solución aplicada:</strong><br/><span style="white-space:pre-wrap">${orden.solucionAplicada}</span></p>` : ""}
       <p>El trabajo aún debe ser verificado por el área de mantenimiento.</p>
       <p><a href="${url}">Ver detalle de la orden →</a></p>`
    ),
    tipo: "ot_completada",
    referencia: `orden:${orden.id}`,
  }).catch(() => {});

  if (sol.telegramChatId) {
    await sendTelegram(env, sol.telegramChatId,
      `✅ <b>Completada:</b> OT #${orden.id} - ${orden.titulo}${orden.solucionAplicada ? `\n<i>Solución:</i> ${orden.solucionAplicada}` : ""}`,
      { linkUrl: url, linkLabel: "Ver orden" }
    );
  }
  if (sol.usuarioId) {
    await crearNotificacion(ctx, {
      usuarioId: sol.usuarioId, tipo: "ot_completada",
      titulo: `OT #${orden.id} completada`,
      mensaje: orden.titulo,
      link: `/ordenes/${orden.id}`,
    });
  }
}

// ─── Notificación: OT cerrada + crear encuesta de satisfacción ───────────────
export async function notificarOTCerradaConEncuesta(ctx: APIContext, orden: OrdenLite) {
  const sol = await obtenerSolicitante(ctx, orden);
  if (!sol) return;
  const db = getDb(ctx);

  // Crear encuesta única (no duplicar si ya existe para esta OT)
  const existente = await db.select().from(encuestasSatisfaccion).where(eq(encuestasSatisfaccion.ordenId, orden.id)).limit(1);
  let token: string;
  if (existente.length > 0) {
    if (existente[0].respondidaEn) return; // ya respondió, no spamear
    token = existente[0].token;
  } else {
    token = generarToken();
    // Buscar ticket relacionado para enlazarlo (si existe)
    const [tk] = await db.select().from(tickets).where(eq(tickets.otId, orden.id)).limit(1);
    await db.insert(encuestasSatisfaccion).values({
      ordenId: orden.id,
      ticketId: tk?.id ?? null,
      token,
      destinatarioEmail: sol.email,
      destinatarioNombre: sol.nombre,
    });
  }

  const baseUrl = appUrl(ctx);
  const encuestaUrl = `${baseUrl}/encuesta/${token}`;
  const otUrl = `${baseUrl}/ordenes/${orden.id}`;

  // Botones grandes con las 5 calificaciones (acceso directo)
  const stars = [1, 2, 3, 4, 5].map((n) => {
    const emoji = n === 1 ? "😞" : n === 2 ? "😕" : n === 3 ? "😐" : n === 4 ? "🙂" : "😀";
    return `<a href="${encuestaUrl}?c=${n}" style="display:inline-block;margin:0 4px;padding:10px 14px;background:#f1f5f9;color:#0f172a;text-decoration:none;border-radius:8px;border:1px solid #e2e8f0;font-size:18px">${emoji}<br/><span style="font-size:11px;color:#64748b">${n}</span></a>`;
  }).join("");

  await sendMail(ctx, {
    to: sol.email,
    subject: `[OT #${orden.id}] ¿Cómo calificas el trabajo?`,
    html: emailLayout(
      "Tu opinión es importante",
      `<p>Hola <strong>${sol.nombre}</strong>,</p>
       <p>La orden <strong>#${orden.id} - ${orden.titulo}</strong> ha sido cerrada. ¡Gracias!</p>
       <p>Nos ayudaría mucho que califiques el servicio del 1 al 5:</p>
       <div style="text-align:center;margin:18px 0">${stars}</div>
       <p style="text-align:center;font-size:12px;color:#64748b">o haz clic en <a href="${encuestaUrl}">este enlace</a> para dejar un comentario.</p>
       <p style="margin-top:18px"><a href="${otUrl}">Ver detalle de la orden →</a></p>`
    ),
    tipo: "encuesta_satisfaccion",
    referencia: `orden:${orden.id}`,
  }).catch(() => {});
}

// ─── Dispatcher: dado un cambio de estado de OT, dispara las notificaciones ───
export async function disparadorOT(
  ctx: APIContext,
  orden: OrdenLite,
  estadoAnterior: string,
  estadoNuevo: string
) {
  if (estadoAnterior === estadoNuevo) return;
  const cambios: Promise<void>[] = [];
  if (estadoNuevo === "en_proceso" && estadoAnterior === "abierta") {
    cambios.push(notificarOTIniciada(ctx, orden));
  } else if (estadoNuevo === "completada") {
    cambios.push(notificarOTCompletada(ctx, orden));
  } else if (estadoNuevo === "cerrada") {
    cambios.push(notificarOTCerradaConEncuesta(ctx, orden));
  }
  // No bloquear la respuesta del API
  const wait = (ctx.locals as any)?.runtime?.ctx?.waitUntil;
  for (const p of cambios) {
    if (wait) wait(p); else await p.catch(() => {});
  }
}
