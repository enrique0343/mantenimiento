import type { APIRoute } from "astro";
import { getDb } from "@/lib/db";
import { requireUserJson } from "@/lib/auth";
import { datosTablero, leerFiltros, ROLES_TABLERO } from "@/lib/preventivos";

export const prerender = false;

// GET /api/preventivos?desde&hasta&sede&area&q — el tablero de preventivos (admin y jefe).
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUserJson(ctx, [...ROLES_TABLERO]);
  if (!user) return response;
  const { filtros, error } = leerFiltros(ctx.url.searchParams);
  if (error) return Response.json({ error }, { status: 400 });
  return Response.json(await datosTablero(getDb(ctx), filtros));
};
