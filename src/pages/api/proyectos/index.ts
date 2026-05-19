import type { APIRoute } from "astro";
import { z } from "zod";
import { desc, eq, like, or, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { proyectos, usuarios, tickets, ordenes } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeCrearProyecto } from "@/lib/proyectos";
import { logAudit } from "@/lib/audit";
import { notificarProyectoCreado } from "@/lib/notificaciones";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const db = getDb(ctx);

  // Técnicos: solo proyectos donde son responsables o tienen OT hija asignada
  let where: any = undefined;
  if (user.rol === "tecnico") {
    const idsOts = await db.select({ pid: ordenes.proyectoId }).from(ordenes).where(eq(ordenes.asignadoA, user.id));
    const proyectoIds = Array.from(new Set(idsOts.map((r) => r.pid).filter((v): v is number => v != null)));
    where = proyectoIds.length > 0
      ? or(eq(proyectos.responsableId, user.id), inArray(proyectos.id, proyectoIds))
      : eq(proyectos.responsableId, user.id);
  }

  const rows = await db
    .select({ p: proyectos, creador: usuarios })
    .from(proyectos)
    .leftJoin(usuarios, eq(usuarios.id, proyectos.creadoPor))
    .where(where)
    .orderBy(desc(proyectos.id));
  return Response.json({
    proyectos: rows.map((r) => ({
      ...r.p,
      creadorNombre: r.creador?.nombre ?? null,
    })),
  });
};

const createSchema = z.object({
  titulo: z.string().min(1),
  descripcion: z.string().nullable().optional(),
  prioridad: z.enum(["baja", "media", "alta", "urgente"]).optional(),
  ticketId: z.number().int().positive().nullable().optional(),
  sucursalId: z.number().int().positive().nullable().optional(),
  ubicacionId: z.number().int().positive().nullable().optional(),
  ubicacionDetalle: z.string().nullable().optional(),
  activoId: z.number().int().positive().nullable().optional(),
  justificacion: z.string().nullable().optional(),
  alcance: z.string().nullable().optional(),
  factibilidad: z.string().nullable().optional(),
  viabilidad: z.string().nullable().optional(),
  beneficiosEsperados: z.string().nullable().optional(),
  riesgos: z.string().nullable().optional(),
  fechaInicioEstimada: z.string().nullable().optional(),
  fechaFinEstimada: z.string().nullable().optional(),
  presupuestoEstimado: z.number().nullable().optional(),
  responsableId: z.number().int().positive().nullable().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeCrearProyecto(user.rol)) return Response.json({ error: "Sin permisos" }, { status: 403 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);

  // Auto-generar código PRY-XXXX
  const ultimos = await db.select({ codigo: proyectos.codigo }).from(proyectos).where(like(proyectos.codigo, "PRY-%"));
  let max = 0;
  for (const { codigo } of ultimos) {
    const m = codigo.match(/^PRY-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const codigo = `PRY-${String(max + 1).padStart(4, "0")}`;

  const [proyecto] = await db.insert(proyectos).values({
    ...parsed.data,
    codigo,
    creadoPor: user.id,
  } as any).returning();

  // Si viene de un ticket, vincula y marca el ticket como en_proceso
  if (parsed.data.ticketId) {
    try {
      await db.update(tickets).set({
        proyectoId: proyecto.id,
        estado: "en_proceso",
        updatedAt: new Date().toISOString(),
      }).where(eq(tickets.id, parsed.data.ticketId));
    } catch {}
  }

  await logAudit(ctx, {
    entidad: "proyecto", entidadId: proyecto.id, accion: "create",
    resumen: `Proyecto creado: ${proyecto.codigo} — ${proyecto.titulo}`,
  });

  await notificarProyectoCreado(ctx, proyecto as any).catch((e) => console.error("notif proyecto creado:", e));

  return Response.json({ proyecto }, { status: 201 });
};
