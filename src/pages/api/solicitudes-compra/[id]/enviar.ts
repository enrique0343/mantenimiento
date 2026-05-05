import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { solicitudesCompra, solicitudCompraEnvios, comprasDestinatarios } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { sendMail, emailLayout } from "@/lib/email";

export const prerender = false;

const schema = z.object({
  // Puede recibir IDs de destinatarios guardados y/o emails ad-hoc
  destinatarioIds: z.array(z.number().int().positive()).optional(),
  extras: z.array(z.object({
    email: z.string().email(),
    nombre: z.string().optional(),
  })).optional(),
});

function randomToken(): string {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin", "jefe"]);
  if (!user) return response;

  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [sol] = await db.select().from(solicitudesCompra).where(eq(solicitudesCompra.id, id)).limit(1);
  if (!sol) return Response.json({ error: "No encontrada" }, { status: 404 });
  if (sol.estado !== "borrador" && sol.estado !== "enviada") {
    return Response.json({ error: "Solo se pueden enviar solicitudes en borrador o enviada" }, { status: 400 });
  }

  const env = (ctx.locals as any)?.runtime?.env ?? {};
  const baseUrl = env.APP_URL || "https://mantenimiento-49c.pages.dev";

  const destinatarios: Array<{ id?: number; email: string; nombre?: string }> = [];

  if (parsed.data.destinatarioIds?.length) {
    const rows = await db.select().from(comprasDestinatarios)
      .where(eq(comprasDestinatarios.activo, true));
    for (const d of rows) {
      if (parsed.data.destinatarioIds.includes(d.id)) {
        destinatarios.push({ id: d.id, email: d.email, nombre: d.nombre });
      }
    }
  }
  for (const e of (parsed.data.extras ?? [])) {
    destinatarios.push({ email: e.email, nombre: e.nombre });
  }

  if (destinatarios.length === 0) {
    return Response.json({ error: "No hay destinatarios seleccionados" }, { status: 400 });
  }

  const enviados: string[] = [];

  for (const dest of destinatarios) {
    const token = randomToken();
    await db.insert(solicitudCompraEnvios).values({
      solicitudId: id,
      destinatarioId: dest.id ?? null,
      destinatarioEmail: dest.email,
      destinatarioNombre: dest.nombre ?? null,
      token,
    });

    const viewUrl = `${baseUrl}/solicitudes-compra/r/${token}`;

    ctx.locals.runtime.ctx.waitUntil(
      sendMail(ctx, {
        to: dest.email,
        subject: `[${sol.codigo}] Solicitud de compra: ${sol.titulo}`,
        html: emailLayout(
          `Solicitud de compra ${sol.codigo}`,
          `<p>${dest.nombre ? `Hola <strong>${dest.nombre}</strong>,` : "Estimado/a,"}</p>
           <p>Se ha generado una solicitud de compra que requiere su atención.</p>
           <p><strong>${sol.titulo}</strong></p>
           ${sol.descripcion ? `<p style="white-space:pre-wrap">${sol.descripcion}</p>` : ""}
           <p>Use el siguiente enlace para ver los detalles y descargar el PDF:</p>
           <p><a href="${viewUrl}" style="display:inline-block;padding:10px 20px;background:#1e40af;color:#fff;border-radius:6px;text-decoration:none">Ver solicitud y descargar PDF →</a></p>
           <p style="color:#888;font-size:12px">Este enlace es personal e intransferible.</p>`
        ),
        tipo: "solicitud_compra",
        referencia: `solicitud:${id}`,
      }).catch(() => {})
    );

    enviados.push(dest.email);
  }

  // Actualizar estado a "enviada" si estaba en borrador
  if (sol.estado === "borrador") {
    await db.update(solicitudesCompra).set({ estado: "enviada", autorizadoPor: user.id, autorizadoEn: new Date().toISOString() }).where(eq(solicitudesCompra.id, id));
  }

  return Response.json({ ok: true, enviados });
};
