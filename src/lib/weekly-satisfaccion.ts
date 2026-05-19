// Resumen semanal de satisfacción para admins/jefes.
// Se ejecuta los lunes 6 AM SV.

import type { APIContext } from "astro";
import { and, eq, gte, isNotNull, inArray, desc } from "drizzle-orm";
import { getDb } from "./db";
import { encuestasSatisfaccion, ordenes, usuarios, emailLog } from "./schema";
import { sendMail, emailLayout } from "./email";

function escapeHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function fechaSV(): { hoy: string; haceUnaSemana: Date } {
  const ahora = new Date();
  const hace7 = new Date(ahora.getTime() - 7 * 86400_000);
  return { hoy: ahora.toISOString().slice(0, 10), haceUnaSemana: hace7 };
}

export async function enviarResumenSemanalSatisfaccion(
  ctx: APIContext,
  opts: { force?: boolean } = {}
): Promise<{ enviados: number; razon?: string }> {
  const db = getDb(ctx);
  const { hoy, haceUnaSemana } = fechaSV();

  // Anti-duplicado: si ya se envió este lunes, salir
  if (!opts.force) {
    const tipo = "resumen_semanal_satisfaccion";
    const yaEnviado = await db.select({ id: emailLog.id })
      .from(emailLog)
      .where(and(eq(emailLog.tipo, tipo), gte(emailLog.createdAt, hoy)))
      .limit(1);
    if (yaEnviado.length > 0) return { enviados: 0, razon: "Ya enviado hoy" };
  }

  // Encuestas respondidas en los últimos 7 días
  const responsidas = await db
    .select({ e: encuestasSatisfaccion, o: ordenes, tec: usuarios })
    .from(encuestasSatisfaccion)
    .leftJoin(ordenes, eq(ordenes.id, encuestasSatisfaccion.ordenId))
    .leftJoin(usuarios, eq(usuarios.id, ordenes.asignadoA))
    .where(and(
      isNotNull(encuestasSatisfaccion.respondidaEn),
      gte(encuestasSatisfaccion.respondidaEn, haceUnaSemana.toISOString()),
    ))
    .orderBy(desc(encuestasSatisfaccion.respondidaEn));

  if (responsidas.length === 0) return { enviados: 0, razon: "Sin respuestas esta semana" };

  // Stats globales
  const n = responsidas.length;
  const promedio = responsidas.reduce((s, r) => s + (r.e.calificacion ?? 0), 0) / n;
  const conteo = [1, 2, 3, 4, 5].map((nv) => responsidas.filter((r) => r.e.calificacion === nv).length);
  const pct5 = Math.round((conteo[4] / n) * 100);
  const pctBajas = Math.round(((conteo[0] + conteo[1] + conteo[2]) / n) * 100);

  // Comentarios bajos (1-3) sin atender
  const bajasSinLeer = responsidas.filter((r) =>
    (r.e.calificacion ?? 5) <= 3 && (r.e.comentario ?? "").trim().length > 0 && !r.e.leidaEn
  );

  // Ranking de técnicos
  const ranking = new Map<number, { id: number; nombre: string; n: number; suma: number }>();
  for (const r of responsidas) {
    if (!r.tec) continue;
    const cur = ranking.get(r.tec.id) ?? { id: r.tec.id, nombre: r.tec.nombre, n: 0, suma: 0 };
    cur.n += 1; cur.suma += r.e.calificacion ?? 0;
    ranking.set(r.tec.id, cur);
  }
  const rankingList = Array.from(ranking.values())
    .map((r) => ({ ...r, promedio: r.suma / r.n }))
    .sort((a, b) => b.promedio - a.promedio || b.n - a.n);

  // Destinatarios: admins + jefes
  const admins = await db.select({ email: usuarios.email, nombre: usuarios.nombre })
    .from(usuarios)
    .where(and(eq(usuarios.activo, true), inArray(usuarios.rol, ["admin", "jefe"])));
  if (admins.length === 0) return { enviados: 0, razon: "Sin destinatarios" };

  const env = (ctx.locals as any)?.runtime?.env ?? {};
  const baseUrl = env.APP_URL || "https://mantenimiento-49c.pages.dev";

  // HTML
  const rankingHtml = rankingList.length === 0 ? "" : `
    <h3 style="margin:24px 0 10px 0;color:#0a4082;font-size:15px">🏆 Ranking de técnicos</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#f8fafc">
        <th style="text-align:left;padding:8px;border-bottom:1px solid #e2e8f0">Técnico</th>
        <th style="text-align:center;padding:8px;border-bottom:1px solid #e2e8f0">Encuestas</th>
        <th style="text-align:center;padding:8px;border-bottom:1px solid #e2e8f0">Promedio</th>
      </tr></thead>
      <tbody>
        ${rankingList.map((r) => `
          <tr>
            <td style="padding:8px;border-bottom:1px solid #f1f5f9">${escapeHtml(r.nombre)}</td>
            <td style="padding:8px;border-bottom:1px solid #f1f5f9;text-align:center">${r.n}</td>
            <td style="padding:8px;border-bottom:1px solid #f1f5f9;text-align:center;font-weight:bold;color:${r.promedio >= 4.5 ? "#16a34a" : r.promedio >= 3.5 ? "#d97706" : "#dc2626"}">${r.promedio.toFixed(2)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>`;

  const bajasHtml = bajasSinLeer.length === 0
    ? `<p style="color:#16a34a;margin:18px 0">✅ Sin comentarios bajos pendientes de atender esta semana.</p>`
    : `
    <h3 style="margin:24px 0 10px 0;color:#dc2626;font-size:15px">⚠️ ${bajasSinLeer.length} comentario(s) bajo(s) sin atender</h3>
    ${bajasSinLeer.slice(0, 8).map((r) => `
      <div style="border-left:3px solid #dc2626;background:#fef2f2;padding:10px 12px;margin:8px 0;border-radius:4px">
        <div style="font-size:12px;color:#475569">
          <strong>${r.e.calificacion}⭐</strong> · ${escapeHtml(r.e.destinatarioNombre)}
          ${r.o ? ` · OT #${r.o.id} ${escapeHtml(r.o.titulo)}` : ""}
          ${r.tec ? ` · Técnico: ${escapeHtml(r.tec.nombre)}` : ""}
        </div>
        <p style="margin:6px 0 0 0;white-space:pre-wrap;font-size:13px;color:#1e293b">${escapeHtml(r.e.comentario)}</p>
      </div>
    `).join("")}
    ${bajasSinLeer.length > 8 ? `<p style="font-size:12px;color:#64748b">…y ${bajasSinLeer.length - 8} más en el sistema.</p>` : ""}`;

  const html = emailLayout(
    "Resumen semanal de satisfacción",
    `<p>Este es el resumen de las encuestas respondidas en los últimos 7 días.</p>
     <div style="display:flex;gap:12px;margin:18px 0;flex-wrap:wrap">
       <div style="flex:1;min-width:140px;background:#f8fafc;padding:14px;border-radius:6px">
         <div style="font-size:11px;color:#64748b;text-transform:uppercase">Respondidas</div>
         <div style="font-size:24px;font-weight:bold;color:#0a4082">${n}</div>
       </div>
       <div style="flex:1;min-width:140px;background:#f0fdf4;padding:14px;border-radius:6px">
         <div style="font-size:11px;color:#64748b;text-transform:uppercase">Promedio</div>
         <div style="font-size:24px;font-weight:bold;color:#16a34a">${promedio.toFixed(2)}/5</div>
       </div>
       <div style="flex:1;min-width:140px;background:#fef2f2;padding:14px;border-radius:6px">
         <div style="font-size:11px;color:#64748b;text-transform:uppercase">% Bajas (1-3⭐)</div>
         <div style="font-size:24px;font-weight:bold;color:#dc2626">${pctBajas}%</div>
       </div>
       <div style="flex:1;min-width:140px;background:#ecfdf5;padding:14px;border-radius:6px">
         <div style="font-size:11px;color:#64748b;text-transform:uppercase">% Excelente</div>
         <div style="font-size:24px;font-weight:bold;color:#059669">${pct5}%</div>
       </div>
     </div>
     ${bajasHtml}
     ${rankingHtml}
     <p style="margin:24px 0 0 0"><a href="${baseUrl}/satisfaccion" style="display:inline-block;padding:10px 20px;background:#0a4082;color:#fff;border-radius:6px;text-decoration:none;font-weight:500">Abrir tablero de satisfacción →</a></p>`
  );

  let enviados = 0;
  for (const a of admins) {
    if (!a.email) continue;
    try {
      await sendMail(ctx, {
        to: a.email,
        subject: `📊 Resumen semanal de satisfacción — ${n} respuestas`,
        html,
        tipo: "resumen_semanal_satisfaccion",
        referencia: hoy,
      });
      enviados++;
    } catch (e) { console.error("weekly satisfaccion:", e); }
  }

  return { enviados };
}
