// ─── MOP · la plantilla baja a la orden ─────────────────────────────────────
//
// Un MOP sin prerrequisitos en la orden es un MOP decorativo: la regla dura
// («la orden no le deja empezar sin el permiso firmado», cap. 2.5) solo muerde
// si la orden trae las filas. Esto las copia desde la plantilla del MOP en el
// momento en que la orden queda vinculada al procedimiento.
import type { APIContext } from "astro";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import {
  checklistPlantillas,
  ordenLiberaciones,
  ordenPrerrequisitos,
  plantillaLiberaciones,
  plantillaPrerrequisitos,
} from "./schema";
import { evaluarConformeLiberacion, liberacionConRango, liberacionTieneLectura, MENSAJE_LECTURA_SIN_NUMERO, numeroDeLectura, PRERREQ_REFERENCIA_HINT, type PrerrequisitoTipo } from "./ordenes";
import { leerNumero, numeroAlInicio } from "./numero";
import { logAudit } from "@/lib/audit";

type Db = ReturnType<typeof getDb>;

export interface ResultadoSiembra {
  prerrequisitos: number;
  liberaciones: number;
  plantilla: string | null;
}

/**
 * Copia los prerrequisitos y las lecturas de liberación de la plantilla del
 * MOP a la orden. No duplica: si la orden ya tiene filas propias, no toca
 * nada (alguien pudo ajustarlas a mano para este trabajo concreto).
 */
export async function sembrarDesdeMop(
  db: Db,
  ordenId: number,
  procedimientoId: number,
): Promise<ResultadoSiembra> {
  const vacio: ResultadoSiembra = { prerrequisitos: 0, liberaciones: 0, plantilla: null };

  const [plantilla] = await db
    .select({ id: checklistPlantillas.id, nombre: checklistPlantillas.nombre })
    .from(checklistPlantillas)
    .where(and(eq(checklistPlantillas.procedimientoId, procedimientoId), eq(checklistPlantillas.activa, true)))
    .limit(1);
  if (!plantilla) return vacio;

  const yaPre = await db
    .select({ id: ordenPrerrequisitos.id })
    .from(ordenPrerrequisitos)
    .where(eq(ordenPrerrequisitos.ordenId, ordenId))
    .limit(1);
  const yaLib = await db
    .select({ id: ordenLiberaciones.id })
    .from(ordenLiberaciones)
    .where(eq(ordenLiberaciones.ordenId, ordenId))
    .limit(1);

  let nPre = 0;
  if (yaPre.length === 0) {
    const filas = await db
      .select()
      .from(plantillaPrerrequisitos)
      .where(eq(plantillaPrerrequisitos.plantillaId, plantilla.id))
      .orderBy(asc(plantillaPrerrequisitos.orden), asc(plantillaPrerrequisitos.id));
    for (const f of filas) {
      await db.insert(ordenPrerrequisitos).values({
        ordenId,
        texto: f.texto,
        tipo: f.tipo,
        obligatorio: f.obligatorio,
        cargoResponsable: f.cargoResponsable,
        orden: f.orden,
      });
      nPre++;
    }
  }

  let nLib = 0;
  if (yaLib.length === 0) {
    const filas = await db
      .select()
      .from(plantillaLiberaciones)
      .where(eq(plantillaLiberaciones.plantillaId, plantilla.id))
      .orderBy(asc(plantillaLiberaciones.orden), asc(plantillaLiberaciones.id));
    for (const f of filas) {
      await db.insert(ordenLiberaciones).values({
        ordenId,
        etiqueta: f.etiqueta,
        unidad: f.unidad,
        valorEsperado: f.valorEsperado,
        minAceptable: f.minAceptable,
        maxAceptable: f.maxAceptable,
        obligatoria: f.obligatoria,
        orden: f.orden,
      });
      nLib++;
    }
  }

  return { prerrequisitos: nPre, liberaciones: nLib, plantilla: plantilla.nombre };
}

// ─── MOP · lo que se registra al ejecutarlo ─────────────────────────────────
//
// Marcar un prerrequisito y registrar una lectura de liberación pasa por aquí,
// venga de la ficha (/api/ordenes/[id]/prerrequisitos y /liberaciones) o del
// celular (/api/campo/sync). Mismas reglas, mismo rastro.

type Quien = { id: number; rol: string };
type OrdenMop = { id: number; estado: string; asignadoA: number | null };

export class RechazoMop extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const esJefatura = (u: Quien) => u.rol === "admin" || u.rol === "jefe";
const ESTADOS_EJECUCION = ["abierta", "en_proceso", "en_espera"];

/**
 * Igual que el resto de la ejecución: solo el técnico asignado o la jefatura.
 * El técnico registra mientras la orden está abierta, en proceso o en pausa;
 * enviada a verificación, la corrige la jefatura o la devuelve.
 */
export function revisarPermisoMop(user: Quien, orden: OrdenMop, que: "prerrequisitos" | "liberaciones"): void {
  if (orden.estado === "cerrada" || orden.estado === "cancelada") {
    throw new RechazoMop(`La orden ya está cerrada: ${que === "prerrequisitos" ? "los prerrequisitos quedan" : "las lecturas de liberación quedan"} como evidencia y no se editan.`, 400);
  }
  if (esJefatura(user)) return;
  if (user.rol !== "tecnico") throw new RechazoMop("No tienes permisos para registrar en esta orden.", 403);
  if (orden.asignadoA !== user.id) throw new RechazoMop("La orden debe estar asignada a ti para registrar en ella.", 403);
  if (!ESTADOS_EJECUCION.includes(orden.estado)) {
    throw new RechazoMop("La orden ya se envió a verificación. Si hay que corregir algo, la jefatura la devuelve.", 409);
  }
}

export interface CambioPrerrequisito {
  itemId: number;
  cumplido?: boolean;
  referencia?: string | null;
  obligatorio?: boolean;
}

/** Marca, desmarca o anota la referencia de un prerrequisito. `momento` es la hora en que se hizo. */
export async function cambiarPrerrequisito(
  ctx: APIContext, db: Db, orden: OrdenMop, user: Quien, cambio: CambioPrerrequisito, momento = new Date().toISOString(),
) {
  revisarPermisoMop(user, orden, "prerrequisitos");
  const [actual] = await db
    .select()
    .from(ordenPrerrequisitos)
    .where(and(eq(ordenPrerrequisitos.id, cambio.itemId), eq(ordenPrerrequisitos.ordenId, orden.id)))
    .limit(1);
  if (!actual) throw new RechazoMop("Prerrequisito no encontrado en esta orden.", 404);
  if (cambio.obligatorio !== undefined && !esJefatura(user)) {
    throw new RechazoMop("Solo la jefatura puede cambiar si un prerrequisito es obligatorio.", 403);
  }

  const data: Record<string, unknown> = {};
  if (cambio.referencia !== undefined) data.referencia = cambio.referencia?.trim().slice(0, 400) || null;
  if (cambio.obligatorio !== undefined) data.obligatorio = cambio.obligatorio;
  if (cambio.cumplido !== undefined) {
    data.cumplido = cambio.cumplido;
    if (cambio.cumplido) {
      // La referencia vuelve verificable el prerrequisito: el n.º de permiso, la
      // clase de la ICRA, el id del candado. Sin ella no se marca cumplido.
      const ref = (cambio.referencia ?? actual.referencia ?? "").trim().slice(0, 400);
      if (ref.length < 2) {
        throw new RechazoMop("Escribe la referencia antes de marcarlo cumplido (n.º de permiso, clase de la ICRA, id del candado, hora del aviso…).", 400);
      }
      data.referencia = ref;
      data.cumplidoPor = user.id;
      data.cumplidoEn = momento;
    } else {
      data.cumplidoPor = null;
      data.cumplidoEn = null;
    }
  }
  if (Object.keys(data).length === 0) throw new RechazoMop("Nada que actualizar.", 400);

  const [row] = await db.update(ordenPrerrequisitos).set(data).where(eq(ordenPrerrequisitos.id, actual.id)).returning();
  if (cambio.cumplido !== undefined && cambio.cumplido !== actual.cumplido) {
    await logAudit(ctx, {
      entidad: "orden",
      entidadId: orden.id,
      accion: "update",
      resumen: cambio.cumplido
        ? `Prerrequisito cumplido: ${actual.texto} (ref. ${row.referencia ?? "—"})`
        : `Prerrequisito revertido a pendiente: ${actual.texto}`,
      cambios: {
        cumplido: { antes: actual.cumplido, despues: cambio.cumplido },
        referencia: { antes: actual.referencia, despues: row.referencia },
      },
    });
  }
  return row;
}

export interface CambioLiberacion {
  itemId: number;
  valorMedido?: number | null;
  valorMedidoTexto?: string | null;
  obligatoria?: boolean;
}

/**
 * Registra la lectura de liberación y calcula si quedó dentro del rango. `momento` es la hora de la medición.
 * Con mínimo o máximo, la lectura trae un número: «aprox 14 A» no se puede juzgar y se rechaza, y
 * «1,200» (¿1200 o 1,2?) se rechaza con la frase de numero.ts. Un número que ya llega como número
 * se acepta tal cual. Sin rango, lo escrito se guarda como texto.
 */
export async function registrarLiberacion(
  ctx: APIContext, db: Db, orden: OrdenMop, user: Quien, cambio: CambioLiberacion, momento = new Date().toISOString(),
) {
  revisarPermisoMop(user, orden, "liberaciones");
  const [actual] = await db
    .select()
    .from(ordenLiberaciones)
    .where(and(eq(ordenLiberaciones.id, cambio.itemId), eq(ordenLiberaciones.ordenId, orden.id)))
    .limit(1);
  if (!actual) throw new RechazoMop("Lectura no encontrada en esta orden.", 404);
  if (cambio.obligatoria !== undefined && !esJefatura(user)) {
    throw new RechazoMop("Solo la jefatura puede cambiar si una lectura de liberación es obligatoria.", 403);
  }

  const data: Record<string, unknown> = {};
  if (cambio.obligatoria !== undefined) data.obligatoria = cambio.obligatoria;
  const tocaValor = cambio.valorMedido !== undefined || cambio.valorMedidoTexto !== undefined;
  if (tocaValor) {
    const valor = cambio.valorMedido !== undefined ? cambio.valorMedido : actual.valorMedido;
    const texto = cambio.valorMedidoTexto !== undefined ? cambio.valorMedidoTexto?.trim().slice(0, 300) || null : actual.valorMedidoTexto;
    const esNumero = valor != null && Number.isFinite(Number(valor));
    const hayLectura = esNumero || !!texto;
    if (hayLectura && !esNumero && liberacionConRango(actual)) {
      const leido = numeroAlInicio(texto);
      if (leido.tipo === "ambiguo") throw new RechazoMop(leido.mensaje, 400);
      if (leido.tipo !== "numero") throw new RechazoMop(MENSAJE_LECTURA_SIN_NUMERO, 400);
    }
    data.valorMedido = valor ?? null;
    data.valorMedidoTexto = texto;
    // Sin rango que comparar, «conforme» queda null y lo juzga quien libera. Una
    // lectura escrita como texto («14,5 A») se juzga por su número.
    data.conforme = evaluarConformeLiberacion(actual.minAceptable, actual.maxAceptable, numeroDeLectura(valor, texto));
    data.medidoPor = hayLectura ? user.id : null;
    data.medidoEn = hayLectura ? momento : null;
  }
  if (Object.keys(data).length === 0) throw new RechazoMop("Nada que actualizar.", 400);

  const [row] = await db.update(ordenLiberaciones).set(data).where(eq(ordenLiberaciones.id, actual.id)).returning();
  if (tocaValor) {
    const leido = row.valorMedido != null ? `${row.valorMedido}${row.unidad ? ` ${row.unidad}` : ""}` : row.valorMedidoTexto ?? "—";
    await logAudit(ctx, {
      entidad: "orden",
      entidadId: orden.id,
      accion: "update",
      resumen: `Liberación «${row.etiqueta}»: ${leido}${row.conforme === false ? " — FUERA DE RANGO" : row.conforme === true ? " — conforme" : ""}`,
      cambios: {
        [`liberacion:${row.etiqueta}`]: { antes: actual.valorMedido ?? actual.valorMedidoTexto, despues: row.valorMedido ?? row.valorMedidoTexto },
        conforme: { antes: actual.conforme, despues: row.conforme },
      },
    });
  }
  return row;
}

/**
 * Lo que escribió el técnico, leído con numero.ts: un número (coma o punto decimal) o, si no lo es,
 * un texto. «1,200» no se adivina y queda como texto: con rango, registrarLiberacion lo rechaza.
 */
export function lecturaEscrita(valor: unknown): { valorMedido: number | null; valorMedidoTexto: string | null } {
  const leido = leerNumero(typeof valor === "number" || typeof valor === "string" ? valor : null);
  if (leido.tipo === "numero") return { valorMedido: leido.valor, valorMedidoTexto: null };
  if (leido.tipo === "vacio" || typeof valor !== "string") return { valorMedido: null, valorMedidoTexto: null };
  return { valorMedido: null, valorMedidoTexto: valor.trim().slice(0, 300) };
}

/**
 * Los prerrequisitos y las lecturas de liberación de varias órdenes: dos
 * consultas por cada 90 órdenes (D1 acepta 100 valores por consulta).
 */
export async function mopDeOrdenes(db: Db, ordenIds: number[]) {
  const prerrequisitos = new Map<number, Array<typeof ordenPrerrequisitos.$inferSelect>>();
  const liberaciones = new Map<number, Array<typeof ordenLiberaciones.$inferSelect>>();
  const ids = [...new Set(ordenIds)];
  for (let i = 0; i < ids.length; i += 90) {
    const tramo = ids.slice(i, i + 90);
    const pre = await db.select().from(ordenPrerrequisitos).where(inArray(ordenPrerrequisitos.ordenId, tramo)).orderBy(asc(ordenPrerrequisitos.orden), asc(ordenPrerrequisitos.id));
    const lib = await db.select().from(ordenLiberaciones).where(inArray(ordenLiberaciones.ordenId, tramo)).orderBy(asc(ordenLiberaciones.orden), asc(ordenLiberaciones.id));
    for (const p of pre) { if (!prerrequisitos.has(p.ordenId)) prerrequisitos.set(p.ordenId, []); prerrequisitos.get(p.ordenId)!.push(p); }
    for (const l of lib) { if (!liberaciones.has(l.ordenId)) liberaciones.set(l.ordenId, []); liberaciones.get(l.ordenId)!.push(l); }
  }
  return { prerrequisitos, liberaciones };
}

/** Cómo ve el celular un prerrequisito y una lectura de liberación. */
export function prerrequisitoParaCampo(p: typeof ordenPrerrequisitos.$inferSelect) {
  const tipo = (p.tipo ?? "otro") as PrerrequisitoTipo;
  return {
    id: p.id,
    texto: p.texto,
    tipo,
    obligatorio: !!p.obligatorio,
    cumplido: !!p.cumplido,
    referencia: p.referencia ?? null,
    pista: PRERREQ_REFERENCIA_HINT[tipo] ?? PRERREQ_REFERENCIA_HINT.otro,
  };
}

export function liberacionParaCampo(l: typeof ordenLiberaciones.$inferSelect) {
  const valor = l.valorMedido != null && Number.isFinite(Number(l.valorMedido)) ? Number(l.valorMedido) : l.valorMedidoTexto?.trim() ? l.valorMedidoTexto : null;
  return {
    id: l.id,
    etiqueta: l.etiqueta,
    unidad: l.unidad ?? null,
    esperado: l.valorEsperado ?? null,
    min: l.minAceptable ?? null,
    max: l.maxAceptable ?? null,
    obligatoria: !!l.obligatoria,
    medida: liberacionTieneLectura(l),
    valor,
    conforme: l.conforme ?? null,
  };
}
