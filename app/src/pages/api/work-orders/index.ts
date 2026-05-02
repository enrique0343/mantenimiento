import type { APIRoute } from 'astro';
import { getDb, newId } from '../../../lib/db';
import { workOrders, equipment, users } from '../../../lib/schema';
import { json } from '../../../lib/utils';
import { eq, and, desc } from 'drizzle-orm';

let woCounter = 0;
function genCode(): string {
  const dt = new Date();
  const y  = dt.getFullYear();
  const seq = String(++woCounter).padStart(4, '0');
  return `OT-${y}-${seq}`;
}

export const GET: APIRoute = async ({ locals, url }) => {
  const env  = (locals.runtime as any).env as Env;
  const user = locals.user!;
  const db   = getDb(env.DB);

  const status      = url.searchParams.get('status');
  const type        = url.searchParams.get('type');
  const techId      = url.searchParams.get('technician');
  const equipmentId = url.searchParams.get('equipment');

  const conditions: ReturnType<typeof eq>[] = [];
  if (status)      conditions.push(eq(workOrders.status, status));
  if (type)        conditions.push(eq(workOrders.type, type));
  if (equipmentId) conditions.push(eq(workOrders.equipmentId, equipmentId));

  // Provider role sees only their orders
  if (user.role === 'PROVIDER') conditions.push(eq(workOrders.providerId, user.sub));
  // Technician role sees only their orders
  if (user.role === 'TECHNICIAN') conditions.push(eq(workOrders.technicianId, user.sub));
  if (techId) conditions.push(eq(workOrders.technicianId, techId));

  const rows = await db
    .select({
      id: workOrders.id, code: workOrders.code, type: workOrders.type,
      priority: workOrders.priority, status: workOrders.status,
      scheduledDate: workOrders.scheduledDate, startedAt: workOrders.startedAt,
      completedAt: workOrders.completedAt, createdAt: workOrders.createdAt,
      equipmentId: workOrders.equipmentId, technicianId: workOrders.technicianId,
      equipmentName: equipment.name, equipmentCode: equipment.code,
    })
    .from(workOrders)
    .leftJoin(equipment, eq(workOrders.equipmentId, equipment.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(workOrders.createdAt))
    .limit(100)
    .all();

  return json(rows);
};

export const POST: APIRoute = async ({ locals, request }) => {
  const env  = (locals.runtime as any).env as Env;
  const user = locals.user!;
  if (['VIEWER', 'PROVIDER'].includes(user.role)) return json({ error: 'Sin permiso' }, 403);

  const db = getDb(env.DB);
  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  if (!body.equipmentId || !body.type) return json({ error: 'equipmentId y type requeridos' }, 400);

  const id   = newId();
  const code = genCode();

  await db.insert(workOrders).values({
    id, code,
    type:        body.type,
    priority:    body.priority ?? 'MEDIUM',
    status:      'OPEN',
    equipmentId: body.equipmentId,
    technicianId:body.technicianId,
    providerId:  body.providerId,
    helpdeskTicketId: body.helpdeskTicketId,
    scheduledDate: body.scheduledDate,
    estimatedHours: body.estimatedHours,
    checklist: body.checklist ? JSON.stringify(body.checklist) : null,
    notes: body.notes,
  });

  return json({ id, code }, 201);
};
