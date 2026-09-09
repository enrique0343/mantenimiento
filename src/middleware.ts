import { defineMiddleware } from "astro:middleware";
import { getCurrentUser } from "./lib/auth";
import { parseArea } from "./lib/areas";
import { getDb } from "./lib/db";
import { activos, ordenes, tickets, actividades, conjuntos } from "./lib/schema";
import { eq } from "drizzle-orm";
import { rubroDeActivo, rubroDeActividad } from "./lib/rubros";

const PUBLIC_PATHS = new Set(["/login"]);
const PUBLIC_PATH_PREFIXES = ["/soporte", "/encuesta", "/solicitudes-compra/r"];
const PUBLIC_API_PREFIXES = [
  "/api/auth/", "/api/cron/", "/api/tickets/publico", "/api/tickets/track/",
  "/api/encuestas/", "/api/calendar/", "/api/telegram/",
  "/api/solicitudes-compra/r/", "/api/solicitudes-compra/adjunto/",
  "/api/empresa/logo",
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
    return ctx.redirect(`/login?next=${encodeURIComponent(path + url.search)}`);
  }

  const requestedArea = url.searchParams.get("area");
  if (requestedArea && !parseArea(requestedArea)) {
    return new Response("Área de mantenimiento no válida", { status: 400 });
  }
  const pathArea = parseArea(path.match(/^\/areas\/([^/]+)\/?$/)?.[1]);
  if (pathArea && requestedArea && pathArea !== requestedArea) {
    return new Response("El área no corresponde al espacio seleccionado", { status: 400 });
  }
  ctx.locals.area = pathArea ?? parseArea(requestedArea);
  // Detail pages derive their workspace from the saved record, even when opened
  // from a notification or QR without a query string.
  const recordPath = path.match(/^\/(activos|ordenes|tickets|actividades|conjuntos)\/(\d+)(?:\/|$)/);
  if (recordPath) {
    const db = getDb(ctx);
    const id = Number(recordPath[2]);
    if (recordPath[1] === "conjuntos") {
      const [c] = await db.select({ rubro: conjuntos.rubro }).from(conjuntos).where(eq(conjuntos.id, id)).limit(1);
      if (c) ctx.locals.area = parseArea(c.rubro);
    } else if (recordPath[1] === "activos") {
      const [a] = await db.select({ rubro: activos.rubro, tipo: activos.tipo }).from(activos).where(eq(activos.id, id)).limit(1);
      if (a) ctx.locals.area = rubroDeActivo(a.rubro, a.tipo);
    } else if (recordPath[1] === "actividades") {
      const [a] = await db.select({ rubro: actividades.rubro }).from(actividades).where(eq(actividades.id, id)).limit(1);
      if (a) ctx.locals.area = rubroDeActividad(a.rubro);
    } else if (recordPath[1] === "ordenes") {
      const [o] = await db.select({ rubro: ordenes.rubro }).from(ordenes).where(eq(ordenes.id, id)).limit(1);
      if (o) ctx.locals.area = parseArea(o.rubro);
    } else {
      const [t] = await db.select({ rubro: tickets.rubro }).from(tickets).where(eq(tickets.id, id)).limit(1);
      if (t) ctx.locals.area = parseArea(t.rubro);
    }
  }
  return next();
});
