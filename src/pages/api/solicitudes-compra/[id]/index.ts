import type { APIRoute } from "astro";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import {
  solicitudesCompra, solicitudCompraItems, solicitudCompraAdjuntos,
  solicitudCompraEnvios, solicitudCompraDescargas, usuarios, ordenes,
  comprasDestinatarios,
} from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { sendMail, emailLayout } from "@/lib/email";
import { crearNotificacion } from "@/lib/notif-app";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);

  const [row] = await db
    .select({ s: solicitudesCompra, u: usuarios, o: ordenes })
    .from(solicitudesCompra)
    .leftJoin(usuarios, eq(usuarios.id, solicitudesCompra.creadoPor))
    .leftJoin(ordenes, eq(ordenes.id, solicitudesCompra.ordenId))
    .where(eq(solicitudesCompra.id, id))
    .limit(1);
  if (!row) return Response.json({ error: "No encontrado" }, { status: 404 });

  const items = await db.select().from(solicitudCompraItems)
    .where(eq(solicitudCompraItems.solicitudId, id))
    .orderBy(solicitudCompraItems.orden);

  const adjuntos = await db.select().from(solicitudCompraAdjuntos)
    .where(eq(solicitudCompraAdjuntos.solicitudId, id));

  const envios = await db.select().from(solicitudCompraEnvios)
    .where(eq(solicitudCompraEnvios.solicitudId, id))
    .orderBy(solicitudCompraEnvios.enviadoEn);

  // Adjuntar conteo de descargas por envío
  const enviosConDescargas = await Promise.all(envios.map(async (e) => {
    const descargas = await db.select().from(solicitudCompraDescargas)
      .where(eq(solicitudCompraDescargas.envioId, e.id));
    return { ...e, descargas };
  }));

  return Response.json({
    solicitud: {
      ...row.s,
      creadoPorNombre: row.u?.nombre ?? null,
      orden: row.o ? { id: row.o.id, titulo: row.o.titulo, estado: row.o.estado } : null,
    },
    items,
    adjuntos,
    envios: enviosConDescargas,
  });
};

const patchSchema = z.object({
  titulo: z.string().min(1).optional(),
  descripcion: z.string().nullable().optional(),
  estado: z.enum(["borrador", "enviada", "comprada", "rechazada", "cancelada"]).optional(),
  notasAutorizacion: z.string().nullable().optional(),
  notasResultado: z.string().nullable().optional(),
  items: z.array(z.object({
    id: z.number().int().optional(),
    descripcion: z.string().min(1),
    cantidad: z.number().positive().default(1),
    unidad: z.string().nullable().optional(),
    notas: z.string().nullable().optional(),
  })).optional(),
});

export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe", "tecnico"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [actual] = await db.select().from(solicitudesCompra).where(eq(solicitudesCompra.id, id)).limit(1);
  if (!actual) return Response.json({ error: "No encontrado" }, { status: 404 });

  // Solo admin/jefe pueden cambiar estado (excepto cancelar la propia)
  if (parsed.data.estado && parsed.data.estado !== actual.estado) {
    const esAdmin = user.rol === "admin" || user.rol === "jefe";
    const esCancelacion = parsed.data.estado === "cancelada";
    const esPropietario = actual.creadoPor === user.id;
    if (!esAdmin && !(esCancelacion && esPropietario)) {
      return Response.json({ error: "No tienes permisos para cambiar el estado" }, { status: 403 });
    }
  }

  const now = new Date().toISOString();
  const data: Record<string, unknown> = {};
  if (parsed.data.titulo !== undefined) data.titulo = parsed.data.titulo;
  if (parsed.data.descripcion !== undefined) data.descripcion = parsed.data.descripcion;
  if (parsed.data.notasAutorizacion !== undefined) data.notasAutorizacion = parsed.data.notasAutorizacion;
  if (parsed.data.notasResultado !== undefined) data.notasResultado = parsed.data.notasResultado;

  if (parsed.data.estado && parsed.data.estado !== actual.estado) {
    data.estado = parsed.data.estado;
    if (parsed.data.estado === "comprada" || parsed.data.estado === "rechazada") {
      data.completadoPor = user.id;
      data.completadoEn = now;
    }
    if (parsed.data.estado === "enviada" && !actual.autorizadoEn) {
      data.autorizadoPor = user.id;
      data.autorizadoEn = now;
    }
  }

  const [row] = await db.update(solicitudesCompra).set(data).where(eq(solicitudesCompra.id, id)).returning();

  // Reemplazar ítems si se enviaron
  if (parsed.data.items) {
    await db.delete(solicitudCompraItems).where(eq(solicitudCompraItems.solicitudId, id));
    if (parsed.data.items.length) {
      await db.insert(solicitudCompraItems).values(
        parsed.data.items.map((item, i) => ({
          solicitudId: id,
          descripcion: item.descripcion,
          cantidad: item.cantidad,
          unidad: item.unidad ?? null,
          notas: item.notas ?? null,
          orden: i,
        }))
      );
    }
  }

  // Notificar al técnico cuando la solicitud se marca como comprada o rechazada
  if (parsed.data.estado && parsed.data.estado !== actual.estado &&
      (parsed.data.estado === "comprada" || parsed.data.estado === "rechazada")) {
    try {
      const [creador] = await db.select({ id: usuarios.id, nombre: usuarios.nombre, email: usuarios.email })
        .from(usuarios).where(eq(usuarios.id, actual.creadoPor)).limit(1);
      if (creador) {
        const estadoLabel = parsed.data.estado === "comprada" ? "✅ aprobada/comprada" : "❌ rechazada";
        // Notificación in-app (campanita) — sigue activa
        await crearNotificacion(ctx, {
          usuarioId: creador.id,
          tipo: "compra_actualizada",
          titulo: `Solicitud ${actual.codigo} ${estadoLabel}`,
          mensaje: parsed.data.notasResultado ?? "",
          link: `/solicitudes-compra/${id}`,
        });
        // ── Correo desactivado temporalmente (#10) ─────────────────────────
        // La secuencia de compras no sigue aún una lógica formal en nuestro
        // ecosistema. Reactivar cuando se defina el flujo definitivo.
        // Para reactivar: descomentar el bloque siguiente.
        /*
        if (creador.email) {
          const env = (ctx.locals as any)?.runtime?.env ?? {};
          const baseUrl = env.APP_URL || "https://mantenimiento-49c.pages.dev";
          ctx.locals.runtime.ctx.waitUntil(
            sendMail(ctx, {
              to: creador.email,
              subject: `[${actual.codigo}] Solicitud de compra ${estadoLabel}`,
              html: emailLayout(
                `Solicitud de compra actualizada`,
                `<p>Hola <strong>${creador.nombre}</strong>,</p>
                 <p>La solicitud <strong>${actual.codigo} - ${actual.titulo}</strong> fue marcada como <strong>${estadoLabel}</strong>.</p>
                 ${parsed.data.notasResultado ? `<p><em>${parsed.data.notasResultado}</em></p>` : ""}
                 <p><a href="${baseUrl}/solicitudes-compra/${id}">Ver solicitud →</a></p>`
              ),
              tipo: "compra_actualizada",
              referencia: `solicitud:${id}`,
            }).catch(() => {})
          );
        }
        */
      }
    } catch {}
  }

  return Response.json({ solicitud: row });
};

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  const [actual] = await db.select().from(solicitudesCompra).where(eq(solicitudesCompra.id, id)).limit(1);
  if (!actual) return Response.json({ error: "No encontrado" }, { status: 404 });
  if (actual.estado !== "borrador" && actual.estado !== "cancelada") {
    return Response.json({ error: "Solo se pueden eliminar solicitudes en borrador o canceladas" }, { status: 400 });
  }
  // Borrar adjuntos de R2
  const adjs = await db.select().from(solicitudCompraAdjuntos).where(eq(solicitudCompraAdjuntos.solicitudId, id));
  if (adjs.length) {
    const env = getEnv(ctx);
    await Promise.allSettled(adjs.map((a) => env.R2.delete(a.r2Key)));
  }
  await db.delete(solicitudesCompra).where(eq(solicitudesCompra.id, id));
  return Response.json({ ok: true });
};
