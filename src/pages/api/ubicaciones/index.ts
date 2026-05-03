import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { ubicaciones } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const db = getDb(ctx);
  const url = new URL(ctx.request.url);
  const sucursalId = url.searchParams.get("sucursal_id");
  const query = db.select().from(ubicaciones);
  const rows = sucursalId
    ? await db.select().from(ubicaciones).where(eq(ubicaciones.sucursalId, Number(sucursalId)))
    : await db.select().from(ubicaciones).orderBy(desc(ubicaciones.id));
  return Response.json({ ubicaciones: rows });
};

const createSchema = z.object({
  sucursalId: z.number().int(),
  nombre: z.string().min(1),
  tipo: z.enum(["edificio", "piso", "area", "sala"]).default("area"),
  padreId: z.number().int().nullable().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = getDb(ctx);
  const [row] = await db.insert(ubicaciones).values(parsed.data).returning();
  return Response.json({ ubicacion: row }, { status: 201 });
};
