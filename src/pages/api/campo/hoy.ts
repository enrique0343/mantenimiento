// Modo técnico · el día de trabajo completo, para poder seguir sin señal.
import type { APIRoute } from "astro";
import { getDb, getEnv } from "@/lib/db";
import { createSessionToken, requireUser, setSessionCookie } from "@/lib/auth";
import { paqueteHoy, puedeUsarCampo } from "@/lib/campo";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeUsarCampo(user.rol)) return new Response("Sin permisos", { status: 403 });
  const sede = Number(ctx.url.searchParams.get("sede"));
  const paquete = await paqueteHoy(getDb(ctx), user, Number.isInteger(sede) && sede > 0 ? sede : null);
  const headers = new Headers({ "cache-control": "no-store" });
  // Un técnico activo no debe quedarse sin sesión a media ronda.
  setSessionCookie(headers, await createSessionToken({ sub: user.id, email: user.email, nombre: user.nombre, rol: user.rol }, getEnv(ctx).JWT_SECRET));
  return Response.json(paquete, { headers });
};
