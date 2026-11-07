// Modo técnico · buscar un equipo por sede y ubicación.
import type { APIRoute } from "astro";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { equiposDeUbicacion, puedeUsarCampo, ubicacionesDeSede } from "@/lib/campo";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeUsarCampo(user.rol)) return new Response("Sin permisos", { status: 403 });
  const db = getDb(ctx);
  const q = ctx.url.searchParams;
  if (q.has("ubicacion")) {
    const raw = q.get("ubicacion");
    const id = raw === "sin" ? null : Number(raw);
    if (id !== null && (!Number.isInteger(id) || id <= 0)) return Response.json({ error: "Ubicación inválida" }, { status: 400 });
    return Response.json({ equipos: await equiposDeUbicacion(db, id) });
  }
  const sede = Number(q.get("sede"));
  if (!Number.isInteger(sede) || sede <= 0) return Response.json({ error: "Falta la sede" }, { status: 400 });
  return Response.json(await ubicacionesDeSede(db, sede));
};
