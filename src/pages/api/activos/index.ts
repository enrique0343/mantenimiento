import type { APIRoute } from "astro";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { activos, planesMantenimiento } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { desc } from "drizzle-orm";
import { siguienteFecha, type Frecuencia } from "@/lib/frecuencias";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const db = getDb(ctx);
  const rows = await db.select().from(activos).orderBy(desc(activos.id));
  return Response.json({ activos: rows });
};

const baseSchema = {
  codigo: z.string().min(1),
  nombre: z.string().min(1),
  descripcion: z.string().nullable().optional(),
  ubicacion: z.string().nullable().optional(),
  estado: z.enum(["operativo", "averiado", "mantenimiento", "baja"]).optional(),
  tipo: z.enum(["general", "biomedico"]).optional(),
  categoria: z.string().nullable().optional(),
  numeroActivo: z.string().nullable().optional(),
  marca: z.string().nullable().optional(),
  modelo: z.string().nullable().optional(),
  serial: z.string().nullable().optional(),
  anio: z.number().int().nullable().optional(),
  registroSanitario: z.string().nullable().optional(),
  claseRiesgo: z.enum(["I", "IIa", "IIb", "III"]).nullable().optional(),
  ultimaCalibracion: z.string().nullable().optional(),
  proximaCalibracion: z.string().nullable().optional(),
  ubicacionId: z.number().int().nullable().optional(),
  proveedorId: z.number().int().nullable().optional(),
  slaUrgenteHoras: z.number().int().nonnegative().optional(),
  slaAltaHoras: z.number().int().nonnegative().optional(),
  slaMediaHoras: z.number().int().nonnegative().optional(),
  slaBajaHoras: z.number().int().nonnegative().optional(),
};

const createSchema = z.object({
  ...baseSchema,
  // Configuración opcional de mantenimiento preventivo automático
  mantenimientoFrecuencia: z.enum(["diaria", "semanal", "quincenal", "mensual", "bimestral", "trimestral", "semestral", "anual"]).optional().nullable(),
  mantenimientoProximaFecha: z.string().optional().nullable(),
  mantenimientoTitulo: z.string().optional().nullable(),
  mantenimientoPrioridad: z.enum(["baja", "media", "alta", "urgente"]).optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "tecnico"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const { mantenimientoFrecuencia, mantenimientoProximaFecha, mantenimientoTitulo, mantenimientoPrioridad, ...activoData } = parsed.data;
  const data = { ...activoData, qrCode: `QR-${activoData.codigo}` };
  try {
    const [row] = await db.insert(activos).values(data).returning();

    // Si se configuró mantenimiento preventivo automático, crea el plan
    if (mantenimientoFrecuencia) {
      const proxima = mantenimientoProximaFecha ?? siguienteFecha(new Date(), mantenimientoFrecuencia as Frecuencia);
      await db.insert(planesMantenimiento).values({
        activoId: row.id,
        titulo: mantenimientoTitulo ?? `Mantenimiento preventivo ${mantenimientoFrecuencia}`,
        frecuencia: mantenimientoFrecuencia as any,
        proximaFecha: proxima,
        prioridad: (mantenimientoPrioridad ?? "media") as any,
      });
    }

    return Response.json({ activo: row }, { status: 201 });
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      return Response.json({ error: "Codigo o QR ya existe" }, { status: 409 });
    }
    throw e;
  }
};
