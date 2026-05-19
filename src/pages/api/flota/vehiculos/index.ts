import type { APIRoute } from "astro";
import { z } from "zod";
import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { vehiculos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { generateQrToken, puedeVerFlota, puedeAdministrarFlota } from "@/lib/flota";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerFlota(user.rol)) return new Response("Sin permisos", { status: 403 });
  const db = getDb(ctx);
  const rows = await db.select().from(vehiculos).orderBy(desc(vehiculos.id));
  return Response.json({ vehiculos: rows });
};

const createSchema = z.object({
  codigo: z.string().min(1),
  placa: z.string().min(1),
  marca: z.string().min(1),
  modelo: z.string().min(1),
  anio: z.number().int().nullable().optional(),
  color: z.string().nullable().optional(),
  vin: z.string().nullable().optional(),
  tipo: z.enum(["carro", "pickup", "moto", "camion", "microbus", "otro"]).default("carro"),
  combustible: z.enum(["gasolina", "diesel", "electrico", "hibrido"]).default("gasolina"),
  capacidadTanque: z.number().nullable().optional(),
  kilometrajeActual: z.number().nonnegative().default(0),
  notas: z.string().nullable().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarFlota(user.rol)) return new Response("Sin permisos", { status: 403 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  try {
    const [row] = await db
      .insert(vehiculos)
      .values({ ...parsed.data, qrToken: generateQrToken() })
      .returning();
    return Response.json({ vehiculo: row }, { status: 201 });
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      return Response.json({ error: "Código o placa duplicados" }, { status: 409 });
    }
    throw e;
  }
};
