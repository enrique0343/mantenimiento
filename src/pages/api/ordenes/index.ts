import type { APIRoute } from "astro";
import { z } from "zod";
import { desc, eq, and } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { ordenes, activos, usuarios } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { calcularVencimiento, type Prioridad } from "@/lib/sla";
import { sendMail, emailLayout } from "@/lib/email";
import { sendTelegram } from "@/lib/telegram";
import { crearNotificacion } from "@/lib/notif-app";

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

      if (u?.email) {
        const p = sendMail(ctx, {
          to: u.email,
          subject: `[OT #${row.id}] Nueva orden asignada: ${row.titulo}`,
          html: emailLayout(
            "Nueva orden asignada",
            `<p>Hola <strong>${u.nombre}</strong>,</p>
             <p>Te asignaron la orden <strong>#${row.id} - ${row.titulo}</strong>.</p>
             <p>Tipo: ${row.tipo} · Prioridad: ${row.prioridad}${row.vencimiento ? ` · Vence: ${new Date(row.vencimiento).toLocaleString("es")}` : ""}</p>
             ${row.descripcion ? `<p style="white-space:pre-wrap">${row.descripcion}</p>` : ""}
             <p><a href="${otUrl}">Abrir orden →</a></p>`
          ),
          tipo: "ot_asignada",
          referencia: `orden:${row.id}`,
        }).catch(() => {});
        if (wait) wait(p); else await p;
      }

      if (u?.telegramChatId) {
        const p = sendTelegram(env, u.telegramChatId,
          `🔔 <b>Nueva OT asignada</b>\n#${row.id} - ${row.titulo}\nPrioridad: ${row.prioridad}${row.vencimiento ? `\nVence: ${new Date(row.vencimiento).toLocaleString("es")}` : ""}`,
          { linkUrl: otUrl, linkLabel: "Abrir orden" }
        );
        if (wait) wait(p); else await p;
      }

      await crearNotificacion(ctx, {
        usuarioId: row.asignadoA, tipo: "ot_asignada",
        titulo: `Nueva OT #${row.id}: ${row.titulo}`,
        mensaje: `Prioridad: ${row.prioridad}${row.vencimiento ? ` · Vence ${new Date(row.vencimiento).toLocaleDateString("es")}` : ""}`,
        link: `/ordenes/${row.id}`,
      });
    } catch {}
  }

  return Response.json({ orden: row }, { status: 201 });
};
