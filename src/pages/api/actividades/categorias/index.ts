import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, asc, and, or, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { actividadCategorias } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

import { parseArea, AREA_KEYS } from "@/lib/areas";
export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const areaParam = ctx.url.searchParams.get("area");
  const area = parseArea(areaParam);
  if (areaParam && !area) return Response.json({ error: "Área no válida" }, { status: 400 });
  const db = getDb(ctx);
  const rows = await db.select().from(actividadCategorias).where(and(eq(actividadCategorias.activo, true), area ? or(eq(actividadCategorias.rubro, area), isNull(actividadCategorias.rubro)) : undefined)).orderBy(asc(actividadCategorias.orden));
  return Response.json({ categorias: rows });
};

const schema = z.object({
  rubro: z.enum(AREA_KEYS).optional(),
  nombre: z.string().min(1),
  icono: z.string().nullable().optional(),
  orden: z.number().int().default(0),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const areaParam = ctx.url.searchParams.get("area");
  const area = parseArea(areaParam);
  if (areaParam && !area) return Response.json({ error: "Área no válida" }, { status: 400 });
  const db = getDb(ctx);
  if (area && parsed.data.rubro && area !== parsed.data.rubro) return Response.json({ error: "La categoría corresponde a otra área" }, { status: 400 });
  const [row] = await db.insert(actividadCategorias).values({ ...parsed.data, rubro: area ?? parsed.data.rubro ?? null }).returning();
  return Response.json({ categoria: row }, { status: 201 });
};
