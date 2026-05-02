import type { APIRoute } from 'astro';
import { getDb, newId } from '../../../lib/db';
import { predictiveMeasurements } from '../../../lib/schema';
import { json } from '../../../lib/utils';
import { eq, desc } from 'drizzle-orm';

export const GET: APIRoute = async ({ locals, url }) => {
  const env = (locals.runtime as any).env as Env;
  const db  = getDb(env.DB);
  const equipmentId = url.searchParams.get('equipment');
  if (!equipmentId) return json({ error: 'equipment requerido' }, 400);

  const rows = await db.select().from(predictiveMeasurements)
    .where(eq(predictiveMeasurements.equipmentId, equipmentId))
    .orderBy(desc(predictiveMeasurements.recordedAt))
    .limit(200).all();
  return json(rows);
};

export const POST: APIRoute = async ({ locals, request }) => {
  const env  = (locals.runtime as any).env as Env;
  const user = locals.user!;
  if (user.role === 'VIEWER') return json({ error: 'Sin permiso' }, 403);

  const db = getDb(env.DB);
  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const { equipmentId, variable, unit, value } = body;
  if (!equipmentId || !variable || !unit || value === undefined) {
    return json({ error: 'equipmentId, variable, unit, value requeridos' }, 400);
  }

  const id = newId();
  await db.insert(predictiveMeasurements).values({
    id, equipmentId, variable, unit,
    value: Number(value),
    minThreshold: body.minThreshold != null ? Number(body.minThreshold) : null,
    maxThreshold: body.maxThreshold != null ? Number(body.maxThreshold) : null,
    recordedBy: user.name,
  });
  return json({ id }, 201);
};
