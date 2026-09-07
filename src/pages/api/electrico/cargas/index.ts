import type { APIRoute } from "astro";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { cargasElectricas } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeAdministrarElectrico } from "@/lib/electrico";

export const prerender = false;

const createSchema = z.object({
  subestacionId: z.number().int().positive(),
  nombre: z.string().min(1),
  activoId: z.number().int().positive().nullable().optional(),
  tablero: z.string().nullable().optional(),
  potenciaKw: z.number().positive().nullable().optional(),
  amperaje: z.number().positive().nullable().optional(),
  voltajeCarga: z.number().positive().nullable().optional(),
  fases: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  notas: z.string().nullable().optional(),
}).refine(
  (d) => (d.potenciaKw != null && d.potenciaKw > 0) || (d.amperaje != null && d.voltajeCarga != null),
  { message: "Registra la potencia en kW, o bien amperaje + voltaje para calcularla" },
);

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarElectrico(user.rol)) return new Response("Sin permisos", { status: 403 });

  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const msg = flat.formErrors[0] ?? "Datos inválidos";
    return Response.json({ error: msg, detalle: flat }, { status: 400 });
  }

  const db = getDb(ctx);
  const [row] = await db.insert(cargasElectricas).values(parsed.data).returning();
  return Response.json({ carga: row }, { status: 201 });
};
