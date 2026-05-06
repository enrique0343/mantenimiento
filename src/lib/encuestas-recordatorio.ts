// Lógica de envío de recordatorios de encuestas de satisfacción.
// Se llama desde el cron diario. Envía un único recordatorio por encuesta
// no respondida pasadas N horas desde el envío original.
import type { APIContext } from "astro";
import { and, eq, isNull, lte } from "drizzle-orm";
import { getDb } from "./db";
import { encuestasSatisfaccion, ordenes, usuarios } from "./schema";
import { sendMail, emailLayout } from "./email";
import { fmtFechaLarga } from "./datetime";

// Horas tras las cuales se envía el recordatorio (si no hay respuesta)
const HORAS_RECORDATORIO = 48;

function appUrl(ctx: APIContext): string {
  const env = (ctx.locals as any)?.runtime?.env ?? {};
  return env.APP_URL || "https://mantenimiento-49c.pages.dev";
}

export async function enviarRecordatoriosEncuestas(ctx: APIContext): Promise<{ enviados: number }> {
  const db = getDb(ctx);
  const cutoff = new Date(Date.now() - HORAS_RECORDATORIO * 3600_000).toISOString();

  // Encuestas: enviadas hace >= 48h, sin respuesta, sin recordatorio enviado
  const pendientes = await db
    .select()
    .from(encuestasSatisfaccion)
    .where(and(
      isNull(encuestasSatisfaccion.respondidaEn),
      isNull(encuestasSatisfaccion.recordatorioEnviadoEn),
      lte(encuestasSatisfaccion.enviadaEn, cutoff),
    ));

  if (pendientes.length === 0) return { enviados: 0 };

  const baseUrl = appUrl(ctx);
  let enviados = 0;

  for (const enc of pendientes) {
    const encuestaUrl = `${baseUrl}/encuesta/${enc.token}`;

    // Cargar OT y técnico responsable
    const [ot] = enc.ordenId
      ? await db.select().from(ordenes).where(eq(ordenes.id, enc.ordenId)).limit(1)
      : [null];
    const [tec] = ot?.asignadoA
      ? await db.select({ nombre: usuarios.nombre }).from(usuarios).where(eq(usuarios.id, ot.asignadoA)).limit(1)
      : [null];

    const primerNombreSol = (enc.destinatarioNombre ?? "").split(" ")[0] || enc.destinatarioNombre || "";
    const tecCompleto = tec?.nombre ?? "el equipo de Mantenimiento";
    const tecCorto = tec?.nombre ? (tec.nombre.split(" ")[0] || tec.nombre) : "el técnico";
    const otId = ot?.id ?? "";
    const otTitulo = ot?.titulo ?? "tu solicitud";

    const stars = [1, 2, 3, 4, 5].map((n) => {
      const emoji = n === 1 ? "😞" : n === 2 ? "😕" : n === 3 ? "😬" : n === 4 ? "🙂" : "😎";
      return `<a href="${encuestaUrl}?c=${n}" style="display:inline-block;margin:0 4px;padding:10px 14px;background:#f1f5f9;color:#0f172a;text-decoration:none;border-radius:8px;border:1px solid #e2e8f0;font-size:18px">${emoji}<br/><span style="font-size:11px;color:#64748b">${n}</span></a>`;
    }).join("");

    try {
      await sendMail(ctx, {
        to: enc.destinatarioEmail,
        subject: `[OT #${otId}] Antes de cerrar definitivamente — necesitamos 10 segundos de ${primerNombreSol}`,
        html: emailLayout(
          `Tu voz cierra el ciclo`,
          `<p>Hola <strong>${primerNombreSol}</strong>,</p>
           <p>Hace 48 horas <strong>${tecCompleto}</strong> trabajó en tu orden <strong>#${otId} — ${otTitulo}</strong>. El trabajo quedó terminado. Lo que falta para cerrar el ciclo eres tú.</p>
           <p>Sabemos que estás ocupado. También sabemos que el silencio es la respuesta más fácil. Pero te pedimos un momento de honestidad institucional: ese silencio le cuesta algo a Avante.</p>
           <p>Cuando un solicitante no califica, perdemos tres cosas: no sabemos si ${tecCorto} hizo un buen trabajo o uno mediocre, no podemos detectar a tiempo un patrón si algo está fallando en el equipo o el área, y no tenemos cómo reconocer al técnico cuando lo merece ni cómo corregirlo cuando hace falta.</p>
           <p><strong>Tu clic, aunque sea uno solo, resuelve las tres cosas.</strong></p>
           <div style="text-align:center;margin:22px 0">${stars}</div>
           <p style="text-align:center;font-weight:600;color:#0a4082;margin:8px 0 18px 0">Diez segundos. Un solo toque.</p>
           <p>Si ${tecCorto} hizo bien su trabajo, díselo con un <strong>4 o un 5</strong>. Lo lee él, lo ve su jefatura, queda en su evaluación. Si algo no quedó bien, díselo con un <strong>1, 2 o 3</strong>. Llega a Mantenimiento esta misma semana, no en el reporte mensual.</p>
           <p><em>Lo que no podemos hacer es mejorar lo que no se nos cuenta.</em></p>
           <p style="font-size:13px;color:#475569;background:#fef9c3;padding:12px;border-left:3px solid #ca8a04;border-radius:4px;margin:18px 0">Este es el último correo que recibirás sobre la OT #${otId}. Si no respondes en las próximas <strong>24 horas</strong>, archivamos el caso sin calificación y no te volveremos a escribir. Pero la próxima vez que algo falle en tu área, vamos a llegar con un poco menos de información sobre cómo atenderte mejor.</p>
           <p style="margin:18px 0;text-align:center"><a href="${encuestaUrl}" style="display:inline-block;padding:12px 28px;background:#0a4082;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">Calificar ahora →</a></p>
           <p style="margin-top:18px"><em>Gracias por construir Avante con nosotros, hasta en los detalles pequeños.</em></p>`
        ),
        tipo: "encuesta_recordatorio",
        referencia: `encuesta:${enc.id}`,
      });

      await db.update(encuestasSatisfaccion)
        .set({ recordatorioEnviadoEn: new Date().toISOString() })
        .where(eq(encuestasSatisfaccion.id, enc.id));

      enviados++;
    } catch (e) {
      console.error("recordatorio encuesta", enc.id, e);
    }
  }

  return { enviados };
}
