// La orden y su vínculo con la solicitud se confirman juntos. Ninguna llamada a
// correo/R2 ocurre dentro de la transacción: solo el ganador ejecuta esos efectos.
import type { APIContext } from 'astro';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, getEnv } from './db';
import { ordenes, tickets, activos, ubicaciones, usuarios, type Ticket } from './schema';
import { puedeEntrar, espacioDeArea } from './espacio';
import { rubroDeActivo } from './rubros';

export class ConflictoTicket extends Error {}
const CAMPOS = {
  rubro:'rubro', activoId:'activo_id', sucursalId:'sucursal_id', ubicacionId:'ubicacion_id', ubicacion:'ubicacion',
  estado:'estado', prioridad:'prioridad', asignadoA:'asignado_a', otId:'ot_id', proyectoId:'proyecto_id',
  updatedAt:'updated_at', asunto:'asunto', descripcion:'descripcion', resueltoEn:'resuelto_en',
  vencimientoSla:'vencimiento_sla', slaHoras:'sla_horas', resolucionNotas:'resolucion_notas',
} as const;
const SNAPSHOT = ['rubro','activoId','sucursalId','ubicacionId','ubicacion','estado','prioridad','asignadoA','otId','proyectoId','updatedAt','asunto','descripcion','resueltoEn','vencimientoSla','slaHoras','resolucionNotas'] as const;
const mensaje = 'La solicitud cambió mientras la editabas. Actualiza la página antes de continuar.';
function condicion(actual: Ticket, alias='') {
  return { texto: `${alias}id=? AND ${SNAPSHOT.map(k=>`${alias}${CAMPOS[k]} IS ?`).join(' AND ')}`,
    valores:[actual.id,...SNAPSHOT.map(k=>actual[k] ?? null)] };
}
function cambiosSql(data: Record<string, unknown>) {
  const entradas=Object.entries(data).filter(([k])=>k in CAMPOS);
  if (!entradas.length) throw new Error('No hay cambios para guardar.');
  return { texto:entradas.map(([k])=>`${CAMPOS[k as keyof typeof CAMPOS]}=?`).join(','), valores:entradas.map(([,v])=>v ?? null) };
}

/** CAS para cambios sin orden nueva; tampoco pisan una conversión simultánea. */
export async function actualizarTicketConcurrente(ctx: APIContext, actual: Ticket, data: Record<string, unknown>) {
  const db=getDb(ctx);
  const [ticket]=await db.update(tickets).set(data).where(and(eq(tickets.id,actual.id),
    ...SNAPSHOT.map(k=>sql`${tickets[k]} IS ${actual[k] ?? null}`))).returning();
  if (!ticket) throw new ConflictoTicket(mensaje);
  return ticket;
}

type OrdenNueva = {
  titulo:string; descripcion:string; rubro:string; prioridad:string; activoId:number|null;
  sucursalId:number|null; ubicacionId:number|null; ubicacionDetalle:string|null;
  asignadoA:number|null; creadoPor:number; vencimiento:string|null;
};
export async function crearOrdenDeTicketAtomica(ctx: APIContext, actual: Ticket, data: Record<string, unknown>, nueva: OrdenNueva, resumen: string) {
  const db=getDb(ctx), DB=getEnv(ctx).DB;
  const guard=condicion(actual,'t.');
  if (actual.otId || actual.proyectoId) throw new ConflictoTicket('La solicitud ya tiene una orden o un proyecto asociado.');
  // Estas referencias se vuelven a comprobar en el INSERT, después de las validaciones del manejador.
  let assetGuard='1', assetArgs: unknown[]=[];
  if (nueva.activoId !== null) {
    const [asset]=await db.select({rubro:activos.rubro,tipo:activos.tipo,ubicacionId:activos.ubicacionId,estado:activos.estado})
      .from(activos).where(eq(activos.id,nueva.activoId)).limit(1);
    if (!asset || asset.estado==='baja' || rubroDeActivo(asset.rubro,asset.tipo)!==nueva.rubro
      || (nueva.ubicacionId!==null && asset.ubicacionId!==null && nueva.ubicacionId!==asset.ubicacionId)) throw new ConflictoTicket('El equipo cambió de área, ubicación o estado. Actualiza la solicitud.');
    if (asset.ubicacionId && nueva.sucursalId) {
      const [lugar]=await db.select({sucursalId:ubicaciones.sucursalId}).from(ubicaciones).where(eq(ubicaciones.id,asset.ubicacionId)).limit(1);
      if (!lugar || lugar.sucursalId!==nueva.sucursalId) throw new ConflictoTicket('El equipo cambió de sede. Actualiza la solicitud.');
    }
    assetGuard=`EXISTS(SELECT 1 FROM activos WHERE id=? AND rubro IS ? AND tipo IS ? AND ubicacion_id IS ? AND estado IS ?)`;
    assetArgs=[nueva.activoId,asset.rubro,asset.tipo,asset.ubicacionId,asset.estado];
  }
  let userGuard='1', userArgs: unknown[]=[];
  if (nueva.asignadoA !== null) {
    const [asignado]=await db.select({rol:usuarios.rol,especialidad:usuarios.especialidad,activo:usuarios.activo}).from(usuarios).where(eq(usuarios.id,nueva.asignadoA)).limit(1);
    if (!asignado?.activo || !puedeEntrar(asignado,espacioDeArea(nueva.rubro))) throw new ConflictoTicket('El técnico ya no está activo o no tiene acceso a este espacio.');
    userGuard='EXISTS(SELECT 1 FROM usuarios WHERE id=? AND activo=1 AND rol=? AND especialidad IS ?)';
    userArgs=[nueva.asignadoA,asignado.rol,asignado.especialidad];
  }
  const change=cambiosSql(data), now=new Date().toISOString();
  const resultados=await DB.batch([
    DB.prepare(`INSERT INTO ordenes(titulo,descripcion,tipo,prioridad,estado,rubro,activo_id,sucursal_id,ubicacion_id,ubicacion_detalle,asignado_a,asignado_en,creado_por,vencimiento)
      SELECT ?,?,'correctivo',?,'abierta',?,?,?,?,?,?,?,?,? FROM tickets t
      WHERE ${guard.texto} AND t.ot_id IS NULL AND t.proyecto_id IS NULL AND ${assetGuard} AND ${userGuard} RETURNING id`)
      .bind(nueva.titulo,nueva.descripcion,nueva.prioridad,nueva.rubro,nueva.activoId,nueva.sucursalId,nueva.ubicacionId,nueva.ubicacionDetalle,
        nueva.asignadoA,nueva.asignadoA?now:null,nueva.creadoPor,nueva.vencimiento,...guard.valores,...assetArgs,...userArgs),
    // changes() cuenta solo el INSERT exterior, no sus triggers; last_insert_rowid()
    // también vuelve al id de la orden al terminar el trigger de numeración.
    DB.prepare(`UPDATE tickets AS t SET ${change.texto},ot_id=last_insert_rowid() WHERE ${guard.texto} AND changes()=1 RETURNING id`)
      .bind(...change.valores,...guard.valores),
    DB.prepare(`INSERT INTO audit_log(entidad,entidad_id,accion,usuario_id,resumen,created_at)
      SELECT 'orden',ot_id,'create',?,?,? FROM tickets WHERE id=? AND changes()=1`)
      .bind(nueva.creadoPor,resumen,now,actual.id),
    DB.prepare(`INSERT INTO audit_log(entidad,entidad_id,accion,usuario_id,resumen,created_at)
      SELECT 'orden',ot_id,'asignacion',?,?,? FROM tickets WHERE id=? AND changes()=1 AND ? IS NOT NULL`)
      .bind(nueva.creadoPor,`Asignada al técnico (id: ${nueva.asignadoA}) al generar la orden desde la solicitud`,now,actual.id,nueva.asignadoA),
  ]);
  if (!resultados[0].meta.changes || !resultados[1].meta.changes) throw new ConflictoTicket(mensaje);
  const id=Number((resultados[0].results[0] as {id:number}).id);
  const [orden]=await db.select().from(ordenes).where(eq(ordenes.id,id)).limit(1);
  const [ticket]=await db.select().from(tickets).where(eq(tickets.id,actual.id)).limit(1);
  return {orden,ticket};
}
