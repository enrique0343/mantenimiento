import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, asc } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { tickets, usuarios, sucursales, ubicaciones, activos, ticketComentarios, ticketAdjuntos, ordenes, adjuntos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { calcularVencimientoSla } from "@/lib/tickets";
import { sendMail, emailLayout } from "@/lib/email";
import { logAudit } from "@/lib/audit";
import { crearNotificacion } from "@/lib/notif-app";
import { fmtFechaLarga } from "@/lib/datetime";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);

  const [r] = await db
    .select({ t: tickets, a: usuarios, s: sucursales, act: activos })
    .from(tickets)
    .leftJoin(usuarios, eq(usuarios.id, tickets.asignadoA))
    .leftJoin(sucursales, eq(sucursales.id, tickets.sucursalId))
    .leftJoin(activos, eq(activos.id, tickets.activoId))
    .where(eq(tickets.id, id))
    .limit(1);
  if (!r) return Response.json({ error: "No encontrado" }, { status: 404 });

  const coms = await db
    .select({ c: ticketComentarios, u: usuarios })
    .from(ticketComentarios)
    .leftJoin(usuarios, eq(usuarios.id, ticketComentarios.usuarioId))
    .where(eq(ticketComentarios.ticketId, id))
    .orderBy(asc(ticketComentarios.id));

  const adjs = await db.select().from(ticketAdjuntos).where(eq(ticketAdjuntos.ticketId, id));

  return Response.json({
    ticket: {
      ...r.t,
      asignado: r.a ? { id: r.a.id, nombre: r.a.nombre } : null,
      sucursal: r.s ? { id: r.s.id, nombre: r.s.nombre } : null,
      activo: r.act ? { id: r.act.id, codigo: r.act.codigo, nombre: r.act.nombre } : null,
    },
    comentarios: coms.map((c) => ({
      ...c.c,
      autor: c.u ? { id: c.u.id, nombre: c.u.nombre } : null,
    })),
    adjuntos: adjs,
  });
};

const updateSchema = z.object({
  estado: z.enum(["nuevo", "asignado", "en_proceso", "resuelto", "cerrado", "descartado"]).optional(),
  prioridad: z.enum(["baja", "media", "alta", "urgente"]).optional(),
  asignadoA: z.number().int().nullable().optional(),
  sucursalId: z.number().int().nullable().optional(),
  ubicacionId: z.number().int().nullable().optional(),
  activoId: z.number().int().nullable().optional(),
  ubicacion: z.string().nullable().optional(),
  resolucionNotas: z.string().nullable().optional(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [actual] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  if (!actual) return Response.json({ error: "No encontrado" }, { status: 404 });

  const data: Record<string, unknown> = { ...parsed.data, updatedAt: new Date().toISOString() };

  // Si cambia prioridad, recalcula SLA desde createdAt
  if (parsed.data.prioridad && parsed.data.prioridad !== actual.prioridad) {
    const desde = new Date(actual.createdAt);
    const { slaHoras, vencimiento } = calcularVencimientoSla(parsed.data.prioridad, desde);
    data.slaHoras = slaHoras;
    data.vencimientoSla = vencimiento;
  }

  if (parsed.data.estado === "resuelto" && !actual.resueltoEn) data.resueltoEn = new Date().toISOString();
  if (parsed.data.estado && parsed.data.estado !== "resuelto" && parsed.data.estado !== "cerrado") {
    data.resueltoEn = null;
  }
  // Auto: si se asigna alguien y estado es nuevo, pasa a asignado
  if (parsed.data.asignadoA && actual.estado === "nuevo" && !parsed.data.estado) {
    data.estado = "asignado";
  }

  // ── AUTO-CREACION DE OT al asignar técnico (si aún no existe) ───────────
  // Si el ticket no tenía OT y se le está asignando un técnico, creamos
  // automáticamente la OT con ese técnico, copiamos las fotos del ticket
  // como "antes" y enviamos el email de "Nueva orden para ti" al técnico.
  let nuevaOtId: number | null = null;
  // Si el ticket está vinculado a un proyecto, NO auto-creamos OT. Las OTs
  // del proyecto se generan desde el detalle del proyecto.
  const debeCrearOT =
    !actual.otId &&
    !(actual as any).proyectoId &&
    parsed.data.asignadoA &&
    parsed.data.asignadoA !== actual.asignadoA;

  if (debeCrearOT) {
    try {
      const desc = `${actual.descripcion}\n\n— Ticket #${actual.id} de ${actual.solicitanteNombre} <${actual.solicitanteEmail}>`;
      const [orden] = await db
        .insert(ordenes)
        .values({
          titulo: actual.asunto,
          descripcion: desc,
          tipo: "correctivo",
          prioridad: actual.prioridad,
          estado: "abierta",
          activoId: actual.activoId,
          asignadoA: parsed.data.asignadoA!,
          asignadoEn: parsed.data.asignadoA ? new Date().toISOString() : null,
          creadoPor: user.id,
          vencimiento: actual.vencimientoSla,
        })
        .returning();
      nuevaOtId = orden.id;
      data.otId = orden.id;

      // Copiar fotos del ticket como adjuntos "antes" de la OT
      try {
        const tas = await db.select().from(ticketAdjuntos).where(eq(ticketAdjuntos.ticketId, id));
        if (tas.length > 0) {
          const env = getEnv(ctx);
          for (const ta of tas) {
            const newKey = `ordenes/${orden.id}/antes/${Date.now()}-${crypto.randomUUID()}-${ta.nombre.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
            try {
              const obj = await env.R2.get(ta.r2Key);
              if (obj) {
                await env.R2.put(newKey, obj.body, { httpMetadata: { contentType: ta.contentType } });
                await db.insert(adjuntos).values({
                  ordenId: orden.id, usuarioId: user.id, nombre: ta.nombre,
                  contentType: ta.contentType, tamano: ta.tamano, r2Key: newKey, categoria: "antes",
                });
              }
            } catch (e) { console.error("copy ticket photo:", e); }
          }
        }
      } catch (e) { console.error("ticket photos transfer:", e); }

      // Audit
      await logAudit(ctx, {
        entidad: "orden", entidadId: orden.id, accion: "create",
        resumen: `OT generada al asignar Ticket #${actual.id} de ${actual.solicitanteNombre} <${actual.solicitanteEmail}>`,
      });
      await logAudit(ctx, {
        entidad: "orden", entidadId: orden.id, accion: "asignacion",
        resumen: `Asignada al técnico (id: ${parsed.data.asignadoA}) en la creación`,
      });

      // Email al técnico (formato "Nueva orden para ti")
      const [tec] = await db.select({ email: usuarios.email, nombre: usuarios.nombre })
        .from(usuarios).where(eq(usuarios.id, parsed.data.asignadoA!)).limit(1);
      if (tec?.email) {
        const env = (ctx.locals as any)?.runtime?.env ?? {};
        const baseUrl = env.APP_URL || "https://mantenimiento-49c.pages.dev";
        const otUrl = `${baseUrl}/ordenes/${orden.id}`;
        const primerNombre = (tec.nombre ?? "").split(" ")[0] || tec.nombre;

        // Resolver ubicación
        let ubicacionTexto: string | null = null;
        if (orden.activoId) {
          try {
            const [info] = await db
              .select({ ub: ubicaciones.nombre, suc: sucursales.nombre })
              .from(activos)
              .leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId))
              .leftJoin(sucursales, eq(sucursales.id, ubicaciones.sucursalId))
              .where(eq(activos.id, orden.activoId))
              .limit(1);
            ubicacionTexto = [info?.ub, info?.suc].filter(Boolean).join(", ") || null;
          } catch {}
        }
        if (!ubicacionTexto && actual.ubicacion) ubicacionTexto = actual.ubicacion;

        const venceFormateado = orden.vencimiento ? fmtFechaLarga(orden.vencimiento) : null;
        const subjectVence = venceFormateado ? ` — vence ${venceFormateado}` : "";

        ctx.locals.runtime.ctx.waitUntil(
          sendMail(ctx, {
            to: tec.email,
            subject: `[OT #${orden.id}] Te asignamos: ${orden.titulo}${subjectVence}`,
            html: emailLayout(
              "Nueva orden para ti",
              `<p>Hola <strong>${primerNombre}</strong>,</p>
               <p>Contamos contigo para esta orden. Te dejamos los detalles abajo.</p>
               <h3 style="margin:18px 0 10px 0;color:#0a4082;font-size:16px">Orden #${orden.id} — ${orden.titulo}</h3>
               <ul style="margin:0 0 14px 0;padding-left:20px;line-height:1.7">
                 <li><strong>Tipo:</strong> ${orden.tipo}</li>
                 <li><strong>Prioridad:</strong> ${orden.prioridad}</li>
                 ${venceFormateado ? `<li><strong>Vence:</strong> ${venceFormateado}</li>` : ""}
                 ${ubicacionTexto ? `<li><strong>Ubicación:</strong> ${ubicacionTexto}</li>` : ""}
               </ul>
               ${orden.descripcion ? `<p style="margin:0 0 6px 0"><strong>Lo que reportaron:</strong></p>
                 <p style="white-space:pre-wrap;background:#f8fafc;padding:12px;border-left:3px solid #0a4082;border-radius:4px;margin:0 0 18px 0">${orden.descripcion}</p>` : ""}
               <p style="margin:18px 0"><a href="${otUrl}" style="display:inline-block;padding:10px 20px;background:#0a4082;color:#fff;border-radius:6px;text-decoration:none;font-weight:500">Abrir orden →</a></p>
               <p style="font-size:13px;color:#475569;margin-top:18px">Si encuentras algo distinto a lo descrito al llegar al sitio, regístralo en la orden antes de iniciar el trabajo. Si necesitas apoyo o materiales adicionales, escríbele directamente a tu jefatura.</p>
               <p style="margin-top:14px"><em>Gracias por mantener Avante funcionando.</em></p>`
            ),
            tipo: "ot_asignada",
            referencia: `orden:${orden.id}`,
          }).catch(() => {})
        );

        // Notificación in-app
        await crearNotificacion(ctx, {
          usuarioId: parsed.data.asignadoA!, tipo: "ot_asignada",
          titulo: `Nueva OT #${orden.id}: ${orden.titulo}`,
          mensaje: `Prioridad: ${orden.prioridad}${venceFormateado ? ` · Vence ${venceFormateado}` : ""}`,
          link: `/ordenes/${orden.id}`,
        });
      }
    } catch (e) {
      console.error("auto-creacion OT desde ticket:", e);
    }
  }

  const [row] = await db.update(tickets).set(data).where(eq(tickets.id, id)).returning();
  return Response.json({ ticket: row, otCreada: nuevaOtId });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  // ticket_comentarios tiene cascade delete; encuestas tiene set null
  try {
    await db.delete(tickets).where(eq(tickets.id, id));
  } catch (e: any) {
    return Response.json({ error: `No se pudo borrar: ${e?.message ?? e}` }, { status: 500 });
  }
  return Response.json({ ok: true });
};
