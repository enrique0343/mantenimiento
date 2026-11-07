// ─── MOP · la plantilla baja a la orden ─────────────────────────────────────
//
// Un MOP sin prerrequisitos en la orden es un MOP decorativo: la regla dura
// («la orden no le deja empezar sin el permiso firmado», cap. 2.5) solo muerde
// si la orden trae las filas. Esto las copia desde la plantilla del MOP en el
// momento en que la orden queda vinculada al procedimiento.
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "./db";
import {
  checklistPlantillas,
  ordenLiberaciones,
  ordenPrerrequisitos,
  plantillaLiberaciones,
  plantillaPrerrequisitos,
} from "./schema";

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
