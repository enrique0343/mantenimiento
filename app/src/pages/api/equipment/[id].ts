import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { equipment, workOrders, predictiveMeasurements } from '../../../lib/schema';
import { json } from '../../../lib/utils';
import { eq, desc } from 'drizzle-orm';

export const GET: APIRoute = async ({ params, locals, url }) => {
  const env = (locals.runtime as any).env as Env;
  const db  = getDb(env.DB);
  const id  = params.id!;

  const sub = url.searchParams.get('sub');

  if (sub === 'history') {
    const rows = await db.select().from(workOrders).where(eq(workOrders.equipmentId, id))
      .orderBy(desc(workOrders.createdAt)).limit(50).all();
    return json(rows);
  }

  const [row] = await db.select().from(equipment).where(eq(equipment.id, id)).limit(1);
  if (!row) return json({ error: 'No encontrado' }, 404);
  return json(row);
};

export const PUT: APIRoute = async ({ params, locals, request }) => {
  const env  = (locals.runtime as any).env as Env;
  const user = locals.user!;
  if (!['ADMIN', 'CHIEF'].includes(user.role)) return json({ error: 'Sin permiso' }, 403);

  const db = getDb(env.DB);
  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const { id } = params;
  delete body.id;
  await db.update(equipment).set({ ...body }).where(eq(equipment.id, id!));
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const user = locals.user!;
  if (user.role !== 'ADMIN') return json({ error: 'Sin permiso' }, 403);

  const env = (locals.runtime as any).env as Env;
  const db  = getDb(env.DB);
  await db.update(equipment).set({ status: 'DECOMMISSIONED' }).where(eq(equipment.id, params.id!));
  return json({ ok: true });
};
