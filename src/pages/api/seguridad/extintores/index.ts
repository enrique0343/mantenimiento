import type { APIRoute } from "astro";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { extintores } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { generateExtintorQrToken, puedeVerSeguridad, puedeAdministrarSeguridad, calcularProximaFecha } from "@/lib/extintores";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerSeguridad(user.rol)) return new Response("Sin permisos", { status: 403 });
  const db = getDb(ctx);
  const rows = await db.select().from(extintores).where(eq(extintores.activo, true)).orderBy(desc(extintores.id));
  return Response.json({ extintores: rows });
};

const createSchema = z.object({
  codigo: z.string().min(1),
  numeroSerie: z.string().nullable().optional(),
  marca: z.string().nullable().optional(),
  modelo: z.string().nullable().optional(),
  tipoAgente: z.enum(["pqs", "co2", "agua", "espuma", "k", "d"]),
  capacidad: z.number().positive().nullable().optional(),
  capacidadUnidad: z.enum(["kg", "lb"]).default("kg"),
  sucursalId: z.number().int().positive(),
  ubicacionId: z.number().int().nullable().optional(),
  ubicacionDetalle: z.string().nullable().optional(),
  zona: z.string().nullable().optional(),
  fechaFabricacion: z.string().nullable().optional(),
  fechaCompra: z.string().nullable().optional(),
  ultimaRecarga: z.string().nullable().optional(),
  ultimaPruebaHidrostatica: z.string().nullable().optional(),
  ultimaInspeccion: z.string().nullable().optional(),
  diasInspeccion: z.number().int().positive().default(30),
  mesesRecarga: z.number().int().positive().default(12),
  aniosPrueba: z.number().int().positive().default(5),
  notas: z.string().nullable().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarSeguridad(user.rol)) return new Response("Sin permisos", { status: 403 });
  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const d = parsed.data;
  const frecuencias = { diasInspeccion: d.diasInspeccion, mesesRecarga: d.mesesRecarga, aniosPrueba: d.aniosPrueba };
  const proximaInspeccion = d.ultimaInspeccion ? calcularProximaFecha("inspeccion", d.ultimaInspeccion, frecuencias) : null;
  const proximaRecarga = d.ultimaRecarga ? calcularProximaFecha("recarga", d.ultimaRecarga, frecuencias) : null;
  const proximaPruebaHidrostatica = d.ultimaPruebaHidrostatica ? calcularProximaFecha("prueba_hidrostatica", d.ultimaPruebaHidrostatica, frecuencias) : null;

  const db = getDb(ctx);
  try {
    const [row] = await db
      .insert(extintores)
      .values({
        ...d,
        proximaInspeccion,
        proximaRecarga,
        proximaPruebaHidrostatica,
        qrToken: generateExtintorQrToken(),
      })
      .returning();
    return Response.json({ extintor: row }, { status: 201 });
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      return Response.json({ error: "Código ya existe" }, { status: 409 });
    }
    throw e;
  }
};
