import type { APIRoute } from "astro";
import { eq, sql } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { adjuntos, ordenes, ordenVerificacionEventos } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  const [row] = await db.select().from(adjuntos).where(eq(adjuntos.id, id)).limit(1);
  if (!row) return new Response("No encontrado", { status: 404 });

  const env = getEnv(ctx);
  const obj = await env.R2.get(row.r2Key);
  if (!obj) return new Response("Archivo no disponible", { status: 410 });

  return new Response(obj.body, {
    headers: {
      "content-type": row.contentType,
      "content-disposition": `inline; filename="${encodeURIComponent(row.nombre)}"`,
      "cache-control": "private, max-age=300",
    },
  });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  const [row] = await db.select().from(adjuntos).where(eq(adjuntos.id, id)).limit(1);
  if (!row) return Response.json({ error: "No encontrado" }, { status: 404 });
  const [order] = await db.select().from(ordenes).where(eq(ordenes.id, row.ordenId)).limit(1);
  if (user.rol === 'tecnico' && order?.asignadoA !== user.id) return Response.json({ error: 'Sin permisos sobre esta orden' }, { status: 403 });
  const [retained] = await db.select({ id: ordenVerificacionEventos.id }).from(ordenVerificacionEventos)
    .where(sql`${ordenVerificacionEventos.ordenId} = ${row.ordenId} and exists (select 1 from json_each(${ordenVerificacionEventos.evidenciaJson}, '$.adjuntos') where json_extract(value, '$.id') = ${id})`).limit(1);
  if (retained || ['completada','verificada','cerrada'].includes(order?.estado ?? '')) return Response.json({ error: 'El adjunto forma parte de la evidencia conservada de la orden.' }, { status: 409 });
  const env = getEnv(ctx);
  // The database guard runs before R2 deletion, including concurrent completion.
  try { await db.delete(adjuntos).where(eq(adjuntos.id, id)); }
  catch { return Response.json({ error: 'No se puede retirar un adjunto conservado en la evidencia de verificación.' }, { status: 409 }); }
  await env.R2.delete(row.r2Key);
  return Response.json({ ok: true });
};
