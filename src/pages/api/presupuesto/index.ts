import type { APIRoute } from "astro";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { presupuestoMantenimiento } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { RUBROS } from "@/lib/rubros";

export const prerender = false;

const schema = z.object({
  anio: z.number().int().min(2020).max(2100),
  presupuestos: z.array(z.object({
    rubro: z.string().refine((r) => r in RUBROS, "Rubro inválido"),
    monto: z.number().min(0),
  })).min(1),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;

  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const { anio, presupuestos } = parsed.data;
  for (const p of presupuestos) {
    const [existente] = await db
      .select()
      .from(presupuestoMantenimiento)
      .where(and(eq(presupuestoMantenimiento.anio, anio), eq(presupuestoMantenimiento.rubro, p.rubro)));
    if (existente) {
      await db.update(presupuestoMantenimiento).set({ monto: p.monto }).where(eq(presupuestoMantenimiento.id, existente.id));
    } else {
      await db.insert(presupuestoMantenimiento).values({ anio, rubro: p.rubro, monto: p.monto });
    }
  }
  return Response.json({ ok: true });
};
