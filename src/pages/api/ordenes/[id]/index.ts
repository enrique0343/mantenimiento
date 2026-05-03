import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { ordenes, activos, usuarios, comentarios, adjuntos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { transicionesPermitidas, type EstadoOT } from "@/lib/ordenes";

export const prerender = false;

const updateSchema = z.object({
  titulo: z.string().min(1).optional(),
  descripcion: z.string().nullable().optional(),
  tipo: z.enum(["preventivo", "correctivo", "predictivo"]).optional(),
  prioridad: z.enum(["baja", "media", "alta", "urgente"]).optional(),
  estado: z.enum(["abierta", "en_proceso", "completada", "verificada", "cerrada", "cancelada"]).optional(),
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

  const data: Record<string, unknown> = { ...parsed.data };
  const now = new Date().toISOString();

  // Validar transicion de estado segun rol
  if (parsed.data.estado && parsed.data.estado !== actual.estado) {
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
      case "completada":
        data.completadaEn = now;
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
      case "en_proceso":
        // Rollback: limpiar timestamps de fases posteriores
        data.completadaEn = null;
        data.verificadoPor = null;
        data.verificadoEn = null;
        break;
    }
  }

  const [row] = await db.update(ordenes).set(data).where(eq(ordenes.id, id)).returning();
  return Response.json({ orden: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  await db.delete(ordenes).where(eq(ordenes.id, id));
  return Response.json({ ok: true });
};
