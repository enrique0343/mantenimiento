import type { APIRoute } from 'astro';
import { getDb, newId } from '../../../lib/db';
import { branches } from '../../../lib/schema';
import { json } from '../../../lib/utils';

export const GET: APIRoute = async ({ locals }) => {
  const env = (locals.runtime as any).env as Env;
  const db  = getDb(env.DB);
  const rows = await db.select().from(branches).all();
  return json(rows);
};

export const POST: APIRoute = async ({ locals, request }) => {
  const env  = (locals.runtime as any).env as Env;
  const user = locals.user!;
  if (user.role !== 'ADMIN') return json({ error: 'Sin permiso' }, 403);

  const db = getDb(env.DB);
  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  if (!body.name) return json({ error: 'name requerido' }, 400);
  const id = newId();
  await db.insert(branches).values({ id, ...body });
  return json({ id }, 201);
};
