import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, asc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tickets, usuarios, sucursales, activos, ticketComentarios } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { calcularVencimientoSla } from "@/lib/tickets";

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

  const [row] = await db.update(tickets).set(data).where(eq(tickets.id, id)).returning();
  return Response.json({ ticket: row });
};
