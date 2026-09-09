import type { APIRoute } from "astro";
import { requireUser } from "@/lib/auth";
import { CONJUNTO_GESTORES, respuestaErrorConjunto, conjuntoId, conjuntoComponenteSchema, cambiarComponenteConjunto } from "@/lib/conjuntos";
export const prerender = false;
export const POST: APIRoute = async ctx => {
  const { user, response } = await requireUser(ctx, [...CONJUNTO_GESTORES]);
  if (!user) return Response.json({ error: response?.status === 403 ? "Solo administración y jefatura pueden gestionar componentes" : "Inicia sesión para continuar" }, { status: response?.status ?? 401 });
  ctx.locals.user = user;
  try {
    const id = conjuntoId(ctx.params.id);
    const parsed = conjuntoComponenteSchema.safeParse(await ctx.request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Revisa el componente, el puesto, la versión y el motivo (3 a 500 caracteres). No se admiten fechas ni responsables enviados por el formulario." }, { status: 400 });
    return Response.json(await cambiarComponenteConjunto(ctx, user, id, parsed.data));
  } catch (error) { return respuestaErrorConjunto(error); }
};
