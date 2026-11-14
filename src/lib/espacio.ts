// ─── Espacios de trabajo: «General» y «Biomédico» ───────────────────────────
//
// CONTRATO (lo usan las pantallas, las API y el middleware; no cambiarlo sin
// cambiar sus pruebas en scripts/test-espacio.mjs).
//
// 1. Hay dos espacios en la misma app:
//    - 'general'   = Mantenimiento general: áreas aires, infraestructura y
//                    equipo_general, más rondas, AOP, EOP, eléctrico, flota,
//                    extintores, actividades y todo lo no biomédico.
//    - 'biomedico' = Ingeniería biomédica: área biomedico y lo de la fase 59
//                    (calibraciones, seguridad eléctrica, expedientes, licencias,
//                    capacitaciones, alertas, incidentes, cumplimiento JCI,
//                    plantillas, centros de costo y plan anual).
//    ESPACIOS trae la etiqueta del interruptor, el rótulo largo, los colores de
//    la barra lateral y de la franja superior, el título del tablero y las áreas.
//
// 2. Quién entra a cada espacio (espaciosPermitidos):
//    - admin y visualizador: a los dos (con interruptor).
//    - el resto de los roles, según su especialidad:
//        'general'   → solo General (sin interruptor)
//        'biomedico' → solo Biomédico (sin interruptor)
//        'ambos' o NULL → a los dos (con interruptor).
//      NULL se trata como 'ambos', igual que tipoActivoFiltro y jefesNotificar
//      en src/lib/especialidad.ts y el filtro de órdenes libres de /campo.
//    - sin usuario: ninguno ([]).
//
// 3. Qué espacio se usa en un request (resolverEspacio): el de ?espacio= si está
//    permitido; si no, el de la cookie COOKIE_ESPACIO si está permitido; si no,
//    el primero permitido (General antes que Biomédico). Nunca devuelve uno que
//    el usuario no tenga, salvo el caso sin usuario, que devuelve 'general'.
//
// 4. El middleware (src/middleware.ts) deja en cada request autenticado:
//      Astro.locals.espacio            → Espacio resuelto
//      Astro.locals.espaciosPermitidos → Espacio[] (length > 1 = hay interruptor)
//    y, si llega ?espacio= permitido distinto de la cookie, la actualiza (se
//    recuerda el último). No redirige ni cambia ninguna pantalla.
//
// 5. Filtrar en el SERVIDOR por espacio:
//    - activos: condicionActivoEspacio(e), sobre activoAreaExpression de
//      src/lib/areas.ts (la misma regla que rubroDeActivo, con los equipos
//      viejos sin rubro: tipo 'biomedico' → biomédico; lo demás → general).
//    - tablas con columna rubro (órdenes, tickets, actividades, conjuntos):
//      condicionRubroEspacio(columna, e). Un rubro NULL o desconocido es General.
//    - un registro suelto: espacioDeActivo({ rubro, tipo }) o espacioDeArea(area).
//    - un recurso del otro espacio: la página muestra «Este registro es del
//      espacio …» (con botón para cambiar si puedeEntrar), o 403 si no puede;
//      las API responden 403 JSON { error: mensajeOtroEspacio(e) } al usuario
//      que no puede entrar a ese espacio.
//
// 6. Común a los dos (no se filtra por espacio): usuarios, sedes y ubicaciones,
//    proveedores y empresas, compras y requisiciones, inventario de repuestos.
//
// 7. Rutas de un solo espacio (RUTAS_SOLO_GENERAL / RUTAS_SOLO_BIOMEDICO) y
//    registros (registroDeRuta): el middleware muestra en su lugar la página
//    /otro-espacio (aviso, con botón «Cambiar a …» si puedeEntrar; 403 si no) y,
//    en la API, responde 403 JSON al usuario que no puede entrar a ese espacio.
//    El interruptor es POST /api/espacio (cookie) o cualquier enlace con ?espacio=.
//
// 8. En páginas y API: espacioDelContexto(ctx, user) (locals.espacio o, sin
//    middleware, resolverEspacio) y espacioDeLista(ctx, user, area) cuando la
//    lista trae ?area= (manda el área, si el usuario entra a su espacio).
//
// 9. Más filtros sin parámetros: condicionActivoIdEspacio (planes y todo lo que
//    tiene activo_id), condicionTrabajoEspacio / condicionOrdenEspacio /
//    condicionTicketEspacio (órdenes y solicitudes: rubro y, sin rubro, el equipo,
//    como la serie OT-MB de la 0057), condicionRubroAreaEspacio (tablas solo con
//    rubro: conjuntos) y condicionLinkEspacio (campana).
//
// Puro salvo por drizzle (sql): sin base de datos ni Astro.
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { activoAreaExpression, type AreaKey } from "./areas";
import { rubroDeActivo } from "./rubros";
import { ordenes, tickets } from "./schema";

export type Espacio = "general" | "biomedico";
export const ESPACIO_KEYS = ["general", "biomedico"] as const satisfies readonly Espacio[];
export const COOKIE_ESPACIO = "espacio";
/** Página que el middleware muestra en lugar de la de otro espacio (src/pages/otro-espacio.astro). */
export const PAGINA_OTRO_ESPACIO = "/otro-espacio";
/** Nombre del parámetro de la URL que pide un espacio (?espacio=biomedico). */
export const PARAM_ESPACIO = "espacio";

export interface InfoEspacio {
  key: Espacio;
  /** Texto del interruptor «General | Biomédico». */
  etiqueta: string;
  /** Rótulo junto al logo. */
  rotulo: string;
  /** Fondo de la barra lateral. */
  colorBarra: string;
  /** Franja superior de 3px; null = sin franja. */
  colorFranja: string | null;
  /** Título de /preventivos en este espacio. */
  tablero: string;
  /** Áreas (src/lib/areas.ts) que el espacio incluye. */
  areas: readonly AreaKey[];
}

export const ESPACIOS: Record<Espacio, InfoEspacio> = {
  general: {
    key: "general",
    etiqueta: "General",
    rotulo: "Mantenimiento general",
    colorBarra: "#1E2142",
    colorFranja: null,
    tablero: "Tablero de preventivos",
    areas: ["aires", "infraestructura", "equipo_general"],
  },
  biomedico: {
    key: "biomedico",
    etiqueta: "Biomédico",
    rotulo: "Ingeniería biomédica",
    colorBarra: "#23417D",
    colorFranja: "#23417D",
    tablero: "Tablero biomédico",
    areas: ["biomedico"],
  },
};

/** Lo mínimo del usuario que hace falta (Astro.locals.user sirve tal cual). */
export type UsuarioEspacio = { rol: string; especialidad?: string | null } | null | undefined;

export function parseEspacio(valor: unknown): Espacio | null {
  return valor === "general" || valor === "biomedico" ? valor : null;
}

/** Roles que ven los dos espacios sin importar su especialidad. */
const ROLES_AMBOS = new Set(["admin", "visualizador"]);

export function espaciosPermitidos(user: UsuarioEspacio): Espacio[] {
  if (!user) return [];
  if (ROLES_AMBOS.has(user.rol)) return [...ESPACIO_KEYS];
  if (user.especialidad === "general") return ["general"];
  if (user.especialidad === "biomedico") return ["biomedico"];
  // 'ambos', NULL (o un valor que la base no admite): los dos, como hoy.
  return [...ESPACIO_KEYS];
}

/** true si el usuario puede entrar a ese espacio. */
export function puedeEntrar(user: UsuarioEspacio, e: Espacio): boolean {
  return espaciosPermitidos(user).includes(e);
}

/** true si el usuario tiene interruptor (más de un espacio). */
export function tieneInterruptor(user: UsuarioEspacio): boolean {
  return espaciosPermitidos(user).length > 1;
}

export function resolverEspacio(user: UsuarioEspacio, cookieValue: string | null | undefined, urlParam?: string | null): Espacio {
  const permitidos = espaciosPermitidos(user);
  for (const pedido of [parseEspacio(urlParam), parseEspacio(cookieValue)]) {
    if (pedido && permitidos.includes(pedido)) return pedido;
  }
  return permitidos[0] ?? "general";
}

export function areasDeEspacio(e: Espacio): AreaKey[] {
  return [...ESPACIOS[e].areas];
}

export function espacioDeArea(area: string | null | undefined): Espacio {
  return area === "biomedico" ? "biomedico" : "general";
}

/** Espacio de una fila de activos (rubro y tipo), con la regla de rubroDeActivo. */
export function espacioDeActivo(row: { rubro?: string | null; tipo?: string | null }): Espacio {
  return espacioDeArea(rubroDeActivo(row.rubro, row.tipo));
}

/** Condición de drizzle sobre activos: solo los equipos del espacio. */
export function condicionActivoEspacio(e: Espacio): SQL {
  return e === "biomedico"
    ? sql`${activoAreaExpression} = 'biomedico'`
    : sql`${activoAreaExpression} <> 'biomedico'`;
}

/**
 * Condición sobre una columna rubro (órdenes, tickets, actividades, conjuntos…).
 * Biomédico = 'biomedico'; General = todo lo demás, también NULL.
 */
export function condicionRubroEspacio(columna: SQLWrapper, e: Espacio): SQL {
  return e === "biomedico"
    ? sql`${columna} = 'biomedico'`
    : sql`(${columna} is null or ${columna} <> 'biomedico')`;
}

/** Texto del aviso (y del 403) para un recurso del otro espacio. */
export function mensajeOtroEspacio(e: Espacio): string {
  return `Este registro es del espacio ${ESPACIOS[e].etiqueta}.`;
}

/** Opciones de la cookie del espacio: un año, todo el sitio, solo el servidor la lee. */
export function opcionesCookieEspacio(seguro: boolean) {
  return { path: "/", httpOnly: true, sameSite: "lax" as const, secure: seguro, maxAge: 60 * 60 * 24 * 365 };
}

// ─── 7. Rutas que viven en un solo espacio ──────────────────────────────────
// Páginas y API que solo existen en un espacio. Lo que no está aquí es común o
// se filtra por los datos (listas) o por el registro (fichas).
export const RUTAS_SOLO_GENERAL = [
  "/ronda", "/rondas", "/aop", "/eop", "/electrico", "/actividades", "/catalogo-aires",
  "/api/ronda-turno", "/api/aop", "/api/electrico", "/api/actividades", "/api/catalogo-aires",
] as const;
export const RUTAS_SOLO_BIOMEDICO = [
  "/calibraciones", "/seguridad-electrica", "/expedientes", "/licencias", "/capacitaciones",
  "/alertas", "/incidentes", "/cumplimiento", "/configuracion/plantillas", "/centros-costo",
  "/api/calibraciones", "/api/seguridad-electrica", "/api/expedientes", "/api/licencias",
  "/api/capacitaciones", "/api/alertas", "/api/cumplimiento", "/api/centros-costo",
] as const;

const enRuta = (path: string, prefijo: string) => path === prefijo || path.startsWith(prefijo + "/");

/** Espacio fijo de una ruta (página o API), o null si es común o depende del registro. */
export function espacioDeRuta(path: string): Espacio | null {
  const p = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  if (RUTAS_SOLO_GENERAL.some((r) => enRuta(p, r))) return "general";
  if (RUTAS_SOLO_BIOMEDICO.some((r) => enRuta(p, r))) return "biomedico";
  return null;
}

export type TipoRegistro = "activos" | "ordenes" | "tickets" | "actividades" | "conjuntos" | "planes" | "firmas";
/** Registro al que apunta una ruta (/activos/12, /api/ordenes/5/adjuntos, /api/planes/3…). */
export function registroDeRuta(path: string): { tipo: TipoRegistro; id: number; api: boolean } | null {
  const m = path.match(/^\/(api\/)?(activos|ordenes|tickets|actividades|conjuntos|planes|firmas)\/(\d+)(?:\/|$)/);
  if (!m) return null;
  const api = !!m[1];
  const tipo = m[2] as TipoRegistro;
  // Las fichas de planes y firmas solo existen como API.
  if (!api && (tipo === "planes" || tipo === "firmas")) return null;
  return { tipo, id: Number(m[3]), api };
}

/**
 * A dónde lleva el interruptor: la misma página si es una lista común (/ordenes,
 * /activos, /indicadores…); al panel del espacio si era de un espacio o un registro.
 */
export function destinoAlCambiar(volver: unknown): string {
  if (typeof volver !== "string" || !volver.startsWith("/") || volver.startsWith("//") || volver.startsWith("/api/")) return "/";
  const path = volver.split(/[?#]/)[0];
  if (espacioDeRuta(path) || registroDeRuta(path) || path.startsWith("/areas/") || path === "/otro-espacio") return "/";
  return path;
}

/** Enlace que cambia de espacio y vuelve a la misma dirección. */
export function hrefCambiarEspacio(volver: string, e: Espacio): string {
  const url = new URL(volver.startsWith("/") && !volver.startsWith("//") ? volver : "/", "https://mantenimiento.local");
  url.searchParams.set(PARAM_ESPACIO, e);
  return url.pathname + url.search + url.hash;
}

export function areaEnEspacio(area: string | null | undefined, e: Espacio): boolean {
  return !!area && (ESPACIOS[e].areas as readonly string[]).includes(area);
}

/** Lo que el middleware deja para la página del aviso «Este registro es del espacio …». */
export interface AvisoEspacio { espacio: Espacio; puedeCambiar: boolean; volver: string }

// ─── 8. El espacio de un request en páginas y API ───────────────────────────
type CtxEspacio = {
  locals?: { espacio?: Espacio; user?: UsuarioEspacio } | Record<string, unknown>;
  cookies?: { get(nombre: string): { value: string } | undefined } | undefined;
  url?: URL;
  request?: Request;
};

/**
 * El espacio del request: el que dejó el middleware; si no pasó por él (pruebas de
 * una ruta suelta), el que resuelve resolverEspacio con el usuario, la cookie y ?espacio=.
 */
export function espacioDelContexto(ctx: CtxEspacio, user?: UsuarioEspacio): Espacio {
  const locals = (ctx.locals ?? {}) as { espacio?: Espacio; user?: UsuarioEspacio };
  const usuario = user ?? locals.user;
  if (locals.espacio && puedeEntrar(usuario, locals.espacio)) return locals.espacio;
  let cookie: string | null = null;
  try { cookie = ctx.cookies?.get(COOKIE_ESPACIO)?.value ?? null; } catch { cookie = null; }
  let param: string | null = null;
  try { param = (ctx.url ?? (ctx.request ? new URL(ctx.request.url) : null))?.searchParams.get(PARAM_ESPACIO) ?? null; } catch { param = null; }
  return resolverEspacio(usuario, cookie, param);
}

/**
 * El espacio de una lista: el del área pedida (?area=) o el del request.
 * permitido=false si el área es de un espacio al que el usuario no entra.
 */
export function espacioDeLista(ctx: CtxEspacio, user: UsuarioEspacio, area: AreaKey | null | undefined): { espacio: Espacio; permitido: boolean } {
  if (area) {
    const e = espacioDeArea(area);
    return { espacio: e, permitido: puedeEntrar(user, e) };
  }
  return { espacio: espacioDelContexto(ctx, user), permitido: true };
}

/** 403 JSON para la API cuando el registro o la lista es del otro espacio. */
export function respuestaOtroEspacio(e: Espacio): Response {
  return Response.json({ error: mensajeOtroEspacio(e) }, { status: 403 });
}

// ─── 9. Más filtros SQL (sin parámetros, por el límite de 100 de D1) ────────
/** columna (un activo_id) in (los equipos del espacio). */
export function condicionActivoIdEspacio(columna: SQLWrapper, e: Espacio): SQL {
  return sql`${columna} in (select "activos"."id" from "activos" where ${condicionActivoEspacio(e)})`;
}

/**
 * Órdenes y solicitudes: por su rubro; sin rubro, por su equipo (la misma regla
 * que la serie OT-MB/OT-MG de la migración 0057). Sin rubro ni equipo: General.
 * Nunca es NULL, así que General es exactamente lo que no es Biomédico.
 */
export function condicionTrabajoEspacio(rubro: SQLWrapper, activoId: SQLWrapper, e: Espacio): SQL {
  const bio = sql`(case when ${rubro} is not null then ${rubro} = 'biomedico' when ${activoId} is null then 0 else ${activoId} in (select "activos"."id" from "activos" where ${condicionActivoEspacio("biomedico")}) end)`;
  return e === "biomedico" ? sql`${bio} = 1` : sql`${bio} = 0`;
}
export const condicionOrdenEspacio = (e: Espacio) => condicionTrabajoEspacio(ordenes.rubro, ordenes.activoId, e);
export const condicionTicketEspacio = (e: Espacio) => condicionTrabajoEspacio(tickets.rubro, tickets.activoId, e);
/** Por área si la hay (su rubro, como siempre); si no, por espacio. */
export function condicionTrabajoAreaEspacio(rubro: SQLWrapper, activoId: SQLWrapper, e: Espacio, area?: AreaKey | null): SQL {
  return area ? sql`${rubro} = ${area}` : condicionTrabajoEspacio(rubro, activoId, e);
}
/** Espacio de una orden o solicitud suelta: su rubro o, sin rubro, el de su equipo. */
export function espacioDeTrabajo(rubro: string | null | undefined, activo?: { rubro?: string | null; tipo?: string | null } | null): Espacio {
  if (rubro) return espacioDeArea(rubro);
  return activo ? espacioDeActivo(activo) : "general";
}

/** Por área si la hay; si no, por espacio. Para columnas rubro. */
export function condicionRubroAreaEspacio(columna: SQLWrapper, e: Espacio, area?: AreaKey | null): SQL {
  return area ? sql`${columna} = ${area}` : condicionRubroEspacio(columna, e);
}

const globRuta = (columna: SQLWrapper, r: string) => sql`(${columna} = ${sql.raw(`'${r}'`)} or ${columna} glob ${sql.raw(`'${r}[/?#]*'`)})`;

/**
 * Espacio del enlace de una notificación ('general', 'biomedico' o NULL = común):
 * por el registro al que apunta (/ordenes/5, /tickets/3, /activos/9, /conjuntos/2,
 * /actividades/1), por la ruta fija (/ronda…, /calibraciones…) o, en una lista
 * común, por el ?espacio= del enlace (/cronograma?espacio=biomedico).
 */
export function expresionEspacioDeLink(columna: SQLWrapper): SQL {
  const porRubro = (tabla: string, desde: number) =>
    sql`(select case when x.rubro = 'biomedico' then 'biomedico' else 'general' end from ${sql.raw(tabla)} x where x.id = cast(substr(${columna}, ${sql.raw(String(desde))}) as integer))`;
  const porTrabajo = (tabla: string, desde: number) =>
    sql`(select case when ${condicionTrabajoEspacio(sql.raw("x.rubro"), sql.raw("x.activo_id"), "biomedico")} then 'biomedico' else 'general' end from ${sql.raw(tabla)} x where x.id = cast(substr(${columna}, ${sql.raw(String(desde))}) as integer))`;
  const rutasGeneral = sql.join(RUTAS_SOLO_GENERAL.filter((r) => !r.startsWith("/api/")).map((r) => globRuta(columna, r)), sql` or `);
  const rutasBio = sql.join(RUTAS_SOLO_BIOMEDICO.filter((r) => !r.startsWith("/api/")).map((r) => globRuta(columna, r)), sql` or `);
  return sql`(case
    when ${columna} is null then null
    when ${columna} glob '/ordenes/[0-9]*' then ${porTrabajo("ordenes", 10)}
    when ${columna} glob '/tickets/[0-9]*' then ${porTrabajo("tickets", 10)}
    when ${columna} glob '/conjuntos/[0-9]*' then ${porRubro("conjuntos", 12)}
    when ${columna} glob '/activos/[0-9]*' then (select case when ${activoAreaExpression} = 'biomedico' then 'biomedico' else 'general' end from "activos" where "activos"."id" = cast(substr(${columna}, 10) as integer))
    when ${rutasGeneral} then 'general'
    when ${rutasBio} then 'biomedico'
    when ${columna} glob '*[?&]espacio=biomedico*' then 'biomedico'
    when ${columna} glob '*[?&]espacio=general*' then 'general'
    else null end)`;
}

/** Notificaciones que se ven en el espacio: las suyas y las comunes. */
export function condicionLinkEspacio(columna: SQLWrapper, e: Espacio): SQL {
  const x = expresionEspacioDeLink(columna);
  return sql`(${x} is null or ${x} = ${sql.raw(`'${e}'`)})`;
}
