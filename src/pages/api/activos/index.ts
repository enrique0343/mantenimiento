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

const createSchema = z.object({
  codigo: z.string().min(1),
  nombre: z.string().min(1),
  descripcion: z.string().optional().nullable(),
  ubicacion: z.string().optional().nullable(),
  estado: z.enum(["operativo", "averiado", "mantenimiento", "baja"]).optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "tecnico"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  try {
    const [row] = await db.insert(activos).values(parsed.data).returning();
    return Response.json({ activo: row }, { status: 201 });
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      return Response.json({ error: "Codigo ya existe" }, { status: 409 });
    }
    throw e;
  }
};
