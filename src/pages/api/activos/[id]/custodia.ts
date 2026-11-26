import type { APIRoute } from 'astro';
import { requireUserJson } from '@/lib/auth';
import { ErrorCustodia, leerCustodia, movimientoCustodiaSchema, registrarMovimientoCustodia,
  ROLES_CUSTODIA_LECTURA, ROLES_CUSTODIA_EDICION } from '@/lib/tecnologia';
export const prerender = false;
const fallo = (error: unknown) => {
  if (error instanceof ErrorCustodia) return Response.json({ error:error.message }, { status:error.status });
  console.error('No se pudo guardar o leer custodia TI', error instanceof Error ? error.message : 'error desconocido');
  return Response.json({ error:'No se pudo completar la operación de custodia. Actualiza la ficha y vuelve a intentarlo.' }, { status:500 });
};
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUserJson(ctx, [...ROLES_CUSTODIA_LECTURA]);
  if (!user) return response;
  const id = Number(ctx.params.id), cursor = ctx.url.searchParams.get('before');
  if (!Number.isSafeInteger(id) || id <= 0 || (cursor !== null && (!/^\d+$/.test(cursor) || Number(cursor) <= 0 || !Number.isSafeInteger(Number(cursor))))) return Response.json({ error:'Equipo o cursor no válido.' }, { status:400 });
  try { return Response.json(await leerCustodia(ctx, user, id, cursor === null ? undefined : Number(cursor)), { headers:{'Cache-Control':'private, no-store'} }); }
  catch (error) { return fallo(error); }
};
export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUserJson(ctx, [...ROLES_CUSTODIA_EDICION]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error:'Equipo no válido.' }, { status:400 });
  const parsed = movimientoCustodiaSchema.safeParse(await ctx.request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error:parsed.error.issues[0]?.message ?? 'Revisa los datos del movimiento.' }, { status:400 });
  try { return Response.json(await registrarMovimientoCustodia(ctx, user, id, parsed.data), { headers:{'Cache-Control':'private, no-store'} }); }
  catch (error) { return fallo(error); }
};
