import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { ordenes, activos, usuarios, comentarios, adjuntos, planesMantenimiento, tickets, actividades, movimientosInventario, extintorEventos } from "@/lib/schema";

async function contarAdjuntos(db: any, ordenId: number, categoria: string): Promise<number> {
  const rows = await db.select({ id: adjuntos.id }).from(adjuntos)
    .where(and(eq(adjuntos.ordenId, ordenId), eq(adjuntos.categoria, categoria)));
  return rows.length;
}
import { and } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { transicionesPermitidas, type EstadoOT } from "@/lib/ordenes";
import { siguienteFecha } from "@/lib/frecuencias";
import { sendMail, emailLayout } from "@/lib/email";
import { disparadorOT } from "@/lib/notificaciones";
import { sendTelegram } from "@/lib/telegram";
import { crearNotificacion } from "@/lib/notif-app";
import { logAudit } from "@/lib/audit";

export const prerender = false;

const updateSchema = z.object({
  titulo: z.string().min(1).optional(),
  descripcion: z.string().nullable().optional(),
  tipo: z.enum(["preventivo", "correctivo", "predictivo"]).optional(),
  prioridad: z.enum(["baja", "media", "alta", "urgente"]).optional(),
  estado: z.enum(["abierta", "en_proceso", "en_espera", "completada", "verificada", "cerrada", "cancelada"]).optional(),
  activoId: z.number().int().positive().nullable().optional(),
  asignadoA: z.number().int().positive().nullable().optional(),
  vencimiento: z.string().nullable().optional(),
  // Ejecucion
  trabajosRealizados: z.string().nullable().optional(),
  causaRaiz: z.string().nullable().optional(),
  solucionAplicada: z.string().nullable().optional(),
  horasTrabajadas: z.number().nullable().optional(),
  checklistEjecucion: z.string().nullable().optional(),
  // Verificacion (solo se setea via accion explicita; aqui aceptamos notas)
  verificacionNotas: z.string().nullable().optional(),
  // Si es correctivo y se cierra, reprogramar planes preventivos del activo
  // (default true; el técnico puede desmarcar si fue trivial)
  reprogramarPreventivos: z.boolean().optional(),
});

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);

  const [row] = await db
    .select({ orden: ordenes, activo: activos, asignado: usuarios })
    .from(ordenes)
    .leftJoin(activos, eq(activos.id, ordenes.activoId))
    .leftJoin(usuarios, eq(usuarios.id, ordenes.asignadoA))
    .where(eq(ordenes.id, id))
    .limit(1);
  if (!row) return Response.json({ error: "No encontrado" }, { status: 404 });

  const coms = await db
    .select({ c: comentarios, u: usuarios })
    .from(comentarios)
    .leftJoin(usuarios, eq(usuarios.id, comentarios.usuarioId))
    .where(eq(comentarios.ordenId, id))
    .orderBy(comentarios.id);

  const adjs = await db.select().from(adjuntos).where(eq(adjuntos.ordenId, id));

  return Response.json({
    orden: {
      ...row.orden,
      activo: row.activo ? { id: row.activo.id, codigo: row.activo.codigo, nombre: row.activo.nombre } : null,
      asignado: row.asignado ? { id: row.asignado.id, nombre: row.asignado.nombre } : null,
    },
    comentarios: coms.map((r) => ({
      ...r.c,
      autor: r.u ? { id: r.u.id, nombre: r.u.nombre } : null,
    })),
    adjuntos: adjs,
  });
};

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [actual] = await db.select().from(ordenes).where(eq(ordenes.id, id)).limit(1);
  if (!actual) return Response.json({ error: "No encontrado" }, { status: 404 });

  const { reprogramarPreventivos, ...rest } = parsed.data;
  const data: Record<string, unknown> = { ...rest };
  const now = new Date().toISOString();

  // Validar transicion de estado segun rol
  if (parsed.data.estado && parsed.data.estado !== actual.estado) {
    // ─── Validaciones de adjuntos obligatorios ──────────────────────────────
    // Para iniciar (abierta → en_proceso): se requiere al menos 1 foto "antes"
    if (actual.estado === "abierta" && parsed.data.estado === "en_proceso") {
      const nAntes = await contarAdjuntos(db, id, "antes");
      if (nAntes === 0) {
        return Response.json(
          { error: "Debes adjuntar al menos una foto del estado inicial (antes) para iniciar la OT." },
          { status: 400 }
        );
      }
    }
    // Para completar (en_proceso → completada): se requiere al menos 1 foto "después"
    if (actual.estado === "en_proceso" && parsed.data.estado === "completada") {
      const nDespues = await contarAdjuntos(db, id, "despues");
      if (nDespues === 0) {
        return Response.json(
          { error: "Debes adjuntar al menos una foto del estado final (después) para completar la OT." },
          { status: 400 }
        );
      }
    }

    const esAsignado = actual.asignadoA === user.id;
    const permitidas = transicionesPermitidas(actual.estado as EstadoOT, user.rol, esAsignado);
    if (!permitidas.includes(parsed.data.estado as EstadoOT)) {
      return Response.json(
        { error: `No tienes permisos para mover de "${actual.estado}" a "${parsed.data.estado}"` },
        { status: 403 }
      );
    }

    // Timestamps automaticos por estado de destino
    switch (parsed.data.estado) {
      case "en_espera":
        // Guardar momento en que se pausa
        data.pausadaEn = now;
        break;
      case "en_proceso":
        // Si venía de en_espera, acumular el tiempo pausado
        if (actual.estado === "en_espera" && actual.pausadaEn) {
          const minPausados = Math.round((new Date(now).getTime() - new Date(actual.pausadaEn).getTime()) / 60_000);
          data.tiempoPausadoMin = (actual.tiempoPausadoMin ?? 0) + minPausados;
          data.pausadaEn = null;
        }
        // Si nunca se había iniciado, marcar inicio (para calcular horas)
        if (!actual.iniciadaEn) data.iniciadaEn = now;
        // Si venía de un estado posterior (rollback), limpiar timestamps post
        if (actual.estado !== "abierta" && actual.estado !== "en_espera") {
          data.completadaEn = null;
          data.verificadoPor = null;
          data.verificadoEn = null;
        }
        break;
      case "completada":
        data.completadaEn = now;
        // Auto-calcular horas trabajadas si hay inicio y el técnico no las
        // proporcionó manualmente en este PATCH. Descuenta tiempo pausado.
        if (actual.iniciadaEn && parsed.data.horasTrabajadas == null) {
          const inicio = new Date(actual.iniciadaEn).getTime();
          const fin = new Date(now).getTime();
          const pausadoMs = (actual.tiempoPausadoMin ?? 0) * 60_000;
          const horas = Math.max(0, (fin - inicio - pausadoMs) / 3_600_000);
          data.horasTrabajadas = Math.round(horas * 100) / 100;
        }
        break;
      case "verificada":
        data.verificadoPor = user.id;
        data.verificadoEn = now;
        if (!actual.completadaEn) data.completadaEn = now;
        break;
      case "cerrada":
        data.cerradoPor = user.id;
        data.cerradoEn = now;
        break;
      case "abierta":
        // Rollback total: limpiar todos los timestamps
        data.completadaEn = null;
        data.verificadoPor = null;
        data.verificadoEn = null;
        break;
    }
  }

  const [row] = await db.update(ordenes).set(data).where(eq(ordenes.id, id)).returning();

  // Audit: cambio de estado (con resumen legible)
  if (parsed.data.estado && parsed.data.estado !== actual.estado) {
    await logAudit(ctx, {
      entidad: "orden", entidadId: id, accion: "estado",
      resumen: `Estado: ${actual.estado} → ${parsed.data.estado}`,
      cambios: { estado: { antes: actual.estado, despues: parsed.data.estado } },
    });
  }
  // Audit: cambio de asignación
  if (parsed.data.asignadoA !== undefined && parsed.data.asignadoA !== actual.asignadoA) {
    let nombreNuevo: string | null = null;
    if (parsed.data.asignadoA) {
      const [u] = await db.select({ nombre: usuarios.nombre }).from(usuarios).where(eq(usuarios.id, parsed.data.asignadoA)).limit(1);
      nombreNuevo = u?.nombre ?? `id ${parsed.data.asignadoA}`;
    }
    await logAudit(ctx, {
      entidad: "orden", entidadId: id, accion: "asignacion",
      resumen: parsed.data.asignadoA
        ? `Asignada a ${nombreNuevo}`
        : "Asignación removida",
      cambios: { asignadoA: { antes: actual.asignadoA, despues: parsed.data.asignadoA } },
    });
  }
  // Audit: otros cambios (campos de ejecución, prioridad, etc.)
  const camposEditables = ["titulo", "descripcion", "prioridad", "tipo", "vencimiento", "trabajosRealizados", "causaRaiz", "solucionAplicada", "horasTrabajadas"];
  const otrosCambios: any = {};
  for (const c of camposEditables) {
    if ((parsed.data as any)[c] !== undefined && (parsed.data as any)[c] !== (actual as any)[c]) {
      otrosCambios[c] = { antes: (actual as any)[c], despues: (parsed.data as any)[c] };
    }
  }
  if (Object.keys(otrosCambios).length > 0) {
    await logAudit(ctx, {
      entidad: "orden", entidadId: id, accion: "update",
      cambios: otrosCambios,
    });
  }

  // Reprogramación: si se completó una OT correctiva sobre un activo,
  // reiniciar el contador de los planes preventivos del activo.
  // Por defecto sí; el cliente puede mandar reprogramarPreventivos:false para opt-out.
  const seCompleto = parsed.data.estado === "completada" && actual.estado !== "completada";
  if (
    seCompleto &&
    actual.tipo === "correctivo" &&
    actual.activoId &&
    reprogramarPreventivos !== false
  ) {
    try {
      const planes = await db
        .select()
        .from(planesMantenimiento)
        .where(and(eq(planesMantenimiento.activoId, actual.activoId), eq(planesMantenimiento.activo, true)));
      for (const p of planes) {
        const nuevaProxima = siguienteFecha(now.slice(0, 10), p.frecuencia as any);
        await db
          .update(planesMantenimiento)
          .set({ proximaFecha: nuevaProxima })
          .where(eq(planesMantenimiento.id, p.id));
      }
    } catch {}
  }

  // Al CERRAR una OT vinculada a un plan preventivo o a una actividad
  // recurrente, avanzar proximaFecha al siguiente ciclo desde HOY. Esto
  // mantiene la programación al ritmo real (no teórico) y evita que se
  // generen OTs duplicadas mientras la actual sigue abierta.
  const seCerro = parsed.data.estado === "cerrada" && actual.estado !== "cerrada";
  if (seCerro) {
    if (actual.planId) {
      try {
        const [pl] = await db.select().from(planesMantenimiento).where(eq(planesMantenimiento.id, actual.planId)).limit(1);
        if (pl) {
          const nueva = siguienteFecha(now.slice(0, 10), pl.frecuencia as any);
          await db.update(planesMantenimiento)
            .set({ proximaFecha: nueva })
            .where(eq(planesMantenimiento.id, pl.id));
        }
      } catch {}
    }
    if (actual.actividadId) {
      try {
        const [act] = await db.select().from(actividades).where(eq(actividades.id, actual.actividadId)).limit(1);
        if (act) {
          const nueva = siguienteFecha(now.slice(0, 10), act.frecuencia as any);
          await db.update(actividades)
            .set({ proximaFecha: nueva, ultimaEjecucion: now })
            .where(eq(actividades.id, act.id));
        }
      } catch {}
    }
  }

  // Sync con ticket vinculado: si la OT cambió de estado, propagar al ticket
  if (parsed.data.estado && parsed.data.estado !== actual.estado) {
    try {
      const mapeo: Record<string, string> = {
        abierta: "asignado",
        en_proceso: "en_proceso",
        completada: "resuelto",
        verificada: "resuelto",
        cerrada: "cerrado",
        cancelada: "descartado",
      };
      const nuevoEstadoTicket = mapeo[parsed.data.estado];
      if (nuevoEstadoTicket) {
        const updateTicket: Record<string, unknown> = {
          estado: nuevoEstadoTicket,
          updatedAt: now,
        };
        if (parsed.data.estado === "completada" || parsed.data.estado === "verificada") {
          updateTicket.resueltoEn = now;
          if (actual.solucionAplicada || parsed.data.solucionAplicada) {
            updateTicket.resolucionNotas = parsed.data.solucionAplicada ?? actual.solucionAplicada;
          }
        }
        await db.update(tickets).set(updateTicket).where(eq(tickets.otId, id));
      }
    } catch {}
  }

  // Notifica al tecnico cuando se le asigna una OT
  if (parsed.data.asignadoA && parsed.data.asignadoA !== actual.asignadoA) {
    try {
      const [u] = await db.select({ email: usuarios.email, nombre: usuarios.nombre, telegramChatId: usuarios.telegramChatId })
        .from(usuarios).where(eq(usuarios.id, parsed.data.asignadoA)).limit(1);
      const env = (ctx.locals as any)?.runtime?.env ?? {};
      const baseUrl = env.APP_URL || "https://mantenimiento-49c.pages.dev";
      const otUrl = `${baseUrl}/ordenes/${row.id}`;

      if (u?.email) {
        ctx.locals.runtime.ctx.waitUntil(
          sendMail(ctx, {
            to: u.email,
            subject: `[OT #${row.id}] Te asignaron: ${row.titulo}`,
            html: emailLayout(
              `Nueva orden asignada`,
              `<p>Hola <strong>${u.nombre}</strong>,</p>
               <p>Te asignaron la orden <strong>#${row.id} - ${row.titulo}</strong>.</p>
               <p>Tipo: ${row.tipo} · Prioridad: ${row.prioridad}${row.vencimiento ? ` · Vence: ${new Date(row.vencimiento).toLocaleString("es")}` : ""}</p>
               ${row.descripcion ? `<p style="white-space:pre-wrap">${row.descripcion}</p>` : ""}
               <p><a href="${otUrl}">Abrir orden →</a></p>`
            ),
            tipo: "ot_asignada",
            referencia: `orden:${row.id}`,
          }).catch(() => {})
        );
      }
      if (u?.telegramChatId) {
        ctx.locals.runtime.ctx.waitUntil(
          sendTelegram(env, u.telegramChatId,
            `🔔 <b>Nueva OT asignada</b>\n#${row.id} - ${row.titulo}\nPrioridad: ${row.prioridad}${row.vencimiento ? `\nVence: ${new Date(row.vencimiento).toLocaleString("es")}` : ""}`,
            { linkUrl: otUrl, linkLabel: "Abrir orden" }
          )
        );
      }
      await crearNotificacion(ctx, {
        usuarioId: parsed.data.asignadoA, tipo: "ot_asignada",
        titulo: `Te asignaron OT #${row.id}: ${row.titulo}`,
        mensaje: `Prioridad: ${row.prioridad}${row.vencimiento ? ` · Vence ${new Date(row.vencimiento).toLocaleDateString("es")}` : ""}`,
        link: `/ordenes/${row.id}`,
      });
    } catch {}
  }

  // Dispara emails según cambio de estado (iniciada/completada/cerrada)
  if (parsed.data.estado && parsed.data.estado !== actual.estado) {
    try {
      await disparadorOT(ctx, row as any, actual.estado, parsed.data.estado);
    } catch {}
  }

  return Response.json({ orden: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  const env = (ctx.locals as any).runtime?.env;
  const [ot] = await db.select().from(ordenes).where(eq(ordenes.id, id)).limit(1);
  if (!ot) return Response.json({ error: "No encontrada" }, { status: 404 });

  // Borrar adjuntos de R2
  const adjs = await db.select().from(adjuntos).where(eq(adjuntos.ordenId, id));
  if (adjs.length && env?.R2) {
    await Promise.allSettled(adjs.map((a) => env.R2.delete(a.r2Key)));
  }

  // Limpiar FKs sin cascade (preserva historial)
  try { await db.update(tickets).set({ otId: null }).where(eq(tickets.otId, id)); } catch {}
  try { await db.update(movimientosInventario).set({ ordenId: null }).where(eq(movimientosInventario.ordenId, id)); } catch {}
  try { await db.update(extintorEventos).set({ otId: null }).where(eq(extintorEventos.otId, id)); } catch {}

  await logAudit(ctx, { entidad: "orden", entidadId: id, accion: "delete", resumen: `OT eliminada: "${ot.titulo}"` });

  try {
    await db.delete(ordenes).where(eq(ordenes.id, id));
  } catch (e: any) {
    return Response.json({ error: `No se pudo borrar: ${e?.message ?? e}` }, { status: 500 });
  }

  if (ot.planId) {
    try { await db.update(planesMantenimiento).set({ ultimaGeneracion: null }).where(eq(planesMantenimiento.id, ot.planId)); } catch {}
  }
  if (ot.actividadId) {
    try { await db.update(actividades).set({ ultimaGeneracion: null }).where(eq(actividades.id, ot.actividadId)); } catch {}
  }
  return Response.json({ ok: true });
};
