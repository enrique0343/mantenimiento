import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { planesMantenimiento, activos, ordenes, usuarios } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

import { parseArea } from "@/lib/areas";
import { rubroDeActivo } from "@/lib/rubros";
import { conCodigo } from "@/lib/ordenes";
import { crearNotificacion } from "@/lib/notif-app";
import { sendTelegram } from "@/lib/telegram";
export const prerender = false;

// Genera una OT preventiva inmediatamente para el plan dado, sin esperar al cron.
// Solo admin/jefe. Marca ultimaGeneracion para evitar duplicados con el cron.
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;

  const id = Number(ctx.params.id);
  const areaParam = ctx.url.searchParams.get("area");
  const area = parseArea(areaParam);
  if (areaParam && !area) return Response.json({ error: "Área no válida" }, { status: 400 });
  const db = getDb(ctx);

  const [row] = await db
    .select({ p: planesMantenimiento, a: activos })
    .from(planesMantenimiento)
    .leftJoin(activos, eq(activos.id, planesMantenimiento.activoId))
    .where(eq(planesMantenimiento.id, id))
    .limit(1);
  if (!row || (area && (!row.a || rubroDeActivo(row.a.rubro, row.a.tipo) !== area))) return Response.json({ error: "Plan no encontrado en esta área" }, { status: 404 });
  if (!row.p.activo) return Response.json({ error: "El plan está inactivo" }, { status: 400 });

  const p = row.p;
  // Si ya hay OT generada para este ciclo, no duplicar
  if (p.ultimaGeneracion && p.ultimaGeneracion.slice(0, 10) >= p.proximaFecha) {
    return Response.json({ error: "Ya existe una OT abierta para el ciclo actual de este plan" }, { status: 409 });
  }

  const codigoActivo = row.a?.codigo ?? `Activo #${p.activoId}`;
  const titulo = `[Preventivo] ${p.titulo} - ${codigoActivo}`;
  const venc = new Date(p.proximaFecha);
  venc.setUTCDate(venc.getUTCDate() + p.alertaDiasAntes);
  const now = new Date().toISOString();

  const [orden] = await db
    .insert(ordenes)
    .values({
      titulo,
      descripcion: p.descripcion ?? null,
      tipo: "preventivo",
      rubro: rubroDeActivo(row.a?.rubro, row.a?.tipo),
      prioridad: p.prioridad,
      estado: "abierta",
      activoId: p.activoId,
      asignadoA: p.asignadoA,
      asignadoEn: p.asignadoA ? new Date().toISOString() : null,
      creadoPor: user.id,
      planId: p.id,
      vencimiento: venc.toISOString(),
      checklistEjecucion: p.checklist ?? null,
    })
    .returning();

  await db
    .update(planesMantenimiento)
    .set({ ultimaGeneracion: now })
    .where(eq(planesMantenimiento.id, p.id));

  // El mismo aviso que manda el cron cuando genera la OT de un preventivo con técnico.
  if (p.asignadoA && p.asignadoA !== user.id) {
    try {
      await crearNotificacion(ctx, { usuarioId: p.asignadoA, tipo: "ot_asignada", titulo: `Preventivo nuevo: ${codigoActivo}`, mensaje: p.titulo, link: `/ordenes/${orden.id}` });
      const [persona] = await db.select({ chat: usuarios.telegramChatId }).from(usuarios).where(eq(usuarios.id, p.asignadoA)).limit(1);
      if (persona?.chat) await sendTelegram(getEnv(ctx), persona.chat, `<b>Preventivo nuevo</b>\n${titulo}`, { linkUrl: `${getEnv(ctx).APP_URL || "https://mantenimiento.complejoavante.dev"}/ordenes/${orden.id}`, linkLabel: "Abrir" });
    } catch {}
  }

  return Response.json({ orden: await conCodigo(db, orden) }, { status: 201 });
};
