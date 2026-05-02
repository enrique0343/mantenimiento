import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import type { APIContext } from "astro";

export function getDb(ctx: APIContext | { locals: App.Locals }) {
  const env = (ctx.locals as any).runtime?.env as Env | undefined;
  if (!env?.DB) {
    throw new Error("D1 binding 'DB' no disponible. Revisa wrangler.toml o ejecuta con `astro dev`.");
  }
  return drizzle(env.DB, { schema });
}

export function getEnv(ctx: APIContext | { locals: App.Locals }): Env {
  const env = (ctx.locals as any).runtime?.env as Env | undefined;
  if (!env) throw new Error("Cloudflare runtime no disponible");
  return env;
}

export { schema };
