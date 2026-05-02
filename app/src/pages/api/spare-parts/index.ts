import type { APIRoute } from 'astro';
import { getDb, newId } from '../../../lib/db';
import { spareParts, sparePartStock, branches } from '../../../lib/schema';
import { json } from '../../../lib/utils';
import { eq, lte, sql } from 'drizzle-orm';

export const GET: APIRoute = async ({ locals, url }) => {
  const env = (locals.runtime as any).env as Env;
  const db  = getDb(env.DB);

  const alertsOnly = url.searchParams.get('alerts') === '1';

  if (alertsOnly) {
    const rows = await db
      .select({ id: sparePartStock.id, sparePartId: sparePartStock.sparePartId,
        quantity: sparePartStock.quantity, minStock: sparePartStock.minStock,
        name: spareParts.name, code: spareParts.code, unit: spareParts.unit,
        branchId: sparePartStock.branchId, branchName: branches.name,
      })
      .from(sparePartStock)
      .leftJoin(spareParts, eq(sparePartStock.sparePartId, spareParts.id))
      .leftJoin(branches, eq(sparePartStock.branchId, branches.id))
      .where(lte(sparePartStock.quantity, sparePartStock.minStock))
      .all();
    return json(rows);
  }

  const rows = await db
    .select({ id: spareParts.id, code: spareParts.code, name: spareParts.name,
      unit: spareParts.unit, category: spareParts.category, description: spareParts.description })
    .from(spareParts).all();
  return json(rows);
};

export const POST: APIRoute = async ({ locals, request }) => {
  const env  = (locals.runtime as any).env as Env;
  const user = locals.user!;
  if (!['ADMIN', 'CHIEF'].includes(user.role)) return json({ error: 'Sin permiso' }, 403);

  const db = getDb(env.DB);
  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const { code, name, unit = 'UND' } = body;
  if (!code || !name) return json({ error: 'code y name requeridos' }, 400);

  const id = newId();
  await db.insert(spareParts).values({ id, ...body, unit });
  return json({ id }, 201);
};
