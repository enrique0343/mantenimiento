// Modo técnico · mantenimiento que no estaba en la lista de trabajo.
import type { APIRoute } from "astro";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { crearOrdenEnCampo, ordenCampoPorId, puedeUsarCampo, RechazoCampo } from "@/lib/campo";

export const prerender = false;

const esquema = z.object({
  activoId: z.number().int().positive(),
  planId: z.number().int().positive().nullable().optional(),
  tipo: z.enum(["preventivo", "correctivo"]).optional(),
  descripcion: z.string().max(1000).nullable().optional(),
  plantillaId: z.number().int().positive().nullable().optional(),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeUsarCampo(user.rol)) return new Response("Sin permisos", { status: 403 });
  const parsed = esquema.safeParse(await ctx.request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Datos inválidos" }, { status: 400 });
  const db = getDb(ctx);
  try {
    const r = await crearOrdenEnCampo(ctx, db, user, parsed.data);
    return Response.json({ ...r, orden: await ordenCampoPorId(db, r.ordenId, user) }, { status: r.yaExistia ? 200 : 201 });
  } catch (e) {
    if (e instanceof RechazoCampo) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
};

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeUsarCampo(user.rol)) return new Response("Sin permisos", { status: 403 });
  const id = Number(ctx.url.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Orden inválida" }, { status: 400 });
  const orden = await ordenCampoPorId(getDb(ctx), id, user);
  if (!orden) return Response.json({ error: "Esa orden no está disponible" }, { status: 404 });
  return Response.json({ orden });
};
