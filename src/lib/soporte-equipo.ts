import { eq } from "drizzle-orm";
import type { getDb } from "./db";
import { activos, ubicaciones, sucursales } from "./schema";
import { espacioDeActivo, puedeEntrar, type UsuarioEspacio } from "./espacio";
import { rubroDeActivo } from "./rubros";
import type { AreaKey } from "./areas";

/** El enlace desde la ficha conserva el equipo, sin publicar su ficha técnica ni custodia. */
export async function equipoInicialSoporte(db: ReturnType<typeof getDb>, user: UsuarioEspacio, rawId: string | null, area: AreaKey | null) {
  const id = Number(rawId);
  if (!user || !Number.isSafeInteger(id) || id <= 0) return null;
  const [a] = await db.select({ id: activos.id, codigo: activos.codigo, nombre: activos.nombre,
    rubro: activos.rubro, tipo: activos.tipo, estado: activos.estado, ubicacionId: activos.ubicacionId,
  }).from(activos).where(eq(activos.id, id)).limit(1);
  if (!a || a.estado === "baja" || !puedeEntrar(user, espacioDeActivo(a))) return null;
  const areaEquipo = rubroDeActivo(a.rubro, a.tipo);
  if (area && area !== areaEquipo) return null;
  let ubicacionId: number | null = null;
  let sucursalId: number | null = null;
  if (a.ubicacionId) {
    const [ub] = await db.select({ id: ubicaciones.id, activa: ubicaciones.activa,
      sucursalId: sucursales.id, sucursalActiva: sucursales.activa,
    }).from(ubicaciones).innerJoin(sucursales, eq(sucursales.id, ubicaciones.sucursalId))
      .where(eq(ubicaciones.id, a.ubicacionId)).limit(1);
    // Una ubicación inactiva requiere corregirse en la ficha antes de preseleccionarla.
    if (!ub?.activa || !ub.sucursalActiva) return null;
    ubicacionId = ub.id; sucursalId = ub.sucursalId;
  }
  return { id: a.id, codigo: a.codigo, nombre: a.nombre, area: areaEquipo, ubicacionId, sucursalId };
}
