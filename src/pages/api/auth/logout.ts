import type { APIRoute } from "astro";
import { clearSessionCookie } from "@/lib/auth";

export const prerender = false;

export const POST: APIRoute = async () => {
  const headers = new Headers({ "content-type": "application/json" });
  clearSessionCookie(headers);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
};
