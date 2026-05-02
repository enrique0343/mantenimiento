import { defineMiddleware } from 'astro:middleware';
import { verifyJwt, getTokenFromRequest } from './lib/auth';

const PUBLIC_PATHS = [
  '/login',
  '/setup',
  '/api/auth/login',
  '/api/auth/register-admin',
  '/helpdesk/nuevo',
  '/helpdesk/ticket/',
  '/api/helpdesk/tickets',         // POST (public form submit)
  '/api/helpdesk/track/',
];

function isPublic(pathname: string): boolean {
  if (pathname === '/') return false;
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p));
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, locals, redirect } = context;
  const url = new URL(request.url);

  if (isPublic(url.pathname)) return next();

  // Resolve D1 binding and JWT_SECRET from Cloudflare runtime env
  const runtime = context.locals.runtime as { env: Record<string, unknown> } | undefined;
  const env = runtime?.env ?? {};
  const secret = (env['JWT_SECRET'] as string | undefined) ?? 'dev-secret-change-me';

  const token = getTokenFromRequest(request);
  if (!token) {
    if (url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    return redirect(`/login?next=${encodeURIComponent(url.pathname)}`);
  }

  const payload = await verifyJwt(token, secret);
  if (!payload) {
    if (url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Sesión expirada' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    return redirect('/login');
  }

  locals.user = payload;
  return next();
});
