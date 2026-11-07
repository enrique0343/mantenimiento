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
import { activos, procedimientos, procedimientoSistemas, aopFicha, eopFicha, aopUmbrales, ubicaciones } from "@/lib/schema";

export type Sistema = "electrico" | "hvac" | "minisplit" | "gases" | "agua" | "incendios" | "ascensores" | "otro";
export type Situacion = "falla" | "desviacion" | "preventivo" | "intervencion";

export const SISTEMA_LABEL: Record<Sistema, string> = {
  electrico: "Energía",
  hvac: "Climatización crítica (HEPA)",
  minisplit: "Minisplit",
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
  // Lo central va primero: «Aire acondicionado central» no es un minisplit.
  ["hvac",       /chiller|manejadora|\buma\b|fan ?coil|extractor|hepa|clima|unidad central|aire acondicionado central|\bvrf\b|\bvrv\b/i],
  ["minisplit",  /mini ?-?split|\bsplit\b|cassette|casete|piso ?techo|aires? acond/i],
  ["gases",      /ox[ií]geno|manifold|vac[ií]o|aire medicinal|criog[eé]nic|[oó]xido nitroso/i],
  ["agua",       /cisterna|tanque de agua|hidroneum|bomba de agua|ablandador|[oó]smosis|potabl/i],
  ["incendios",  /extintor|rociador|sprinkler|alarma de incend|bomba contra incend|detector de humo|hidrante/i],
  ["ascensores", /ascensor|elevador|montacarga/i],
];

/** Mapea el dominio del plan maestro al sistema critico, como ultimo recurso. */
const POR_RUBRO: Record<string, Sistema> = {
  aires: "minisplit",
  infraestructura: "otro",
  equipo_general: "otro",
  biomedico: "otro",
};

/** Áreas donde el aire es de climatización crítica: manejadoras con filtro HEPA, presión y renovaciones. */
const AREA_CRITICA = /quir[oó]fano|quir[uú]rg|sala de operaciones|\bu\.?c\.?i\.?(?![a-z])|\buci[a-z]\b|\buti\b|intensiv|cuidados? cr[ií]tico|aislamiento|est[eé]ril|ceye|cirug[ií]a|neonat|perioperator|\brecuperaci/i;

/**
 * Infiere el sistema por el nombre y la categoria del equipo. Un minisplit no
 * se rige igual en todas partes: dentro de un área crítica manda la familia de
 * climatización crítica, y por eso importa la ubicación.
 */
export function inferirSistema(nombre?: string | null, categoria?: string | null, rubro?: string | null, ubicacion?: string | null): Sistema {
  const txt = `${nombre ?? ""} ${categoria ?? ""}`;
  let sistema: Sistema = (rubro && POR_RUBRO[rubro]) || "otro";
  for (const [sis, re] of PALABRAS) {
    if (re.test(txt)) { sistema = sis; break; }
  }
  return sistema === "minisplit" && ubicacion && AREA_CRITICA.test(ubicacion) ? "hvac" : sistema;
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
  const sugerido = inferirSistema(activo.nombre, activo.categoria, activo.rubro);
  if (sugerido !== "minisplit") return { sistema: sugerido, origen: "inferido" };
  const [lugar] = await db
    .select({ nombre: ubicaciones.nombre })
    .from(activos)
    .innerJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId))
    .where(eq(activos.id, activo.id))
    .limit(1);
  return { sistema: inferirSistema(activo.nombre, activo.categoria, activo.rubro, lugar?.nombre), origen: "inferido" };
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

const DOC_DE_AREA_CRITICA = /quir[oó]fano|[aá]reas? cr[ií]ticas?|aislamiento|almac[eé]n est[eé]ril|cirug[ií]a/i;

export interface QueSigue {
  /** El documento no se escribió para el lugar donde está este equipo. */
  fueraDeAlcance?: boolean;
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
  // Una manejadora o un chiller fuera de un área crítica comparte familia, pero
  // varios documentos se escribieron para esas áreas. Se muestran como guía y se dice por qué.
  if (DOC_DE_AREA_CRITICA.test(doc.titulo)) {
    const [lugar] = await db
      .select({ nombre: ubicaciones.nombre })
      .from(activos)
      .innerJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId))
      .where(eq(activos.id, activoId))
      .limit(1);
    if (!lugar || !AREA_CRITICA.test(lugar.nombre)) {
      out.fueraDeAlcance = true;
      out.aviso = `${doc.codigoCorto} está escrito para áreas críticas${lugar ? ` y este equipo está en ${lugar.nombre}` : ""}: úsalo como guía, sin los plazos ni la gravedad de un quirófano.`;
    }
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
      ubicacion: ubicaciones.nombre,
    })
    .from(activos)
    .leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId));
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
      const sis = (a.sistema as Sistema) || inferirSistema(a.nombre, a.categoria, a.rubro, a.ubicacion);
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

// ─── El juego de documentos por familia de equipo ────────────────────────────
// "Todos los aires acondicionados deben aplicarse los mismos 5 documentos."
// El juego no se arma equipo por equipo: se define una vez por familia (el
// sistema critico) y todos sus equipos lo heredan. Un documento puede cubrir
// varias familias — la ronda por turno las recorre todas.

export const LOS_CINCO: Array<{ tipo: "scp" | "sop" | "aop" | "eop" | "mop"; label: string; pregunta: string }> = [
  { tipo: "scp", label: "SCP · Configuración", pregunta: "¿Cómo está configurado y cuáles son sus valores normales?" },
  { tipo: "sop", label: "SOP · Rutina",        pregunta: "¿Cómo se opera y verifica a diario?" },
  { tipo: "aop", label: "AOP · Desviación",    pregunta: "¿Qué hacer si un valor se sale de rango?" },
  { tipo: "eop", label: "EOP · Emergencia",    pregunta: "¿Qué hacer si ya falló?" },
  { tipo: "mop", label: "MOP · Intervención",  pregunta: "¿Cómo se interviene sin dañar al paciente?" },
];

export interface SlotJuego {
  tipo: "scp" | "sop" | "aop" | "eop" | "mop";
  label: string;
  pregunta: string;
  documentos: ProcedimientoRige[];
  cubierto: boolean;
  vigente: boolean;
}

export interface JuegoFamilia {
  sistema: Sistema;
  label: string;
  slots: SlotJuego[];
  cubiertos: number;   // de 5
  vigentes: number;    // de 5
  completo: boolean;
  faltantes: string[]; // etiquetas de los tipos que faltan
}

/**
 * El juego de los cinco documentos de una familia. Incluye los que cubren esa
 * familia aunque su sistema principal sea otro (procedimiento_sistemas).
 */
export async function juegoDeFamilia(db: any, sistema: Sistema, sucursalId?: number | null): Promise<JuegoFamilia> {
  const filas = await db
    .select({
      id: procedimientos.id,
      codigoCorto: procedimientos.codigoCorto,
      codigoInstitucional: procedimientos.codigoInstitucional,
      tipo: procedimientos.tipo,
      sistema: procedimientos.sistema,
      titulo: procedimientos.titulo,
      version: procedimientos.version,
      estado: procedimientos.estado,
    })
    .from(procedimientoSistemas)
    .innerJoin(procedimientos, eq(procedimientos.id, procedimientoSistemas.procedimientoId))
    .where(
      and(
        eq(procedimientoSistemas.sistema, sistema),
        eq(procedimientos.activo, true),
        sucursalId
          ? or(isNull(procedimientos.sucursalId), eq(procedimientos.sucursalId, sucursalId))
          : isNull(procedimientos.sucursalId),
      ),
    );

  const slots: SlotJuego[] = LOS_CINCO.map((c) => {
    const docs = filas.filter((f: any) => f.tipo === c.tipo);
    return {
      ...c,
      documentos: docs,
      cubierto: docs.length > 0,
      vigente: docs.some((d: any) => d.estado === "vigente"),
    };
  });

  const cubiertos = slots.filter((s) => s.cubierto).length;
  return {
    sistema,
    label: SISTEMA_LABEL[sistema],
    slots,
    cubiertos,
    vigentes: slots.filter((s) => s.vigente).length,
    completo: cubiertos === 5,
    faltantes: slots.filter((s) => !s.cubierto).map((s) => s.label),
  };
}

/** El juego de todas las familias: el tablero de qué parte de la operación está gobernada. */
export async function juegosDeTodasLasFamilias(db: any, sucursalId?: number | null): Promise<JuegoFamilia[]> {
  const sistemas: Sistema[] = ["electrico", "hvac", "minisplit", "gases", "agua", "incendios", "ascensores"];
  const out: JuegoFamilia[] = [];
  for (const s of sistemas) out.push(await juegoDeFamilia(db, s, sucursalId));
  return out.sort((a, b) => a.cubiertos - b.cubiertos || a.label.localeCompare(b.label, "es"));
}

/** Cuántos equipos vivos hay en cada familia (para pesar la brecha: 40 aires sin EOP duele más que 1). */
export async function equiposPorFamilia(db: any): Promise<Record<string, { total: number; criticos: number }>> {
  const todos = await db
    .select({
      nombre: activos.nombre,
      categoria: activos.categoria,
      rubro: activos.rubro,
      sistema: activos.sistema,
      criticidad: activos.criticidadOperacional,
      estado: activos.estado,
      ubicacion: ubicaciones.nombre,
    })
    .from(activos)
    .leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId));
  const acc: Record<string, { total: number; criticos: number }> = {};
  for (const a of todos) {
    if (a.estado === "baja") continue;
    const sis = (a.sistema as Sistema) || inferirSistema(a.nombre, a.categoria, a.rubro, a.ubicacion);
    const e = acc[sis] ?? { total: 0, criticos: 0 };
    e.total++;
    if (a.criticidad === "alta") e.criticos++;
    acc[sis] = e;
  }
  return acc;
}
