import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, asc, desc, and } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import {
  proyectos, proyectoPresupuestoItems, proyectoHitos, proyectoAdjuntos,
  proyectoComentarios, usuarios, sucursales, ubicaciones, activos, tickets,
  ordenes, proveedores,
} from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { calcularResumenProyecto, puedeEditarProyecto } from "@/lib/proyectos";
import { logAudit, calcularDiff } from "@/lib/audit";
import { disparadorProyecto } from "@/lib/notificaciones";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);

  const [row] = await db
    .select({
      p: proyectos,
      creador: usuarios,
      sucursal: sucursales,
      ubicacion: ubicaciones,
      activo: activos,
      ticket: tickets,
    })
    .from(proyectos)
    .leftJoin(usuarios, eq(usuarios.id, proyectos.creadoPor))
    .leftJoin(sucursales, eq(sucursales.id, proyectos.sucursalId))
    .leftJoin(ubicaciones, eq(ubicaciones.id, proyectos.ubicacionId))
    .leftJoin(activos, eq(activos.id, proyectos.activoId))
    .leftJoin(tickets, eq(tickets.id, proyectos.ticketId))
    .where(eq(proyectos.id, id))
    .limit(1);
  if (!row) return Response.json({ error: "No encontrado" }, { status: 404 });

  // Técnicos: solo si son responsables o tienen una OT hija asignada
  if (user.rol === "tecnico" && row.p.responsableId !== user.id) {
    const [mineOt] = await db.select({ id: ordenes.id }).from(ordenes)
      .where(and(eq(ordenes.proyectoId, id), eq(ordenes.asignadoA, user.id))).limit(1);
    if (!mineOt) return Response.json({ error: "Sin acceso" }, { status: 403 });
  }

  const items = await db
    .select({ i: proyectoPresupuestoItems, prov: proveedores })
    .from(proyectoPresupuestoItems)
    .leftJoin(proveedores, eq(proveedores.id, proyectoPresupuestoItems.proveedorId))
    .where(eq(proyectoPresupuestoItems.proyectoId, id))
    .orderBy(asc(proyectoPresupuestoItems.orden), asc(proyectoPresupuestoItems.id));

  const hitos = await db.select().from(proyectoHitos)
    .where(eq(proyectoHitos.proyectoId, id))
    .orderBy(asc(proyectoHitos.orden), asc(proyectoHitos.id));

  const adjs = await db.select().from(proyectoAdjuntos).where(eq(proyectoAdjuntos.proyectoId, id));

  const coms = await db
    .select({ c: proyectoComentarios, u: usuarios })
    .from(proyectoComentarios)
    .leftJoin(usuarios, eq(usuarios.id, proyectoComentarios.usuarioId))
    .where(eq(proyectoComentarios.proyectoId, id))
    .orderBy(asc(proyectoComentarios.id));

  const ots = await db
    .select({ o: ordenes, u: usuarios })
    .from(ordenes)
    .leftJoin(usuarios, eq(usuarios.id, ordenes.asignadoA))
    .where(eq(ordenes.proyectoId, id))
    .orderBy(desc(ordenes.id));

  const resumen = await calcularResumenProyecto(ctx, id);

  return Response.json({
    proyecto: {
      ...row.p,
      creador: row.creador ? { id: row.creador.id, nombre: row.creador.nombre, email: row.creador.email } : null,
      sucursal: row.sucursal ? { id: row.sucursal.id, nombre: row.sucursal.nombre } : null,
      ubicacion: row.ubicacion ? { id: row.ubicacion.id, nombre: row.ubicacion.nombre } : null,
      activo: row.activo ? { id: row.activo.id, codigo: row.activo.codigo, nombre: row.activo.nombre } : null,
      ticket: row.ticket ? { id: row.ticket.id, asunto: row.ticket.asunto, trackingToken: row.ticket.trackingToken } : null,
    },
    items: items.map((it) => ({
      ...it.i,
      proveedorNombre: it.prov?.nombre ?? null,
    })),
    hitos,
    adjuntos: adjs,
    comentarios: coms.map((c) => ({
      ...c.c,
      autor: c.u ? { id: c.u.id, nombre: c.u.nombre } : null,
    })),
    ots: ots.map((r) => ({
      ...r.o,
      asignado: r.u ? { id: r.u.id, nombre: r.u.nombre } : null,
    })),
    resumen,
  });
};

const patchSchema = z.object({
  titulo: z.string().min(1).optional(),
  descripcion: z.string().nullable().optional(),
  prioridad: z.enum(["baja", "media", "alta", "urgente"]).optional(),
  estado: z.enum(["evaluacion","aprobado","rechazado","en_ejecucion","en_pausa","completado","cancelado"]).optional(),
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
  fechaInicioReal: z.string().nullable().optional(),
  fechaFinReal: z.string().nullable().optional(),
  presupuestoEstimado: z.number().nullable().optional(),
  avanceManual: z.number().int().min(0).max(100).nullable().optional(),
  responsableId: z.number().int().positive().nullable().optional(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [actual] = await db.select().from(proyectos).where(eq(proyectos.id, id)).limit(1);
  if (!actual) return Response.json({ error: "No encontrado" }, { status: 404 });
  if (!puedeEditarProyecto(user.rol, actual, user.id)) {
    return Response.json({ error: "Sin permisos para editar este proyecto" }, { status: 403 });
  }

  const now = new Date().toISOString();
  const data: Record<string, unknown> = { ...parsed.data };

  // Transiciones de estado con sus efectos
  if (parsed.data.estado && parsed.data.estado !== actual.estado) {
    if (parsed.data.estado === "en_ejecucion" && !actual.fechaInicioReal) {
      data.fechaInicioReal = now;
    }
    if (parsed.data.estado === "completado") {
      if (!actual.fechaFinReal) data.fechaFinReal = now;
      data.cerradoPor = user.id;
      data.cerradoEn = now;
    }
  }

  const [row] = await db.update(proyectos).set(data).where(eq(proyectos.id, id)).returning();

  // Audit
  if (parsed.data.estado && parsed.data.estado !== actual.estado) {
    await logAudit(ctx, {
      entidad: "proyecto", entidadId: id, accion: "estado",
      resumen: `Estado: ${actual.estado} → ${parsed.data.estado}`,
      cambios: { estado: { antes: actual.estado, despues: parsed.data.estado } },
    });
  }
  const otrosCampos = ["titulo", "descripcion", "prioridad", "presupuestoEstimado", "responsableId"];
  const diff = calcularDiff(actual as any, parsed.data as any, otrosCampos);
  if (Object.keys(diff).length > 0) {
    await logAudit(ctx, { entidad: "proyecto", entidadId: id, accion: "update", cambios: diff });
  }

  if (parsed.data.estado && parsed.data.estado !== actual.estado) {
    await disparadorProyecto(ctx, row as any, actual.estado, parsed.data.estado).catch((e) => console.error("dispatch proyecto:", e));
  }

  return Response.json({ proyecto: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  const [actual] = await db.select().from(proyectos).where(eq(proyectos.id, id)).limit(1);
  if (!actual) return Response.json({ error: "No encontrado" }, { status: 404 });

  // Borrar adjuntos de R2
  const adjs = await db.select().from(proyectoAdjuntos).where(eq(proyectoAdjuntos.proyectoId, id));
  if (adjs.length) {
    const env = getEnv(ctx);
    await Promise.allSettled(adjs.map((a) => env.R2.delete(a.r2Key)));
  }

  await db.delete(proyectos).where(eq(proyectos.id, id));
  await logAudit(ctx, { entidad: "proyecto", entidadId: id, accion: "delete", resumen: `Proyecto eliminado: ${actual.codigo}` });
  return Response.json({ ok: true });
};
