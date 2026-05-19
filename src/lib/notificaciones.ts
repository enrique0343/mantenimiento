// Lógica de notificaciones por email para órdenes de trabajo.
// Centraliza qué se envía a quién en cada cambio de estado.

import type { APIContext } from "astro";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { ordenes, usuarios, tickets, activos, encuestasSatisfaccion } from "./schema";
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

  // Crear encuesta única — UN SOLO envío por OT.
  // Si ya existe el registro (porque la OT fue cerrada antes, reabierta y
  // re-cerrada, o por cualquier otra razón), NO mandamos el correo otra vez.
  // El recordatorio (#8) se encarga del segundo envío a las 48h vía cron.
  const existente = await db.select().from(encuestasSatisfaccion).where(eq(encuestasSatisfaccion.ordenId, orden.id)).limit(1);
  if (existente.length > 0) {
    return; // Encuesta ya fue enviada antes — evitamos duplicados
  }
  const token = generarToken();
  // Buscar ticket relacionado para enlazarlo (si existe)
  const [tk] = await db.select().from(tickets).where(eq(tickets.otId, orden.id)).limit(1);
  await db.insert(encuestasSatisfaccion).values({
    ordenId: orden.id,
    ticketId: tk?.id ?? null,
    token,
    destinatarioEmail: sol.email,
    destinatarioNombre: sol.nombre,
  });

  const baseUrl = appUrl(ctx);
  const encuestaUrl = `${baseUrl}/encuesta/${token}`;
  const primerNombreSol = (sol.nombre ?? "").split(" ")[0] || sol.nombre;

  // Nombre del técnico para mostrarlo en la prosa
  const asg = await obtenerAsignado(ctx, orden);
  const nombreTec = asg?.nombre ?? "el equipo de Mantenimiento";

  // Link al portal público si vino de ticket; si no, al detalle interno
  const url = tk?.trackingToken
    ? `${baseUrl}/soporte/track/${tk.trackingToken}`
    : `${baseUrl}/ordenes/${orden.id}`;
  const inconformidadUrl = tk?.trackingToken ? `${baseUrl}/soporte/track/${tk.trackingToken}?inconformidad=1` : null;

  const fechaCierre = (orden as any).completadaEn
    ? fmtFechaLarga((orden as any).completadaEn)
    : fmtFechaLarga(new Date());

  // Botones grandes con las 5 calificaciones (acceso directo)
  const stars = [1, 2, 3, 4, 5].map((n) => {
    const emoji = n === 1 ? "😞" : n === 2 ? "😕" : n === 3 ? "😬" : n === 4 ? "🙂" : "😎";
    return `<a href="${encuestaUrl}?c=${n}" style="display:inline-block;margin:0 4px;padding:10px 14px;background:#f1f5f9;color:#0f172a;text-decoration:none;border-radius:8px;border:1px solid #e2e8f0;font-size:18px">${emoji}<br/><span style="font-size:11px;color:#64748b">${n}</span></a>`;
  }).join("");

  // CORREO COMBINADO: cierre + encuesta en un solo mensaje
  await sendMail(ctx, {
    to: sol.email,
    subject: `[OT #${orden.id}] Tu solicitud quedó resuelta — cuéntanos cómo nos fue`,
    html: emailLayout(
      "Tu solicitud quedó resuelta",
      `<p>Hola <strong>${primerNombreSol}</strong>,</p>
       <p>Te confirmamos que tu orden ya fue atendida.</p>
       <h3 style="margin:18px 0 10px 0;color:#0a4082;font-size:16px">Orden #${orden.id} — ${orden.titulo}</h3>
       <ul style="margin:0 0 14px 0;padding-left:20px;line-height:1.7">
         <li><strong>Técnico responsable:</strong> ${nombreTec}</li>
         <li><strong>Fecha de cierre:</strong> ${fechaCierre}</li>
         <li><strong>Estado:</strong> <span style="display:inline-block;padding:2px 10px;background:#d1fae5;color:#065f46;border-radius:99px;font-weight:600">✓ completada</span></li>
       </ul>
       ${orden.solucionAplicada ? `<p style="margin:0 0 6px 0"><strong>Solución aplicada:</strong></p>
         <p style="white-space:pre-wrap;background:#f8fafc;padding:12px;border-left:3px solid #0a4082;border-radius:4px;margin:0 0 18px 0">${orden.solucionAplicada}</p>` : ""}

       <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />

       <p style="margin:0 0 8px 0;text-align:center;font-weight:600;color:#0a4082;font-size:16px">¿Cómo te atendimos?</p>
       <p style="margin:0 0 14px 0;text-align:center;font-size:13px;color:#64748b">Tu calificación define el próximo cambio en Mantenimiento. Solo te toma 10 segundos.</p>
       <div style="text-align:center;margin:8px 0 22px 0">${stars}</div>
       <p style="margin:0 0 6px 0"><strong>Qué pasa con tu voto:</strong></p>
       <ul style="margin:0 0 14px 0;padding-left:20px;line-height:1.7">
         <li>Si calificas con <strong>4 o 5</strong>, le llega como reconocimiento al técnico <strong>${nombreTec}</strong> en su evaluación mensual.</li>
         <li>Si calificas con <strong>1, 2 o 3</strong>, entra al tablero de mejoras de Mantenimiento como caso a revisar esta semana.</li>
       </ul>

       <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />

       <p style="margin-top:14px"><strong>Tu validación nos importa.</strong> Si al verificar notas que el problema persiste o que algo no quedó como esperabas, repórtalo dentro de las próximas <strong>48 horas</strong> y la reabriremos sin necesidad de generar un nuevo ticket.</p>
       <p style="margin:18px 0">
         <a href="${url}" style="display:inline-block;padding:10px 20px;background:#0a4082;color:#fff;border-radius:6px;text-decoration:none;font-weight:500;margin-right:8px">${tk?.trackingToken ? "Ver estado de tu solicitud →" : "Ver detalle de la orden →"}</a>
         ${inconformidadUrl ? `<a href="${inconformidadUrl}" style="display:inline-block;padding:10px 20px;background:#fff;color:#dc2626;border:1px solid #dc2626;border-radius:6px;text-decoration:none;font-weight:500">Reportar inconformidad →</a>` : ""}
       </p>
       <p style="margin-top:18px"><em>Gracias por confiar en nosotros para resolver tu solicitud. Cada orden cerrada es una oportunidad de hacerlo mejor la próxima vez.</em></p>`
    ),
    tipo: "encuesta_satisfaccion",
    referencia: `orden:${orden.id}`,
  }).catch(() => {});
}

// ─── Notificación: OT cerrada → AVISO AL JEFE (#14) ──────────────────────────
export async function notificarOTCerradaJefe(ctx: APIContext, orden: OrdenLite) {
  const db = getDb(ctx);
  // Determinar tipo del equipo (general/biomedico) para routing del jefe
  let tipoEquipo: "general" | "biomedico" | null = null;
  if ((orden as any).activoId) {
    try {
      const [a] = await db.select({ tipo: activos.tipo }).from(activos).where(eq(activos.id, (orden as any).activoId)).limit(1);
      tipoEquipo = (a?.tipo as any) ?? null;
    } catch {}
  }

  // Buscar jefes que deban recibir el aviso
  const jefes = await db.select().from(usuarios).where(eq(usuarios.rol, "jefe"));
  const destinatarios = jefes.filter((j) => {
    if (!tipoEquipo) return true;
    const esp = j.especialidad;
    return !esp || esp === "ambos" || esp === tipoEquipo;
  });
  if (destinatarios.length === 0) return;

  const sol = await obtenerSolicitante(ctx, orden);
  const asg = await obtenerAsignado(ctx, orden);
  const nombreTec = asg?.nombre ?? "Sin asignar";
  const otUrl = `${appUrl(ctx)}/ordenes/${orden.id}`;

  const fechaCierre = (orden as any).completadaEn
    ? fmtFechaLarga((orden as any).completadaEn)
    : fmtFechaLarga(new Date());
  const horas = (orden as any).horasTrabajadas != null
    ? `${Number((orden as any).horasTrabajadas).toFixed(2)} h`
    : "—";

  const env = (ctx.locals as any)?.runtime?.env ?? {};
  for (const jefe of destinatarios) {
    if (!jefe.email) continue;
    const primerNombre = (jefe.nombre ?? "").split(" ")[0] || jefe.nombre;
    await sendMail(ctx, {
      to: jefe.email,
      subject: `[OT #${orden.id}] Trabajo finalizado por ${nombreTec}`,
      html: emailLayout(
        "Trabajo finalizado en tu radar",
        `<p>Hola <strong>${primerNombre}</strong>,</p>
         <p>Te avisamos que <strong>${nombreTec}</strong> acaba de cerrar la <strong>OT #${orden.id} — ${orden.titulo}</strong>.</p>

         <h3 style="margin:18px 0 10px 0;color:#0a4082;font-size:15px">Datos del cierre</h3>
         <ul style="margin:0 0 14px 0;padding-left:20px;line-height:1.7;font-size:14px">
           <li><strong>Técnico:</strong> ${nombreTec}</li>
           <li><strong>Tipo:</strong> ${orden.tipo} · <strong>Prioridad:</strong> ${orden.prioridad}</li>
           ${tipoEquipo ? `<li><strong>Especialidad:</strong> ${tipoEquipo === "biomedico" ? "🩺 Biomédico" : "🔧 General"}</li>` : ""}
           <li><strong>Fecha de cierre:</strong> ${fechaCierre}</li>
           <li><strong>Horas trabajadas:</strong> ${horas}</li>
           ${sol ? `<li><strong>Solicitante:</strong> ${sol.nombre} &lt;${sol.email}&gt;</li>` : ""}
         </ul>

         ${orden.trabajosRealizados ? `<p style="margin:0 0 6px 0"><strong>Trabajos realizados:</strong></p>
           <p style="white-space:pre-wrap;background:#f8fafc;padding:12px;border-left:3px solid #0a4082;border-radius:4px;margin:0 0 14px 0;font-size:13px">${orden.trabajosRealizados}</p>` : ""}
         ${orden.solucionAplicada ? `<p style="margin:0 0 6px 0"><strong>Solución aplicada:</strong></p>
           <p style="white-space:pre-wrap;background:#f0fdf4;padding:12px;border-left:3px solid #16a34a;border-radius:4px;margin:0 0 14px 0;font-size:13px">${orden.solucionAplicada}</p>` : ""}

         <p style="margin:18px 0"><a href="${otUrl}" style="display:inline-block;padding:10px 20px;background:#0a4082;color:#fff;border-radius:6px;text-decoration:none;font-weight:500">Abrir orden →</a></p>
         <p style="font-size:13px;color:#64748b;margin-top:14px">Esto es un aviso para tu monitoreo. El solicitante ya recibió la encuesta de satisfacción y tiene 48h para reportar inconformidad si algo no quedó bien.</p>`
      ),
      tipo: "ot_cerrada_jefe",
      referencia: `orden:${orden.id}`,
    }).catch(() => {});

    // Notificación in-app
    await crearNotificacion(ctx, {
      usuarioId: jefe.id, tipo: "ot_cerrada_jefe",
      titulo: `OT #${orden.id} cerrada por ${nombreTec}`,
      mensaje: orden.titulo,
      link: `/ordenes/${orden.id}`,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PROYECTOS
// ═══════════════════════════════════════════════════════════════════════════

interface ProyectoLite {
  id: number;
  codigo: string;
  titulo: string;
  descripcion?: string | null;
  prioridad: string;
  estado: string;
  creadoPor?: number | null;
  responsableId?: number | null;
  ticketId?: number | null;
  notasCierre?: string | null;
}

// Nuevo proyecto creado → email a todos los admins para revisar/aprobar
export async function notificarProyectoCreado(ctx: APIContext, proyecto: ProyectoLite) {
  const db = getDb(ctx);
  const admins = await db.select({ id: usuarios.id, email: usuarios.email, nombre: usuarios.nombre })
    .from(usuarios).where(eq(usuarios.rol, "admin"));
  if (admins.length === 0) return;

  const baseUrl = appUrl(ctx);
  const link = `${baseUrl}/proyectos/${proyecto.id}`;
  const subject = `[${proyecto.codigo}] Proyecto pendiente de evaluación: ${proyecto.titulo}`;

  for (const a of admins) {
    if (!a.email) continue;
    const primer = (a.nombre ?? "").split(" ")[0] || a.nombre;
    ctx.locals.runtime.ctx.waitUntil(
      sendMail(ctx, {
        to: a.email, subject,
        html: emailLayout(
          "Nuevo proyecto a evaluar",
          `<p>Hola <strong>${primer}</strong>,</p>
           <p>Se ha registrado un nuevo proyecto que requiere tu revisión y aprobación.</p>
           <h3 style="margin:18px 0 10px 0;color:#0a4082;font-size:16px">${proyecto.codigo} — ${proyecto.titulo}</h3>
           <ul style="margin:0 0 14px 0;padding-left:20px;line-height:1.7">
             <li><strong>Prioridad:</strong> ${proyecto.prioridad}</li>
             <li><strong>Estado:</strong> En evaluación</li>
           </ul>
           ${proyecto.descripcion ? `<p style="margin:0 0 6px 0"><strong>Descripción:</strong></p>
             <p style="white-space:pre-wrap;background:#f8fafc;padding:12px;border-left:3px solid #0a4082;border-radius:4px;margin:0 0 18px 0">${proyecto.descripcion}</p>` : ""}
           <p style="margin:18px 0"><a href="${link}" style="display:inline-block;padding:10px 20px;background:#0a4082;color:#fff;border-radius:6px;text-decoration:none;font-weight:500">Revisar proyecto →</a></p>`
        ),
        tipo: "proyecto_creado", referencia: `proyecto:${proyecto.id}`,
      }).catch(() => {})
    );

    await crearNotificacion(ctx, {
      usuarioId: a.id, tipo: "proyecto_creado",
      titulo: `Nuevo proyecto ${proyecto.codigo} a evaluar`,
      mensaje: proyecto.titulo,
      link: `/proyectos/${proyecto.id}`,
    });
  }
}

// Proyecto pasa a en_ejecucion → email al responsable
export async function notificarProyectoEnEjecucion(ctx: APIContext, proyecto: ProyectoLite) {
  if (!proyecto.responsableId) return;
  const db = getDb(ctx);
  const [resp] = await db.select({ id: usuarios.id, email: usuarios.email, nombre: usuarios.nombre })
    .from(usuarios).where(eq(usuarios.id, proyecto.responsableId)).limit(1);
  if (!resp?.email) return;

  const baseUrl = appUrl(ctx);
  const link = `${baseUrl}/proyectos/${proyecto.id}`;
  const primer = (resp.nombre ?? "").split(" ")[0] || resp.nombre;

  ctx.locals.runtime.ctx.waitUntil(
    sendMail(ctx, {
      to: resp.email,
      subject: `[${proyecto.codigo}] Proyecto en ejecución: ${proyecto.titulo}`,
      html: emailLayout(
        "Proyecto en ejecución",
        `<p>Hola <strong>${primer}</strong>,</p>
         <p>El proyecto <strong>${proyecto.codigo} — ${proyecto.titulo}</strong> fue aprobado y entra en ejecución. Eres su responsable.</p>
         <p>Desde el detalle del proyecto puedes generar las OTs hijas, registrar avance de hitos y dar seguimiento al presupuesto.</p>
         <p style="margin:18px 0"><a href="${link}" style="display:inline-block;padding:10px 20px;background:#0a4082;color:#fff;border-radius:6px;text-decoration:none;font-weight:500">Abrir proyecto →</a></p>
         <p style="margin-top:14px"><em>Gracias por mantener Avante funcionando.</em></p>`
      ),
      tipo: "proyecto_en_ejecucion", referencia: `proyecto:${proyecto.id}`,
    }).catch(() => {})
  );

  await crearNotificacion(ctx, {
    usuarioId: resp.id, tipo: "proyecto_en_ejecucion",
    titulo: `Eres responsable de ${proyecto.codigo}`,
    mensaje: proyecto.titulo,
    link: `/proyectos/${proyecto.id}`,
  });
}

// Proyecto completado → email al solicitante original (si vino de ticket)
export async function notificarProyectoCompletado(ctx: APIContext, proyecto: ProyectoLite) {
  if (!proyecto.ticketId) return;
  const db = getDb(ctx);
  const [t] = await db.select().from(tickets).where(eq(tickets.id, proyecto.ticketId)).limit(1);
  if (!t?.solicitanteEmail) return;

  const baseUrl = appUrl(ctx);
  const primer = (t.solicitanteNombre ?? "").split(" ")[0] || t.solicitanteNombre;
  const link = `${baseUrl}/p/ticket/${t.trackingToken}`;

  ctx.locals.runtime.ctx.waitUntil(
    sendMail(ctx, {
      to: t.solicitanteEmail,
      subject: `[${proyecto.codigo}] Proyecto completado — ${proyecto.titulo}`,
      html: emailLayout(
        "Proyecto completado",
        `<p>Hola <strong>${primer}</strong>,</p>
         <p>Te informamos que el proyecto originado por tu reporte <strong>Ticket #${t.id}</strong> ha sido completado.</p>
         <h3 style="margin:18px 0 10px 0;color:#0a4082;font-size:16px">${proyecto.codigo} — ${proyecto.titulo}</h3>
         ${proyecto.notasCierre ? `<p style="margin:0 0 6px 0"><strong>Notas de cierre:</strong></p>
           <p style="white-space:pre-wrap;background:#f0fdf4;padding:12px;border-left:3px solid #16a34a;border-radius:4px;margin:0 0 18px 0">${proyecto.notasCierre}</p>` : ""}
         <p style="margin:18px 0"><a href="${link}" style="display:inline-block;padding:10px 20px;background:#0a4082;color:#fff;border-radius:6px;text-decoration:none;font-weight:500">Ver mi reporte →</a></p>
         <p style="margin-top:14px"><em>Gracias por confiar en el equipo de mantenimiento.</em></p>`
      ),
      tipo: "proyecto_completado", referencia: `proyecto:${proyecto.id}`,
    }).catch(() => {})
  );
}

// Dispatcher de proyectos por cambio de estado
export async function disparadorProyecto(
  ctx: APIContext,
  proyecto: ProyectoLite,
  estadoAnterior: string,
  estadoNuevo: string
) {
  if (estadoAnterior === estadoNuevo) return;
  const cambios: Promise<void>[] = [];
  if (estadoNuevo === "en_ejecucion") {
    cambios.push(notificarProyectoEnEjecucion(ctx, proyecto));
  } else if (estadoNuevo === "completado") {
    cambios.push(notificarProyectoCompletado(ctx, proyecto));
  }
  const wait = (ctx.locals as any)?.runtime?.ctx?.waitUntil;
  for (const p of cambios) {
    if (wait) wait(p); else await p.catch(() => {});
  }
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
    cambios.push(notificarOTCerradaJefe(ctx, orden));
  }
  // No bloquear la respuesta del API
  const wait = (ctx.locals as any)?.runtime?.ctx?.waitUntil;
  for (const p of cambios) {
    if (wait) wait(p); else await p.catch(() => {});
  }
}
