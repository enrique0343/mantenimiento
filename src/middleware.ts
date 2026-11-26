import { defineMiddleware } from "astro:middleware";
import { handleSgoRequest, handleSnapshotPublish } from "./lib/sgo/handler.mjs";
import { getCurrentUser } from "./lib/auth";
import { parseArea } from "./lib/areas";
import { getDb } from "./lib/db";
import { activos, ordenes, tickets, actividades, conjuntos, planesMantenimiento } from "./lib/schema";
import { eq } from "drizzle-orm";
import { rubroDeActivo, rubroDeActividad } from "./lib/rubros";
import {
  ESPACIO_KEYS, COOKIE_ESPACIO, PAGINA_OTRO_ESPACIO, PARAM_ESPACIO, espacioDeArea, espacioDeRuta, espaciosPermitidos, opcionesCookieEspacio, puedeEntrar,
  espacioDeTrabajo, gestionaEspacio, registroDeRuta, resolverEspacio, respuestaOtroEspacio, rutaDecodificada, type Espacio,
} from "./lib/espacio";
import { esSolicitudPropia } from "./lib/ticket-acceso";
import { espacioDeProyectoId } from "./lib/espacio-db";

/** Espacio de una orden o solicitud guardada: su rubro o, sin rubro, el de su equipo. */
async function espacioDeTrabajoGuardado(db: ReturnType<typeof getDb>, rubro: string | null, activoId: number | null): Promise<Espacio> {
  if (rubro || !activoId) return espacioDeTrabajo(rubro, null);
  const [a] = await db.select({ rubro: activos.rubro, tipo: activos.tipo }).from(activos).where(eq(activos.id, activoId)).limit(1);
  return espacioDeTrabajo(null, a ?? null);
}

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
  // La ruta decodificada, igual que la usa Astro para elegir la página y sus params:
  // con la cruda, «/api/ordenes/%32%30%34» o «/%63alibraciones» saltaban el control del espacio.
  const path = rutaDecodificada(url.pathname);
  if (path === null) return new Response("Dirección no válida", { status: 400 });

  // A separate server principal protects the integration before cookie auth.
  // No human role or public-path exemption authorizes this namespace.
  if (path === "/api/integraciones/sgo/v1" || path.startsWith("/api/integraciones/sgo/v1/")) {
    return handleSgoRequest(ctx.request, ctx.locals.runtime?.env);
  }
  if (path === "/api/cron/sgo-snapshot" || path === "/api/cron/sgo-snapshot/") {
    return handleSnapshotPublish(ctx.request, ctx.locals.runtime?.env);
  }

  const user = await getCurrentUser(ctx).catch(() => null);
  if (user) {
    ctx.locals.user = user;
    // Espacio de trabajo (src/lib/espacio.ts): el pedido en ?espacio= si se puede,
    // si no el último recordado, si no el primero permitido. Se recuerda en la cookie.
    // cookies?.: las pruebas que llaman al middleware sin cookies siguen sirviendo.
    const cookieEspacio = ctx.cookies?.get(COOKIE_ESPACIO)?.value ?? null;
    const espacio = resolverEspacio(user, cookieEspacio, url.searchParams.get(PARAM_ESPACIO));
    ctx.locals.espacio = espacio;
    ctx.locals.espaciosPermitidos = espaciosPermitidos(user);
    if (url.searchParams.has(PARAM_ESPACIO) && espacio !== cookieEspacio) {
      ctx.cookies?.set(COOKIE_ESPACIO, espacio, opcionesCookieEspacio(url.protocol === "https:"));
    }
  }

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

  // Modo técnico: el técnico entra directo a su pantalla de trabajo.
  if (user.rol === "tecnico" && (path === "/" || path === "/mi-panel" || path === "/mi-panel/")) {
    return ctx.redirect("/campo");
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
  // from a notification or QR without a query string. The API only looks the
  // record up for users locked to one space (the others may read both).
  const registro = registroDeRuta(path);
  let espacioRegistro: Espacio | null = null;
  let solicitudPropia = false;
  if (registro && (!registro.api || ctx.locals.espaciosPermitidos!.length < ESPACIO_KEYS.length)) {
    const db = getDb(ctx);
    const { tipo, id } = registro;
    let areaRegistro: ReturnType<typeof parseArea> = null;
    if (tipo === "conjuntos") {
      const [c] = await db.select({ rubro: conjuntos.rubro }).from(conjuntos).where(eq(conjuntos.id, id)).limit(1);
      if (c) areaRegistro = parseArea(c.rubro);
    } else if (tipo === "activos") {
      const [a] = await db.select({ rubro: activos.rubro, tipo: activos.tipo }).from(activos).where(eq(activos.id, id)).limit(1);
      if (a) areaRegistro = rubroDeActivo(a.rubro, a.tipo);
    } else if (tipo === "planes") {
      const [a] = await db.select({ rubro: activos.rubro, tipo: activos.tipo }).from(planesMantenimiento).innerJoin(activos, eq(activos.id, planesMantenimiento.activoId)).where(eq(planesMantenimiento.id, id)).limit(1);
      if (a) areaRegistro = rubroDeActivo(a.rubro, a.tipo);
    } else if (tipo === "actividades") {
      const [a] = await db.select({ rubro: actividades.rubro }).from(actividades).where(eq(actividades.id, id)).limit(1);
      if (a) areaRegistro = rubroDeActividad(a.rubro);
    } else if (tipo === "ordenes" || tipo === "firmas") {
      const [o] = await db.select({ rubro: ordenes.rubro, estado: ordenes.estado, asignadoA: ordenes.asignadoA, activoId: ordenes.activoId }).from(ordenes).where(eq(ordenes.id, id)).limit(1);
      if (o) areaRegistro = parseArea(o.rubro);
      // Un aviso o un correo también lleva al técnico a su pantalla de trabajo,
      // con cualquier tipo de orden: la emergencia y la intervención también se
      // trabajan en el celular. ?completa=1 abre la ficha (para verificar).
      if (
        o && !registro.api && user.rol === "tecnico" && /^\/ordenes\/\d+\/?$/.test(path) && !url.searchParams.has("completa")
        && ["abierta", "en_proceso", "en_espera"].includes(o.estado)
        && (o.asignadoA === user.id || !o.asignadoA)
      ) {
        return ctx.redirect(`/campo#orden-${id}`);
      }
      // Sin rubro, la orden es del espacio de su equipo (como la serie OT-MB/OT-MG).
      if (o) espacioRegistro = await espacioDeTrabajoGuardado(db, o.rubro, o.activoId);
    } else if (tipo === "proyectos") {
      // Sin rubro: el espacio de su equipo o, sin equipo, el de su solicitud.
      espacioRegistro = await espacioDeProyectoId(db, id);
    } else {
      const [t] = await db.select({ rubro: tickets.rubro, activoId: tickets.activoId, solicitanteUsuarioId: tickets.solicitanteUsuarioId, solicitanteEmail: tickets.solicitanteEmail }).from(tickets).where(eq(tickets.id, id)).limit(1);
      if (t) { areaRegistro = parseArea(t.rubro); solicitudPropia = esSolicitudPropia(user, t); }
      if (t) espacioRegistro = await espacioDeTrabajoGuardado(db, t.rubro, t.activoId);
    }
    if (areaRegistro) {
      espacioRegistro ??= espacioDeArea(areaRegistro);
      if (!registro.api) ctx.locals.area = areaRegistro;
    }
  }

  // El solicitante abre sus solicitudes de los dos espacios sin el aviso: la página
  // se arma en el espacio de la solicitud (no gestiona ninguno, no tiene interruptor).
  if (registro?.tipo === "tickets" && !gestionaEspacio(user)) {
    if (!solicitudPropia) return new Response("No autorizado", { status: 403 });
    if (!espacioRegistro) return next();
    ctx.locals.espacio = espacioRegistro;
    return next();
  }
  // Espacio de lo pedido: la ruta (solo de un espacio), el registro o el área.
  const destino = espacioDeRuta(path) ?? espacioRegistro ?? (ctx.locals.area ? espacioDeArea(ctx.locals.area) : null);
  if (destino && destino !== ctx.locals.espacio) {
    const puede = puedeEntrar(user, destino);
    if (path.startsWith("/api/")) {
      // Quien tiene los dos espacios puede leer el otro; quien está atado a uno, no.
      if (!puede) return respuestaOtroEspacio(destino);
    } else {
      // La página no se arma: en su lugar va el aviso, sin datos del registro.
      ctx.locals.avisoEspacio = { espacio: destino, puedeCambiar: puede, volver: path + url.search };
      return next(PAGINA_OTRO_ESPACIO);
    }
  }
  return next();
});
