import type { APIRoute } from "astro";
import { requireUser } from "@/lib/auth";
import { CATALOGO_AIRES_GESTORES, editarModeloAire, getModeloAireDetalle, modeloAireEditarSchema, modeloAireId, respuestaErrorCatalogoAire } from "@/lib/catalogo-aires";
export const prerender = false;
export const GET: APIRoute = async ctx => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  ctx.locals.user = user;
  try {
    const detalle = await getModeloAireDetalle(ctx, modeloAireId(ctx.params.id));
    return detalle ? Response.json(detalle) : Response.json({ error: "Ficha no encontrada" }, { status: 404 });
  } catch (error) { return respuestaErrorCatalogoAire(error); }
};
export const PATCH: APIRoute = async ctx => {
  const { user, response } = await requireUser(ctx, [...CATALOGO_AIRES_GESTORES]);
  if (!user) return response;
  const parsed = modeloAireEditarSchema.safeParse(await ctx.request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Revisa los campos de la ficha y su versión. El nombre no puede quedar vacío y solo se admiten datos compartidos de aire acondicionado." }, { status: 400 });
  try { return Response.json(await editarModeloAire(ctx, user, modeloAireId(ctx.params.id), parsed.data)); }
  catch (error) { return respuestaErrorCatalogoAire(error); }
};
