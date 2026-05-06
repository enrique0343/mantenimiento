import type { APIRoute } from "astro";
import { z } from "zod";
import { desc, eq, and } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { ordenes, activos, usuarios, ubicaciones, sucursales } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { calcularVencimiento, type Prioridad } from "@/lib/sla";
import { sendMail, emailLayout } from "@/lib/email";
import { sendTelegram } from "@/lib/telegram";
import { crearNotificacion } from "@/lib/notif-app";
import { logAudit } from "@/lib/audit";
import { fmtFechaLarga, fmtFechaCompacta } from "@/lib/datetime";

export const prerender = false;

const createSchema = z.object({
  titulo: z.string().min(1),
  descripcion: z.string().optional().nullable(),
  tipo: z.enum(["preventivo", "correctivo", "predictivo"]).optional(),
  prioridad: z.enum(["baja", "media", "alta", "urgente"]).optional(),
  activoId: z.number().int().positive().optional().nullable(),
  asignadoA: z.number().int().positive().optional().nullable(),
  vencimiento: z.string().optional().nullable(),
  checklistEjecucion: z.string().optional().nullable(),
});

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const db = getDb(ctx);
  const url = new URL(ctx.request.url);
  const estado = url.searchParams.get("estado") as any;
  const asignado = url.searchParams.get("asignado");

  const conditions = [];
  if (estado) conditions.push(eq(ordenes.estado, estado));
  if (asignado === "me") conditions.push(eq(ordenes.asignadoA, user.id));

  const rows = await db
    .select({
      orden: ordenes,
      activo: activos,
      asignado: usuarios,
    })
    .from(ordenes)
    .leftJoin(activos, eq(activos.id, ordenes.activoId))
    .leftJoin(usuarios, eq(usuarios.id, ordenes.asignadoA))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(ordenes.id));

  return Response.json({
    ordenes: rows.map((r) => ({
      ...r.orden,
      activo: r.activo ? { id: r.activo.id, codigo: r.activo.codigo, nombre: r.activo.nombre } : null,
      asignado: r.asignado ? { id: r.asignado.id, nombre: r.asignado.nombre } : null,
    })),
  });
};

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);

  // Si no se proporcionó vencimiento explícito y hay equipo, calcular desde SLA
  let vencimiento = parsed.data.vencimiento ?? null;
  if (!vencimiento && parsed.data.activoId) {
    const [eq_row] = await db.select().from(activos).where(eq(activos.id, parsed.data.activoId)).limit(1);
    const prioridad = (parsed.data.prioridad ?? "media") as Prioridad;
    vencimiento = calcularVencimiento(new Date().toISOString(), eq_row, prioridad);
  }

  const [row] = await db
    .insert(ordenes)
    .values({ ...parsed.data, vencimiento, creadoPor: user.id })
    .returning();

  // Audit: creación de OT
  await logAudit(ctx, {
    entidad: "orden", entidadId: row.id, accion: "create",
    resumen: `OT creada: "${row.titulo}"${row.asignadoA ? ` (asignada al inicio)` : ""}`,
  });
  if (row.asignadoA) {
    await logAudit(ctx, {
      entidad: "orden", entidadId: row.id, accion: "asignacion",
      resumen: `Asignada al técnico (id: ${row.asignadoA})`,
    });
  }

  // Si la OT se crea con un técnico ya asignado, notificarle (email + Telegram + in-app)
  if (row.asignadoA) {
    try {
      const [u] = await db
        .select({ email: usuarios.email, nombre: usuarios.nombre, telegramChatId: usuarios.telegramChatId })
        .from(usuarios).where(eq(usuarios.id, row.asignadoA)).limit(1);
      const env = (ctx.locals as any)?.runtime?.env ?? {};
      const baseUrl = env.APP_URL || "https://mantenimiento-49c.pages.dev";
      const otUrl = `${baseUrl}/ordenes/${row.id}`;
      const wait = (ctx.locals as any)?.runtime?.ctx?.waitUntil;

      // Resolver ubicación (sucursal + ubicación) si la OT tiene equipo
      let ubicacionTexto: string | null = null;
      if (row.activoId) {
        try {
          const [info] = await db
            .select({ ub: ubicaciones.nombre, suc: sucursales.nombre })
            .from(activos)
            .leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId))
            .leftJoin(sucursales, eq(sucursales.id, ubicaciones.sucursalId))
            .where(eq(activos.id, row.activoId))
            .limit(1);
          ubicacionTexto = [info?.ub, info?.suc].filter(Boolean).join(", ") || null;
        } catch {}
      }

      const primerNombre = (u?.nombre ?? "").split(" ")[0] || u?.nombre || "";
      const venceFormateado = row.vencimiento ? fmtFechaLarga(row.vencimiento) : null;
      const subjectVence = venceFormateado ? ` — vence ${venceFormateado}` : "";

      if (u?.email) {
        const p = sendMail(ctx, {
          to: u.email,
          subject: `[OT #${row.id}] Te asignamos: ${row.titulo}${subjectVence}`,
          html: emailLayout(
            "Nueva orden para ti",
            `<p>Hola <strong>${primerNombre}</strong>,</p>
             <p>Contamos contigo para esta orden. Te dejamos los detalles abajo.</p>
             <h3 style="margin:18px 0 10px 0;color:#0a4082;font-size:16px">Orden #${row.id} — ${row.titulo}</h3>
             <ul style="margin:0 0 14px 0;padding-left:20px;line-height:1.7">
               <li><strong>Tipo:</strong> ${row.tipo}</li>
               <li><strong>Prioridad:</strong> ${row.prioridad}</li>
               ${venceFormateado ? `<li><strong>Vence:</strong> ${venceFormateado}</li>` : ""}
               ${ubicacionTexto ? `<li><strong>Ubicación:</strong> ${ubicacionTexto}</li>` : ""}
             </ul>
             ${row.descripcion ? `<p style="margin:0 0 6px 0"><strong>Lo que reportaron:</strong></p>
               <p style="white-space:pre-wrap;background:#f8fafc;padding:12px;border-left:3px solid #0a4082;border-radius:4px;margin:0 0 18px 0">${row.descripcion}</p>` : ""}
             <p style="margin:18px 0"><a href="${otUrl}" style="display:inline-block;padding:10px 20px;background:#0a4082;color:#fff;border-radius:6px;text-decoration:none;font-weight:500">Abrir orden →</a></p>
             <p style="font-size:13px;color:#475569;margin-top:18px">Si encuentras algo distinto a lo descrito al llegar al sitio, regístralo en la orden antes de iniciar el trabajo. Si necesitas apoyo o materiales adicionales, escríbele directamente a tu jefatura.</p>
             <p style="margin-top:14px"><em>Gracias por mantener Avante funcionando.</em></p>`
          ),
          tipo: "ot_asignada",
          referencia: `orden:${row.id}`,
        }).catch(() => {});
        if (wait) wait(p); else await p;
      }

      if (u?.telegramChatId) {
        const p = sendTelegram(env, u.telegramChatId,
          `🔔 <b>Nueva OT asignada</b>\n#${row.id} - ${row.titulo}\nPrioridad: ${row.prioridad}${row.vencimiento ? `\nVence: ${fmtFechaCompacta(row.vencimiento)}` : ""}`,
          { linkUrl: otUrl, linkLabel: "Abrir orden" }
        );
        if (wait) wait(p); else await p;
      }

      await crearNotificacion(ctx, {
        usuarioId: row.asignadoA, tipo: "ot_asignada",
        titulo: `Nueva OT #${row.id}: ${row.titulo}`,
        mensaje: `Prioridad: ${row.prioridad}${row.vencimiento ? ` · Vence ${fmtFechaLarga(row.vencimiento)}` : ""}`,
        link: `/ordenes/${row.id}`,
      });
    } catch {}
  }

  return Response.json({ orden: row }, { status: 201 });
};
