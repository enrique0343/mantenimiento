import type { APIRoute } from "astro";
import { requireUser } from "@/lib/auth";
import { parseArea } from "@/lib/areas";
import { CONJUNTO_LECTORES, CONJUNTO_GESTORES, respuestaErrorConjunto, conjuntoCrearSchema, crearConjunto, getConjuntos } from "@/lib/conjuntos";
export const prerender = false;
export const GET: APIRoute = async ctx => {
  const { user, response } = await requireUser(ctx, [...CONJUNTO_LECTORES]);
  if (!user) return Response.json({ error: response?.status === 403 ? "Sin permisos para consultar conjuntos" : "Inicia sesión para continuar" }, { status: response?.status ?? 401 });
  ctx.locals.user = user;
  const value = new URL(ctx.request.url).searchParams.get("area"), area = parseArea(value);
  if (value && !area) return Response.json({ error: "Área de mantenimiento inválida" }, { status: 400 });
  try { return Response.json({ conjuntos: await getConjuntos(ctx, area) }); }
  catch (error) { return respuestaErrorConjunto(error); }
};
export const POST: APIRoute = async ctx => {
  const { user, response } = await requireUser(ctx, [...CONJUNTO_GESTORES]);
  if (!user) return Response.json({ error: response?.status === 403 ? "Solo administración y jefatura pueden gestionar conjuntos" : "Inicia sesión para continuar" }, { status: response?.status ?? 401 });
  ctx.locals.user = user;
  const parsed = conjuntoCrearSchema.safeParse(await ctx.request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Revisa los campos del conjunto y escribe un motivo de 3 a 500 caracteres. No se admiten campos adicionales." }, { status: 400 });
  try { return Response.json(await crearConjunto(ctx, user, parsed.data), { status: 201 }); }
  catch (error) { return respuestaErrorConjunto(error); }
};
