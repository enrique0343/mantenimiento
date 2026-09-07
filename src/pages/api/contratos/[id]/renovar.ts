import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, like } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contratosMantenimiento, contratoEquipos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeGestionarContratos } from "@/lib/contratos";
import { logAudit } from "@/lib/audit";

export const prerender = false;

const schema = z.object({
  fechaInicio: z.string().min(1),
  fechaFin: z.string().min(1),
  costo: z.number().min(0).optional(),
  notasRenovacion: z.string().nullable().optional(),
  copiarEquipos: z.boolean().optional().default(true),
  // Campos opcionales que el usuario puede ajustar al renovar
  nombre: z.string().min(1).optional(),
  alcance: z.string().nullable().optional(),
  periodicidadCosto: z.enum(["mensual", "trimestral", "semestral", "anual", "unico"]).optional(),
  numeroContratoExterno: z.string().nullable().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeGestionarContratos(user.rol)) return Response.json({ error: "Sin permisos" }, { status: 403 });

  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  if (parsed.data.fechaFin <= parsed.data.fechaInicio) {
    return Response.json({ error: "La fecha fin debe ser posterior al inicio" }, { status: 400 });
  }

  const db = getDb(ctx);
  const [original] = await db.select().from(contratosMantenimiento).where(eq(contratosMantenimiento.id, id)).limit(1);
  if (!original) return Response.json({ error: "No encontrado" }, { status: 404 });

  if (!["vigente", "por_vencer"].includes(original.estado)) {
    return Response.json({ error: `No se puede renovar un contrato en estado '${original.estado}'` }, { status: 400 });
  }

  // Generar código nuevo CTR-XXXX
  const ultimos = await db.select({ codigo: contratosMantenimiento.codigo })
    .from(contratosMantenimiento).where(like(contratosMantenimiento.codigo, "CTR-%"));
  let max = 0;
  for (const { codigo } of ultimos) {
    const m = codigo.match(/^CTR-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const codigo = `CTR-${String(max + 1).padStart(4, "0")}`;

  // Crear contrato nuevo heredando los datos del original
  const [nuevo] = await db.insert(contratosMantenimiento).values({
    codigo,
    nombre: parsed.data.nombre ?? original.nombre,
    descripcion: original.descripcion,
    proveedorId: original.proveedorId,
    tipo: original.tipo,
    alcance: parsed.data.alcance ?? original.alcance,
    fechaInicio: parsed.data.fechaInicio,
    fechaFin: parsed.data.fechaFin,
    costo: parsed.data.costo ?? original.costo,
    periodicidadCosto: parsed.data.periodicidadCosto ?? original.periodicidadCosto,
    numeroContratoExterno: parsed.data.numeroContratoExterno ?? original.numeroContratoExterno,
    contactoProveedor: original.contactoProveedor,
    telefonoContacto: original.telefonoContacto,
    emailContacto: original.emailContacto,
    responsableId: original.responsableId,
    estado: "vigente",
    renovacionDeId: original.id,
    notasRenovacion: parsed.data.notasRenovacion ?? null,
    creadoPor: user.id,
  } as any).returning();

  // Copiar equipos del original
  if (parsed.data.copiarEquipos !== false) {
    const equipos = await db.select({ aid: contratoEquipos.activoId }).from(contratoEquipos)
      .where(eq(contratoEquipos.contratoId, original.id));
    if (equipos.length > 0) {
      await db.insert(contratoEquipos).values(
        equipos.map((e) => ({ contratoId: nuevo.id, activoId: e.aid }))
      );
    }
  }

  // Marcar el contrato anterior como 'renovado'
  await db.update(contratosMantenimiento).set({
    estado: "renovado",
    updatedAt: new Date().toISOString(),
  }).where(eq(contratosMantenimiento.id, original.id));

  await logAudit(ctx, {
    entidad: "contrato", entidadId: nuevo.id, accion: "create",
    resumen: `Contrato renovado a partir de ${original.codigo}`,
  });
  await logAudit(ctx, {
    entidad: "contrato", entidadId: original.id, accion: "estado",
    resumen: `Estado: ${original.estado} → renovado (renovado por ${codigo})`,
    cambios: { estado: { antes: original.estado, despues: "renovado" } },
  });

  return Response.json({ contrato: nuevo }, { status: 201 });
};
