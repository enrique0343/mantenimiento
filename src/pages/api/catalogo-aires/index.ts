import type { APIRoute } from "astro";
import { requireUser } from "@/lib/auth";
import { CATALOGO_AIRES_GESTORES, crearModeloAire, getModelosAire, modeloAireCrearSchema, respuestaErrorCatalogoAire } from "@/lib/catalogo-aires";
export const prerender = false;
export const GET: APIRoute = async ctx => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  ctx.locals.user = user;
  try { return Response.json({ modelos: await getModelosAire(ctx, new URL(ctx.request.url).searchParams.get("incluirArchivados") === "1") }); }
  catch (error) { return respuestaErrorCatalogoAire(error); }
};
export const POST: APIRoute = async ctx => {
  const { user, response } = await requireUser(ctx, [...CATALOGO_AIRES_GESTORES]);
  if (!user) return response;
  const parsed = modeloAireCrearSchema.safeParse(await ctx.request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Escribe un nombre de 1 a 200 caracteres y revisa los datos de la ficha. Solo se admiten datos compartidos de aire acondicionado." }, { status: 400 });
  try { return Response.json(await crearModeloAire(ctx, user, parsed.data), { status: 201 }); }
  catch (error) { return respuestaErrorCatalogoAire(error); }
};
