import type { APIRoute } from "astro";
import { z } from "zod";
import { desc, eq, like, and, inArray, lte, gte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contratosMantenimiento, contratoEquipos, proveedores, usuarios, activos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeGestionarContratos, puedeVerContratos } from "@/lib/contratos";
import { logAudit } from "@/lib/audit";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerContratos(user.rol)) return Response.json({ error: "Sin permisos" }, { status: 403 });

  const db = getDb(ctx);
  const url = new URL(ctx.request.url);
  const filtroEstado = url.searchParams.get("estado");
  const filtroProveedor = url.searchParams.get("proveedorId");
  const filtroEquipo = url.searchParams.get("equipoId");
  const proximos = url.searchParams.get("proximos");

  const conds: any[] = [];
  if (filtroEstado) conds.push(eq(contratosMantenimiento.estado, filtroEstado));
  if (filtroProveedor) conds.push(eq(contratosMantenimiento.proveedorId, Number(filtroProveedor)));
  if (proximos) {
    const dias = Number(proximos) || 90;
    const limite = new Date(Date.now() + dias * 86400_000).toISOString().slice(0, 10);
    conds.push(lte(contratosMantenimiento.fechaFin, limite));
    conds.push(inArray(contratosMantenimiento.estado, ["vigente", "por_vencer"]));
  }
  if (filtroEquipo) {
    const ids = await db.select({ cid: contratoEquipos.contratoId }).from(contratoEquipos)
      .where(eq(contratoEquipos.activoId, Number(filtroEquipo)));
    const arr = ids.map((r) => r.cid);
    if (arr.length === 0) return Response.json({ contratos: [] });
    conds.push(inArray(contratosMantenimiento.id, arr));
  }

  const rows = await db
    .select({ c: contratosMantenimiento, prov: proveedores, resp: usuarios })
    .from(contratosMantenimiento)
    .leftJoin(proveedores, eq(proveedores.id, contratosMantenimiento.proveedorId))
    .leftJoin(usuarios, eq(usuarios.id, contratosMantenimiento.responsableId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(contratosMantenimiento.id));

  // Conteo de equipos por contrato
  const idsContratos = rows.map((r) => r.c.id);
  const conteoEquipos = new Map<number, number>();
  if (idsContratos.length > 0) {
    const grupos = await db
      .select({ cid: contratoEquipos.contratoId, n: sql<number>`count(*)` })
      .from(contratoEquipos)
      .where(inArray(contratoEquipos.contratoId, idsContratos))
      .groupBy(contratoEquipos.contratoId);
    for (const g of grupos) conteoEquipos.set(g.cid, Number(g.n));
  }

  return Response.json({
    contratos: rows.map((r) => ({
      ...r.c,
      proveedorNombre: r.prov?.nombre ?? null,
      responsableNombre: r.resp?.nombre ?? null,
      cantidadEquipos: conteoEquipos.get(r.c.id) ?? 0,
    })),
  });
};

const createSchema = z.object({
  nombre: z.string().min(1),
  descripcion: z.string().nullable().optional(),
  proveedorId: z.number().int().positive(),
  tipo: z.enum(["preventivo", "correctivo", "integral", "garantia"]).optional(),
  alcance: z.string().nullable().optional(),
  fechaInicio: z.string().min(1),
  fechaFin: z.string().min(1),
  costo: z.number().min(0).optional(),
  periodicidadCosto: z.enum(["mensual", "trimestral", "semestral", "anual", "unico"]).optional(),
  numeroContratoExterno: z.string().nullable().optional(),
  contactoProveedor: z.string().nullable().optional(),
  telefonoContacto: z.string().nullable().optional(),
  emailContacto: z.string().nullable().optional(),
  responsableId: z.number().int().positive().nullable().optional(),
  notas: z.string().nullable().optional(),
  equipoIds: z.array(z.number().int().positive()).min(1, "Vincula al menos un equipo"),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeGestionarContratos(user.rol)) return Response.json({ error: "Sin permisos" }, { status: 403 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  if (parsed.data.fechaFin <= parsed.data.fechaInicio) {
    return Response.json({ error: "La fecha fin debe ser posterior al inicio" }, { status: 400 });
  }

  const db = getDb(ctx);

  // Auto-generar código CTR-XXXX
  const ultimos = await db.select({ codigo: contratosMantenimiento.codigo })
    .from(contratosMantenimiento).where(like(contratosMantenimiento.codigo, "CTR-%"));
  let max = 0;
  for (const { codigo } of ultimos) {
    const m = codigo.match(/^CTR-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const codigo = `CTR-${String(max + 1).padStart(4, "0")}`;

  const { equipoIds, ...data } = parsed.data;

  const [contrato] = await db.insert(contratosMantenimiento).values({
    ...data,
    codigo,
    creadoPor: user.id,
  } as any).returning();

  // Vincular equipos
  await db.insert(contratoEquipos).values(
    equipoIds.map((aid) => ({ contratoId: contrato.id, activoId: aid }))
  );

  await logAudit(ctx, {
    entidad: "contrato", entidadId: contrato.id, accion: "create",
    resumen: `Contrato creado: ${contrato.codigo} — ${contrato.nombre}`,
  });

  return Response.json({ contrato }, { status: 201 });
};
