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
// Puro salvo por drizzle (sql): sin base de datos ni Astro.
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { activoAreaExpression, type AreaKey } from "./areas";
import { rubroDeActivo } from "./rubros";

export type Espacio = "general" | "biomedico";
export const ESPACIO_KEYS = ["general", "biomedico"] as const satisfies readonly Espacio[];
export const COOKIE_ESPACIO = "espacio";
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
