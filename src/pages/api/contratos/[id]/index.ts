import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, asc, and, inArray, desc } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import {
  contratosMantenimiento, contratoEquipos, contratoAdjuntos, contratoComentarios,
  proveedores, usuarios, activos,
} from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeGestionarContratos, puedeVerContratos } from "@/lib/contratos";
import { logAudit, calcularDiff } from "@/lib/audit";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerContratos(user.rol)) return Response.json({ error: "Sin permisos" }, { status: 403 });

  const id = Number(ctx.params.id);
  const db = getDb(ctx);

  const [row] = await db
    .select({
      c: contratosMantenimiento, prov: proveedores, resp: usuarios,
    })
    .from(contratosMantenimiento)
    .leftJoin(proveedores, eq(proveedores.id, contratosMantenimiento.proveedorId))
    .leftJoin(usuarios, eq(usuarios.id, contratosMantenimiento.responsableId))
    .where(eq(contratosMantenimiento.id, id))
    .limit(1);
  if (!row) return Response.json({ error: "No encontrado" }, { status: 404 });

  const equiposRows = await db
    .select({ a: activos })
    .from(contratoEquipos)
    .innerJoin(activos, eq(activos.id, contratoEquipos.activoId))
    .where(eq(contratoEquipos.contratoId, id))
    .orderBy(asc(activos.nombre));

  const adjs = await db.select().from(contratoAdjuntos).where(eq(contratoAdjuntos.contratoId, id));

  const coms = await db
    .select({ c: contratoComentarios, u: usuarios })
    .from(contratoComentarios)
    .leftJoin(usuarios, eq(usuarios.id, contratoComentarios.usuarioId))
    .where(eq(contratoComentarios.contratoId, id))
    .orderBy(asc(contratoComentarios.id));

  // Historial de renovaciones (encadenado)
  const historial: any[] = [];
  let cursor = row.c.renovacionDeId;
  while (cursor) {
    const [prev] = await db.select({
      id: contratosMantenimiento.id, codigo: contratosMantenimiento.codigo,
      nombre: contratosMantenimiento.nombre, fechaInicio: contratosMantenimiento.fechaInicio,
      fechaFin: contratosMantenimiento.fechaFin, estado: contratosMantenimiento.estado,
      renovacionDeId: contratosMantenimiento.renovacionDeId,
    }).from(contratosMantenimiento).where(eq(contratosMantenimiento.id, cursor)).limit(1);
    if (!prev) break;
    historial.push(prev);
    cursor = prev.renovacionDeId;
  }

  // Renovación posterior (si la hubo)
  const [renovacion] = await db.select({
    id: contratosMantenimiento.id, codigo: contratosMantenimiento.codigo,
    nombre: contratosMantenimiento.nombre, estado: contratosMantenimiento.estado,
  }).from(contratosMantenimiento).where(eq(contratosMantenimiento.renovacionDeId, id)).limit(1);

  return Response.json({
    contrato: {
      ...row.c,
      proveedor: row.prov ? { id: row.prov.id, nombre: row.prov.nombre, telefono: row.prov.telefono, email: row.prov.email } : null,
      responsable: row.resp ? { id: row.resp.id, nombre: row.resp.nombre } : null,
    },
    equipos: equiposRows.map((r) => ({ id: r.a.id, codigo: r.a.codigo, nombre: r.a.nombre })),
    adjuntos: adjs,
    comentarios: coms.map((c) => ({ ...c.c, autor: c.u ? { id: c.u.id, nombre: c.u.nombre } : null })),
    historial,
    renovacion: renovacion ?? null,
  });
};

const patchSchema = z.object({
  nombre: z.string().min(1).optional(),
  descripcion: z.string().nullable().optional(),
  proveedorId: z.number().int().positive().optional(),
  tipo: z.enum(["preventivo", "correctivo", "integral", "garantia"]).optional(),
  alcance: z.string().nullable().optional(),
  fechaInicio: z.string().min(1).optional(),
  fechaFin: z.string().min(1).optional(),
  costo: z.number().min(0).optional(),
  periodicidadCosto: z.enum(["mensual", "trimestral", "semestral", "anual", "unico"]).optional(),
  numeroContratoExterno: z.string().nullable().optional(),
  contactoProveedor: z.string().nullable().optional(),
  telefonoContacto: z.string().nullable().optional(),
  emailContacto: z.string().nullable().optional(),
  responsableId: z.number().int().positive().nullable().optional(),
  notas: z.string().nullable().optional(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeGestionarContratos(user.rol)) return Response.json({ error: "Sin permisos" }, { status: 403 });

  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [actual] = await db.select().from(contratosMantenimiento).where(eq(contratosMantenimiento.id, id)).limit(1);
  if (!actual) return Response.json({ error: "No encontrado" }, { status: 404 });

  const data: Record<string, unknown> = { ...parsed.data, updatedAt: new Date().toISOString() };

  // Si cambian las fechas, resetear flags de alertas para que se vuelvan a enviar
  if (parsed.data.fechaFin && parsed.data.fechaFin !== actual.fechaFin) {
    data.alerta90dEnviadaEn = null;
    data.alerta60dEnviadaEn = null;
    data.alerta30dEnviadaEn = null;
  }

  const [row] = await db.update(contratosMantenimiento).set(data).where(eq(contratosMantenimiento.id, id)).returning();

  const camposAudit = ["nombre", "descripcion", "proveedorId", "tipo", "fechaInicio", "fechaFin", "costo", "responsableId"];
  const diff = calcularDiff(actual as any, parsed.data as any, camposAudit);
  if (Object.keys(diff).length > 0) {
    await logAudit(ctx, { entidad: "contrato", entidadId: id, accion: "update", cambios: diff });
  }

  return Response.json({ contrato: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);

  const [actual] = await db.select().from(contratosMantenimiento).where(eq(contratosMantenimiento.id, id)).limit(1);
  if (!actual) return Response.json({ error: "No encontrado" }, { status: 404 });

  // No permitir borrar si hay renovaciones encadenadas hacia adelante
  const [siguiente] = await db.select({ id: contratosMantenimiento.id })
    .from(contratosMantenimiento).where(eq(contratosMantenimiento.renovacionDeId, id)).limit(1);
  if (siguiente) {
    return Response.json({
      error: "Este contrato tiene una renovación posterior. Borra primero la renovación.",
    }, { status: 400 });
  }

  // Borrar adjuntos de R2
  const adjs = await db.select().from(contratoAdjuntos).where(eq(contratoAdjuntos.contratoId, id));
  if (adjs.length) {
    const env = getEnv(ctx);
    await Promise.allSettled(adjs.map((a) => env.R2.delete(a.r2Key)));
  }

  await db.delete(contratosMantenimiento).where(eq(contratosMantenimiento.id, id));
  await logAudit(ctx, {
    entidad: "contrato", entidadId: id, accion: "delete",
    resumen: `Contrato eliminado: ${actual.codigo} — ${actual.nombre}`,
  });
  return Response.json({ ok: true });
};
