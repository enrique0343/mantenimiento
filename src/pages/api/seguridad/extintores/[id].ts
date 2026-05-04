import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { extintores, extintorEventos, sucursales, ubicaciones, usuarios, proveedores } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeVerSeguridad, puedeAdministrarSeguridad } from "@/lib/extintores";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerSeguridad(user.rol)) return new Response("Sin permisos", { status: 403 });
  const id = Number(ctx.params.id);
  const db = getDb(ctx);

  const [r] = await db
    .select({ e: extintores, s: sucursales, u: ubicaciones })
    .from(extintores)
    .leftJoin(sucursales, eq(sucursales.id, extintores.sucursalId))
    .leftJoin(ubicaciones, eq(ubicaciones.id, extintores.ubicacionId))
    .where(eq(extintores.id, id))
    .limit(1);
  if (!r) return Response.json({ error: "No encontrado" }, { status: 404 });

  const eventos = await db
    .select({ ev: extintorEventos, u: usuarios, p: proveedores })
    .from(extintorEventos)
    .leftJoin(usuarios, eq(usuarios.id, extintorEventos.responsableId))
    .leftJoin(proveedores, eq(proveedores.id, extintorEventos.proveedorId))
    .where(eq(extintorEventos.extintorId, id))
    .orderBy(desc(extintorEventos.fecha), desc(extintorEventos.id));

  return Response.json({
    extintor: {
      ...r.e,
      sucursal: r.s ? { id: r.s.id, nombre: r.s.nombre } : null,
      ubicacion: r.u ? { id: r.u.id, nombre: r.u.nombre, tipo: r.u.tipo } : null,
    },
    eventos: eventos.map((x) => ({
      ...x.ev,
      responsable: x.u ? { id: x.u.id, nombre: x.u.nombre } : null,
      proveedor: x.p ? { id: x.p.id, nombre: x.p.nombre } : null,
    })),
  });
};

const updateSchema = z.object({
  codigo: z.string().min(1).optional(),
  numeroSerie: z.string().nullable().optional(),
  marca: z.string().nullable().optional(),
  modelo: z.string().nullable().optional(),
  tipoAgente: z.enum(["pqs", "co2", "agua", "espuma", "k", "d"]).optional(),
  capacidad: z.number().positive().nullable().optional(),
  capacidadUnidad: z.enum(["kg", "lb"]).optional(),
  sucursalId: z.number().int().positive().optional(),
  ubicacionId: z.number().int().nullable().optional(),
  ubicacionDetalle: z.string().nullable().optional(),
  zona: z.string().nullable().optional(),
  fechaFabricacion: z.string().nullable().optional(),
  fechaCompra: z.string().nullable().optional(),
  diasInspeccion: z.number().int().positive().optional(),
  mesesRecarga: z.number().int().positive().optional(),
  aniosPrueba: z.number().int().positive().optional(),
  estado: z.enum(["activo", "mantenimiento", "baja"]).optional(),
  notas: z.string().nullable().optional(),
  activo: z.boolean().optional(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarSeguridad(user.rol)) return new Response("Sin permisos", { status: 403 });
  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const [row] = await db.update(extintores).set(parsed.data).where(eq(extintores.id, id)).returning();
  return Response.json({ extintor: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  // Soft delete
  await db.update(extintores).set({ activo: false, estado: "baja" }).where(eq(extintores.id, id));
  return Response.json({ ok: true });
};
