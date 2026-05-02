import type { APIRoute } from 'astro';
import { getDb, newId } from '../../../lib/db';
import { equipment, locations, branches } from '../../../lib/schema';
import { json } from '../../../lib/utils';
import { eq, like, and, sql } from 'drizzle-orm';

export const GET: APIRoute = async ({ locals, url }) => {
  const env = (locals.runtime as any).env as Env;
  const db  = getDb(env.DB);

  const branchId = url.searchParams.get('branch');
  const type     = url.searchParams.get('type');
  const status   = url.searchParams.get('status');
  const search   = url.searchParams.get('q');

  const conditions: ReturnType<typeof eq>[] = [];
  if (type)   conditions.push(eq(equipment.type,   type));
  if (status) conditions.push(eq(equipment.status, status));

  const rows = await db
    .select({
      id: equipment.id, code: equipment.code, name: equipment.name,
      brand: equipment.brand, model: equipment.model, type: equipment.type,
      status: equipment.status, category: equipment.category,
      locationId: equipment.locationId, qrCode: equipment.qrCode,
      area: locations.area, branchName: branches.name, branchId: branches.id,
    })
    .from(equipment)
    .leftJoin(locations, eq(equipment.locationId, locations.id))
    .leftJoin(branches, eq(locations.branchId, branches.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .all();

  const filtered = rows.filter(r => {
    if (branchId && r.branchId !== branchId) return false;
    if (search) {
      const q = search.toLowerCase();
      return r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q);
    }
    return true;
  });

  return json(filtered);
};

export const POST: APIRoute = async ({ locals, request }) => {
  const env  = (locals.runtime as any).env as Env;
  const user = locals.user!;
  if (!['ADMIN', 'CHIEF'].includes(user.role)) return json({ error: 'Sin permiso' }, 403);

  const db = getDb(env.DB);
  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const { name, code, category, type = 'GENERAL' } = body;
  if (!name || !code || !category) return json({ error: 'name, code, category son requeridos' }, 400);

  const id     = newId();
  const qrCode = `${(env.BASE_URL ?? '')}${id}`;

  await db.insert(equipment).values({ id, qrCode, ...body });
  return json({ id, qrCode }, 201);
};
