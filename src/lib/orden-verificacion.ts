import { and, eq, sql } from 'drizzle-orm';
import { ordenes, usuarios, adjuntos, planesMantenimiento, actividades, activos, ordenPrerrequisitos, ordenLiberaciones } from './schema';
import { ordenVerificacion, ordenVerificacionEventos } from './orden-verificacion-schema';
import {
  parseChecklist, validarChecklistParaCierre, validarLecturasChecklistParaCierre, transicionesPermitidas,
  validarPrerrequisitosParaIniciar, validarLiberacionesParaCierre, validarCausaRaizParaCierre, puedeCerrarSinLectura,
  type EstadoOT,
} from './ordenes';
import { siguienteFecha } from './frecuencias';
import type { getDb } from './db';

type DB = ReturnType<typeof getDb>;
type Orden = typeof ordenes.$inferSelect;
type User = { id: number; rol: string; nombre: string };
export class ErrorVerificacion extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const deny = (message: string, status = 403): never => { throw new ErrorVerificacion(message, status); };
const executionFields = ['trabajosRealizados', 'causaRaiz', 'solucionAplicada', 'checklistEjecucion'];
const manager = (user: User) => ['admin', 'jefe'].includes(user.rol);
export function ejecutoresDeOrden(state: any): number[] {
  try { return JSON.parse(state?.executoresJson ?? '[]').filter((id: unknown) => Number.isInteger(id)); } catch { return []; }
}
export function esRevisorOrden(user: User, state: any) {
  return manager(user) || (user.rol === 'tecnico' && [state?.revisorId, state?.revisorSuplenteId].includes(user.id));
}
export function puedeVerificarOrden(user: User, order: Orden, state: any) {
  return esRevisorOrden(user, state) && user.id !== order.asignadoA && user.id !== state?.ejecutadoPor && !ejecutoresDeOrden(state).includes(user.id);
}
export async function leerVerificacionOrden(db: DB, id: number) {
  const [control] = await db.select().from(ordenVerificacion).where(eq(ordenVerificacion.ordenId, id)).limit(1);
  const eventos = await db.select().from(ordenVerificacionEventos).where(eq(ordenVerificacionEventos.ordenId, id)).orderBy(ordenVerificacionEventos.id);
  return { control: control ?? null, eventos };
}
function validarEvidencia(order: Orden, input: Record<string, any>) {
  const trabajos = input.trabajosRealizados !== undefined ? input.trabajosRealizados : order.trabajosRealizados;
  if (!trabajos?.trim() || trabajos.trim().length < 10) deny('Describe los trabajos realizados (al menos 10 caracteres) antes de enviar a verificación.', 400);
  const raw = input.checklistEjecucion !== undefined ? input.checklistEjecucion : order.checklistEjecucion;
  if (raw) { try { if (!Array.isArray(JSON.parse(raw))) throw new Error(); } catch { deny('El checklist no es un arreglo JSON válido.', 400); } }
  const result = validarChecklistParaCierre(parseChecklist(raw));
  if (!result.ok) deny(result.error!, 400);
}
/**
 * Reglas duras del volumen GO-GUI-011-2026 (cap. 02). «En una intervención, la
 * orden no le deja empezar sin el permiso firmado ni cerrar sin las lecturas de
 * liberación. En una emergencia [...] obliga a cerrar con un análisis de causa
 * raíz.» Aplican a todos los roles: son la evidencia de FMS.10.00 y FMS.08.01.
 * El único escape es el cierre sin lectura de un MOP, con motivo y por jefatura.
 */
async function validarInicioDocumental(db: DB, order: Orden, input: Record<string, any>) {
  const tipo = (input.tipo ?? order.tipo) as string;
  if (tipo !== 'intervencion') return;
  const prerreqs = await db
    .select({ texto: ordenPrerrequisitos.texto, tipo: ordenPrerrequisitos.tipo, obligatorio: ordenPrerrequisitos.obligatorio, cumplido: ordenPrerrequisitos.cumplido })
    .from(ordenPrerrequisitos).where(eq(ordenPrerrequisitos.ordenId, order.id));
  const v = validarPrerrequisitosParaIniciar(tipo, prerreqs);
  if (!v.ok) deny(v.error!, 400);
}
async function validarCierreDocumental(db: DB, order: Orden, user: User, input: Record<string, any>, data: Record<string, any>, now: string, motivoSinLectura?: string | null) {
  const tipo = (input.tipo ?? order.tipo) as string;
  // Una OT que nunca se inició no tiene lecturas que exigir: el cierre
  // administrativo de registros viejos sigue siendo posible.
  if (order.iniciadaEn) {
    const raw = input.checklistEjecucion !== undefined ? input.checklistEjecucion : order.checklistEjecucion;
    const lect = validarLecturasChecklistParaCierre(parseChecklist(raw));
    if (!lect.ok) deny(lect.error!, 400);
  }
  if (tipo === 'intervencion') {
    const libs = await db
      .select({ etiqueta: ordenLiberaciones.etiqueta, unidad: ordenLiberaciones.unidad, obligatoria: ordenLiberaciones.obligatoria, valorMedido: ordenLiberaciones.valorMedido, valorMedidoTexto: ordenLiberaciones.valorMedidoTexto })
      .from(ordenLiberaciones).where(eq(ordenLiberaciones.ordenId, order.id));
    const v = validarLiberacionesParaCierre(tipo, libs);
    if (!v.ok) {
      const motivo = (motivoSinLectura ?? '').trim();
      if (!motivo) deny(v.error!, 400);
      if (!puedeCerrarSinLectura(user.rol as any)) deny('Solo la jefatura (admin o jefe) puede cerrar un MOP sin la lectura de liberación. Pide a tu jefatura que lo cierre con el motivo escrito.');
      if (motivo.length < 20) deny('El motivo del cierre sin lectura tiene que explicar por qué no se pudo medir y con qué evidencia se libera el sistema (mínimo 20 caracteres).', 400);
      Object.assign(data, { cierreSinLecturaPor: user.id, cierreSinLecturaEn: now, cierreSinLecturaMotivo: motivo });
    }
  }
  let criticidad: string | null = null;
  const activoFinal = input.activoId !== undefined ? input.activoId : order.activoId;
  if (activoFinal) {
    const [a] = await db.select({ criticidad: activos.criticidadOperacional }).from(activos).where(eq(activos.id, activoFinal)).limit(1);
    criticidad = a?.criticidad ?? null;
  }
  const causa = input.causaRaiz !== undefined ? input.causaRaiz : order.causaRaiz;
  const vc = validarCausaRaizParaCierre(tipo, criticidad, causa);
  if (!vc.ok) deny(vc.error!, 400);
}

/** One transactional mutation, immutable snapshot and one-time PM advancement.
 * Completion remains `completada` (pending review); only independent approval closes.
 * Server identities/timestamps cannot be supplied by callers. */
export async function actualizarOrdenConVerificacion(db: DB, order: Orden, user: User, input: Record<string, any>, now = new Date().toISOString()) {
  const [saved] = await db.select().from(ordenVerificacion).where(eq(ordenVerificacion.ordenId, order.id)).limit(1);
  const initial = {
    ordenId: order.id, version: 0, ciclo: 1, ejecutadoPor: null, executoresJson: '[]',
    revisorId: null, revisorSuplenteId: null, reprogramarPreventivos: true,
    // A legacy closed order may already have advanced PM: never replay it.
    pmAvanzadoEn: order.estado === 'cerrada' ? (order.cerradoEn ?? order.completadaEn ?? now) : null,
  };
  const state = saved ?? initial;
  const { accion, motivo, revisorId, revisorSuplenteId, reprogramarPreventivos, motivoReasignacion, horasTrabajadas, cierreSinLecturaMotivo, ...data } = input;
  const stateData: Record<string, any> = {};
  let eventAction = 'edicion';
  let destination = input.estado ?? order.estado;
  const isReturn = accion === 'devolver' || accion === 'reabrir' ||
    (['completada', 'verificada', 'cerrada'].includes(order.estado) && ['en_proceso', 'abierta'].includes(destination));
  const isReview = !isReturn && ['verificada', 'cerrada'].includes(destination) && destination !== order.estado;
  const isComplete = destination === 'completada' && destination !== order.estado;
  const editsExecution = executionFields.some((key) => input[key] !== undefined && input[key] !== (order as any)[key]);
  const editsMetadata = ['titulo', 'descripcion', 'tipo', 'prioridad', 'activoId', 'vencimiento'].some((key) => input[key] !== undefined && input[key] !== (order as any)[key]);
  const editsAssignment = input.asignadoA !== undefined && input.asignadoA !== order.asignadoA;
  const onlySelfAssignment = user.rol === 'tecnico' && order.estado === 'abierta' && !order.asignadoA && input.asignadoA === user.id;
  if (!manager(user) && !onlySelfAssignment && editsAssignment) deny('Solo la jefatura puede cambiar la asignación.');
  if (editsMetadata && !manager(user)) deny('Solo la jefatura puede modificar los datos de la orden.');
  if (user.rol === 'tecnico' && !isReview && !isReturn && !onlySelfAssignment && order.asignadoA !== user.id && !(order.estado === 'abierta' && !order.asignadoA && destination === 'en_proceso')) deny('La orden debe estar asignada a ti para registrar ejecución o cambiar su estado.');
  if (editsExecution && !(manager(user) || (user.rol === 'tecnico' && order.asignadoA === user.id))) deny('No puedes registrar ejecución en esta orden.');
  if (editsExecution && !['en_proceso', 'en_espera'].includes(order.estado)) deny('Devuelve o reabre la orden antes de cambiar evidencia de ejecución.', 409);
  if ((isReturn || isReview) && (editsExecution || editsAssignment || editsMetadata)) deny('La revisión o devolución debe enviarse separada de cambios de ejecución, equipo o asignación.', 400);
  if (input.verificacionNotas !== undefined && !isReview) deny('Las notas de verificación solo se registran al verificar.', 400);
  if (!manager(user) && !['tecnico'].includes(user.rol) && !isReturn && !isReview) deny('No tienes permisos para modificar órdenes.');
  if (['completada','verificada','cerrada','cancelada'].includes(order.estado) && (editsMetadata || editsAssignment)) deny('Devuelve o reabre la orden antes de cambiar sus datos.', 409);
  if (input.vencimiento !== undefined && input.vencimiento !== order.vencimiento && !motivo?.trim()) deny('Registra el motivo de la reprogramación.', 400);

  if (revisorId !== undefined || revisorSuplenteId !== undefined) {
    if (!manager(user)) deny('Solo la jefatura puede designar revisores.');
    if (isReview || isReturn || isComplete) deny('Designa al revisor en una operación separada.', 400);
    for (const [key, value] of Object.entries({ revisorId, revisorSuplenteId })) {
      if (value === undefined) continue;
      if (value !== null) {
        const [candidate] = await db.select().from(usuarios).where(eq(usuarios.id, value as number)).limit(1);
        if (!candidate?.activo || !['admin','jefe','tecnico'].includes(candidate.rol)) deny('El revisor debe ser un administrador, jefe o técnico activo.', 400);
        if (value === order.asignadoA || value === state.ejecutadoPor || ejecutoresDeOrden(state).includes(value as number)) deny('El revisor debe ser independiente de la ejecución.', 400);
      }
      stateData[key] = value;
    }
    eventAction = 'designacion_revisor';
  }
  // Existing checklist criteria and critical flags cannot be removed by the executor.
  if (input.checklistEjecucion !== undefined && input.checklistEjecucion !== order.checklistEjecucion) {
    let incoming: any;
    try { incoming = JSON.parse(input.checklistEjecucion ?? '[]'); } catch { deny('Checklist inválido.', 400); }
    if (!Array.isArray(incoming)) deny('Checklist inválido.', 400);
    const original = parseChecklist(order.checklistEjecucion), next = parseChecklist(input.checklistEjecucion);
    if (original.length && (next.length !== original.length || original.some((item, i) => item.texto !== next[i]?.texto || !!item.bloqueante !== !!next[i]?.bloqueante || item.criterio !== next[i]?.criterio))) {
      deny('No se pueden eliminar puntos ni cambiar criterios o puntos críticos del checklist durante la ejecución.', 400);
    }
  }
  if (isReturn) {
    if (!esRevisorOrden(user, state)) deny('Solo una jefatura o un revisor designado puede devolver o reabrir la orden.');
    if (!['completada','verificada','cerrada'].includes(order.estado)) deny('La orden no está pendiente de verificación ni cerrada.', 409);
    if (!motivo?.trim() || motivo.trim().length < 10) deny('Registra el motivo de devolución o reapertura (al menos 10 caracteres).', 400);
    destination = 'en_proceso';
    eventAction = order.estado === 'cerrada' ? 'reapertura' : 'devolucion';
    Object.assign(data, { estado: destination, completadaEn: null, verificadoPor: null, verificadoEn: null, verificacionNotas: null, cerradoPor: null, cerradoEn: null });
    // Keep all contributors: reopening must not let an earlier executor approve reused evidence.
    Object.assign(stateData, { ciclo: state.ciclo + 1, ejecutadoPor: null });
  } else if (isReview) {
    if (!puedeVerificarOrden(user, order, state)) deny('La verificación requiere un revisor autorizado distinto del ejecutor y del técnico asignado.');
    if (!['completada', 'verificada'].includes(order.estado)) deny('Primero completa la ejecución y envíala a verificación.', 409);
    if (!state.ejecutadoPor || !order.completadaEn) deny('No hay un ejecutor trazable. Devuelve la orden para documentar la ejecución; el historial anterior se conserva.', 409);
    if (!input.verificacionNotas?.trim() || input.verificacionNotas.trim().length < 10) deny('Describe la evidencia revisada y el resultado de la verificación (al menos 10 caracteres).', 400);
    validarEvidencia(order, {});
    await validarCierreDocumental(db, order, user, {}, data, now, cierreSinLecturaMotivo);
    destination = 'cerrada'; eventAction = 'verificacion_cierre';
    Object.assign(data, { estado: destination, verificadoPor: user.id, verificadoEn: now, verificacionNotas: input.verificacionNotas.trim(), cerradoPor: user.id, cerradoEn: now });
  } else if (destination !== order.estado) {
    if (!transicionesPermitidas(order.estado as EstadoOT, user.rol as any, order.asignadoA === user.id).includes(destination)) deny(`No tienes permisos para mover de "${order.estado}" a "${destination}".`);
    eventAction = 'estado';
    if (destination === 'en_espera') {
      if (!motivo?.trim()) deny('Registra el motivo del bloqueo o espera.', 400);
      data.pausadaEn = now; eventAction = 'bloqueo';
    }
    if (destination === 'en_proceso') {
      await validarInicioDocumental(db, order, input);
      if (order.estado === 'en_espera' && order.pausadaEn) {
        data.tiempoPausadoMin = (order.tiempoPausadoMin ?? 0) + Math.max(0, Math.round((Date.parse(now) - Date.parse(order.pausadaEn)) / 60000));
        data.pausadaEn = null;
      }
      if (!order.iniciadaEn) data.iniciadaEn = now;
      if (!order.asignadoA && user.rol === 'tecnico') { data.asignadoA = user.id; data.asignadoEn = now; }
    }
    if (isComplete) {
      validarEvidencia(order, input);
      await validarCierreDocumental(db, order, user, input, data, now, cierreSinLecturaMotivo);
      data.completadaEn = now; eventAction = 'ejecucion_completada';
      Object.assign(data, { verificadoPor: null, verificadoEn: null, verificacionNotas: null, cerradoPor: null, cerradoEn: null });
      stateData.ejecutadoPor = user.id;
      if (order.iniciadaEn) data.horasTrabajadas = Math.round(Math.max(0, (Date.parse(now) - Date.parse(order.iniciadaEn) - (order.tiempoPausadoMin ?? 0) * 60000) / 3600000) * 100) / 100;
    }
  }
  if (editsExecution || isComplete) stateData.executoresJson = JSON.stringify([...new Set([...ejecutoresDeOrden(state), user.id])]);
  if (editsExecution && eventAction === 'edicion') eventAction = 'ejecucion';
  if (input.vencimiento !== undefined && input.vencimiento !== order.vencimiento) eventAction = 'reprogramacion';
  if (reprogramarPreventivos !== undefined) {
    if (!(manager(user) || (user.rol === 'tecnico' && order.asignadoA === user.id)) || !['en_proceso','en_espera'].includes(order.estado)) deny('No puedes cambiar la decisión de reprogramación preventiva en este estado.');
    stateData.reprogramarPreventivos = reprogramarPreventivos;
  }
  if (editsAssignment) data.asignadoEn = input.asignadoA ? now : null;
  if (!Object.keys(data).length && !Object.keys(stateData).length) deny('No hay cambios.', 400);
  // Approval can be delayed; recurrence stays anchored to actual execution.
  const advancePM = isReview && !state.pmAvanzadoEn;
  if (advancePM) stateData.pmAvanzadoEn = now;
  const operationId = crypto.randomUUID();
  Object.assign(stateData, { version: state.version + 1, operacionId: operationId, ultimaAccion: eventAction, ultimoActorId: user.id, actualizadoEn: now, ultimoMotivo: motivo?.trim() ?? null });
  const guard = sql`exists (select 1 from orden_verificacion where orden_id = ${order.id} and operacion_id = ${operationId})`;
  const currentAttachments = await db.select({ id: adjuntos.id, categoria: adjuntos.categoria, nombre: adjuntos.nombre }).from(adjuntos).where(eq(adjuntos.ordenId, order.id));
  // Attachment routes do not advance the OT version. Validate the captured
  // evidence inside the batch so a concurrent removal cannot publish a dangling
  // snapshot. Once the event commits, its retention trigger protects DB and R2.
  const attachmentsUnchanged = sql`
    (select count(*) from adjuntos where orden_id = ${order.id}) = ${currentAttachments.length}
    and not exists (
      select 1 from json_each(${JSON.stringify(currentAttachments)}) captured
      where not exists (
        select 1 from adjuntos a where a.orden_id = ${order.id}
          and a.id = json_extract(captured.value, '$.id')
          and a.categoria = json_extract(captured.value, '$.categoria')
          and a.nombre = json_extract(captured.value, '$.nombre')
      )
    )`;
  const snapshot = JSON.stringify({ antes: order, despues: { ...order, ...data }, adjuntos: currentAttachments, ejecutores: JSON.parse(stateData.executoresJson ?? state.executoresJson), revisorId: stateData.revisorId ?? state.revisorId, revisorSuplenteId: stateData.revisorSuplenteId ?? state.revisorSuplenteId, historicoSinControl: !saved });
  const batch: any[] = [
    db.insert(ordenVerificacion).values(initial).onConflictDoNothing(),
    db.update(ordenVerificacion).set(stateData).where(and(eq(ordenVerificacion.ordenId, order.id), eq(ordenVerificacion.version, state.version), sql`exists (select 1 from ordenes where id = ${order.id} and estado = ${order.estado})`, attachmentsUnchanged)).returning({ ordenId: ordenVerificacion.ordenId }),
  ];
  if (Object.keys(data).length) batch.push(db.update(ordenes).set(data).where(and(eq(ordenes.id, order.id), guard)));
  batch.push(db.insert(ordenVerificacionEventos).select(db.select({
    id: sql<number>`null`.as('id'), ordenId: sql<number>`${order.id}`.as('orden_id'), ciclo: sql<number>`${state.ciclo}`.as('ciclo'), accion: sql<string>`${eventAction}`.as('accion'),
    estadoAntes: sql<string>`${order.estado}`.as('estado_antes'), estadoDespues: sql<string>`${destination}`.as('estado_despues'),
    actorId: sql<number>`${user.id}`.as('actor_id'), actorNombre: sql<string>`${user.nombre}`.as('actor_nombre'), ocurridoEn: sql<string>`${now}`.as('ocurrido_en'),
    motivo: sql<string>`${motivo?.trim() ?? input.verificacionNotas?.trim() ?? null}`.as('motivo'), evidenciaJson: sql<string>`${snapshot}`.as('evidencia_json'), operacionId: sql<string>`${operationId}`.as('operacion_id'),
  }).from(ordenVerificacion).where(and(eq(ordenVerificacion.ordenId, order.id), eq(ordenVerificacion.operacionId, operationId)))));
  if (advancePM) {
    const plans = new Map<number, typeof planesMantenimiento.$inferSelect>();
    if (order.planId) { const [plan] = await db.select().from(planesMantenimiento).where(eq(planesMantenimiento.id, order.planId)).limit(1); if (plan) plans.set(plan.id, plan); }
    if (order.tipo === 'correctivo' && order.activoId && state.reprogramarPreventivos) {
      for (const plan of await db.select().from(planesMantenimiento).where(and(eq(planesMantenimiento.activoId, order.activoId), eq(planesMantenimiento.activo, true)))) plans.set(plan.id, plan);
    }
    for (const plan of plans.values()) batch.push(db.update(planesMantenimiento).set({ proximaFecha: siguienteFecha(order.completadaEn!.slice(0,10), plan.frecuencia as any) }).where(and(eq(planesMantenimiento.id, plan.id), guard)));
    if (order.actividadId) {
      const [activity] = await db.select().from(actividades).where(eq(actividades.id, order.actividadId)).limit(1);
      if (activity) batch.push(db.update(actividades).set({ proximaFecha: siguienteFecha(order.completadaEn!.slice(0,10), activity.frecuencia as any), ultimaEjecucion: order.completadaEn }).where(and(eq(actividades.id, activity.id), guard)));
    }
  }
  const results = await db.batch(batch as any);
  if (!(results[1] as any[])?.length) deny('La orden cambió durante la operación. Actualiza la página e inténtalo de nuevo.', 409);
  const [row] = await db.select().from(ordenes).where(eq(ordenes.id, order.id)).limit(1);
  return { row, estado: destination, accion: eventAction, advancePM };
}

/** The existing public ticket token may return pending work, never approve or
 * reopen a closed order. The external actor is named explicitly, not impersonated. */
export async function devolverOrdenDesdeTicket(db: DB, order: Orden, ticket: { id: number; solicitanteNombre: string }, motivo: string, now: string) {
  if (!['completada', 'verificada'].includes(order.estado)) deny('Solo se puede devolver una ejecución pendiente de revisión.', 409);
  const [saved] = await db.select().from(ordenVerificacion).where(eq(ordenVerificacion.ordenId, order.id)).limit(1);
  const state = saved ?? { ordenId: order.id, version: 0, ciclo: 1 };
  const operationId = crypto.randomUUID();
  const data = { estado: 'en_proceso' as const, completadaEn: null, verificadoPor: null, verificadoEn: null, verificacionNotas: null, cerradoPor: null, cerradoEn: null };
  const guard = sql`exists (select 1 from orden_verificacion where orden_id = ${order.id} and operacion_id = ${operationId})`;
  const results = await db.batch([
    db.insert(ordenVerificacion).values({ ordenId: order.id }).onConflictDoNothing(),
    db.update(ordenVerificacion).set({ version: state.version + 1, ciclo: state.ciclo + 1, ejecutadoPor: null, operacionId: operationId, ultimaAccion: 'devolucion_solicitante', ultimoMotivo: motivo, ultimoActorId: null, actualizadoEn: now }).where(and(eq(ordenVerificacion.ordenId, order.id), eq(ordenVerificacion.version, state.version), sql`exists (select 1 from ordenes where id = ${order.id} and estado = ${order.estado})`)).returning({ id: ordenVerificacion.ordenId }),
    db.update(ordenes).set(data).where(and(eq(ordenes.id, order.id), guard)),
    db.insert(ordenVerificacionEventos).select(db.select({
      id: sql<number>`null`.as('id'), ordenId: sql<number>`${order.id}`.as('orden_id'), ciclo: sql<number>`${state.ciclo}`.as('ciclo'), accion: sql<string>`'devolucion_solicitante'`.as('accion'),
      estadoAntes: sql<string>`${order.estado}`.as('estado_antes'), estadoDespues: sql<string>`'en_proceso'`.as('estado_despues'),
      actorId: sql<number>`null`.as('actor_id'), actorNombre: sql<string>`${'Solicitante externo: ' + ticket.solicitanteNombre}`.as('actor_nombre'), ocurridoEn: sql<string>`${now}`.as('ocurrido_en'),
      motivo: sql<string>`${motivo}`.as('motivo'), evidenciaJson: sql<string>`${JSON.stringify({ antes: order, despues: { ...order, ...data }, ticketId: ticket.id, actorTipo: 'solicitante_token_ticket', historicoSinControl: !saved })}`.as('evidencia_json'), operacionId: sql<string>`${operationId}`.as('operacion_id'),
    }).from(ordenVerificacion).where(and(eq(ordenVerificacion.ordenId, order.id), eq(ordenVerificacion.operacionId, operationId)))),
  ]);
  if (!results[1].length) deny('La orden cambió durante la devolución. Actualiza e inténtalo de nuevo.', 409);
}

/** La parada de ronda de la que nació la orden. Los textos salen de la foto del recorrido de ese turno. */
export async function leerOrigenesRondaOrden(db: DB, id: number) {
  const rows = await db.all(sql`
    SELECT e.id AS ejecucionId,l.punto_id AS puntoId,e.fecha,e.turno,s.nombre AS sede,l.resultado,l.valor,l.nota,
      l.registrado_en AS registradoEn,e.recorrido_json AS recorridoJson,p.etiqueta AS etiquetaActual,u.nombre AS registradoPor
    FROM ronda_lecturas l JOIN ronda_ejecuciones e ON e.id=l.ejecucion_id JOIN ronda_puntos p ON p.id=l.punto_id
    LEFT JOIN sucursales s ON s.id=e.sucursal_id LEFT JOIN usuarios u ON u.id=l.registrado_por
    WHERE l.orden_id=${id} ORDER BY e.fecha,e.turno,l.punto_id
  `) as any[];
  return rows.map(({ recorridoJson, etiquetaActual, ...row }) => {
    let punto: any = null;
    try { punto = (JSON.parse(recorridoJson) as any[])?.find((p) => p.id === row.puntoId); } catch { /* sin foto: se usa el texto actual */ }
    return { ...row, etiqueta: punto?.etiqueta ?? etiquetaActual, href: `/ronda/${row.ejecucionId}` };
  });
}
