// Fase 59 · WP-G · Lecturas de la biblioteca de procedimientos y protocolos.
//
// La lista de la biblioteca necesita los campos en azul y la matriz de validación
// de todos los documentos activos. Pedirlos con la lista de ids (inArray) suma un
// parámetro por documento y D1 rechaza la consulta pasados los 100: la página
// entera dejaría de abrir cuando la biblioteca (modelos, copias por sede y
// protocolos) llegue a ese número. Aquí se piden con una subconsulta: un solo
// parámetro, cualquiera que sea el tamaño de la biblioteca.
import { eq, inArray } from "drizzle-orm";
import type { getDb } from "./db";
import { procedimientoCampos, procedimientoValidaciones, procedimientos } from "./schema";

type Db = ReturnType<typeof getDb>;

/** Campos en azul y validaciones de los documentos activos, sin listas de ids. */
export async function camposYValidacionesActivos(db: Db) {
  const activos = db.select({ id: procedimientos.id }).from(procedimientos).where(eq(procedimientos.activo, true));
  const [campos, validaciones] = await Promise.all([
    db.select().from(procedimientoCampos).where(inArray(procedimientoCampos.procedimientoId, activos)),
    db.select().from(procedimientoValidaciones).where(inArray(procedimientoValidaciones.procedimientoId, activos)),
  ]);
  return { campos, validaciones };
}
