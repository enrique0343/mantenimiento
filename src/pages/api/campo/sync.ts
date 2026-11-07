// Modo técnico · recibe lo que el celular capturó, en el orden en que ocurrió.
import type { APIRoute } from "astro";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { aplicarOperacion, puedeUsarCampo, type OperacionCampo } from "@/lib/campo";

export const prerender = false;

const MAX_OPS = 25;

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeUsarCampo(user.rol)) return new Response("Sin permisos", { status: 403 });
  const body: any = await ctx.request.json().catch(() => null);
  const ops: OperacionCampo[] = Array.isArray(body?.ops) ? body.ops.slice(0, MAX_OPS) : [];
  if (!ops.length) return Response.json({ error: "Sin operaciones" }, { status: 400 });
  // Si el reloj del celular está mal, las horas capturadas se corrigen con la
  // diferencia entre su reloj y el del servidor al momento de enviar.
  const relojCelular = typeof body?.reloj === "string" ? Date.parse(body.reloj) : NaN;
  const desfase = Number.isFinite(relojCelular) ? Date.now() - relojCelular : 0;
  if (Math.abs(desfase) > 120_000) {
    for (const op of ops) {
      const ms = typeof op.at === "string" ? Date.parse(op.at) : NaN;
      if (Number.isFinite(ms)) op.at = new Date(ms + desfase).toISOString();
    }
  }
  const db = getDb(ctx);
  const resultados = [];
  for (const op of ops) {
    try {
      resultados.push(await aplicarOperacion(ctx, db, user, op));
    } catch (e) {
      // Fallo del servidor, no de la operación: se detiene para conservar el orden.
      console.error("campo_sync", op?.tipo, e);
      return Response.json({ resultados, detenido: op?.opId ?? null }, { status: 200 });
    }
  }
  return Response.json({ resultados });
};
