import { SignJWT, jwtVerify } from "jose";
import type { APIContext } from "astro";
import { getDb, getEnv } from "./db";
import { usuarios } from "./schema";
import { eq } from "drizzle-orm";

const COOKIE_NAME = "mant_session";
const ITERATIONS = 100_000;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    key,
    256
  );
  return `pbkdf2$${ITERATIONS}$${toBase64(salt.buffer)}$${toBase64(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterStr, saltB64, hashB64] = stored.split("$");
  if (scheme !== "pbkdf2") return false;
  const iterations = parseInt(iterStr, 10);
  const salt = fromBase64(saltB64);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256
  );
  const got = toBase64(bits);
  if (got.length !== hashB64.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ hashB64.charCodeAt(i);
  return diff === 0;
}

function getSecretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(
  payload: { sub: number; email: string; nombre: string; rol: string },
  secret: string
): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecretKey(secret));
}

export async function readSessionToken(token: string, secret: string) {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(secret));
    return payload as { sub: number; email: string; nombre: string; rol: string };
  } catch {
    return null;
  }
}

export function setSessionCookie(headers: Headers, token: string) {
  headers.append(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`
  );
}

export function clearSessionCookie(headers: Headers) {
  headers.append("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

export function readSessionCookie(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function getCurrentUser(ctx: APIContext) {
  const env = getEnv(ctx);
  const token = readSessionCookie(ctx.request);
  if (!token) return null;
  const data = await readSessionToken(token, env.JWT_SECRET);
  if (!data) return null;
  const db = getDb(ctx);
  const rows = await db.select().from(usuarios).where(eq(usuarios.id, data.sub)).limit(1);
  const u = rows[0];
  if (!u || !u.activo) return null;
  return { id: u.id, email: u.email, nombre: u.nombre, rol: u.rol };
}

export async function requireUser(ctx: APIContext, roles?: Array<"admin" | "tecnico" | "solicitante">) {
  const user = await getCurrentUser(ctx);
  if (!user) {
    return { user: null as null, response: new Response("No autenticado", { status: 401 }) };
  }
  if (roles && !roles.includes(user.rol as any)) {
    return { user: null as null, response: new Response("Sin permisos", { status: 403 }) };
  }
  return { user, response: null as null };
}

export async function countUsers(ctx: APIContext): Promise<number> {
  const db = getDb(ctx);
  const rows = await db.select({ id: usuarios.id }).from(usuarios).limit(1);
  if (rows.length === 0) return 0;
  const all = await db.select({ id: usuarios.id }).from(usuarios);
  return all.length;
}
