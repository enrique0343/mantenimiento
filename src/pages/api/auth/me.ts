import type { APIRoute } from "astro";
import { getCurrentUser } from "@/lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const user = await getCurrentUser(ctx);
  return Response.json({ user });
};
