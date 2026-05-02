import type { APIRoute } from 'astro';
import { getDb, newId, newToken } from '../../../../lib/db';
import { helpdeskTickets, branches } from '../../../../lib/schema';
import { json, slaDueDate } from '../../../../lib/utils';
import { eq, and, desc } from 'drizzle-orm';

let ticketCounter = 0;
function genCode(): string {
  const y = new Date().getFullYear();
  return `HD-${y}-${String(++ticketCounter).padStart(4, '0')}`;
}

// GET — internal list (requires auth, handled by middleware)
export const GET: APIRoute = async ({ locals, url }) => {
  const env = (locals.runtime as any).env as Env;
  const db  = getDb(env.DB);

  const status   = url.searchParams.get('status');
  const branchId = url.searchParams.get('branch');

  const conditions: ReturnType<typeof eq>[] = [];
  if (status)   conditions.push(eq(helpdeskTickets.status, status));
  if (branchId) conditions.push(eq(helpdeskTickets.branchId, branchId));

  const rows = await db
    .select({
      id: helpdeskTickets.id, code: helpdeskTickets.code,
      requesterName: helpdeskTickets.requesterName,
      requesterEmail: helpdeskTickets.requesterEmail,
      area: helpdeskTickets.area, priority: helpdeskTickets.priority,
      status: helpdeskTickets.status, requestType: helpdeskTickets.requestType,
      slaDeadline: helpdeskTickets.slaDeadline,
      createdAt: helpdeskTickets.createdAt,
      branchName: branches.name,
    })
    .from(helpdeskTickets)
    .leftJoin(branches, eq(helpdeskTickets.branchId, branches.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(helpdeskTickets.createdAt))
    .limit(100)
    .all();

  return json(rows);
};

// POST — public form submit (no auth required — allowed in middleware)
export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals.runtime as any).env as Env;
  const db  = getDb(env.DB);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const { requesterName, requesterEmail, branchId, area, requestType, priority, description } = body;
  if (!requesterName || !requesterEmail || !branchId || !area || !requestType || !priority || !description) {
    return json({ error: 'Todos los campos requeridos deben ser completados' }, 400);
  }

  const [branch] = await db.select({ id: branches.id }).from(branches).where(eq(branches.id, branchId)).limit(1);
  if (!branch) return json({ error: 'Sucursal no encontrada' }, 400);

  const id     = newId();
  const code   = genCode();
  const token  = newToken(32);

  await db.insert(helpdeskTickets).values({
    id, code, trackingToken: token,
    requesterName, requesterEmail,
    requesterPhone: body.requesterPhone,
    branchId, area, requestType, priority, description,
    attachments: body.attachments ? JSON.stringify(body.attachments) : null,
    status: 'OPEN',
    slaDeadline: slaDueDate(priority),
    equipmentId: body.equipmentId ?? null,
  });

  return json({ id, code, trackingToken: token }, 201);
};
