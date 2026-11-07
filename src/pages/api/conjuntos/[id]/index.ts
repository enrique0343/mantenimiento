import type { APIRoute } from "astro";
import { requireUser } from "@/lib/auth";
import { CONJUNTO_LECTORES, CONJUNTO_GESTORES, respuestaErrorConjunto, conjuntoId, conjuntoEditarSchema, editarConjunto, getConjuntoDetalle } from "@/lib/conjuntos";
export const prerender = false;
export const GET: APIRoute = async ctx => {
  const { user, response } = await requireUser(ctx, [...CONJUNTO_LECTORES]);
  if (!user) return Response.json({ error: response?.status === 403 ? "Sin permisos para consultar conjuntos" : "Inicia sesión para continuar" }, { status: response?.status ?? 401 });
  ctx.locals.user = user;
  try {
    const detalle = await getConjuntoDetalle(ctx, conjuntoId(ctx.params.id), new URL(ctx.request.url).searchParams.get("fecha"));
    return detalle ? Response.json(detalle) : Response.json({ error: "Conjunto no encontrado" }, { status: 404 });
  } catch (error) { return respuestaErrorConjunto(error); }
};
export const PATCH: APIRoute = async ctx => {
  const { user, response } = await requireUser(ctx, [...CONJUNTO_GESTORES]);
  if (!user) return Response.json({ error: response?.status === 403 ? "Solo administración y jefatura pueden gestionar conjuntos" : "Inicia sesión para continuar" }, { status: response?.status ?? 401 });
  ctx.locals.user = user;
  try {
    const id = conjuntoId(ctx.params.id);
    const parsed = conjuntoEditarSchema.safeParse(await ctx.request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Revisa los cambios, la versión y el motivo (3 a 500 caracteres). El código y el área no se pueden cambiar." }, { status: 400 });
    return Response.json(await editarConjunto(ctx, user, id, parsed.data));
  } catch (error) { return respuestaErrorConjunto(error); }
};
export const DELETE: APIRoute = async ctx => {
  const { user, response } = await requireUser(ctx, [...CONJUNTO_GESTORES]);
  if (!user) return Response.json({ error: response?.status === 403 ? "Sin permisos" : "Inicia sesión para continuar" }, { status: response?.status ?? 401 });
  ctx.locals.user = user;
  return Response.json({ error: "Los conjuntos conservan su trazabilidad. Retira sus componentes y archívalo desde su ficha." }, { status: 409 });
};
