import type { APIRoute } from 'astro';
import { getDb, newId } from '../../../lib/db';
import { maintenancePlans, equipment } from '../../../lib/schema';
import { json } from '../../../lib/utils';
import { eq, gte, lte, and } from 'drizzle-orm';

export const GET: APIRoute = async ({ locals, url }) => {
  const env = (locals.runtime as any).env as Env;
  const db  = getDb(env.DB);

  const upcoming = url.searchParams.get('upcoming');

  if (upcoming) {
    const days = parseInt(upcoming) || 7;
    const until = new Date(Date.now() + days * 864e5).toISOString();
    const rows = await db
      .select({
        id: maintenancePlans.id, frequency: maintenancePlans.frequency,
        nextDueDate: maintenancePlans.nextDueDate, alertDaysBefore: maintenancePlans.alertDaysBefore,
        estimatedHours: maintenancePlans.estimatedHours, equipmentId: maintenancePlans.equipmentId,
        equipmentName: equipment.name, equipmentCode: equipment.code,
      })
      .from(maintenancePlans)
      .leftJoin(equipment, eq(maintenancePlans.equipmentId, equipment.id))
      .where(and(eq(maintenancePlans.active, true), lte(maintenancePlans.nextDueDate, until)))
      .all();
    return json(rows);
  }

  const rows = await db
    .select({
      id: maintenancePlans.id, frequency: maintenancePlans.frequency,
      nextDueDate: maintenancePlans.nextDueDate, active: maintenancePlans.active,
      estimatedHours: maintenancePlans.estimatedHours, equipmentId: maintenancePlans.equipmentId,
      equipmentName: equipment.name,
    })
    .from(maintenancePlans)
    .leftJoin(equipment, eq(maintenancePlans.equipmentId, equipment.id))
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

  const { equipmentId, frequency, nextDueDate } = body;
  if (!equipmentId || !frequency || !nextDueDate) return json({ error: 'equipmentId, frequency, nextDueDate requeridos' }, 400);

  const id = newId();
  await db.insert(maintenancePlans).values({
    id, equipmentId, frequency, nextDueDate,
    alertDaysBefore:      body.alertDaysBefore ?? 7,
    checklistTemplate:    body.checklistTemplate ? JSON.stringify(body.checklistTemplate) : null,
    estimatedHours:       body.estimatedHours,
    assignedToUserId:     body.assignedToUserId,
    assignedToProviderId: body.assignedToProviderId,
  });
  return json({ id }, 201);
};
