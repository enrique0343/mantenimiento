// Resumen diario de operaciones de Mantenimiento.
// Se envía cada día a todos los admins. La protección anti-duplicado usa
// email_log: si ya hay un envío "digest_diario" con referencia de hoy (en
// hora El Salvador), no se vuelve a mandar. Esto permite que el cron corra
// a cualquier hora del día sin riesgo de duplicar y sin depender de UTC.

import type { APIContext } from "astro";
import { and, eq, lte, gte, isNotNull, isNull, inArray, desc, sql, like } from "drizzle-orm";
import { getDb } from "./db";
import {
  ordenes, tickets, usuarios, activos, ubicaciones, sucursales,
  ordenRepuestos, items as itemsTable, planesMantenimiento, actividades,
  solicitudesCompra, emailLog,
} from "./schema";
import { sendMail, emailLayout } from "./email";
import { fmtFechaLarga, fmtFechaSimple } from "./datetime";

function appUrl(ctx: APIContext): string {
  const env = (ctx.locals as any)?.runtime?.env ?? {};
  return env.APP_URL || "https://mantenimiento-49c.pages.dev";
}

// Helpers de fecha en zona local El Salvador (UTC-6)
function ayerEnSV(): { inicio: string; fin: string } {
  const ahora = new Date();
  // Hora UTC del inicio de "ayer" en El Salvador = ayer 00:00 SV = ayer 06:00 UTC
  const ayer = new Date(ahora.getTime() - 24 * 3600_000);
  ayer.setUTCHours(6, 0, 0, 0);
  const finAyer = new Date(ayer.getTime() + 24 * 3600_000);
  return { inicio: ayer.toISOString(), fin: finAyer.toISOString() };
}

function inicioMesEnSV(): string {
  const ahora = new Date();
  // Primer día del mes 00:00 SV = primer día 06:00 UTC
  const primer = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1, 6, 0, 0));
  return primer.toISOString();
}

function hoyDateSV(): string {
  const ahora = new Date();
  const sv = new Date(ahora.getTime() - 6 * 3600_000);
  return sv.toISOString().slice(0, 10);
}

const ESTADO_OT_LABEL: Record<string, string> = {
  abierta: "Abierta",
  en_proceso: "En proceso",
  en_espera: "En espera",
  completada: "Completada",
  verificada: "Verificada",
  cerrada: "Cerrada",
  cancelada: "Cancelada",
};

const ESTADO_TICKET_LABEL: Record<string, string> = {
  nuevo: "Nuevo",
  asignado: "Asignado",
  en_proceso: "En proceso",
  resuelto: "Resuelto",
  cerrado: "Cerrado",
  descartado: "Descartado",
};

export async function enviarDigestDiario(
  ctx: APIContext,
  opts: { force?: boolean } = {}
): Promise<{ enviados: number; razon?: string }> {
  const db = getDb(ctx);
  const baseUrl = appUrl(ctx);
  const hoy = hoyDateSV();

  // Anti-duplicado: si ya hay un envío "digest_diario" hoy (SV), no repetir.
  // El parámetro force=true salta esta verificación (para el botón manual).
  if (!opts.force) {
    const yaEnviado = await db
      .select({ id: emailLog.id })
      .from(emailLog)
      .where(and(
        eq(emailLog.tipo, "digest_diario"),
        eq(emailLog.referencia, `digest:${hoy}`),
        eq(emailLog.estado, "enviado"),
      ))
      .limit(1);
    if (yaEnviado.length > 0) {
      return { enviados: 0, razon: `Ya se envió el digest de hoy (${hoy}). Usa force=true para reenviar.` };
    }
  }

  // 1) Destinatarios: solo admins activos con email
  const admins = await db.select().from(usuarios).where(and(eq(usuarios.rol, "admin"), eq(usuarios.activo, true)));
  const destinatarios = admins.filter((a) => !!a.email);
  if (destinatarios.length === 0) return { enviados: 0, razon: "Sin admins con email configurado" };

  // ── Rangos de tiempo ──────────────────────────────────────────────────────
  const { inicio: ayerIni, fin: ayerFin } = ayerEnSV();
  const inicioMes = inicioMesEnSV();
  const en3 = new Date(Date.now() + 3 * 24 * 3600_000).toISOString().slice(0, 10);
  const ahoraIso = new Date().toISOString();

  // ── Datos para el resumen ejecutivo ───────────────────────────────────────
  const otsCerradasAyerRaw = await db
    .select({ o: ordenes, a: activos, u: usuarios })
    .from(ordenes)
    .leftJoin(activos, eq(activos.id, ordenes.activoId))
    .leftJoin(usuarios, eq(usuarios.id, ordenes.asignadoA))
    .where(and(eq(ordenes.estado, "cerrada"), gte(ordenes.cerradoEn, ayerIni), lte(ordenes.cerradoEn, ayerFin)));

  const otsEnProceso = await db
    .select({ o: ordenes, a: activos, u: usuarios })
    .from(ordenes)
    .leftJoin(activos, eq(activos.id, ordenes.activoId))
    .leftJoin(usuarios, eq(usuarios.id, ordenes.asignadoA))
    .where(inArray(ordenes.estado, ["en_proceso", "en_espera"]))
    .orderBy(desc(ordenes.iniciadaEn));

  const otsAtrasadasRaw = await db
    .select({ o: ordenes, a: activos, u: usuarios })
    .from(ordenes)
    .leftJoin(activos, eq(activos.id, ordenes.activoId))
    .leftJoin(usuarios, eq(usuarios.id, ordenes.asignadoA))
    .where(and(
      inArray(ordenes.estado, ["abierta", "en_proceso", "en_espera"]),
      isNotNull(ordenes.vencimiento),
      lte(ordenes.vencimiento, ahoraIso),
    ));

  const otsAbiertasSinAsignarRaw = await db
    .select({ o: ordenes, a: activos })
    .from(ordenes)
    .leftJoin(activos, eq(activos.id, ordenes.activoId))
    .where(and(eq(ordenes.estado, "abierta"), isNull(ordenes.asignadoA)));

  // Tickets
  const ticketsResueltosAyer = await db
    .select({ t: tickets, u: usuarios })
    .from(tickets)
    .leftJoin(usuarios, eq(usuarios.id, tickets.asignadoA))
    .where(and(inArray(tickets.estado, ["resuelto", "cerrado"]), gte(tickets.resueltoEn, ayerIni), lte(tickets.resueltoEn, ayerFin)));

  const ticketsActivosRaw = await db
    .select({ t: tickets, u: usuarios, s: sucursales })
    .from(tickets)
    .leftJoin(usuarios, eq(usuarios.id, tickets.asignadoA))
    .leftJoin(sucursales, eq(sucursales.id, tickets.sucursalId))
    .where(inArray(tickets.estado, ["nuevo", "asignado", "en_proceso"]));

  const ticketsSinAsignar = ticketsActivosRaw.filter((r) => !r.t.asignadoA);
  const ticketsSlaVencido = ticketsActivosRaw.filter((r) =>
    r.t.vencimientoSla && r.t.vencimientoSla <= ahoraIso
  );

  // ── KPIs del mes ──────────────────────────────────────────────────────────
  const otsDelMes = await db
    .select({ o: ordenes, a: activos, u: usuarios })
    .from(ordenes)
    .leftJoin(activos, eq(activos.id, ordenes.activoId))
    .leftJoin(usuarios, eq(usuarios.id, ordenes.asignadoA))
    .where(gte(ordenes.createdAt, inicioMes));

  const cerradasMes = otsDelMes.filter((r) => r.o.estado === "cerrada");
  const cerradasMesATiempo = cerradasMes.filter((r) =>
    r.o.cerradoEn && r.o.vencimiento && r.o.cerradoEn <= r.o.vencimiento
  );
  const pctATiempo = cerradasMes.length > 0
    ? Math.round((cerradasMesATiempo.length / cerradasMes.length) * 100)
    : null;

  // MTTR: tiempo promedio de resolución (cerradoEn - createdAt) en horas
  const ttrs = cerradasMes
    .filter((r) => r.o.cerradoEn && r.o.createdAt)
    .map((r) => (new Date(r.o.cerradoEn!).getTime() - new Date(r.o.createdAt).getTime()) / 3600_000);
  const mttr = ttrs.length > 0 ? (ttrs.reduce((a, b) => a + b, 0) / ttrs.length) : null;

  // Backlog growth: creadas - cerradas en el mes
  const creadasMes = otsDelMes.length;
  const backlog = creadasMes - cerradasMes.length;

  // Top técnicos del mes
  const tecMap = new Map<number, { nombre: string; cerradas: number; horas: number; aTiempo: number }>();
  for (const r of cerradasMes) {
    if (!r.o.asignadoA || !r.u) continue;
    const cur = tecMap.get(r.o.asignadoA) ?? { nombre: r.u.nombre, cerradas: 0, horas: 0, aTiempo: 0 };
    cur.cerradas++;
    cur.horas += Number(r.o.horasTrabajadas ?? 0);
    if (r.o.cerradoEn && r.o.vencimiento && r.o.cerradoEn <= r.o.vencimiento) cur.aTiempo++;
    tecMap.set(r.o.asignadoA, cur);
  }
  const topTecnicos = Array.from(tecMap.values())
    .sort((a, b) => b.cerradas - a.cerradas)
    .slice(0, 5);

  // Equipos con más OTs en el mes
  const equipoMap = new Map<number, { codigo: string; nombre: string; cantidad: number }>();
  for (const r of otsDelMes) {
    if (!r.a) continue;
    const cur = equipoMap.get(r.a.id) ?? { codigo: r.a.codigo, nombre: r.a.nombre, cantidad: 0 };
    cur.cantidad++;
    equipoMap.set(r.a.id, cur);
  }
  const topEquipos = Array.from(equipoMap.values())
    .sort((a, b) => b.cantidad - a.cantidad)
    .slice(0, 5);

  // ── Costos del mes ────────────────────────────────────────────────────────
  // Mano de obra = horas trabajadas * tarifa del técnico
  // Repuestos = sum(precioUnitario * cantidad) en orden_repuestos
  let costoManoObraMes = 0;
  for (const r of cerradasMes) {
    const tarifa = Number(r.u?.tarifaHora ?? 0);
    const horas = Number(r.o.horasTrabajadas ?? 0);
    costoManoObraMes += tarifa * horas;
  }
  const repuestosMesRows = cerradasMes.length > 0
    ? await db
        .select({ rep: ordenRepuestos })
        .from(ordenRepuestos)
        .where(inArray(ordenRepuestos.ordenId, cerradasMes.map((r) => r.o.id)))
    : [];
  const costoRepuestosMes = repuestosMesRows.reduce(
    (s, r) => s + (r.rep.precioUnitario ?? 0) * r.rep.cantidad, 0
  );
  const costoTotalMes = costoManoObraMes + costoRepuestosMes;

  // ── Próximos preventivos (3 días) ─────────────────────────────────────────
  const proximosPlanes = await db
    .select({ p: planesMantenimiento, a: activos })
    .from(planesMantenimiento)
    .leftJoin(activos, eq(activos.id, planesMantenimiento.activoId))
    .where(and(eq(planesMantenimiento.activo, true), lte(planesMantenimiento.proximaFecha, en3)))
    .orderBy(planesMantenimiento.proximaFecha);

  const proximasActividades = await db
    .select({ a: actividades })
    .from(actividades)
    .where(and(eq(actividades.activo, true), lte(actividades.proximaFecha, en3)))
    .orderBy(actividades.proximaFecha);

  // ── Compras pendientes ────────────────────────────────────────────────────
  const comprasPendientes = await db
    .select()
    .from(solicitudesCompra)
    .where(eq(solicitudesCompra.estado, "enviada"))
    .orderBy(desc(solicitudesCompra.id));

  // ─────────────────────────────────────────────────────────────────────────
  // Construir HTML
  // ─────────────────────────────────────────────────────────────────────────
  const fechaHoy = new Date().toLocaleDateString("es", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
    timeZone: "America/El_Salvador",
  });
  const ayerLabel = new Date(ayerIni).toLocaleDateString("es", {
    weekday: "long", day: "numeric", month: "long",
    timeZone: "America/El_Salvador",
  });

  const numCard = (n: number, label: string, color: string) =>
    `<td style="padding:14px;text-align:center;background:${color.bg};border-radius:8px;width:20%">
       <div style="font-size:28px;font-weight:700;color:${color.text}">${n}</div>
       <div style="font-size:11px;color:${color.text};margin-top:4px;line-height:1.3">${label}</div>
     </td>`;

  let html = `<p>Buenos días,</p>
  <p>Resumen del estado de Mantenimiento al inicio de <strong>${fechaHoy}</strong>.</p>

  <h3 style="margin:22px 0 10px 0;color:#0a4082;font-size:15px;text-transform:uppercase;letter-spacing:0.5px">📊 Resumen ejecutivo</h3>
  <table style="width:100%;border-collapse:separate;border-spacing:6px">
    <tr>
      ${numCard(otsCerradasAyerRaw.length, "OTs cerradas ayer", { bg: "#d1fae5", text: "#065f46" })}
      ${numCard(otsEnProceso.length, "OTs en curso", { bg: "#dbeafe", text: "#1e40af" })}
      ${numCard(otsAtrasadasRaw.length, "OTs atrasadas", { bg: "#fee2e2", text: "#991b1b" })}
      ${numCard(ticketsSinAsignar.length, "Tickets sin asignar", { bg: "#fef3c7", text: "#92400e" })}
      ${numCard(ticketsSlaVencido.length, "SLA vencido", { bg: "#fee2e2", text: "#991b1b" })}
    </tr>
  </table>`;

  // ── Avances de ayer ───────────────────────────────────────────────────────
  html += `<h3 style="margin:24px 0 10px 0;color:#0a4082;font-size:15px;text-transform:uppercase;letter-spacing:0.5px">✅ Avances de ${ayerLabel}</h3>`;
  if (otsCerradasAyerRaw.length === 0 && ticketsResueltosAyer.length === 0) {
    html += `<p style="color:#64748b">Sin cierres registrados ayer.</p>`;
  } else {
    if (otsCerradasAyerRaw.length > 0) {
      html += `<p style="margin:0 0 6px 0"><strong>OTs cerradas (${otsCerradasAyerRaw.length}):</strong></p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px">
        <thead><tr style="background:#f1f5f9;color:#475569;font-size:11px;text-align:left">
          <th style="padding:6px 8px">#</th><th style="padding:6px 8px">Título</th>
          <th style="padding:6px 8px">Equipo</th><th style="padding:6px 8px">Técnico</th>
          <th style="padding:6px 8px;text-align:right">Horas</th>
        </tr></thead><tbody>`;
      for (const r of otsCerradasAyerRaw) {
        html += `<tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:6px 8px;color:#94a3b8">#${r.o.id}</td>
          <td style="padding:6px 8px"><a href="${baseUrl}/ordenes/${r.o.id}" style="color:#0a4082;text-decoration:none">${r.o.titulo}</a></td>
          <td style="padding:6px 8px;color:#64748b">${r.a ? r.a.codigo : "—"}</td>
          <td style="padding:6px 8px">${r.u?.nombre ?? "—"}</td>
          <td style="padding:6px 8px;text-align:right;font-family:monospace">${r.o.horasTrabajadas != null ? Number(r.o.horasTrabajadas).toFixed(1) : "—"}</td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }
    if (ticketsResueltosAyer.length > 0) {
      html += `<p style="margin:8px 0 6px 0"><strong>Tickets resueltos (${ticketsResueltosAyer.length}):</strong></p>
      <ul style="margin:0 0 14px 0;padding-left:20px;font-size:13px;line-height:1.6">`;
      for (const r of ticketsResueltosAyer) {
        html += `<li><a href="${baseUrl}/tickets/${r.t.id}" style="color:#0a4082;text-decoration:none">#${r.t.id} — ${r.t.asunto}</a> · ${r.u?.nombre ?? "—"}</li>`;
      }
      html += `</ul>`;
    }
  }

  // ── En curso ──────────────────────────────────────────────────────────────
  html += `<h3 style="margin:24px 0 10px 0;color:#0a4082;font-size:15px;text-transform:uppercase;letter-spacing:0.5px">🟢 En curso ahora</h3>`;
  if (otsEnProceso.length === 0 && ticketsActivosRaw.filter((t) => t.t.asignadoA).length === 0) {
    html += `<p style="color:#64748b">Sin trabajos activos en este momento.</p>`;
  } else {
    if (otsEnProceso.length > 0) {
      html += `<p style="margin:0 0 6px 0"><strong>OTs (${otsEnProceso.length}):</strong></p>
      <ul style="margin:0 0 14px 0;padding-left:20px;font-size:13px;line-height:1.6">`;
      for (const r of otsEnProceso.slice(0, 15)) {
        const estado = ESTADO_OT_LABEL[r.o.estado] ?? r.o.estado;
        const desde = r.o.iniciadaEn ? `desde ${fmtFechaSimple(r.o.iniciadaEn)}` : "sin iniciar";
        html += `<li><a href="${baseUrl}/ordenes/${r.o.id}" style="color:#0a4082;text-decoration:none">#${r.o.id} ${r.o.titulo}</a> · ${r.u?.nombre ?? "Sin asignar"} · <em>${estado}</em> · ${desde}</li>`;
      }
      if (otsEnProceso.length > 15) html += `<li style="color:#94a3b8">... y ${otsEnProceso.length - 15} más</li>`;
      html += `</ul>`;
    }
    const ticketsAsignados = ticketsActivosRaw.filter((t) => t.t.asignadoA);
    if (ticketsAsignados.length > 0) {
      html += `<p style="margin:8px 0 6px 0"><strong>Tickets asignados (${ticketsAsignados.length}):</strong></p>
      <ul style="margin:0 0 14px 0;padding-left:20px;font-size:13px;line-height:1.6">`;
      for (const r of ticketsAsignados.slice(0, 10)) {
        const estado = ESTADO_TICKET_LABEL[r.t.estado] ?? r.t.estado;
        html += `<li><a href="${baseUrl}/tickets/${r.t.id}" style="color:#0a4082;text-decoration:none">#${r.t.id} ${r.t.asunto}</a> · ${r.u?.nombre} · <em>${estado}</em></li>`;
      }
      if (ticketsAsignados.length > 10) html += `<li style="color:#94a3b8">... y ${ticketsAsignados.length - 10} más</li>`;
      html += `</ul>`;
    }
  }

  // ── Atrasados / críticos ──────────────────────────────────────────────────
  if (otsAtrasadasRaw.length > 0 || otsAbiertasSinAsignarRaw.length > 0 || ticketsSinAsignar.length > 0 || ticketsSlaVencido.length > 0) {
    html += `<h3 style="margin:24px 0 10px 0;color:#991b1b;font-size:15px;text-transform:uppercase;letter-spacing:0.5px">🔴 Requiere atención</h3>`;
    if (otsAtrasadasRaw.length > 0) {
      html += `<p style="margin:0 0 6px 0"><strong>OTs vencidas y aún abiertas (${otsAtrasadasRaw.length}):</strong></p>
      <ul style="margin:0 0 14px 0;padding-left:20px;font-size:13px;line-height:1.6">`;
      for (const r of otsAtrasadasRaw.slice(0, 10)) {
        html += `<li><a href="${baseUrl}/ordenes/${r.o.id}" style="color:#991b1b;text-decoration:none">#${r.o.id} ${r.o.titulo}</a> · vence ${fmtFechaSimple(r.o.vencimiento!)} · ${r.u?.nombre ?? "Sin asignar"}</li>`;
      }
      if (otsAtrasadasRaw.length > 10) html += `<li style="color:#94a3b8">... y ${otsAtrasadasRaw.length - 10} más</li>`;
      html += `</ul>`;
    }
    if (otsAbiertasSinAsignarRaw.length > 0) {
      html += `<p style="margin:0 0 6px 0"><strong>OTs creadas sin técnico (${otsAbiertasSinAsignarRaw.length}):</strong></p>
      <ul style="margin:0 0 14px 0;padding-left:20px;font-size:13px;line-height:1.6">`;
      for (const r of otsAbiertasSinAsignarRaw.slice(0, 10)) {
        html += `<li><a href="${baseUrl}/ordenes/${r.o.id}" style="color:#991b1b;text-decoration:none">#${r.o.id} ${r.o.titulo}</a> · ${r.a ? r.a.codigo : "Sin equipo"}</li>`;
      }
      html += `</ul>`;
    }
    if (ticketsSinAsignar.length > 0) {
      html += `<p style="margin:0 0 6px 0"><strong>Tickets sin asignar (${ticketsSinAsignar.length}):</strong></p>
      <ul style="margin:0 0 14px 0;padding-left:20px;font-size:13px;line-height:1.6">`;
      for (const r of ticketsSinAsignar.slice(0, 10)) {
        html += `<li><a href="${baseUrl}/tickets/${r.t.id}" style="color:#991b1b;text-decoration:none">#${r.t.id} ${r.t.asunto}</a> · ${r.s?.nombre ?? "—"}</li>`;
      }
      html += `</ul>`;
    }
    if (ticketsSlaVencido.length > 0) {
      html += `<p style="margin:0 0 6px 0"><strong>Tickets con SLA vencido (${ticketsSlaVencido.length}):</strong></p>
      <ul style="margin:0 0 14px 0;padding-left:20px;font-size:13px;line-height:1.6">`;
      for (const r of ticketsSlaVencido.slice(0, 10)) {
        html += `<li><a href="${baseUrl}/tickets/${r.t.id}" style="color:#991b1b;text-decoration:none">#${r.t.id} ${r.t.asunto}</a> · venció ${fmtFechaSimple(r.t.vencimientoSla!)}</li>`;
      }
      html += `</ul>`;
    }
  }

  // ── KPIs del mes ──────────────────────────────────────────────────────────
  html += `<h3 style="margin:24px 0 10px 0;color:#0a4082;font-size:15px;text-transform:uppercase;letter-spacing:0.5px">📈 KPIs del mes en curso</h3>
  <table style="width:100%;border-collapse:separate;border-spacing:6px;margin-bottom:14px">
    <tr>
      <td style="padding:10px;background:#f1f5f9;border-radius:6px;text-align:center">
        <div style="font-size:11px;color:#64748b">% A tiempo</div>
        <div style="font-size:20px;font-weight:600;color:${pctATiempo == null ? "#94a3b8" : pctATiempo >= 80 ? "#065f46" : pctATiempo >= 50 ? "#92400e" : "#991b1b"}">${pctATiempo == null ? "—" : pctATiempo + "%"}</div>
      </td>
      <td style="padding:10px;background:#f1f5f9;border-radius:6px;text-align:center">
        <div style="font-size:11px;color:#64748b">MTTR</div>
        <div style="font-size:20px;font-weight:600;color:#0a4082">${mttr == null ? "—" : mttr.toFixed(1) + " h"}</div>
      </td>
      <td style="padding:10px;background:#f1f5f9;border-radius:6px;text-align:center">
        <div style="font-size:11px;color:#64748b">Cerradas</div>
        <div style="font-size:20px;font-weight:600;color:#065f46">${cerradasMes.length}</div>
      </td>
      <td style="padding:10px;background:#f1f5f9;border-radius:6px;text-align:center">
        <div style="font-size:11px;color:#64748b">Creadas</div>
        <div style="font-size:20px;font-weight:600;color:#0a4082">${creadasMes}</div>
      </td>
      <td style="padding:10px;background:${backlog > 0 ? "#fee2e2" : "#d1fae5"};border-radius:6px;text-align:center">
        <div style="font-size:11px;color:#64748b">Backlog</div>
        <div style="font-size:20px;font-weight:600;color:${backlog > 0 ? "#991b1b" : "#065f46"}">${backlog > 0 ? "+" : ""}${backlog}</div>
      </td>
    </tr>
  </table>

  <p style="margin:16px 0 6px 0;font-size:13px"><strong>💰 Costo del mes:</strong></p>
  <ul style="margin:0 0 14px 0;padding-left:20px;font-size:13px;line-height:1.7">
    <li>Mano de obra: <strong>$${costoManoObraMes.toFixed(2)}</strong></li>
    <li>Repuestos: <strong>$${costoRepuestosMes.toFixed(2)}</strong></li>
    <li><strong>Total:</strong> <strong style="color:#065f46">$${costoTotalMes.toFixed(2)}</strong></li>
  </ul>`;

  if (topTecnicos.length > 0) {
    html += `<p style="margin:16px 0 6px 0;font-size:13px"><strong>🏆 Top técnicos del mes:</strong></p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px">
      <thead><tr style="background:#f1f5f9;color:#475569;font-size:11px;text-align:left">
        <th style="padding:6px 8px">Técnico</th>
        <th style="padding:6px 8px;text-align:right">Cerradas</th>
        <th style="padding:6px 8px;text-align:right">Horas</th>
        <th style="padding:6px 8px;text-align:right">% A tiempo</th>
      </tr></thead><tbody>`;
    for (const t of topTecnicos) {
      const pct = t.cerradas > 0 ? Math.round((t.aTiempo / t.cerradas) * 100) : 0;
      html += `<tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:6px 8px">${t.nombre}</td>
        <td style="padding:6px 8px;text-align:right;font-family:monospace">${t.cerradas}</td>
        <td style="padding:6px 8px;text-align:right;font-family:monospace">${t.horas.toFixed(1)}</td>
        <td style="padding:6px 8px;text-align:right;color:${pct >= 80 ? "#065f46" : pct >= 50 ? "#92400e" : "#991b1b"}">${pct}%</td>
      </tr>`;
    }
    html += `</tbody></table>`;
  }

  if (topEquipos.length > 0) {
    html += `<p style="margin:16px 0 6px 0;font-size:13px"><strong>🛠 Equipos con más OTs del mes:</strong></p>
    <ul style="margin:0 0 14px 0;padding-left:20px;font-size:13px;line-height:1.6">`;
    for (const e of topEquipos) {
      html += `<li><strong>${e.codigo}</strong> · ${e.nombre} → <strong>${e.cantidad}</strong> OTs</li>`;
    }
    html += `</ul>`;
  }

  // ── Próximos vencimientos ─────────────────────────────────────────────────
  if (proximosPlanes.length > 0 || proximasActividades.length > 0) {
    html += `<h3 style="margin:24px 0 10px 0;color:#0a4082;font-size:15px;text-transform:uppercase;letter-spacing:0.5px">📅 Próximos 3 días</h3>
    <ul style="margin:0 0 14px 0;padding-left:20px;font-size:13px;line-height:1.6">`;
    for (const r of proximosPlanes) {
      const venc = r.p.proximaFecha <= hoy ? `<strong style="color:#991b1b">vencido</strong>` : fmtFechaSimple(r.p.proximaFecha);
      html += `<li>🛠 <strong>${r.p.titulo}</strong>${r.a ? ` (${r.a.codigo})` : ""} — ${venc}</li>`;
    }
    for (const r of proximasActividades) {
      const venc = r.a.proximaFecha <= hoy ? `<strong style="color:#991b1b">vencido</strong>` : fmtFechaSimple(r.a.proximaFecha);
      html += `<li>📌 <strong>${r.a.titulo}</strong> (${r.a.codigo}) — ${venc}</li>`;
    }
    html += `</ul>`;
  }

  // ── Compras pendientes ────────────────────────────────────────────────────
  if (comprasPendientes.length > 0) {
    html += `<h3 style="margin:24px 0 10px 0;color:#0a4082;font-size:15px;text-transform:uppercase;letter-spacing:0.5px">🛒 Solicitudes de compra abiertas (${comprasPendientes.length})</h3>
    <ul style="margin:0 0 14px 0;padding-left:20px;font-size:13px;line-height:1.6">`;
    for (const sc of comprasPendientes.slice(0, 10)) {
      const dias = Math.floor((Date.now() - new Date(sc.createdAt).getTime()) / (24 * 3600_000));
      html += `<li><a href="${baseUrl}/solicitudes-compra/${sc.id}" style="color:#0a4082;text-decoration:none">${sc.codigo} — ${sc.titulo}</a> · ${dias === 0 ? "hoy" : `hace ${dias} día${dias === 1 ? "" : "s"}`}</li>`;
    }
    if (comprasPendientes.length > 10) html += `<li style="color:#94a3b8">... y ${comprasPendientes.length - 10} más</li>`;
    html += `</ul>`;
  }

  html += `<p style="margin-top:24px;font-size:12px;color:#64748b">Este resumen se envía cada mañana a las 6:00 AM. Para cambiar destinatarios, edita los usuarios admin en /usuarios.</p>`;

  // ─────────────────────────────────────────────────────────────────────────
  // Enviar a cada destinatario
  // ─────────────────────────────────────────────────────────────────────────
  let enviados = 0;
  for (const dest of destinatarios) {
    try {
      await sendMail(ctx, {
        to: dest.email,
        subject: `📊 Resumen diario de Mantenimiento — ${new Date().toLocaleDateString("es", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/El_Salvador" })}`,
        html: emailLayout("Resumen diario de operaciones", html),
        tipo: "digest_diario",
        referencia: `digest:${hoy}`,
      });
      enviados++;
    } catch (e) {
      console.error("digest a", dest.email, e);
    }
  }

  return { enviados };
}
