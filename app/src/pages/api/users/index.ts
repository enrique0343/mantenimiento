import type { APIRoute } from 'astro';
import { getDb, newId } from '../../../lib/db';
import { users } from '../../../lib/schema';
import { hashPassword } from '../../../lib/auth';
import { json } from '../../../lib/utils';
import { eq } from 'drizzle-orm';

export const GET: APIRoute = async ({ locals }) => {
  const env  = (locals.runtime as any).env as Env;
  const user = locals.user!;
  if (!['ADMIN', 'CHIEF'].includes(user.role)) return json({ error: 'Sin permiso' }, 403);

  const db = getDb(env.DB);
  const rows = await db.select({
    id: users.id, email: users.email, name: users.name,
    role: users.role, branchId: users.branchId, active: users.active, createdAt: users.createdAt,
  }).from(users).all();
  return json(rows);
};

export const POST: APIRoute = async ({ locals, request }) => {
  const env  = (locals.runtime as any).env as Env;
  const user = locals.user!;
  if (user.role !== 'ADMIN') return json({ error: 'Sin permiso' }, 403);

  const db = getDb(env.DB);
  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const { name, email, password, role } = body;
  if (!name || !email || !password || !role) return json({ error: 'name, email, password, role requeridos' }, 400);

  const id     = newId();
  const hashed = await hashPassword(password);
  await db.insert(users).values({ id, name, email: email.toLowerCase(), password: hashed, role, branchId: body.branchId });
  return json({ id }, 201);
};
