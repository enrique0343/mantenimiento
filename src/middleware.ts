import { defineMiddleware } from "astro:middleware";
import { getCurrentUser } from "./lib/auth";

const PUBLIC_PATHS = new Set(["/login"]);
const PUBLIC_PATH_PREFIXES = ["/soporte", "/encuesta"];
const PUBLIC_API_PREFIXES = ["/api/auth/", "/api/cron/", "/api/tickets/publico", "/api/tickets/track/", "/api/encuestas/", "/api/calendar/", "/api/telegram/"];

export const onRequest = defineMiddleware(async (ctx, next) => {
  const url = new URL(ctx.request.url);
  const path = url.pathname;

  const user = await getCurrentUser(ctx).catch(() => null);
  if (user) ctx.locals.user = user;

  if (
    PUBLIC_PATHS.has(path) ||
    PUBLIC_PATH_PREFIXES.some((p) => path === p || path.startsWith(p + "/")) ||
    PUBLIC_API_PREFIXES.some((p) => path.startsWith(p))
  ) {
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
