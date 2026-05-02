import type { APIRoute } from 'astro';
import { getDb, newId } from '../../../lib/db';
import { verifyPassword, signJwt, makeSessionCookie } from '../../../lib/auth';
import { users } from '../../../lib/schema';
import { eq } from 'drizzle-orm';

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals.runtime as any).env as Env;
  const db  = getDb(env.DB);

  let body: { email?: string; password?: string };
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const { email, password } = body;
  if (!email || !password) return json({ error: 'Email y contraseña requeridos' }, 400);

  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  if (!user || !user.active) return json({ error: 'Credenciales inválidas' }, 401);

  const ok = await verifyPassword(password, user.password);
  if (!ok) return json({ error: 'Credenciales inválidas' }, 401);

  const secret = env.JWT_SECRET ?? 'dev-secret-change-me';
  const token  = await signJwt({ sub: user.id, role: user.role, name: user.name }, secret);

  return new Response(JSON.stringify({ ok: true, role: user.role, name: user.name }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie':   makeSessionCookie(token),
    },
  });
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
