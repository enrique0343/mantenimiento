import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import {
  solicitudCompraEnvios, solicitudCompraDescargas, solicitudCompraAdjuntos,
  solicitudesCompra, solicitudCompraItems,
} from "@/lib/schema";
import { getCurrentUser } from "@/lib/auth";

export const prerender = false;

// GET: returns solicitud data for public view (no auth required — token is the auth)
export const GET: APIRoute = async (ctx) => {
  const token = ctx.params.token!;
  const db = getDb(ctx);

  const [envio] = await db.select().from(solicitudCompraEnvios)
    .where(eq(solicitudCompraEnvios.token, token)).limit(1);
  if (!envio) return Response.json({ error: "Enlace no válido" }, { status: 404 });

  const [sol] = await db.select().from(solicitudesCompra)
    .where(eq(solicitudesCompra.id, envio.solicitudId)).limit(1);
  if (!sol) return Response.json({ error: "Solicitud no encontrada" }, { status: 404 });

  const items = await db.select().from(solicitudCompraItems)
    .where(eq(solicitudCompraItems.solicitudId, sol.id))
    .orderBy(solicitudCompraItems.orden);

  const adjuntos = await db.select().from(solicitudCompraAdjuntos)
    .where(eq(solicitudCompraAdjuntos.solicitudId, sol.id));

  // Registrar descarga SOLO si el visitante NO tiene sesión interna activa.
  // Los usuarios autenticados (admin/jefe/técnico) que llegan al link público
  // no contaminan el log de trazabilidad — para eso ven la solicitud en el
  // panel interno /solicitudes-compra/[id].
  const usuarioInterno = await getCurrentUser(ctx).catch(() => null);
  if (!usuarioInterno) {
    const ip = ctx.request.headers.get("cf-connecting-ip") ??
                ctx.request.headers.get("x-forwarded-for") ??
                ctx.request.headers.get("x-real-ip") ?? null;
    const userAgent = ctx.request.headers.get("user-agent") ?? null;
    await db.insert(solicitudCompraDescargas).values({
      envioId: envio.id,
      ip,
      userAgent,
    });
  }

  return Response.json({
    solicitud: sol,
    items,
    adjuntos,
    envio: { destinatarioNombre: envio.destinatarioNombre, enviadoEn: envio.enviadoEn },
  });
};
