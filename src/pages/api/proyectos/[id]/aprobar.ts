import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { proyectos, usuarios } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeAprobarProyecto } from "@/lib/proyectos";
import { logAudit } from "@/lib/audit";
import { sendMail, emailLayout } from "@/lib/email";
import { crearNotificacion } from "@/lib/notif-app";

export const prerender = false;

const schema = z.object({
  decision: z.enum(["aprobado", "rechazado"]),
  notas: z.string().min(1, "Las notas de la decisión son obligatorias"),
});

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAprobarProyecto(user.rol)) return Response.json({ error: "Solo admin puede aprobar proyectos" }, { status: 403 });

  const id = Number(ctx.params.id);
  const body = await ctx.request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const [actual] = await db.select().from(proyectos).where(eq(proyectos.id, id)).limit(1);
  if (!actual) return Response.json({ error: "No encontrado" }, { status: 404 });
  if (actual.estado !== "evaluacion") {
    return Response.json({ error: "El proyecto debe estar en evaluación para aprobarlo o rechazarlo" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const [row] = await db.update(proyectos).set({
    estado: parsed.data.decision,
    aprobadoPor: user.id,
    aprobadoEn: now,
    notasAprobacion: parsed.data.notas,
  }).where(eq(proyectos.id, id)).returning();

  await logAudit(ctx, {
    entidad: "proyecto", entidadId: id, accion: "estado",
    resumen: `${parsed.data.decision === "aprobado" ? "Aprobado" : "Rechazado"} por ${user.nombre}`,
    cambios: { estado: { antes: "evaluacion", despues: parsed.data.decision } },
  });

  // Notificar al creador
  if (actual.creadoPor) {
    try {
      const [creador] = await db.select().from(usuarios).where(eq(usuarios.id, actual.creadoPor)).limit(1);
      if (creador?.email) {
        const env = (ctx.locals as any)?.runtime?.env ?? {};
        const baseUrl = env.APP_URL || "https://mantenimiento-49c.pages.dev";
        const url = `${baseUrl}/proyectos/${id}`;
        const primer = (creador.nombre ?? "").split(" ")[0] || creador.nombre;
        const titulo = parsed.data.decision === "aprobado" ? "Tu proyecto fue aprobado" : "Tu proyecto fue rechazado";
        const color = parsed.data.decision === "aprobado" ? "#065f46" : "#991b1b";
        const bg = parsed.data.decision === "aprobado" ? "#d1fae5" : "#fee2e2";
        ctx.locals.runtime.ctx.waitUntil(
          sendMail(ctx, {
            to: creador.email,
            subject: `[${actual.codigo}] ${parsed.data.decision === "aprobado" ? "✅ Aprobado" : "❌ Rechazado"} — ${actual.titulo}`,
            html: emailLayout(
              titulo,
              `<p>Hola <strong>${primer}</strong>,</p>
               <p>El proyecto <strong>${actual.codigo} — ${actual.titulo}</strong> fue ${parsed.data.decision === "aprobado" ? "aprobado" : "rechazado"} por <strong>${user.nombre}</strong>.</p>
               <p style="margin:0 0 6px 0"><strong>Notas:</strong></p>
               <p style="white-space:pre-wrap;background:${bg};padding:12px;border-left:3px solid ${color};border-radius:4px;margin:0 0 18px 0">${parsed.data.notas}</p>
               ${parsed.data.decision === "aprobado"
                 ? `<p>Ya puedes proceder a planificar la ejecución: cargar presupuesto definitivo, hitos y generar OTs.</p>`
                 : `<p>Si crees que la decisión debe revisarse, puedes comentar el caso directamente con la jefatura.</p>`}
               <p style="margin:18px 0"><a href="${url}" style="display:inline-block;padding:10px 20px;background:#0a4082;color:#fff;border-radius:6px;text-decoration:none;font-weight:500">Abrir proyecto →</a></p>`
            ),
            tipo: "proyecto_decision",
            referencia: `proyecto:${id}`,
          }).catch(() => {})
        );
      }
      await crearNotificacion(ctx, {
        usuarioId: actual.creadoPor, tipo: "proyecto_decision",
        titulo: `${actual.codigo} ${parsed.data.decision === "aprobado" ? "aprobado" : "rechazado"}`,
        mensaje: parsed.data.notas.slice(0, 100),
        link: `/proyectos/${id}`,
      });
    } catch {}
  }

  return Response.json({ proyecto: row });
};
