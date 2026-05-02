import type { APIRoute } from 'astro';
import { json } from '../../../lib/utils';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'image/svg+xml'];
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export const POST: APIRoute = async ({ request, locals }) => {
  const env  = (locals.runtime as any).env as Env;
  const user = locals.user!;

  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: 'FormData requerido' }, 400);

  const file = form.get('file') as File | null;
  if (!file) return json({ error: 'Campo "file" requerido' }, 400);
  if (!ALLOWED_TYPES.includes(file.type)) return json({ error: 'Tipo de archivo no permitido' }, 415);
  if (file.size > MAX_BYTES) return json({ error: 'Archivo demasiado grande (máx 5 MB)' }, 413);

  const folder = (form.get('folder') as string) || 'uploads';
  const ext    = file.name.split('.').pop() ?? 'bin';
  const key    = `${folder}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  await env.R2.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { uploadedBy: user.sub },
  });

  return json({ key }, 201);
};

// Serve files from R2 (signed — only authenticated users)
export const GET: APIRoute = async ({ url, locals }) => {
  const env  = (locals.runtime as any).env as Env;
  const key  = url.searchParams.get('key');
  if (!key) return json({ error: 'key requerido' }, 400);

  const obj = await env.R2.get(key);
  if (!obj) return new Response('No encontrado', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('cache-control', 'private, max-age=3600');

  return new Response(obj.body, { headers });
};
