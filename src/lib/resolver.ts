// ─── Resolver: que documento rige este equipo y que sigue ────────────────────
// El punto del volumen GO-GUI-011-2026 no es tener documentos, es que la
// operacion los siga sin buscarlos. Cuando un equipo falla, el sistema
// responde solo: "esto se rige por EOP-ELE-01, estas son las tres primeras
// acciones, y el reloj corre".
//
// Cadena del capitulo 01:
//   SCP  como esta configurado      -> referencia de todo lo demas
//   SOP  se opera a diario          -> rutina que verifica contra el SCP
//   AOP  se desvio, aun no es falla -> reloj: actuar, escalar, pasar a EOP
//   EOP  ya fallo                   -> tres primeras acciones, estabilizar
//   MOP  se interviene planificado  -> permiso, bloqueo, liberacion medida

import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { activos, procedimientos, aopFicha, eopFicha, aopUmbrales } from "@/lib/schema";

export type Sistema = "electrico" | "hvac" | "gases" | "agua" | "incendios" | "ascensores" | "otro";
export type Situacion = "falla" | "desviacion" | "preventivo" | "intervencion";

export const SISTEMA_LABEL: Record<Sistema, string> = {
  electrico: "Energía",
  hvac: "Climatización",
  gases: "Gases medicinales",
  agua: "Agua",
  incendios: "Protección contra incendios",
  ascensores: "Transporte vertical",
  otro: "Otro",
};

/** Tipo de documento que gobierna cada situacion (tabla del capitulo 02). */
export const DOC_DE_SITUACION: Record<Situacion, "eop" | "aop" | "sop" | "mop"> = {
  falla: "eop",
  desviacion: "aop",
  preventivo: "sop",
  intervencion: "mop",
};

const PALABRAS: Array<[Sistema, RegExp]> = [
  ["electrico",  /planta el[eé]ctr|generador|tablero|transferencia|\bats\b|\bups\b|subestaci[oó]n|transformador|acometida/i],
  ["hvac",       /aire acond|minisplit|mini split|\bsplit\b|chiller|manejadora|\buma\b|fan ?coil|extractor|clima/i],
  ["gases",      /ox[ií]geno|manifold|vac[ií]o|aire medicinal|criog[eé]nic|[oó]xido nitroso/i],
  ["agua",       /cisterna|tanque de agua|hidroneum|bomba de agua|ablandador|[oó]smosis|potabl/i],
  ["incendios",  /extintor|rociador|sprinkler|alarma de incend|bomba contra incend|detector de humo|hidrante/i],
  ["ascensores", /ascensor|elevador|montacarga/i],
];

/** Mapea el dominio del plan maestro al sistema critico, como ultimo recurso. */
const POR_RUBRO: Record<string, Sistema> = {
  aires: "hvac",
  infraestructura: "otro",
  equipo_general: "otro",
  biomedico: "otro",
};

/** Infiere el sistema por el nombre y la categoria del equipo. */
export function inferirSistema(nombre?: string | null, categoria?: string | null, rubro?: string | null): Sistema {
  const txt = `${nombre ?? ""} ${categoria ?? ""}`;
  for (const [sis, re] of PALABRAS) if (re.test(txt)) return sis;
  return (rubro && POR_RUBRO[rubro]) || "otro";
}

type ActivoMin = {
  id: number;
  nombre: string;
  categoria: string | null;
  rubro: string | null;
  sistema: string | null;
  padreId: number | null;
  scpProcedimientoId: number | null;
};

/**
 * Sistema del equipo, en orden de confianza:
 *   1. lo que declara el propio equipo
 *   2. lo que declara algun ancestro (el componente hereda del sistema padre)
 *   3. palabras clave del nombre
 *   4. el dominio del plan maestro
 * Devuelve tambien de donde salio, para poder decirlo en pantalla.
 */
export async function sistemaDeActivo(
  db: any,
  activo: ActivoMin,
): Promise<{ sistema: Sistema; origen: "declarado" | "heredado" | "inferido"; desdeActivoId?: number }> {
  if (activo.sistema) return { sistema: activo.sistema as Sistema, origen: "declarado" };

  // Sube por la jerarquia buscando un ancestro que lo declare (profundidad maxima 3)
  let padreId = activo.padreId;
  for (let i = 0; i < 3 && padreId; i++) {
    const [p] = await db
      .select({ id: activos.id, sistema: activos.sistema, padreId: activos.padreId })
      .from(activos)
      .where(eq(activos.id, padreId))
      .limit(1);
    if (!p) break;
    if (p.sistema) return { sistema: p.sistema as Sistema, origen: "heredado", desdeActivoId: p.id };
    padreId = p.padreId;
  }
  return { sistema: inferirSistema(activo.nombre, activo.categoria, activo.rubro), origen: "inferido" };
}

export interface ProcedimientoRige {
  id: number;
  codigoCorto: string;
  codigoInstitucional: string | null;
  tipo: string;
  sistema: string;
  titulo: string;
  version: string;
  estado: string;
}

export interface QueRige {
  sistema: Sistema;
  origenSistema: "declarado" | "heredado" | "inferido";
  scp: ProcedimientoRige | null;
  sop: ProcedimientoRige[];
  aop: ProcedimientoRige[];
  eop: ProcedimientoRige[];
  mop: ProcedimientoRige[];
  /** true cuando no hay un solo documento para este sistema: la brecha a cerrar */
  sinCobertura: boolean;
}

/**
 * Todos los documentos que gobiernan un equipo. Incluye los de su sede y los
 * modelo (sucursalId NULL), porque el cap. 8.3 dice que cada sede hereda el
 * volumen con sus propios valores.
 */
export async function queRigeEsteActivo(db: any, activoId: number, sucursalId?: number | null): Promise<QueRige | null> {
  const [a] = await db
    .select({
      id: activos.id,
      nombre: activos.nombre,
      categoria: activos.categoria,
      rubro: activos.rubro,
      sistema: activos.sistema,
      padreId: activos.padreId,
      scpProcedimientoId: activos.scpProcedimientoId,
    })
    .from(activos)
    .where(eq(activos.id, activoId))
    .limit(1);
  if (!a) return null;

  const { sistema, origen } = await sistemaDeActivo(db, a as ActivoMin);

  const cols = {
    id: procedimientos.id,
    codigoCorto: procedimientos.codigoCorto,
    codigoInstitucional: procedimientos.codigoInstitucional,
    tipo: procedimientos.tipo,
    sistema: procedimientos.sistema,
    titulo: procedimientos.titulo,
    version: procedimientos.version,
    estado: procedimientos.estado,
  };

  const where = and(
    eq(procedimientos.activo, true),
    eq(procedimientos.sistema, sistema),
    sucursalId
      ? or(isNull(procedimientos.sucursalId), eq(procedimientos.sucursalId, sucursalId))
      : isNull(procedimientos.sucursalId),
  );
  const todos: ProcedimientoRige[] = await db.select(cols).from(procedimientos).where(where);

  // El SCP del propio equipo manda sobre el del sistema
  let scp: ProcedimientoRige | null = null;
  if (a.scpProcedimientoId) {
    const [p] = await db.select(cols).from(procedimientos).where(eq(procedimientos.id, a.scpProcedimientoId)).limit(1);
    scp = p ?? null;
  }
  if (!scp) scp = todos.find((p) => p.tipo === "scp") ?? null;

  const porTipo = (t: string) => todos.filter((p) => p.tipo === t);

  return {
    sistema,
    origenSistema: origen,
    scp,
    sop: porTipo("sop"),
    aop: porTipo("aop"),
    eop: porTipo("eop"),
    mop: porTipo("mop"),
    sinCobertura: todos.length === 0 && !scp,
  };
}

export interface QueSigue {
  documento: ProcedimientoRige | null;
  /** Las tres primeras acciones del EOP, que se saben de memoria */
  primerasAcciones: string[];
  /** Para un AOP: cuanto tiempo hay antes de actuar y de escalar */
  minutosParaActuar?: number | null;
  minutosParaEscalar?: number | null;
  /** Texto de una linea para la cabecera: "Se rige por EOP-ELE-01" */
  encabezado: string;
  /** Que hacer si no hay documento todavia */
  aviso?: string;
}

/**
 * La pregunta operativa: este equipo esta en esta situacion, ¿que sigue?
 * Devuelve el documento que gobierna y lo primero que hay que hacer.
 */
export async function queSigue(
  db: any,
  activoId: number,
  situacion: Situacion,
  sucursalId?: number | null,
): Promise<QueSigue> {
  const rige = await queRigeEsteActivo(db, activoId, sucursalId);
  const tipo = DOC_DE_SITUACION[situacion];
  const vacio: QueSigue = {
    documento: null,
    primerasAcciones: [],
    encabezado: "Sin procedimiento asignado",
    aviso:
      "Este equipo no tiene todavía un documento que lo gobierne para esta situación. " +
      "Regístralo en Procedimientos para que el sistema pueda guiar la respuesta.",
  };
  if (!rige) return vacio;

  const candidatos = (rige as any)[tipo] as ProcedimientoRige[];
  // Prefiere el vigente sobre el borrador: se opera con lo aprobado
  const doc =
    candidatos.find((p) => p.estado === "vigente") ??
    candidatos.find((p) => p.estado === "en_validacion") ??
    candidatos[0] ??
    null;
  if (!doc) return { ...vacio, aviso: `No hay ningún ${tipo.toUpperCase()} para ${SISTEMA_LABEL[rige.sistema]}. ${vacio.aviso}` };

  const out: QueSigue = {
    documento: doc,
    primerasAcciones: [],
    encabezado: `Se rige por ${doc.codigoCorto} · ${doc.titulo}`,
  };
  if (doc.estado !== "vigente") {
    out.aviso = `Atención: ${doc.codigoCorto} está en estado "${doc.estado}", todavía no aprobado.`;
  }

  if (tipo === "eop") {
    const [f] = await db.select().from(eopFicha).where(eq(eopFicha.procedimientoId, doc.id)).limit(1);
    if (f) out.primerasAcciones = [f.accion1, f.accion2, f.accion3].filter(Boolean) as string[];
  }
  if (tipo === "aop") {
    const [u] = await db.select().from(aopUmbrales).where(eq(aopUmbrales.procedimientoId, doc.id)).limit(1);
    if (u) {
      out.minutosParaActuar = u.minutosParaActuar;
      out.minutosParaEscalar = u.minutosParaEscalar;
    }
  }
  return out;
}

/** Equipos cuyo sistema no tiene ningún documento: la brecha real de cobertura. */
export async function cobertura(db: any) {
  const todos = await db
    .select({
      id: activos.id,
      codigo: activos.codigo,
      nombre: activos.nombre,
      categoria: activos.categoria,
      rubro: activos.rubro,
      sistema: activos.sistema,
      criticidad: activos.criticidadOperacional,
      estado: activos.estado,
    })
    .from(activos);
  const procs = await db
    .select({ sistema: procedimientos.sistema, tipo: procedimientos.tipo })
    .from(procedimientos)
    .where(eq(procedimientos.activo, true));
  const porSistema = new Map<string, Set<string>>();
  for (const p of procs) {
    const s = porSistema.get(p.sistema) ?? new Set<string>();
    s.add(p.tipo);
    porSistema.set(p.sistema, s);
  }
  return todos
    .filter((a: any) => a.estado !== "baja")
    .map((a: any) => {
      const sis = (a.sistema as Sistema) || inferirSistema(a.nombre, a.categoria, a.rubro);
      const tipos = porSistema.get(sis) ?? new Set<string>();
      return {
        ...a,
        sistemaResuelto: sis,
        declarado: !!a.sistema,
        tieneScp: tipos.has("scp"),
        tieneEop: tipos.has("eop"),
        tieneAop: tipos.has("aop"),
        tieneSop: tipos.has("sop"),
        cubierto: tipos.size > 0,
      };
    });
}
