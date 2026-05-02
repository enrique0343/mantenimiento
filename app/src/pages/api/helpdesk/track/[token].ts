import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { helpdeskTickets, ticketComments } from '../../../../lib/schema';
import { json } from '../../../../lib/utils';
import { eq } from 'drizzle-orm';

export const GET: APIRoute = async ({ params, locals }) => {
  const env = (locals.runtime as any).env as Env;
  const db  = getDb(env.DB);

  const [ticket] = await db.select().from(helpdeskTickets)
    .where(eq(helpdeskTickets.trackingToken, params.token!)).limit(1);
  if (!ticket) return json({ error: 'Ticket no encontrado' }, 404);

  const comments = await db.select().from(ticketComments)
    .where(eq(ticketComments.ticketId, ticket.id)).all();

  return json({
    ...ticket,
    comments: comments.filter(c => !c.isInternal),
  });
};
