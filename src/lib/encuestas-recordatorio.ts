// Lógica de envío de recordatorios de encuestas de satisfacción.
// Se llama desde el cron diario. Envía un único recordatorio por encuesta
// no respondida pasadas N horas desde el envío original.
import type { APIContext } from "astro";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { getDb } from "./db";
import { encuestasSatisfaccion } from "./schema";
import { sendMail, emailLayout } from "./email";

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

    const stars = [1, 2, 3, 4, 5].map((n) => {
      const emoji = n === 1 ? "😞" : n === 2 ? "😕" : n === 3 ? "😐" : n === 4 ? "🙂" : "😀";
      return `<a href="${encuestaUrl}?c=${n}" style="display:inline-block;margin:0 4px;padding:10px 14px;background:#f1f5f9;color:#0f172a;text-decoration:none;border-radius:8px;border:1px solid #e2e8f0;font-size:18px">${emoji}<br/><span style="font-size:11px;color:#64748b">${n}</span></a>`;
    }).join("");

    try {
      await sendMail(ctx, {
        to: enc.destinatarioEmail,
        subject: `Recordatorio: ¿Cómo calificas el trabajo realizado?`,
        html: emailLayout(
          `Tu opinión nos importa`,
          `<p>${enc.destinatarioNombre ? `Hola <strong>${enc.destinatarioNombre}</strong>,` : "Hola,"}</p>
           <p>Hace unos días te enviamos una encuesta sobre el trabajo de mantenimiento realizado. Aún no nos has compartido tu opinión.</p>
           <p>Solo te tomará un par de segundos:</p>
           <div style="text-align:center;margin:18px 0">${stars}</div>
           <p style="text-align:center;font-size:12px;color:#64748b">o haz clic en <a href="${encuestaUrl}">este enlace</a> para dejar un comentario.</p>
           <p style="font-size:12px;color:#94a3b8;margin-top:18px">Este es nuestro último recordatorio. Si no respondes, no te volveremos a escribir sobre este caso.</p>`
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
