// Ronda de turno · cerrarla.
// Regla dura: no se cierra con un punto crítico en blanco. "No pude
// verificarlo" es una respuesta válida y queda escrita; dejarlo vacío no.
import type { APIRoute } from "astro";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { cerrarEjecucion, puedeEjecutarRonda } from "@/lib/ronda-turno";

export const prerender = false;

const schema = z.object({ notas: z.string().max(2000).nullable().optional() });

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  if (!puedeEjecutarRonda(user.rol)) return new Response("Sin permisos", { status: 403 });

  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) return new Response("Ronda inválida", { status: 400 });

  const body = await ctx.request.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  const notas = parsed.success ? (parsed.data.notas ?? null) : null;

  const db = getDb(ctx);
  const r = await cerrarEjecucion(db, id, user.id, notas);
  if (!r.ok) return Response.json({ error: r.error, faltantes: r.faltantes ?? [] }, { status: 400 });
  return Response.json({ ok: true });
};
