import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { solicitudesCompra, solicitudCompraEnvios, solicitudCompraItems, comprasDestinatarios, usuarios, ordenes } from "@/lib/schema";
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

  // Datos para el correo formal: técnico solicitante + jefe que autoriza
  const [creador] = sol.creadoPor
    ? await db.select({ nombre: usuarios.nombre, email: usuarios.email }).from(usuarios).where(eq(usuarios.id, sol.creadoPor)).limit(1)
    : [null];
  const autorizadorId = sol.autorizadoPor ?? user.id;
  const [autorizador] = await db.select({ nombre: usuarios.nombre, email: usuarios.email }).from(usuarios).where(eq(usuarios.id, autorizadorId)).limit(1);

  // Items de la solicitud (para mostrar el bien solicitado en el correo)
  const items = await db.select().from(solicitudCompraItems)
    .where(eq(solicitudCompraItems.solicitudId, id))
    .orderBy(solicitudCompraItems.orden);
  const itemsResumen = items.length === 0
    ? sol.titulo
    : items.length === 1
      ? `${items[0].descripcion}${items[0].cantidad ? ` (${items[0].cantidad}${items[0].unidad ? " " + items[0].unidad : ""})` : ""}`
      : `${items[0].descripcion} y ${items.length - 1} ${items.length - 1 === 1 ? "ítem más" : "ítems más"}`;

  // OT vinculada (si existe) para tomar el área afectada
  const [ot] = sol.ordenId
    ? await db.select({ titulo: ordenes.titulo }).from(ordenes).where(eq(ordenes.id, sol.ordenId)).limit(1)
    : [null];

  const fechaSol = new Date(sol.createdAt).toLocaleString("es", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

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

    // Saludo: "Estimada Licda. María" (usa el nombre completo del destinatario)
    const saludo = dest.nombre
      ? `Estimado/a <strong>${dest.nombre}</strong>,`
      : `Estimado/a,`;

    // Reply-To y CC: el jefe que autorizó + el técnico solicitante (si tienen email)
    const replyToList: string[] = [];
    const ccList: string[] = [];
    if (autorizador?.email) { replyToList.push(autorizador.email); ccList.push(autorizador.email); }
    if (creador?.email && creador.email !== autorizador?.email) { replyToList.push(creador.email); ccList.push(creador.email); }

    ctx.locals.runtime.ctx.waitUntil(
      sendMail(ctx, {
        to: dest.email,
        cc: ccList.length ? ccList : undefined,
        replyTo: replyToList.length ? replyToList : undefined,
        subject: `[${sol.codigo}] Solicitud de compra crítica — ${itemsResumen}`,
        html: emailLayout(
          `Solicitud de compra ${sol.codigo}`,
          `<p>${saludo}</p>
           <p>Reciba un cordial saludo de la Gerencia de Operaciones.</p>
           <p>Por este medio le hago llegar la solicitud de compra <strong>${sol.codigo}</strong>, generada desde el módulo de Mantenimiento para atender una falla activa${ot?.titulo ? ` relacionada con: <em>${ot.titulo}</em>` : ""}.</p>

           <h3 style="margin:18px 0 8px 0;color:#0a4082;font-size:15px">Detalle de la solicitud</h3>
           <ul style="margin:0 0 14px 0;padding-left:20px;line-height:1.7;font-size:14px">
             <li><strong>Código:</strong> ${sol.codigo}</li>
             <li><strong>Bien solicitado:</strong> ${itemsResumen}</li>
             ${creador?.nombre ? `<li><strong>Solicitante técnico:</strong> ${creador.nombre}</li>` : ""}
             <li><strong>Fecha de generación:</strong> ${fechaSol}</li>
             ${autorizador?.nombre ? `<li><strong>Autorizado por:</strong> ${autorizador.nombre}</li>` : ""}
           </ul>

           ${sol.descripcion ? `<h3 style="margin:18px 0 8px 0;color:#0a4082;font-size:15px">Justificación operativa</h3>
             <p style="white-space:pre-wrap">${sol.descripcion}</p>
             <p>La pronta atención de esta solicitud resulta clave para restablecer la operación bajo parámetros normales y proteger la continuidad del servicio en las áreas que dependen de esta operación.</p>` : ""}

           <h3 style="margin:18px 0 8px 0;color:#0a4082;font-size:15px">Documentación adjunta</h3>
           <p>En el siguiente enlace encontrará el detalle técnico completo, especificaciones del repuesto y el formulario PDF firmado de la solicitud:</p>
           <p style="margin:14px 0"><a href="${viewUrl}" style="display:inline-block;padding:10px 22px;background:#0a4082;color:#fff;border-radius:6px;text-decoration:none;font-weight:500">Ver solicitud y descargar PDF →</a></p>
           <p style="color:#64748b;font-size:12px">Este enlace es personal e intransferible. Su acceso queda registrado en el expediente de la solicitud para efectos de trazabilidad.</p>

           <h3 style="margin:18px 0 8px 0;color:#0a4082;font-size:15px">Próximos pasos</h3>
           <p>Le agradecemos confirmar la recepción de la presente solicitud y, en cuanto le sea posible, hacernos llegar el plazo estimado de adquisición. Si requiere información adicional o necesita coordinar con el área técnica, puede dirigirse a ${creador?.nombre ? `<strong>${creador.nombre}</strong>` : "la jefatura"} o a la jefatura correspondiente de Mantenimiento.</p>

           <p style="margin-top:20px">Agradezco de antemano su gestión y disposición habituales.</p>

           <p style="margin-top:24px">Atentamente,<br/>
             <strong>${autorizador?.nombre ?? "Gerencia de Operaciones"}</strong><br/>
             Gerencia de Operaciones<br/>
             <em>Avante Complejo Hospitalario</em><br/>
             <span style="font-size:12px;color:#64748b">Inversiones Avante S.A. de C.V.</span>
           </p>`
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
