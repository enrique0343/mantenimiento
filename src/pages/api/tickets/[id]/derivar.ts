import type { APIRoute } from 'astro';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { usuarios } from '@/lib/schema';
import { ESPACIOS, puedeEntrar } from '@/lib/espacio';
import { crearNotificacion } from '@/lib/notif-app';
import { derivacionTicketSchema, derivarTicket, ErrorDerivacionTicket } from '@/lib/ticket-derivacion';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx, ['admin', 'jefe', 'tecnico']);
  if (!user) return response;
  const id = Number(ctx.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: 'Solicitud inválida.' }, { status: 400 });
  const parsed = derivacionTicketSchema.safeParse(await ctx.request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Datos de derivación inválidos.' }, { status: 400 });
  try {
    const resultado = await derivarTicket(ctx, user, id, parsed.data);
    // Un aviso fallido no deshace ni repite una derivación ya confirmada. No se
    // devuelven los destinatarios ni se amplían permisos hacia la nueva bandeja.
    try {
      const jefes = await getDb(ctx).select({ id: usuarios.id, rol: usuarios.rol, especialidad: usuarios.especialidad })
        .from(usuarios).where(and(eq(usuarios.rol, 'jefe'), eq(usuarios.activo, true)));
      await Promise.all(jefes.filter(j => puedeEntrar(j, resultado.espacioDestino)).map(j => crearNotificacion(ctx, {
        usuarioId: j.id, tipo: 'ticket_derivacion', titulo: `Solicitud #${id} recibida en ${ESPACIOS[resultado.espacioDestino].etiqueta}`,
        mensaje: 'Derivada sin asignar. Conserva la fecha original y su plazo de atención.',
        link: `/tickets/${id}?espacio=${resultado.espacioDestino}&area=${resultado.rubroDestino}`,
      })));
    } catch { console.error('No se pudo crear el aviso interno de la derivación.'); }
    return Response.json(resultado);
  } catch (error) {
    if (error instanceof ErrorDerivacionTicket) return Response.json({ error: error.message }, { status: error.status });
    console.error('No se pudo derivar la solicitud.', error instanceof Error ? error.message : 'error');
    return Response.json({ error: 'No se pudo guardar la derivación. Vuelve a intentarlo.' }, { status: 500 });
  }
};
