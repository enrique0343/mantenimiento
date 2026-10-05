import type { APIRoute } from "astro";
import { getDb, getEnv } from "@/lib/db";
import { eq } from "drizzle-orm";
import { esRevisorOrden } from "@/lib/orden-verificacion";
import { adjuntos, ordenes, ordenVerificacion } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const ordenId = Number(ctx.params.id);
  const env = getEnv(ctx);
  const db = getDb(ctx);
  const [order] = await db.select().from(ordenes).where(eq(ordenes.id, ordenId)).limit(1);
  if (!order) return Response.json({ error: 'Orden no encontrada' }, { status: 404 });
  if (['cerrada', 'cancelada'].includes(order.estado)) return Response.json({ error: 'Reabre la orden antes de agregar evidencia nueva.' }, { status: 409 });
  const [control] = await db.select().from(ordenVerificacion).where(eq(ordenVerificacion.ordenId, ordenId)).limit(1);
  const reviewer = esRevisorOrden(user, control);
  if (user.rol === 'tecnico' && order.asignadoA !== user.id && !reviewer) return Response.json({ error: 'Sin permisos sobre esta orden' }, { status: 403 });
  if (['completada', 'verificada'].includes(order.estado) && !reviewer) return Response.json({ error: 'La ejecución está enviada. La revisión puede agregar evidencia; devuelve la orden para corregir la ejecución.' }, { status: 409 });

  const form = await ctx.request.formData().catch(() => null);
  const file = form?.get("file");
  const categoriaRaw = String(form?.get("categoria") ?? "general");
  const categoria = (["antes", "despues", "documento", "general"] as const).includes(categoriaRaw as any)
    ? (categoriaRaw as "antes" | "despues" | "documento" | "general")
    : "general";

  if (!(file instanceof File)) {
    return Response.json({ error: "Archivo requerido en campo 'file'" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "Archivo supera 10MB" }, { status: 413 });
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const r2Key = `ordenes/${ordenId}/${categoria}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  await env.R2.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });

  const [row] = await db
    .insert(adjuntos)
    .values({
      ordenId,
      usuarioId: user.id,
      nombre: file.name,
      contentType: file.type || "application/octet-stream",
      tamano: file.size,
      r2Key,
      categoria,
    })
    .returning();
  return Response.json({ adjunto: row }, { status: 201 });
};
