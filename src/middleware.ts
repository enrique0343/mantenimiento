import { defineMiddleware } from "astro:middleware";
import { getCurrentUser } from "./lib/auth";

const PUBLIC_PATHS = new Set(["/login"]);
const PUBLIC_API_PREFIXES = ["/api/auth/"];

export const onRequest = defineMiddleware(async (ctx, next) => {
  const url = new URL(ctx.request.url);
  const path = url.pathname;

  const user = await getCurrentUser(ctx).catch(() => null);
  if (user) ctx.locals.user = user;

  if (PUBLIC_PATHS.has(path) || PUBLIC_API_PREFIXES.some((p) => path.startsWith(p))) {
    return next();
  }

  if (!user) {
    if (path.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "No autenticado" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return ctx.redirect(`/login?next=${encodeURIComponent(path)}`);
  }

  return next();
});
