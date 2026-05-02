import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export type DB = ReturnType<typeof getDb>;

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

/** Generates a URL-safe random ID (16 bytes = 22 chars base64url) */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Generates a hex token of `bytes` length */
export function newToken(bytes = 32): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return [...arr].map(b => b.toString(16).padStart(2, '0')).join('');
}
