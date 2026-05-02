import type { APIRoute } from 'astro';
import { getDb, newId } from '../../../lib/db';
import { hashPassword, signJwt, makeSessionCookie } from '../../../lib/auth';
import { users } from '../../../lib/schema';

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals.runtime as any).env as Env;
  const db  = getDb(env.DB);

  // Only allowed when no users exist yet
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) {
    return json({ error: 'El administrador ya existe. Use /login.' }, 403);
  }

  let body: { name?: string; email?: string; password?: string };
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const { name, email, password } = body;
  if (!name || !email || !password) return json({ error: 'Nombre, email y contraseña son requeridos' }, 400);
  if (password.length < 8) return json({ error: 'La contraseña debe tener al menos 8 caracteres' }, 400);

  const id       = newId();
  const hashed   = await hashPassword(password);

  await db.insert(users).values({
    id, name, email: email.toLowerCase(), password: hashed, role: 'ADMIN', active: true,
  });

  const secret = env.JWT_SECRET ?? 'dev-secret-change-me';
  const token  = await signJwt({ sub: id, role: 'ADMIN', name }, secret);

  return new Response(JSON.stringify({ ok: true }), {
    status: 201,
    headers: { 'content-type': 'application/json', 'set-cookie': makeSessionCookie(token) },
  });
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
