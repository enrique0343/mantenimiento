// Lógica de notificaciones por email para órdenes de trabajo.
// Centraliza qué se envía a quién en cada cambio de estado.

import type { APIContext } from "astro";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { ordenes, usuarios, tickets, encuestasSatisfaccion } from "./schema";
import { sendMail, emailLayout } from "./email";
import { sendTelegram } from "./telegram";
import { crearNotificacion } from "./notif-app";
import { fmtFechaLarga } from "./datetime";

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
  const primerNombreSol = (sol.nombre ?? "").split(" ")[0] || sol.nombre;
  const primerNombreTec = asg ? ((asg.nombre ?? "").split(" ")[0] || asg.nombre) : null;

  // Si la OT viene de un ticket público, usamos el portal público de
  // seguimiento (sin login). Si no, usamos el detalle interno (que
  // requiere login pero es accesible al solicitante interno).
  const db = getDb(ctx);
  const [tk] = await db.select({ token: tickets.trackingToken }).from(tickets).where(eq(tickets.otId, orden.id)).limit(1);
  const url = tk?.token
    ? `${appUrl(ctx)}/soporte/track/${tk.token}`
    : `${appUrl(ctx)}/ordenes/${orden.id}`;
  const linkLabel = tk?.token ? "Ver estado de tu solicitud →" : "Ver detalle de la orden →";

  // Inicio del trabajo: SIEMPRE el momento real de iniciada_en.
  // Si por alguna razón no está, usamos "Hace un momento" para no engañar
  // mostrando la fecha de creación de la OT o del ticket.
  const fechaInicio = (orden as any).iniciadaEn
    ? fmtFechaLarga((orden as any).iniciadaEn)
    : "Hace un momento";

  await sendMail(ctx, {
    to: sol.email,
    subject: `[OT #${orden.id}] Tu orden ya está en proceso — ${orden.titulo}`,
    html: emailLayout(
      "Estamos trabajando en tu solicitud",
      `<p>Hola <strong>${primerNombreSol}</strong>,</p>
       <p>Buenas noticias. Tu orden ya está en marcha.</p>
       <h3 style="margin:18px 0 10px 0;color:#0a4082;font-size:16px">Orden #${orden.id} — ${orden.titulo}</h3>
       <ul style="margin:0 0 14px 0;padding-left:20px;line-height:1.7">
         ${asg ? `<li><strong>Técnico asignado:</strong> ${asg.nombre}</li>` : ""}
         <li><strong>Inicio del trabajo:</strong> ${fechaInicio}</li>
         <li><strong>Estado:</strong> en ejecución</li>
       </ul>
       <p>${primerNombreTec ? `${primerNombreTec} está atendiendo personalmente tu solicitud` : "El equipo está atendiendo personalmente tu solicitud"} y te confirmaremos por este medio cuando el trabajo quede completado.</p>
       <p>Si durante la ejecución necesitas dar acceso a un área, aclarar un detalle del reporte original o compartir información adicional con el técnico, puedes hacerlo desde la orden.</p>
       <p style="margin:18px 0"><a href="${url}" style="display:inline-block;padding:10px 20px;background:#0a4082;color:#fff;border-radius:6px;text-decoration:none;font-weight:500">${linkLabel}</a></p>
       <p style="margin-top:18px"><em>Gracias por reportarlo. Cada solicitud que llega nos ayuda a mantener Avante en su mejor forma.</em></p>`
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
  const asg = await obtenerAsignado(ctx, orden);
  if (!sol) return;
  const env = (ctx.locals as any)?.runtime?.env ?? {};
  const primerNombreSol = (sol.nombre ?? "").split(" ")[0] || sol.nombre;

  // Si la OT viene de un ticket público, usamos el portal público para los
  // botones (sin login). Si no, usamos el detalle interno.
  const db = getDb(ctx);
  const [tk] = await db.select({ token: tickets.trackingToken }).from(tickets).where(eq(tickets.otId, orden.id)).limit(1);
  const url = tk?.token
    ? `${appUrl(ctx)}/soporte/track/${tk.token}`
    : `${appUrl(ctx)}/ordenes/${orden.id}`;
  const linkLabel = tk?.token ? "Ver estado de tu solicitud →" : "Ver detalle de la orden →";
  const inconformidadUrl = tk?.token ? `${appUrl(ctx)}/soporte/track/${tk.token}?inconformidad=1` : null;

  const fechaCierre = (orden as any).completadaEn
    ? fmtFechaLarga((orden as any).completadaEn)
    : fmtFechaLarga(new Date());

  await sendMail(ctx, {
    to: sol.email,
    subject: `[OT #${orden.id}] Tu solicitud quedó resuelta — ${orden.titulo}`,
    html: emailLayout(
      "Tu solicitud quedó resuelta",
      `<p>Hola <strong>${primerNombreSol}</strong>,</p>
       <p>Te confirmamos que tu orden ya fue atendida.</p>
       <h3 style="margin:18px 0 10px 0;color:#0a4082;font-size:16px">Orden #${orden.id} — ${orden.titulo}</h3>
       <ul style="margin:0 0 14px 0;padding-left:20px;line-height:1.7">
         ${asg ? `<li><strong>Técnico responsable:</strong> ${asg.nombre}</li>` : ""}
         <li><strong>Fecha de cierre:</strong> ${fechaCierre}</li>
         <li><strong>Estado:</strong> <span style="display:inline-block;padding:2px 10px;background:#d1fae5;color:#065f46;border-radius:99px;font-weight:600">✓ completada</span></li>
       </ul>
       ${orden.solucionAplicada ? `<p style="margin:0 0 6px 0"><strong>Solución aplicada:</strong></p>
         <p style="white-space:pre-wrap;background:#f8fafc;padding:12px;border-left:3px solid #0a4082;border-radius:4px;margin:0 0 18px 0">${orden.solucionAplicada}</p>` : ""}
       <p style="margin-top:18px"><strong>Tu validación nos importa.</strong> Tú conoces el área mejor que nadie. Si al verificar notas que el problema original persiste o que algo no quedó como esperabas, repórtalo dentro de las próximas <strong>48 horas</strong> y la reabriremos sin necesidad de generar un nuevo ticket.</p>
       <p>Si todo quedó conforme, no necesitas hacer nada. Tu silencio confirma el cierre.</p>
       <p style="margin:18px 0">
         <a href="${url}" style="display:inline-block;padding:10px 20px;background:#0a4082;color:#fff;border-radius:6px;text-decoration:none;font-weight:500;margin-right:8px">${linkLabel}</a>
         ${inconformidadUrl ? `<a href="${inconformidadUrl}" style="display:inline-block;padding:10px 20px;background:#fff;color:#dc2626;border:1px solid #dc2626;border-radius:6px;text-decoration:none;font-weight:500">Reportar inconformidad →</a>` : ""}
       </p>
       <p style="margin-top:18px"><em>Gracias por confiar en nosotros para resolver tu solicitud. Cada orden cerrada es una oportunidad de hacerlo mejor la próxima vez.</em></p>`
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
  const primerNombreSol = (sol.nombre ?? "").split(" ")[0] || sol.nombre;

  // Nombre del técnico para mostrarlo en la prosa de reconocimiento
  const asg = await obtenerAsignado(ctx, orden);
  const nombreTec = asg?.nombre ?? "el equipo de Mantenimiento";

  // Botones grandes con las 5 calificaciones (acceso directo)
  const stars = [1, 2, 3, 4, 5].map((n) => {
    const emoji = n === 1 ? "😞" : n === 2 ? "😕" : n === 3 ? "😬" : n === 4 ? "🙂" : "😎";
    return `<a href="${encuestaUrl}?c=${n}" style="display:inline-block;margin:0 4px;padding:10px 14px;background:#f1f5f9;color:#0f172a;text-decoration:none;border-radius:8px;border:1px solid #e2e8f0;font-size:18px">${emoji}<br/><span style="font-size:11px;color:#64748b">${n}</span></a>`;
  }).join("");

  await sendMail(ctx, {
    to: sol.email,
    subject: `[OT #${orden.id}] Tu calificación define el próximo cambio en Mantenimiento`,
    html: emailLayout(
      "Cuéntanos cómo nos fue",
      `<p>Hola <strong>${primerNombreSol}</strong>,</p>
       <p>La orden <strong>#${orden.id} — ${orden.titulo}</strong> quedó cerrada. Antes de archivarla, te pedimos un favor de 10 segundos.</p>
       <p style="margin:20px 0 8px 0;text-align:center;font-weight:600;color:#0a4082">¿Cómo te atendimos?</p>
       <div style="text-align:center;margin:8px 0 22px 0">${stars}</div>
       <p style="margin:0 0 6px 0"><strong>Qué pasa con tu voto:</strong></p>
       <ul style="margin:0 0 14px 0;padding-left:20px;line-height:1.7">
         <li>Si calificas con <strong>4 o 5</strong>, le llega como reconocimiento al técnico <strong>${nombreTec}</strong> en su evaluación mensual.</li>
         <li>Si calificas con <strong>1, 2 o 3</strong>, entra al tablero de mejoras de Mantenimiento como caso a revisar esta semana.</li>
       </ul>
       <p style="font-size:13px;color:#475569">Si quieres dejar un comentario adicional, hay un campo opcional al final.</p>
       <p style="margin:18px 0"><a href="${otUrl}" style="display:inline-block;padding:10px 20px;background:#0a4082;color:#fff;border-radius:6px;text-decoration:none;font-weight:500">Ver detalle de la orden →</a></p>
       <p style="margin-top:18px"><em>Cada voto que recibimos cambia algo. Gracias por tomarte el tiempo.</em></p>`
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
