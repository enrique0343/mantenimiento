// Procesamiento diario de contratos: auto-transición de estados y alertas 90/60/30 días.
// Llamado desde el cron daily-digest.

import type { APIContext } from "astro";
import { and, eq, lte, lt, isNull, inArray, gte, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { contratosMantenimiento, contratoEquipos, usuarios, proveedores, activos } from "./schema";
import { sendMail, emailLayout } from "./email";
import { crearNotificacion } from "./notif-app";
import { diasParaVencer } from "./contratos";
import { fmtFechaLarga } from "./datetime";

function appUrl(ctx: APIContext): string {
  const env = (ctx.locals as any)?.runtime?.env ?? {};
  return env.APP_URL || "https://mantenimiento-49c.pages.dev";
}

function escapeHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// 1) Actualiza estados según fecha_fin.
// 2) Envía emails para los hitos 90/60/30 días que aún no se han notificado.
// 3) Devuelve los contratos por vencer en próximos 90 días (para incluir en el digest).
export async function procesarContratosVencimiento(ctx: APIContext): Promise<{
  vencidos: number;
  porVencer: Array<{ id: number; codigo: string; nombre: string; fechaFin: string; diasRestantes: number; proveedor: string | null }>;
  alertasEnviadas: number;
}> {
  const db = getDb(ctx);
  const ahora = new Date().toISOString();
  const hoy = ahora.slice(0, 10);
  const en90 = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);

  // 1. Auto-transición: vigente|por_vencer → vencido cuando fecha_fin < hoy
  await db.update(contratosMantenimiento).set({
    estado: "vencido",
    updatedAt: ahora,
  }).where(and(
    lt(contratosMantenimiento.fechaFin, hoy),
    inArray(contratosMantenimiento.estado, ["vigente", "por_vencer"]),
  ));

  // 2. Auto-transición: vigente → por_vencer cuando faltan ≤ 90 días
  await db.update(contratosMantenimiento).set({
    estado: "por_vencer",
    updatedAt: ahora,
  }).where(and(
    eq(contratosMantenimiento.estado, "vigente"),
    lte(contratosMantenimiento.fechaFin, en90),
    gte(contratosMantenimiento.fechaFin, hoy),
  ));

  // 3. Listar contratos en próximos 90 días (vigente o por_vencer) para alertas y digest
  const proximos = await db
    .select({ c: contratosMantenimiento, prov: proveedores, resp: usuarios })
    .from(contratosMantenimiento)
    .leftJoin(proveedores, eq(proveedores.id, contratosMantenimiento.proveedorId))
    .leftJoin(usuarios, eq(usuarios.id, contratosMantenimiento.responsableId))
    .where(and(
      inArray(contratosMantenimiento.estado, ["vigente", "por_vencer"]),
      lte(contratosMantenimiento.fechaFin, en90),
      gte(contratosMantenimiento.fechaFin, hoy),
    ));

  // Admins activos como destinatarios base
  const admins = await db.select({ id: usuarios.id, email: usuarios.email, nombre: usuarios.nombre })
    .from(usuarios).where(and(eq(usuarios.activo, true), eq(usuarios.rol, "admin")));

  let alertasEnviadas = 0;
  const baseUrl = appUrl(ctx);

  for (const { c, prov, resp } of proximos) {
    const d = diasParaVencer(c.fechaFin);
    let umbral: 90 | 60 | 30 | null = null;
    let yaEnviada: string | null = null;
    if (d <= 30) { umbral = 30; yaEnviada = c.alerta30dEnviadaEn; }
    else if (d <= 60) { umbral = 60; yaEnviada = c.alerta60dEnviadaEn; }
    else if (d <= 90) { umbral = 90; yaEnviada = c.alerta90dEnviadaEn; }
    if (!umbral || yaEnviada) continue;

    // Equipos cubiertos
    const equipos = await db
      .select({ codigo: activos.codigo, nombre: activos.nombre })
      .from(contratoEquipos)
      .innerJoin(activos, eq(activos.id, contratoEquipos.activoId))
      .where(eq(contratoEquipos.contratoId, c.id));
    const equiposTexto = equipos.length === 0
      ? "<em>sin equipos vinculados</em>"
      : equipos.map((e) => `${escapeHtml(e.codigo)} — ${escapeHtml(e.nombre)}`).join("<br>");

    const urgencia = umbral === 30 ? "URGENTE" : umbral === 60 ? "Importante" : "Aviso";
    const colorAcento = umbral === 30 ? "#dc2626" : umbral === 60 ? "#ea580c" : "#0a4082";

    // Destinatarios: admins + responsable interno (si existe y no es admin ya en la lista)
    const dests = [...admins];
    if (resp?.email && !dests.find((a) => a.id === resp.id)) {
      dests.push({ id: resp.id, email: resp.email, nombre: resp.nombre });
    }

    const link = `${baseUrl}/contratos/${c.id}`;
    const subject = `[${urgencia}] Contrato ${c.codigo} vence en ${d} día${d === 1 ? "" : "s"}: ${c.nombre}`;
    const html = emailLayout(
      `Contrato por vencer en ${d} día${d === 1 ? "" : "s"}`,
      `<p>El contrato <strong>${escapeHtml(c.nombre)}</strong> vence el <strong>${fmtFechaLarga(c.fechaFin)}</strong> (${d} día${d === 1 ? "" : "s"} restantes).</p>
       <table style="margin:14px 0;border-collapse:collapse;width:100%">
         <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Código:</td><td style="padding:6px 0;font-weight:bold">${c.codigo}</td></tr>
         <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Proveedor:</td><td style="padding:6px 0">${escapeHtml(prov?.nombre ?? "—")}</td></tr>
         <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Tipo:</td><td style="padding:6px 0">${c.tipo}</td></tr>
         <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Costo:</td><td style="padding:6px 0">$${(c.costo ?? 0).toFixed(2)} (${c.periodicidadCosto})</td></tr>
         <tr><td style="padding:6px 0;color:#64748b;font-size:13px;vertical-align:top">Equipos cubiertos:</td><td style="padding:6px 0">${equiposTexto}</td></tr>
       </table>
       <p style="margin:14px 0;padding:10px 14px;border-left:3px solid ${colorAcento};background:#f8fafc;font-size:14px">
         Te recomendamos contactar al proveedor para iniciar la renovación cuanto antes y evitar quedar sin cobertura.
       </p>
       <p style="margin:18px 0"><a href="${link}" style="display:inline-block;padding:10px 20px;background:${colorAcento};color:#fff;border-radius:6px;text-decoration:none;font-weight:500">Abrir contrato →</a></p>`
    );

    for (const dst of dests) {
      if (!dst.email) continue;
      try {
        await sendMail(ctx, { to: dst.email, subject, html, tipo: `contrato_alerta_${umbral}d`, referencia: `contrato:${c.id}` });
        alertasEnviadas++;
      } catch (e) { console.error("alerta contrato:", e); }

      await crearNotificacion(ctx, {
        usuarioId: dst.id,
        tipo: `contrato_alerta_${umbral}d`,
        titulo: `Contrato ${c.codigo} vence en ${d} día${d === 1 ? "" : "s"}`,
        mensaje: c.nombre,
        link: `/contratos/${c.id}`,
      });
    }

    // Marcar la alerta como enviada para no repetir
    const campo = umbral === 30 ? "alerta30dEnviadaEn" : umbral === 60 ? "alerta60dEnviadaEn" : "alerta90dEnviadaEn";
    await db.update(contratosMantenimiento).set({
      [campo]: ahora,
      updatedAt: ahora,
    } as any).where(eq(contratosMantenimiento.id, c.id));
  }

  // 4. Conteo de vencidos (los que pasaron a vencido hoy o ya estaban vencidos)
  const vencRows = await db.select({ n: sql<number>`count(*)` })
    .from(contratosMantenimiento)
    .where(eq(contratosMantenimiento.estado, "vencido"));
  const vencidos = Number(vencRows[0]?.n ?? 0);

  return {
    vencidos,
    porVencer: proximos.map(({ c, prov }) => ({
      id: c.id, codigo: c.codigo, nombre: c.nombre, fechaFin: c.fechaFin,
      diasRestantes: diasParaVencer(c.fechaFin),
      proveedor: prov?.nombre ?? null,
    })).sort((a, b) => a.diasRestantes - b.diasRestantes),
    alertasEnviadas,
  };
}
