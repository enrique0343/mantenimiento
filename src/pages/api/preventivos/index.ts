import type { APIRoute } from "astro";
import { getDb } from "@/lib/db";
import { requireUserJson } from "@/lib/auth";
import { datosTablero, espacioDelPedido, leerFiltros, ROLES_TABLERO_VER } from "@/lib/preventivos";

export const prerender = false;

// GET /api/preventivos?desde&hasta&sede&area&q&empresa — el tablero del espacio del
// usuario (General o Biomédico): jefatura y visualizador (este, solo para ver).
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUserJson(ctx, [...ROLES_TABLERO_VER]);
  if (!user) return response;
  const espacio = espacioDelPedido(ctx, user);
  const { filtros, error } = leerFiltros(ctx.url.searchParams, undefined, espacio);
  if (error) return Response.json({ error }, { status: 400 });
  return Response.json(await datosTablero(getDb(ctx), filtros));
};
