// Jerarquía de activos del SCP (Fase 47, GO-GUI-011-2026 cap. 02 y 03).
//
// «Cada sistema crítico se registra como activo padre con sus componentes como
// hijos» (cap. 02.2, tabla «Un objeto del sistema por cada tipo de documento»).
// El SCP es la ficha del sistema: su versión vive como atributo del activo
// padre y sus componentes cuelgan de él.
//
// Este módulo concentra el recorrido del árbol y, sobre todo, la GUARDA
// ANTI-CICLO: sin ella un padre mal elegido cuelga la ficha del activo en un
// bucle infinito al subir la migaja de pan.
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { activos, ordenes } from "./schema";

type Db = ReturnType<typeof getDb>;

export const NIVELES_JERARQUIA = ["sistema", "subsistema", "componente"] as const;
export type NivelJerarquia = (typeof NIVELES_JERARQUIA)[number];

export const NIVEL_LABEL: Record<NivelJerarquia, string> = {
  sistema: "Sistema",
  subsistema: "Subsistema",
  componente: "Componente",
};

export const NIVEL_COLOR: Record<NivelJerarquia, string> = {
  sistema: "bg-indigo-100 text-indigo-700",
  subsistema: "bg-sky-100 text-sky-700",
  componente: "bg-slate-100 text-slate-600",
};

// sistema → subsistema → componente. Tres niveles, los del documento.
export const PROFUNDIDAD_MAXIMA = 3;

// Tope duro del recorrido ascendente: si la base quedara con un ciclo por un
// INSERT externo (importación, SQL manual), la página no se cuelga.
const TOPE_RECORRIDO = 20;

export type NodoActivo = {
  id: number;
  codigo: string;
  nombre: string;
  estado: string;
  nivelJerarquia: string;
  padreId: number | null;
};

const COLUMNAS_NODO = {
  id: activos.id,
  codigo: activos.codigo,
  nombre: activos.nombre,
  estado: activos.estado,
  nivelJerarquia: activos.nivelJerarquia,
  padreId: activos.padreId,
};

/**
 * Cadena de ancestros del activo, del más lejano al padre inmediato
 * (abuelo → padre). Devuelve [] si el activo es raíz.
 * Corta ante cualquier ciclo o profundidad anómala.
 */
export async function rutaAscendente(db: Db, id: number): Promise<NodoActivo[]> {
  const cadena: NodoActivo[] = [];
  const vistos = new Set<number>([id]);
  let actual = id;

  for (let i = 0; i < TOPE_RECORRIDO; i++) {
    const [fila] = await db.select(COLUMNAS_NODO).from(activos).where(eq(activos.id, actual)).limit(1);
    if (!fila?.padreId) break;
    if (vistos.has(fila.padreId)) break; // ciclo en datos: corta
    const [padre] = await db.select(COLUMNAS_NODO).from(activos).where(eq(activos.id, fila.padreId)).limit(1);
    if (!padre) break;
    cadena.unshift(padre as NodoActivo);
    vistos.add(padre.id);
    actual = padre.id;
  }
  return cadena;
}

/** Hijos directos del activo, ordenados por código. */
export async function hijosDe(db: Db, id: number): Promise<NodoActivo[]> {
  const filas = await db.select(COLUMNAS_NODO).from(activos).where(eq(activos.padreId, id)).orderBy(asc(activos.codigo));
  return filas as NodoActivo[];
}

/**
 * Hijos directos con el conteo de OTs abiertas de cada uno, para la tarjeta
 * «Componentes (n)» de la ficha del activo.
 */
export async function hijosConOrdenesAbiertas(db: Db, id: number) {
  const hijos = await hijosDe(db, id);
  if (hijos.length === 0) return [] as Array<NodoActivo & { otsAbiertas: number }>;

  const filas = await db
    .select({ activoId: ordenes.activoId })
    .from(ordenes)
    .where(and(
      inArray(ordenes.activoId, hijos.map((h) => h.id)),
      inArray(ordenes.estado, ["abierta", "en_proceso", "en_espera"]),
    ));

  const porActivo = new Map<number, number>();
  for (const f of filas) {
    if (f.activoId == null) continue;
    porActivo.set(f.activoId, (porActivo.get(f.activoId) ?? 0) + 1);
  }
  return hijos.map((h) => ({ ...h, otsAbiertas: porActivo.get(h.id) ?? 0 }));
}

/**
 * Descendientes del activo (todos los niveles por debajo), como conjunto de
 * ids. Es la base de la guarda anti-ciclo: un descendiente nunca puede ser
 * padre de su propio ancestro.
 */
export async function descendientesDe(db: Db, id: number): Promise<Set<number>> {
  const ids = new Set<number>();
  let frontera = [id];
  for (let nivel = 0; nivel < TOPE_RECORRIDO && frontera.length > 0; nivel++) {
    const siguiente: number[] = [];
    for (const padre of frontera) {
      const hijos = await hijosDe(db, padre);
      for (const h of hijos) {
        if (ids.has(h.id) || h.id === id) continue; // ciclo en datos: no reexpande
        ids.add(h.id);
        siguiente.push(h.id);
      }
    }
    frontera = siguiente;
  }
  return ids;
}

/**
 * Altura del subárbol que cuelga del activo: 1 = sin hijos.
 * Recorrido por niveles (no recursivo) con conjunto de visitados, para no
 * colgarse si la base ya tuviera un ciclo por un INSERT externo.
 */
export async function alturaSubarbol(db: Db, id: number): Promise<number> {
  const vistos = new Set<number>([id]);
  let frontera = [id];
  let altura = 1;
  for (let nivel = 0; nivel < TOPE_RECORRIDO; nivel++) {
    const siguiente: number[] = [];
    for (const padre of frontera) {
      for (const h of await hijosDe(db, padre)) {
        if (vistos.has(h.id)) continue; // ciclo en datos: no reexpande
        vistos.add(h.id);
        siguiente.push(h.id);
      }
    }
    if (siguiente.length === 0) break;
    altura++;
    frontera = siguiente;
  }
  return altura;
}

export type ResultadoValidarPadre =
  | { ok: true; padre: NodoActivo | null }
  | { ok: false; error: string };

/**
 * GUARDA ANTI-CICLO. Decide si `padreId` puede ser el padre de `id`.
 * Rechaza: auto-padre, un descendiente como padre, un padre inexistente y
 * cualquier combinación que pase de tres niveles (sistema → subsistema →
 * componente). `padreId` nulo siempre es válido: desvincula.
 */
export async function validarPadre(db: Db, id: number, padreId: number | null): Promise<ResultadoValidarPadre> {
  if (padreId == null) return { ok: true, padre: null };

  if (!Number.isFinite(padreId) || padreId <= 0) {
    return { ok: false, error: "El activo padre indicado no es válido." };
  }
  if (padreId === id) {
    return { ok: false, error: "Un activo no puede ser su propio padre." };
  }

  const [padre] = await db.select(COLUMNAS_NODO).from(activos).where(eq(activos.id, padreId)).limit(1);
  if (!padre) return { ok: false, error: "El activo padre no existe." };

  // Un descendiente como padre cerraría el ciclo.
  const descendientes = await descendientesDe(db, id);
  if (descendientes.has(padreId)) {
    return { ok: false, error: `${padre.codigo} cuelga de este activo: no puede ser además su padre (crearía un ciclo).` };
  }

  // Profundidad: ancestros del padre + el padre + este activo + lo que cuelga
  // de este activo no puede pasar de tres niveles.
  const ancestrosDelPadre = await rutaAscendente(db, padreId);
  const alturaPropia = await alturaSubarbol(db, id);
  const profundidadTotal = ancestrosDelPadre.length + 1 + alturaPropia;
  if (profundidadTotal > PROFUNDIDAD_MAXIMA) {
    return {
      ok: false,
      error: `La jerarquía admite ${PROFUNDIDAD_MAXIMA} niveles (sistema → subsistema → componente) y este vínculo llegaría a ${profundidadTotal}.`,
    };
  }

  return { ok: true, padre: padre as NodoActivo };
}

/**
 * Nivel que le corresponde a un activo según la profundidad de su padre.
 * Es una sugerencia para el formulario, no una imposición.
 */
export function nivelSugerido(profundidadDelPadre: number): NivelJerarquia {
  if (profundidadDelPadre <= 0) return "sistema";
  if (profundidadDelPadre === 1) return "subsistema";
  return "componente";
}

// ─── Mapa de distribución: «una manejadora sirve varias salas» ──────────────
export const ROLES_UBICACION_SERVIDA = ["sirve", "alimenta", "controla", "extrae"] as const;
export type RolUbicacionServida = (typeof ROLES_UBICACION_SERVIDA)[number];

export const ROL_SERVIDA_LABEL: Record<RolUbicacionServida, string> = {
  sirve: "Sirve",
  alimenta: "Alimenta",
  controla: "Controla",
  extrae: "Extrae",
};

export const ROL_SERVIDA_COLOR: Record<RolUbicacionServida, string> = {
  sirve: "bg-sky-100 text-sky-700",
  alimenta: "bg-amber-100 text-amber-700",
  controla: "bg-violet-100 text-violet-700",
  extrae: "bg-teal-100 text-teal-700",
};

export const ROL_SERVIDA_AYUDA: Record<RolUbicacionServida, string> = {
  sirve: "La sala depende de este activo para su ambiente o su servicio.",
  alimenta: "Le entrega energía, agua o gas (tablero, bomba, manifold).",
  controla: "Regula sus variables sin alimentarla (control, sensor, válvula).",
  extrae: "Extrae aire o fluido de la sala (extractor, campana).",
};

// ─── Puntos de ajuste del SCP ───────────────────────────────────────────────
export const TIPOS_ATRIBUTO = ["punto_ajuste", "posicion_normal", "predictiva"] as const;
export type TipoAtributo = (typeof TIPOS_ATRIBUTO)[number];

export const TIPO_ATRIBUTO_LABEL: Record<TipoAtributo, string> = {
  punto_ajuste: "Punto de ajuste",
  posicion_normal: "Posición normal",
  predictiva: "Variable predictiva",
};

export const TIPO_ATRIBUTO_COLOR: Record<TipoAtributo, string> = {
  punto_ajuste: "bg-blue-100 text-blue-700",
  posicion_normal: "bg-emerald-100 text-emerald-700",
  predictiva: "bg-slate-100 text-slate-600",
};

export const ESTADO_PROCEDIMIENTO_LABEL: Record<string, string> = {
  borrador: "Borrador",
  en_validacion: "En validación",
  vigente: "Vigente",
  en_revision: "En revisión",
  retirado: "Retirado",
};

export const ESTADO_PROCEDIMIENTO_COLOR: Record<string, string> = {
  borrador: "bg-slate-100 text-slate-600",
  en_validacion: "bg-amber-100 text-amber-700",
  vigente: "bg-emerald-100 text-emerald-700",
  en_revision: "bg-orange-100 text-orange-700",
  retirado: "bg-red-100 text-red-700",
};

/** El valor nominal de un atributo: numérico o textual («selector en AUTO»). */
export function valorNominalTexto(v: { valorNominal: number | null; valorNominalTexto: string | null; unidad: string | null }): string {
  if (v.valorNominalTexto) return v.valorNominalTexto;
  if (v.valorNominal != null) return v.unidad ? `${v.valorNominal} ${v.unidad}` : String(v.valorNominal);
  return "—";
}
