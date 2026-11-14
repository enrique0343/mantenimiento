// Modo técnico · todo lo que se puede hacer con un equipo: sus planes, sus
// órdenes abiertas y qué documento lo rige si falla.
import type { APIRoute } from "astro";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { fichaEquipo, puedeUsarCampo, RechazoCampo } from "@/lib/campo";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeUsarCampo(user.rol)) return new Response("Sin permisos", { status: 403 });
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Equipo inválido" }, { status: 400 });
  let ficha;
  try { ficha = await fichaEquipo(getDb(ctx), id, user); }
  catch (e) {
    // Un equipo del otro espacio (403) para quien trabaja solo en uno.
    if (e instanceof RechazoCampo) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
  if (!ficha) return Response.json({ error: "Ese equipo no existe" }, { status: 404 });
  return Response.json(ficha);
};
