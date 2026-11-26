import type { APIContext } from 'astro';
import { z } from 'zod';
import { getEnv } from './db';
import { ESPACIOS, espacioDeArea, puedeEntrar, type Espacio } from './espacio';
import { rubroDeActivo, type RubroKey } from './rubros';

export const derivacionTicketSchema = z.object({
  espacioDestino: z.enum(['general', 'biomedico', 'tecnologia']),
  rubroDestino: z.enum(['aires', 'infraestructura', 'equipo_general', 'biomedico', 'tecnologia']).optional(),
  motivo: z.string().trim().min(3).max(2000).transform(s => s.toLocaleUpperCase('es-SV')),
  desvincularEquipo: z.boolean().optional().default(false),
  expectedUpdatedAt: z.string().min(1).max(80),
}).strict().superRefine((v, ctx) => {
  if (v.rubroDestino && espacioDeArea(v.rubroDestino) !== v.espacioDestino) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rubroDestino'], message: 'El área debe pertenecer al espacio de destino.' });
  }
});
type SolicitudDerivacion = z.infer<typeof derivacionTicketSchema>;
type Actor = { id: number; rol: string; especialidad?: string | null };
type Fila = Record<string, string | number | null>;
type Trabajo = Fila & { id: number; rubro: string | null; activo_id: number | null; sucursal_id: number | null; ubicacion_id: number | null; estado: string; asignado_a: number | null; proyecto_id: number | null };
type Ticket = Trabajo & { ot_id: number | null; updated_at: string; created_at: string; vencimiento_sla: string | null; sla_horas: number | null; resuelto_en: string | null };
type Equipo = Fila & { id: number; rubro: string | null; tipo: string; ubicacion_id: number | null };

export class ErrorDerivacionTicket extends Error {
  constructor(message: string, public status: 400 | 403 | 404 | 409 = 409) { super(message); }
}
const CONFLICTO = 'La solicitud, su orden o sus referencias cambiaron. Actualiza la página antes de derivarla.';
const CON_TRABAJO = 'La solicitud tiene trabajo registrado o un proyecto asociado. Conserva su historial y coordina la derivación con la jefatura.';

// Un único parámetro JSON permite comparar toda la fila sin superar los 100
// parámetros de D1. Las claves proceden exclusivamente de columnas leídas en DB.
function snapshot(fila: Fila, alias: string) {
  const campos = Object.keys(fila);
  if (campos.some(c => !/^[a-z_][a-z0-9_]*$/.test(c))) throw new Error('Columna de snapshot inválida');
  return {
    sql: `EXISTS (SELECT 1 FROM (SELECT ? AS fila) snapshot WHERE ${campos.map(c => `${alias}.${c} IS json_extract(snapshot.fila,'$.${c}')`).join(' AND ')})`,
    valor: JSON.stringify(fila),
  };
}

// Una OT abierta puede contener ejecución ya registrada o evidencia en tablas
// auxiliares. Nunca se reclasifican esas intervenciones ni los conjuntos históricos.
const CAMPOS_TRABAJO = [
  'iniciada_en', 'pausada_en', 'completada_en', 'trabajos_realizados', 'causa_raiz', 'solucion_aplicada',
  'checklist_ejecucion', 'verificado_por', 'verificado_en', 'verificacion_notas', 'cerrado_por', 'cerrado_en',
  'firma_tecnico_r2', 'firma_tecnico_nombre', 'firma_tecnico_fecha', 'firma_jefe_r2', 'firma_jefe_nombre',
  'firma_jefe_fecha', 'firma_solicitante_r2', 'firma_solicitante_nombre', 'firma_solicitante_fecha',
  'proyecto_id', 'plan_id', 'actividad_id', 'vehiculo_id', 'procedimiento_id', 'aop_evento_id',
  'hora_alarma', 'hora_llegada', 'hora_mitigacion', 'hora_restablecimiento', 'plan_reversa', 'reversa_notas',
  'riesgo_aceptado_por', 'riesgo_aceptado_en', 'riesgo_aceptado_notas',
  'cierre_sin_lectura_por', 'cierre_sin_lectura_en', 'cierre_sin_lectura_motivo',
];
const EVIDENCIAS = [
  ['comentarios', 'orden_id'], ['adjuntos', 'orden_id'], ['movimientos_inventario', 'orden_id'],
  ['orden_repuestos', 'orden_id'], ['encuestas_satisfaccion', 'orden_id'], ['solicitudes_compra', 'orden_id'],
  ['mediciones', 'orden_id'], ['aop_eventos', 'orden_id'], ['orden_prerrequisitos', 'orden_id'],
  ['orden_liberaciones', 'orden_id'], ['ronda_lecturas', 'orden_id'], ['orden_paso_marcas', 'orden_id'],
  ['campo_operaciones', 'orden_id'], ['orden_conjuntos', 'orden_id'], ['orden_verificacion', 'orden_id'],
  ['orden_verificacion_eventos', 'orden_id'], ['pruebas_seguridad_electrica', 'orden_id'], ['orden_incidentes', 'orden_id'],
  ['rondas_proposals', 'order_id'], ['rondas_order_links', 'order_id'],
] as const;
function ordenSinTrabajo(alias: string, ticketId: number) {
  return `${alias}.estado='abierta' AND ${alias}.tipo='correctivo'
    AND ${CAMPOS_TRABAJO.map(c => `(${alias}.${c} IS NULL OR ${alias}.${c}='')`).join(' AND ')}
    AND coalesce(${alias}.tiempo_pausado_min,0)=0 AND coalesce(${alias}.horas_trabajadas,0)=0 AND ${alias}.reversa_ejecutada=0
    AND ${EVIDENCIAS.map(([table, key]) => `NOT EXISTS(SELECT 1 FROM ${table} e WHERE e.${key}=${alias}.id)`).join(' AND ')}
    AND NOT EXISTS(SELECT 1 FROM tickets otro WHERE otro.ot_id=${alias}.id AND otro.id<>${ticketId})
    AND EXISTS(SELECT 1 FROM audit_log origen WHERE origen.entidad='orden' AND origen.entidad_id=${alias}.id AND origen.accion='create'
      AND (origen.resumen LIKE 'OT generada desde Ticket #${ticketId} de %' OR origen.resumen LIKE 'OT generada al asignar Ticket #${ticketId} de %'))`;
}

/** Traslada una solicitud abierta; no genera otra OT ni amplía el acceso del actor. */
export async function derivarTicket(ctx: APIContext, actor: Actor, id: number, datos: SolicitudDerivacion) {
  const DB = getEnv(ctx).DB;
  const ticket = await DB.prepare('SELECT * FROM tickets WHERE id=?').bind(id).first<Ticket>();
  if (!ticket) throw new ErrorDerivacionTicket('Solicitud no encontrada.', 404);
  const equipo = ticket.activo_id === null ? null : await DB.prepare('SELECT id,rubro,tipo,ubicacion_id,estado FROM activos WHERE id=?').bind(ticket.activo_id).first<Equipo>();
  const origen = espacioDeArea(ticket.rubro ?? (equipo ? rubroDeActivo(equipo.rubro, equipo.tipo) : null));
  if (!['admin', 'jefe', 'tecnico'].includes(actor.rol) || !puedeEntrar(actor, origen)) throw new ErrorDerivacionTicket('No tienes permiso para derivar solicitudes de este espacio.', 403);
  if (actor.rol === 'tecnico' && ticket.asignado_a !== null && ticket.asignado_a !== actor.id) throw new ErrorDerivacionTicket('Solo puedes derivar solicitudes sin asignar o asignadas a ti.', 403);
  if (ticket.updated_at !== datos.expectedUpdatedAt) throw new ErrorDerivacionTicket(CONFLICTO);
  const url = new URL(ctx.request.url);
  const areaSolicitada = url.searchParams.get('area'), espacioSolicitado = url.searchParams.get('espacio');
  const rubroOrigen = ticket.rubro ?? (equipo ? rubroDeActivo(equipo.rubro, equipo.tipo) : 'equipo_general');
  if ((areaSolicitada && areaSolicitada !== rubroOrigen) || (espacioSolicitado && espacioSolicitado !== origen)) throw new ErrorDerivacionTicket(CONFLICTO);
  if (!['nuevo', 'asignado', 'en_proceso'].includes(ticket.estado) || ticket.proyecto_id || ticket.resuelto_en) throw new ErrorDerivacionTicket(CON_TRABAJO);
  const rubroDestino: RubroKey = datos.rubroDestino ?? (datos.espacioDestino === 'general' ? 'equipo_general' : datos.espacioDestino);
  if (rubroOrigen === rubroDestino) throw new ErrorDerivacionTicket('La solicitud ya pertenece a esa bandeja. No se realizó otra derivación.');
  if (ticket.activo_id !== null && !equipo) throw new ErrorDerivacionTicket(CONFLICTO);
  if (equipo && rubroDeActivo(equipo.rubro, equipo.tipo) !== rubroDestino && !datos.desvincularEquipo) {
    throw new ErrorDerivacionTicket('El equipo vinculado pertenece a otra área. Confirma su desvinculación para derivar la solicitud; el inventario conservará su clasificación.');
  }
  const activoDestino = datos.desvincularEquipo ? null : ticket.activo_id;
  const orden = ticket.ot_id === null ? null : await DB.prepare('SELECT * FROM ordenes WHERE id=?').bind(ticket.ot_id).first<Trabajo>();
  if (ticket.ot_id !== null && !orden) throw new ErrorDerivacionTicket(CONFLICTO);
  const guards: string[] = [], args: (string | number | null)[] = [];
  const original = snapshot(ticket, 't');
  guards.push(original.sql, 'EXISTS(SELECT 1 FROM usuarios actor WHERE actor.id=? AND actor.activo=1 AND actor.rol=? AND actor.especialidad IS ?)');
  args.push(original.valor, actor.id, actor.rol, actor.especialidad ?? null);
  if (equipo) {
    const s = snapshot(equipo, 'a');
    guards.push(`EXISTS(SELECT 1 FROM activos a WHERE a.id=? AND ${s.sql})`); args.push(equipo.id, s.valor);
  }
  if (orden) {
    if (espacioDeArea(orden.rubro ?? (equipo ? rubroDeActivo(equipo.rubro, equipo.tipo) : null)) !== origen
      || orden.activo_id !== ticket.activo_id || orden.sucursal_id !== ticket.sucursal_id || orden.ubicacion_id !== ticket.ubicacion_id) throw new ErrorDerivacionTicket('La orden y la solicitud tienen referencias diferentes. Revisa sus vínculos antes de derivar.');
    if (actor.rol === 'tecnico' && orden.asignado_a !== null && orden.asignado_a !== actor.id) throw new ErrorDerivacionTicket('La orden está asignada a otra persona. Solicita la derivación a la jefatura.', 403);
    const segura = ordenSinTrabajo('o', id);
    if (!await DB.prepare(`SELECT id FROM ordenes o WHERE id=? AND ${segura}`).bind(orden.id).first()) throw new ErrorDerivacionTicket(CON_TRABAJO);
    const s = snapshot(orden, 'o');
    guards.push(`EXISTS(SELECT 1 FROM ordenes o WHERE o.id=? AND ${s.sql} AND ${segura})`); args.push(orden.id, s.valor);
  }
  // Se vuelve a comprobar la sede/ubicación efectiva, incluida la del equipo
  // aun cuando el usuario autorice quitar su vínculo; no se mueven inventarios.
  for (const lugarId of new Set([ticket.ubicacion_id, equipo?.ubicacion_id].filter((n): n is number => n != null))) {
    const lugar = await DB.prepare('SELECT id,sucursal_id,activa FROM ubicaciones WHERE id=?').bind(lugarId).first<Fila>();
    if (!lugar || (ticket.sucursal_id !== null && lugar.sucursal_id !== ticket.sucursal_id)) throw new ErrorDerivacionTicket('La sede y la ubicación no coinciden. Revisa la solicitud antes de derivar.');
    const s = snapshot(lugar, 'u'); guards.push(`EXISTS(SELECT 1 FROM ubicaciones u WHERE u.id=? AND ${s.sql})`); args.push(lugarId, s.valor);
  }
  if (ticket.sucursal_id !== null) {
    const sede = await DB.prepare('SELECT id,activa FROM sucursales WHERE id=?').bind(ticket.sucursal_id).first<Fila>();
    if (!sede) throw new ErrorDerivacionTicket(CONFLICTO);
    const s = snapshot(sede, 's'); guards.push(`EXISTS(SELECT 1 FROM sucursales s WHERE s.id=? AND ${s.sql})`); args.push(ticket.sucursal_id, s.valor);
  }
  const now = new Date().toISOString();
  const antes = { espacio: origen, rubro: ticket.rubro, estado: ticket.estado, asignadoA: ticket.asignado_a, otId: ticket.ot_id, activoId: ticket.activo_id };
  const despues = { espacio: datos.espacioDestino, rubro: rubroDestino, estado: 'nuevo', asignadoA: null, otId: ticket.ot_id, activoId: activoDestino };
  const movimiento = {
    antes, despues, motivo: datos.motivo, desvincularEquipo: !!(datos.desvincularEquipo && equipo),
    fechasConservadas: { createdAt: ticket.created_at, vencimientoSla: ticket.vencimiento_sla, slaHoras: ticket.sla_horas, resueltoEn: ticket.resuelto_en },
    ...(orden ? { orden: { id: orden.id, codigo: orden.codigo,
      antes: { rubro: orden.rubro, estado: orden.estado, asignadoA: orden.asignado_a, asignadoEn: orden.asignado_en, activoId: orden.activo_id },
      despues: { rubro: rubroDestino, estado: orden.estado, asignadoA: null, asignadoEn: null, activoId: activoDestino },
      fechasConservadas: { createdAt: orden.created_at, vencimiento: orden.vencimiento, iniciadaEn: orden.iniciada_en, completadaEn: orden.completada_en, horasTrabajadas: orden.horas_trabajadas, tiempoPausadoMin: orden.tiempo_pausado_min },
    } } : {}),
  };
  const resumen = `Solicitud #${id} derivada de ${ESPACIOS[origen].etiqueta} a ${ESPACIOS[datos.espacioDestino].etiqueta}: ${datos.motivo}`;
  const statements = [DB.prepare(`UPDATE tickets AS t SET rubro=?,tipo_mantenimiento=?,estado='nuevo',asignado_a=NULL,activo_id=?,updated_at=?
    WHERE t.id=? AND ${guards.join(' AND ')} RETURNING id`)
    .bind(rubroDestino, datos.espacioDestino === 'biomedico' ? 'biomedico' : 'general', activoDestino, now, id, ...args)];
  // La primera escritura toma el bloqueo de D1 y verifica todos los snapshots.
  // Las siguientes solo se ejecutan si ganó: cero cambios produce cero auditorías.
  if (orden) statements.push(DB.prepare('UPDATE ordenes SET rubro=?,asignado_a=NULL,asignado_en=NULL,activo_id=? WHERE id=? AND changes()=1').bind(rubroDestino, activoDestino, orden.id));
  statements.push(DB.prepare(`INSERT INTO audit_log(entidad,entidad_id,accion,usuario_id,cambios,resumen,created_at)
    SELECT 'ticket',?,'derivacion',?,?,?,? WHERE changes()=1`).bind(id, actor.id, JSON.stringify(movimiento), resumen, now));
  if (orden) statements.push(DB.prepare(`INSERT INTO audit_log(entidad,entidad_id,accion,usuario_id,cambios,resumen,created_at)
    SELECT 'orden',?,'derivacion',?,?,?,? WHERE changes()=1`).bind(orden.id, actor.id, JSON.stringify({ ticketId: id, motivo: datos.motivo, ...movimiento.orden }), resumen, now));
  const result = await DB.batch(statements);
  if (!result[0].meta.changes) throw new ErrorDerivacionTicket(CONFLICTO);
  return { id, espacioDestino: datos.espacioDestino, rubroDestino, mensaje: `Solicitud derivada a ${ESPACIOS[datos.espacioDestino].etiqueta}, sin asignar y conservando su fecha original y plazo.` };
}
