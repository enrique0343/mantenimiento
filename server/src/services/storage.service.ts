import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// ── Detectar modo de storage ──────────────────────────────────────────────────
const useLocal = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY;

// ── Storage local ─────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

function ensureDir(folder: string) {
  const dir = path.join(UPLOADS_DIR, folder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function uploadLocal(buffer: Buffer, mimeType: string, folder: string): Promise<string> {
  const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'bin';
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const dir = ensureDir(folder);
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `${BASE_URL}/uploads/${folder}/${filename}`;
}

async function deleteLocal(url: string): Promise<void> {
  const relative = url.replace(`${BASE_URL}/uploads/`, '');
  const fullPath = path.join(UPLOADS_DIR, relative);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
}

// ── Storage Supabase ───────────────────────────────────────────────────────────
const BUCKET = process.env.SUPABASE_BUCKET || 'maintenance-files';

function getSupabase() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
}

async function uploadSupabase(buffer: Buffer, mimeType: string, folder: string): Promise<string> {
  const ext = mimeType.split('/')[1] || 'bin';
  const filePath = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const supabase = getSupabase();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, buffer, { contentType: mimeType, upsert: false });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
}

async function deleteSupabase(url: string): Promise<void> {
  const filePath = url.split(`/${BUCKET}/`)[1];
  if (!filePath) return;
  const supabase = getSupabase();
  await supabase.storage.from(BUCKET).remove([filePath]);
}

// ── API pública ───────────────────────────────────────────────────────────────
export async function uploadFile(buffer: Buffer, mimeType: string, folder: string): Promise<string> {
  if (useLocal) return uploadLocal(buffer, mimeType, folder);
  return uploadSupabase(buffer, mimeType, folder);
}

export async function deleteFile(url: string): Promise<void> {
  if (useLocal) return deleteLocal(url);
  return deleteSupabase(url);
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

export function validateImage(buffer: Buffer, mimeType: string): void {
  if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) {
    throw new Error('Tipo de archivo no permitido. Use JPG, PNG o WEBP.');
  }
  if (buffer.length > MAX_IMAGE_SIZE) {
    throw new Error('La imagen supera el tamaño máximo de 5 MB.');
  }
}

export function isLocalStorage(): boolean {
  return useLocal;
}
