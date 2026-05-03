import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { mediciones, variablesPredictivas, ordenes, activos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { evaluarMedicion } from "@/lib/predictivo";

export const prerender = false;

const schema = z.object({
  variableId: z.number().int().positive(),
  valor: z.number(),
  fecha: z.string().optional(),
  notas: z.string().nullable().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [v] = await db.select().from(variablesPredictivas).where(eq(variablesPredictivas.id, parsed.data.variableId)).limit(1);
  if (!v) return Response.json({ error: "Variable no existe" }, { status: 404 });

  const estado = evaluarMedicion(parsed.data.valor, v);

  const [med] = await db
    .insert(mediciones)
    .values({
      variableId: parsed.data.variableId,
      valor: parsed.data.valor,
      fecha: parsed.data.fecha ?? new Date().toISOString(),
      estadoAlerta: estado,
      usuarioId: user.id,
      notas: parsed.data.notas ?? null,
    })
    .returning();

  // Si es critico, genera OT predictiva automatica
  let ordenAuto = null;
  if (estado === "critico") {
    const [act] = await db.select().from(activos).where(eq(activos.id, v.activoId)).limit(1);
    const titulo = `[Predictivo] ${v.nombre} fuera de rango - ${act?.codigo ?? `Activo #${v.activoId}`}`;
    const desc = `Medición de ${v.nombre} = ${parsed.data.valor}${v.unidad ? " " + v.unidad : ""} (rango crítico). Revisar.`;
    const [orden] = await db
      .insert(ordenes)
      .values({
        titulo,
        descripcion: desc,
        tipo: "predictivo",
        prioridad: "alta",
        estado: "abierta",
        activoId: v.activoId,
        creadoPor: user.id,
      })
      .returning();
    ordenAuto = orden;
  }

  return Response.json({ medicion: med, ordenAutomatica: ordenAuto }, { status: 201 });
};
