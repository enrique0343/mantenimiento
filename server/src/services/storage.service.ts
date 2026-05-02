import { createClient } from '@supabase/supabase-js';
import { v4 as uuid } from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const BUCKET = process.env.SUPABASE_BUCKET || 'maintenance-files';

export async function uploadFile(
  buffer: Buffer,
  mimeType: string,
  folder: string
): Promise<string> {
  const ext = mimeType.split('/')[1] || 'bin';
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: mimeType, upsert: false });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function deleteFile(url: string): Promise<void> {
  const path = url.split(`/${BUCKET}/`)[1];
  if (!path) return;
  await supabase.storage.from(BUCKET).remove([path]);
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB

export function validateImage(buffer: Buffer, mimeType: string): void {
  if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) {
    throw new Error('Tipo de archivo no permitido. Use JPG, PNG o WEBP.');
  }
  if (buffer.length > MAX_IMAGE_SIZE) {
    throw new Error('La imagen supera el tamaño máximo de 5 MB.');
  }
}
