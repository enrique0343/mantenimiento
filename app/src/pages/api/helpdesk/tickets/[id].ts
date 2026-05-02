import type { APIRoute } from 'astro';
import { getDb, newId } from '../../../../lib/db';
import { helpdeskTickets, ticketComments, workOrders } from '../../../../lib/schema';
import { json, slaDueDate } from '../../../../lib/utils';
import { eq } from 'drizzle-orm';

export const GET: APIRoute = async ({ params, locals, url }) => {
  const env = (locals.runtime as any).env as Env;
  const db  = getDb(env.DB);
  const id  = params.id!;
  const sub = url.searchParams.get('sub');

  if (sub === 'comments') {
    const rows = await db.select().from(ticketComments).where(eq(ticketComments.ticketId, id)).all();
    const user = locals.user;
    return json(user ? rows : rows.filter(r => !r.isInternal));
  }

  const [row] = await db.select().from(helpdeskTickets).where(eq(helpdeskTickets.id, id)).limit(1);
  if (!row) return json({ error: 'No encontrado' }, 404);
  return json(row);
};

export const PATCH: APIRoute = async ({ params, locals, request, url }) => {
  const env  = (locals.runtime as any).env as Env;
  const user = locals.user!;
  const db   = getDb(env.DB);
  const id   = params.id!;
  const sub  = url.searchParams.get('sub');

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  if (sub === 'status') {
    const updates: any = { status: body.status };
    if (body.status === 'RESOLVED') {
      updates.resolvedAt      = new Date().toISOString();
      updates.resolutionNotes = body.resolutionNotes;
    }
    if (body.status === 'CLOSED') updates.closedAt = new Date().toISOString();
    await db.update(helpdeskTickets).set(updates).where(eq(helpdeskTickets.id, id));
    return json({ ok: true });
  }

  if (sub === 'assign') {
    await db.update(helpdeskTickets).set({ assignedToId: body.technicianId, status: 'IN_PROGRESS' }).where(eq(helpdeskTickets.id, id));
    return json({ ok: true });
  }

  if (sub === 'comment') {
    const { content, isInternal = false } = body;
    if (!content) return json({ error: 'content requerido' }, 400);
    const cmtId = newId();
    await db.insert(ticketComments).values({
      id: cmtId, ticketId: id,
      authorId: user.sub, authorName: user.name,
      content, isInternal,
    });
    return json({ id: cmtId }, 201);
  }

  if (sub === 'convert') {
    // Convert to corrective work order
    const [ticket] = await db.select().from(helpdeskTickets).where(eq(helpdeskTickets.id, id)).limit(1);
    if (!ticket || !ticket.equipmentId) return json({ error: 'El ticket no tiene equipo vinculado' }, 400);

    const woId  = newId();
    const woSeq = String(Date.now()).slice(-4);
    await db.insert(workOrders).values({
      id: woId, code: `OT-HD-${woSeq}`,
      type: 'CORRECTIVE', priority: ticket.priority,
      status: 'OPEN', equipmentId: ticket.equipmentId,
      helpdeskTicketId: id, notes: ticket.description,
    });
    await db.update(helpdeskTickets).set({ status: 'IN_PROGRESS', relatedWorkOrderId: woId }).where(eq(helpdeskTickets.id, id));
    return json({ workOrderId: woId }, 201);
  }

  return json({ error: 'Sub-acción no reconocida' }, 400);
};
