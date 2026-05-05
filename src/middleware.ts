import { defineMiddleware } from "astro:middleware";
import { getCurrentUser } from "./lib/auth";

const PUBLIC_PATHS = new Set(["/login"]);
const PUBLIC_PATH_PREFIXES = ["/soporte", "/encuesta", "/solicitudes-compra/r"];
const PUBLIC_API_PREFIXES = [
  "/api/auth/", "/api/cron/", "/api/tickets/publico", "/api/tickets/track/",
  "/api/encuestas/", "/api/calendar/", "/api/telegram/",
  "/api/solicitudes-compra/r/", "/api/solicitudes-compra/adjunto/",
];

function isPublic(path: string): boolean {
  // Normaliza eliminando trailing slash (excepto la raíz)
  const norm = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;

  if (PUBLIC_PATHS.has(norm)) return true;
  for (const p of PUBLIC_PATH_PREFIXES) {
    if (norm === p || norm.startsWith(p + "/")) return true;
  }
  for (const p of PUBLIC_API_PREFIXES) {
    if (norm.startsWith(p)) return true;
  }
  return false;
}

export const onRequest = defineMiddleware(async (ctx, next) => {
  const url = new URL(ctx.request.url);
  const path = url.pathname;

  const user = await getCurrentUser(ctx).catch(() => null);
  if (user) ctx.locals.user = user;

  if (isPublic(path)) {
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
