import type { APIRoute } from "astro";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { activos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { desc } from "drizzle-orm";

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
};

const createSchema = z.object(baseSchema);

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "tecnico"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const data = { ...parsed.data, qrCode: `QR-${parsed.data.codigo}` };
  try {
    const [row] = await db.insert(activos).values(data).returning();
    return Response.json({ activo: row }, { status: 201 });
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      return Response.json({ error: "Codigo o QR ya existe" }, { status: 409 });
    }
    throw e;
  }
};
