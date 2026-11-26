import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { getDb } from './db';
import { activos, ordenes, usuarios } from './schema';
import { espacioDeTrabajo, puedeEntrar } from './espacio';

type Db = ReturnType<typeof getDb>;
type Orden = typeof ordenes.$inferSelect;
type Actor = { id: number; rol: string };
export class ErrorAlcanceOrden extends Error {
  constructor(message: string, public status: 401 | 403 | 404 | 409 = 409) { super(message); }
}

/** El alcance autorizado debe seguir igual cuando se confirma la escritura. */
export function condicionAlcanceOrden(order: Orden): SQL {
  return sql`exists (select 1 from ordenes where id=${order.id}
    and estado=${order.estado} and rubro is ${order.rubro} and activo_id is ${order.activoId}
    and asignado_a is ${order.asignadoA} and asignado_en is ${order.asignadoEn}
    and sucursal_id is ${order.sucursalId} and ubicacion_id is ${order.ubicacionId}
    and proyecto_id is ${order.proyectoId} and plan_id is ${order.planId}
    and actividad_id is ${order.actividadId} and vehiculo_id is ${order.vehiculoId}
    and procedimiento_id is ${order.procedimientoId} and tipo=${order.tipo})`;
}

/**
 * Autoriza dentro del manejador, aunque el middleware haya visto otro alcance.
 * Quien llama conserva sus reglas de estado/propiedad; soloAsignado es optativo
 * para las rutas que ya exigen que el técnico sea responsable de la OT.
 */
export async function leerOrdenConAlcance(db: Db, id: number, user: Actor, opciones: { soloAsignado?: boolean; roles?: readonly string[] } = {}) {
  const [usuario] = await db.select({ id: usuarios.id, rol: usuarios.rol, especialidad: usuarios.especialidad, activo: usuarios.activo })
    .from(usuarios).where(eq(usuarios.id, user.id)).limit(1);
  if (!usuario?.activo) throw new ErrorAlcanceOrden('La cuenta ya no está activa.', 403);
  if (usuario.rol !== user.rol || (opciones.roles && !opciones.roles.includes(usuario.rol))) throw new ErrorAlcanceOrden('Tus permisos cambiaron. Vuelve a cargar la página.', 403);
  const [orden] = await db.select().from(ordenes).where(eq(ordenes.id, id)).limit(1);
  if (!orden) throw new ErrorAlcanceOrden('Orden no encontrada.', 404);
  const [equipo] = orden.activoId ? await db.select({ id: activos.id, rubro: activos.rubro, tipo: activos.tipo, ubicacionId: activos.ubicacionId, estado: activos.estado })
    .from(activos).where(eq(activos.id, orden.activoId)).limit(1) : [];
  const espacio = espacioDeTrabajo(orden.rubro, equipo);
  if (!puedeEntrar(usuario, espacio)) throw new ErrorAlcanceOrden('No tienes acceso al espacio actual de esta orden.', 403);
  if (opciones.soloAsignado && usuario.rol === 'tecnico' && orden.asignadoA !== usuario.id) throw new ErrorAlcanceOrden('La orden debe estar asignada a ti.', 403);
  if (orden.activoId && !equipo) throw new ErrorAlcanceOrden('El equipo de la orden cambió. Actualiza la página.');
  const guard = and(condicionAlcanceOrden(orden),
    sql`exists (select 1 from usuarios where id=${usuario.id} and activo=1 and rol=${usuario.rol} and especialidad is ${usuario.especialidad})`,
    equipo ? sql`exists (select 1 from activos where id=${equipo.id} and rubro is ${equipo.rubro} and tipo is ${equipo.tipo} and ubicacion_id is ${equipo.ubicacionId} and estado is ${equipo.estado})` : undefined)!;
  return { orden, usuario, espacio, guard };
}

/** Subconsulta escalar para D1 prepare: WHERE (${sql}), bind(...params). */
export function guardAlcanceD1(db: Db, guard: SQL): { sql: string; params: unknown[] } {
  return db.select({ vigente: sql<number>`1` }).from(ordenes).where(guard).limit(1).toSQL();
}
