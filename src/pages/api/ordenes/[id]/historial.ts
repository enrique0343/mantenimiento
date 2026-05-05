import type { APIRoute } from "astro";
import { eq, desc, and } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { auditLog, usuarios, ordenes, tickets } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

// Devuelve el historial completo de una OT: eventos del audit_log + datos
// del ticket origen si aplica. Solo admin.
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const id = Number(ctx.params.id);
  const db = getDb(ctx);

  const [ot] = await db.select().from(ordenes).where(eq(ordenes.id, id)).limit(1);
  if (!ot) return Response.json({ error: "No encontrada" }, { status: 404 });

  // Eventos del audit log
  const eventos = await db
    .select({ a: auditLog, u: usuarios })
    .from(auditLog)
    .leftJoin(usuarios, eq(usuarios.id, auditLog.usuarioId))
    .where(and(eq(auditLog.entidad, "orden"), eq(auditLog.entidadId, id)))
    .orderBy(desc(auditLog.id));

  // Buscar ticket origen (si OT vino de un ticket)
  let ticketOrigen: any = null;
  const [tk] = await db.select().from(tickets).where(eq(tickets.otId, id)).limit(1);
  if (tk) {
    ticketOrigen = {
      id: tk.id, asunto: tk.asunto, descripcion: tk.descripcion,
      solicitanteNombre: tk.solicitanteNombre,
      solicitanteEmail: tk.solicitanteEmail,
      solicitanteTelefono: tk.solicitanteTelefono,
      createdAt: tk.createdAt,
      trackingToken: tk.trackingToken,
    };
  }

  // Info de creador y verificador desde la propia OT
  const [creador] = ot.creadoPor
    ? await db.select({ id: usuarios.id, nombre: usuarios.nombre, email: usuarios.email })
        .from(usuarios).where(eq(usuarios.id, ot.creadoPor)).limit(1)
    : [null];
  const [verificador] = ot.verificadoPor
    ? await db.select({ id: usuarios.id, nombre: usuarios.nombre, email: usuarios.email })
        .from(usuarios).where(eq(usuarios.id, ot.verificadoPor)).limit(1)
    : [null];
  const [cierra] = ot.cerradoPor
    ? await db.select({ id: usuarios.id, nombre: usuarios.nombre, email: usuarios.email })
        .from(usuarios).where(eq(usuarios.id, ot.cerradoPor)).limit(1)
    : [null];

  return Response.json({
    orden: {
      id: ot.id, titulo: ot.titulo, estado: ot.estado,
      createdAt: ot.createdAt, iniciadaEn: ot.iniciadaEn,
      completadaEn: ot.completadaEn, verificadoEn: ot.verificadoEn,
      cerradoEn: ot.cerradoEn,
    },
    ticketOrigen,
    creador, verificador, cierra,
    eventos: eventos.map((e) => ({
      ...e.a,
      cambios: e.a.cambios ? JSON.parse(e.a.cambios) : null,
      usuario: e.u ? { id: e.u.id, nombre: e.u.nombre, email: e.u.email } : null,
    })),
  });
};
