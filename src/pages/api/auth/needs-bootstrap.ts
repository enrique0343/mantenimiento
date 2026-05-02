import type { APIRoute } from "astro";
import { getDb } from "@/lib/db";
import { usuarios } from "@/lib/schema";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const db = getDb(ctx);
  const rows = await db.select({ id: usuarios.id }).from(usuarios).limit(1);
  return Response.json({ needsBootstrap: rows.length === 0 });
};
