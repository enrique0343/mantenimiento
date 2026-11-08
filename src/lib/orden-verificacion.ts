import { and, eq, sql } from 'drizzle-orm';
import { ordenes, usuarios, adjuntos, planesMantenimiento, actividades, activos, ordenPrerrequisitos, ordenLiberaciones } from './schema';
import { ordenVerificacion, ordenVerificacionEventos } from './orden-verificacion-schema';
import {
  parseChecklist, validarChecklistParaCierre, validarLecturasChecklistParaCierre, transicionesPermitidas,
  validarPrerrequisitosParaIniciar, validarLiberacionesParaCierre, validarLiberacionesEnRango, validarCausaRaizParaCierre, puedeCerrarSinLectura,
  requiereCausaRaiz, MIN_CAUSA_RAIZ, type EstadoOT,
} from './ordenes';
import { siguienteFecha } from './frecuencias';
import { leerNumero } from './numero';
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
// Las horas del EOP. La de alarma, además, corre el plazo de la causa raíz.
const HORAS_EOP = ['horaAlarma', 'horaLlegada', 'horaMitigacion', 'horaRestablecimiento'] as const;
/** Un texto como se compara (causa raíz, plan y notas de la reversa): recortado, y null igual a vacío. */
const textoComparable = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
/** Una hora del EOP al minuto, como la muestra la ficha. Vacía es null. */
function minutoEop(v: unknown): number | string | null {
  if (v === null || v === undefined || v === '') return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? Math.floor(t / 60_000) : String(v);
}
async function criticidadDeActivo(db: DB, activoId: number | null | undefined): Promise<string | null> {
  if (!activoId) return null;
  const [a] = await db.select({ criticidad: activos.criticidadOperacional }).from(activos).where(eq(activos.id, activoId)).limit(1);
  return a?.criticidad ?? null;
}

// ── El checklist de la ficha, fusionado con lo que llegó del celular ──
const ESTADOS_PUNTO = ['pendiente', 'ok', 'na', 'desviacion'];
/** Un checklist guardado como texto: vacío es []; ilegible, null. */
function listaChecklist(raw: unknown): unknown[] | null {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return [];
  try { const v = JSON.parse(String(raw)); return Array.isArray(v) ? v : null; } catch { return null; }
}
/** Un punto como se compara: sin claves vacías y con el estado viejo {hecho} traducido.
 * La ficha rellena claves al abrir; eso no cuenta como un cambio suyo. Null si no es un objeto. */
function puntoNormal(punto: unknown): Record<string, unknown> | null {
  if (typeof punto !== 'object' || punto === null || Array.isArray(punto)) return null;
  const p: Record<string, unknown> = { ...(punto as Record<string, unknown>) };
  if (!ESTADOS_PUNTO.includes(p.estado as string)) p.estado = p.hecho === true ? 'ok' : 'pendiente';
  delete p.hecho;
  for (const k of ['bloqueante', 'requiereValor']) if (k in p) p[k] = p[k] === true || p[k] === 1;
  for (const k of Object.keys(p)) if (p[k] === null || p[k] === undefined || p[k] === '' || p[k] === false) delete p[k];
  return p;
}
function puntoComparable(punto: unknown): string {
  const p = puntoNormal(punto);
  return p ? JSON.stringify(Object.keys(p).sort().map((k) => [k, p[k]])) : JSON.stringify(punto ?? null);
}
/** Dos checklists con los mismos puntos, aunque la ficha haya rellenado claves vacías. */
function mismoChecklist(aRaw: unknown, bRaw: unknown): boolean {
  const a = listaChecklist(aRaw), b = listaChecklist(bRaw);
  return !!a && !!b && a.length === b.length && a.every((p, i) => puntoComparable(p) === puntoComparable(b[i]));
}
/**
 * Un punto que cambió en la ficha y también en el servidor, los dos frente a la
 * base: gana cada clave que la ficha cambió; las demás quedan como están
 * guardadas. Así la jefatura marca N/A sin borrar la lectura del celular.
 */
function fusionarPunto(guardado: unknown, nuevo: unknown, base: unknown): unknown {
  const g = puntoNormal(guardado), n = puntoNormal(nuevo), b = puntoNormal(base);
  if (!g || !n || !b) return nuevo;
  const fusion: Record<string, unknown> = { ...(guardado as Record<string, unknown>) };
  for (const k of new Set([...Object.keys(n), ...Object.keys(b)])) {
    if (JSON.stringify(n[k] ?? null) === JSON.stringify(b[k] ?? null)) continue;
    if (k === 'estado') { fusion.estado = n.estado; delete fusion.hecho; continue; }
    const crudo = (nuevo as Record<string, unknown>)[k];
    if (crudo === undefined) delete fusion[k]; else fusion[k] = crudo;
  }
  return fusion;
}
/**
 * La ficha manda el checklist junto con la base que recibió del servidor. Un
 * punto que la ficha no cambió frente a su base queda como está guardado, para
 * no deshacer lo que el técnico marcó en el celular mientras tanto; uno que solo
 * cambió en la ficha, como lo mandó; uno que cambió en los dos lados, fusionado
 * por clave.
 */
function fusionarChecklist(guardadoRaw: string | null, nuevoRaw: unknown, baseRaw: unknown): string {
  const nuevo = listaChecklist(nuevoRaw), base = listaChecklist(baseRaw);
  if (!nuevo || !base) throw new ErrorVerificacion('Checklist inválido.', 400);
  const guardado = listaChecklist(guardadoRaw) ?? [];
  if (nuevo.length !== base.length || base.length !== guardado.length) throw new ErrorVerificacion('El checklist cambió mientras lo editabas. Vuelve a cargar la ficha.', 409);
  return JSON.stringify(nuevo.map((punto, i) => {
    const deBase = puntoComparable(base[i]);
    if (puntoComparable(punto) === deBase) return guardado[i];
    if (puntoComparable(guardado[i]) === deBase) return punto;
    return fusionarPunto(guardado[i], punto, base[i]);
  }));
}
/** Un punto ya marcado: con estado y con la hora o las iniciales de quien lo marcó. */
const puntoMarcado = (p: Record<string, unknown> | null) => !!p && p.estado !== 'pendiente' && (!!p.hora || !!p.iniciales);
/**
 * Sin base (una pestaña vieja): un punto guardado ya marcado no se pisa con uno
 * que llega pendiente y sin hora; los demás puntos, como llegaron. Devuelve el
 * checklist con lo conservado, o undefined si no hubo que conservar nada.
 */
function conservarMarcados(guardadoRaw: string | null, nuevoRaw: unknown): string | undefined {
  const nuevo = listaChecklist(nuevoRaw), guardado = listaChecklist(guardadoRaw);
  if (!nuevo || !guardado || nuevo.length !== guardado.length) return undefined;
  let conserva = false;
  const lista = nuevo.map((punto, i) => {
    const llega = puntoNormal(punto);
    if (!llega || llega.estado !== 'pendiente' || llega.hora || !puntoMarcado(puntoNormal(guardado[i]))) return punto;
    conserva = true;
    return guardado[i];
  });
  return conserva ? JSON.stringify(lista) : undefined;
}

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
 * La causa raíz la escribe la jefatura dentro de las 72 h: se exige al
 * verificar o cerrar, no al técnico cuando envía a verificación.
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
async function validarCierreDocumental(db: DB, order: Orden, user: User, input: Record<string, any>, data: Record<string, any>, now: string, motivoSinLectura: string | null | undefined, etapa: 'envio' | 'verificacion') {
  const tipo = (input.tipo ?? order.tipo) as string;
  // Una OT que nunca se inició no tiene lecturas que exigir: el cierre
  // administrativo de registros viejos sigue siendo posible.
  if (order.iniciadaEn) {
    const raw = input.checklistEjecucion !== undefined ? input.checklistEjecucion : order.checklistEjecucion;
    const lect = validarLecturasChecklistParaCierre(parseChecklist(raw));
    if (!lect.ok) deny(lect.error!, 400);
  }
  // Con la reversa ejecutada el sistema volvió a como estaba: no hay nada que liberar.
  const reversa = (input.reversaEjecutada !== undefined ? input.reversaEjecutada : order.reversaEjecutada) === true;
  if (tipo === 'intervencion' && !reversa) {
    const libs = await db
      .select({
        etiqueta: ordenLiberaciones.etiqueta, unidad: ordenLiberaciones.unidad, obligatoria: ordenLiberaciones.obligatoria, valorMedido: ordenLiberaciones.valorMedido,
        valorMedidoTexto: ordenLiberaciones.valorMedidoTexto, minAceptable: ordenLiberaciones.minAceptable, maxAceptable: ordenLiberaciones.maxAceptable,
      })
      .from(ordenLiberaciones).where(eq(ordenLiberaciones.ordenId, order.id));
    const v = validarLiberacionesParaCierre(tipo, libs);
    if (!v.ok) {
      const motivo = (motivoSinLectura ?? '').trim();
      // La jefatura ya cerró sin lectura y dejó su motivo: la verificación no lo vuelve a pedir.
      const yaCerradaSinLectura = !motivo && etapa === 'verificacion' && !!order.cierreSinLecturaMotivo?.trim();
      if (!yaCerradaSinLectura) {
        if (!motivo) deny(v.error!, 400);
        if (!puedeCerrarSinLectura(user.rol as any)) deny('Solo la jefatura (admin o jefe) puede enviar un MOP a verificación sin la lectura de liberación. Pídeselo a tu jefatura con el motivo.');
        if (motivo.length < 20) deny('El motivo del envío sin lectura tiene que explicar por qué no se pudo medir y con qué evidencia se libera el sistema (mínimo 20 caracteres).', 400);
        Object.assign(data, { cierreSinLecturaPor: user.id, cierreSinLecturaEn: now, cierreSinLecturaMotivo: motivo });
      }
    }
    // Una lectura obligatoria fuera de rango no libera el sistema; el cierre sin lectura no la salva.
    const rango = validarLiberacionesEnRango(tipo, libs);
    if (!rango.ok) deny(rango.error!, 400);
  }
  if (etapa !== 'verificacion') return;
  const criticidad = await criticidadDeActivo(db, input.activoId !== undefined ? input.activoId : order.activoId);
  const causa = input.causaRaiz !== undefined ? input.causaRaiz : order.causaRaiz;
  const vc = validarCausaRaizParaCierre(tipo, criticidad, causa);
  if (!vc.ok) deny(vc.error!, 400);
}

/** One transactional mutation, immutable snapshot and one-time PM advancement.
 * Completion remains `completada` (pending review); only independent approval closes.
 * Server identities/timestamps cannot be supplied by callers. */
export async function actualizarOrdenConVerificacion(db: DB, order: Orden, user: User, input: Record<string, any>, now = new Date().toISOString()) {
  input = { ...input };
  // Lo que llegó igual a lo guardado no es un cambio: se deja fuera sin error.
  let sinCambio = false;
  const igualAlGuardado = (key: string) => { delete input[key]; sinCambio = true; };
  const llegaEjecucion = executionFields.some((key) => key !== 'causaRaiz' && input[key] !== undefined);
  const checklistBase = input.checklistBase;
  delete input.checklistBase;
  let checklistFusionado = false;
  if (input.checklistEjecucion !== undefined) {
    // Con su base, la ficha se fusiona por punto. Sin ella (pestaña vieja), un
    // punto ya marcado en el celular no vuelve a pendiente.
    const fusion = checklistBase !== undefined
      ? fusionarChecklist(order.checklistEjecucion, input.checklistEjecucion, checklistBase)
      : conservarMarcados(order.checklistEjecucion, input.checklistEjecucion);
    if (fusion !== undefined) { input.checklistEjecucion = fusion; checklistFusionado = true; }
    if (mismoChecklist(input.checklistEjecucion, order.checklistEjecucion)) { igualAlGuardado('checklistEjecucion'); checklistFusionado = false; }
  }
  // La causa raíz es de la jefatura, en cualquier estado. Igual a la guardada no
  // es un cambio, tampoco de la jefatura: no se escribe ni deja evento.
  if (input.causaRaiz !== undefined) {
    const causa = textoComparable(input.causaRaiz);
    if (causa === textoComparable(order.causaRaiz)) igualAlGuardado('causaRaiz');
    else if (!manager(user)) {
      if (!llegaEjecucion) deny('La causa raíz la escribe la jefatura dentro de las 72 h.');
      // Una pestaña vieja del técnico guarda la causa junto con los trabajos: se
      // guarda lo demás, y lo que escribió como causa queda en los trabajos, igual
      // que con un celular viejo.
      if (causa) {
        const frase = `Causa probable según el técnico: ${causa}`;
        const trabajos = textoComparable(input.trabajosRealizados !== undefined ? input.trabajosRealizados : order.trabajosRealizados);
        if (!trabajos.includes(frase)) input.trabajosRealizados = trabajos ? `${trabajos} ${frase}` : frase;
      }
      igualAlGuardado('causaRaiz');
    }
  }
  // Las horas de la emergencia las corrige la jefatura, en cualquier estado. Una
  // pestaña vieja que las reenvía iguales al autoguardar no choca.
  if (!manager(user)) {
    for (const key of HORAS_EOP) {
      if (input[key] === undefined) continue;
      const guardada = minutoEop((order as any)[key]);
      if (minutoEop(input[key]) === guardada) {
        igualAlGuardado(key);
        if (key === 'horaAlarma') delete input.causaRaizVencimiento;
        continue;
      }
      // La alarma corre el plazo de la causa raíz. Una hora vacía la fija quien
      // trabaja, y solo con la hora de la operación: la del toque en el celular,
      // ya validada, o la del servidor en la ficha. Una ya fijada, otra hora o la
      // orden ya enviada, solo la jefatura.
      const deAhora = minutoEop(input[key]) === minutoEop(now);
      if (key === 'horaAlarma' || guardada !== null || !deAhora || !['abierta', 'en_proceso', 'en_espera'].includes(order.estado)) deny('Las horas de la emergencia las corrige la jefatura.');
    }
  }
  // El plan de reversa y la reversa del MOP, con la regla de las lecturas y los
  // prerrequisitos (revisarPermisoMop): cerrada o cancelada, nadie los cambia; el
  // técnico asignado escribe el plan con la orden en curso y marca la reversa con
  // la orden empezada; enviada a verificación, la registra la jefatura.
  for (const key of ['planReversa', 'reversaNotas']) {
    if (input[key] !== undefined && textoComparable(input[key]) === textoComparable((order as any)[key])) igualAlGuardado(key);
  }
  if (input.reversaEjecutada !== undefined && !!input.reversaEjecutada === !!order.reversaEjecutada) igualAlGuardado('reversaEjecutada');
  const tocaReversa = input.reversaEjecutada !== undefined || input.reversaNotas !== undefined;
  if (tocaReversa || input.planReversa !== undefined) {
    if (order.estado === 'cerrada') deny('La orden ya está cerrada: el plan y la reversa quedan como evidencia y no se editan.', 400);
    if (order.estado === 'cancelada') deny('La orden fue cancelada: el plan y la reversa ya no se editan.', 400);
    if (!manager(user)) {
      if (user.rol !== 'tecnico') deny('No tienes permisos para modificar órdenes.');
      if (order.asignadoA !== user.id) deny('La orden debe estar asignada a ti para registrar ejecución o cambiar su estado.');
      if (!['abierta', 'en_proceso', 'en_espera'].includes(order.estado)) deny('La orden ya se envió a verificación. La reversa la registra la jefatura en la ficha.', 409);
      if (tocaReversa && order.estado === 'abierta') deny('La reversa se marca después de empezar la intervención.', 409);
    }
    // «Cualquier reversa se informa a la jefatura antes de cerrar»: no queda
    // ejecutada sin decir qué se revirtió.
    const ejecutada = input.reversaEjecutada !== undefined ? input.reversaEjecutada === true : !!order.reversaEjecutada;
    const notas = textoComparable(input.reversaNotas !== undefined ? input.reversaNotas : order.reversaNotas);
    if (tocaReversa && ejecutada && notas.length < 10) deny('Para marcar la reversa como ejecutada, describe qué se revirtió y cómo quedó el sistema (mínimo 10 caracteres). Cualquier reversa se informa a la jefatura antes de cerrar.', 400);
  }
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
  const changes = (key: string) => input[key] !== undefined && input[key] !== (order as any)[key];
  // La causa raíz la escribe la jefatura, también con la orden ya enviada a
  // verificación o cerrada. Es análisis, no ejecución: no la vuelve ejecutora
  // (podrá verificar) ni obliga a devolver la orden.
  const causaDeJefatura = changes('causaRaiz') && manager(user) && !['abierta', 'cancelada'].includes(order.estado);
  const editsExecution = executionFields.some((key) => changes(key) && !(key === 'causaRaiz' && causaDeJefatura));
  const editsMetadata = ['titulo', 'descripcion', 'tipo', 'prioridad', 'activoId', 'vencimiento'].some((key) => input[key] !== undefined && input[key] !== (order as any)[key]);
  const editsAssignment = input.asignadoA !== undefined && input.asignadoA !== order.asignadoA;
  const onlySelfAssignment = user.rol === 'tecnico' && order.estado === 'abierta' && !order.asignadoA && input.asignadoA === user.id;
  if (!manager(user) && !onlySelfAssignment && editsAssignment) deny('Solo la jefatura puede cambiar la asignación.');
  if (editsMetadata && !manager(user)) deny('Solo la jefatura puede modificar los datos de la orden.');
  if (user.rol === 'tecnico' && !isReview && !isReturn && !onlySelfAssignment && order.asignadoA !== user.id && !(order.estado === 'abierta' && !order.asignadoA && destination === 'en_proceso')) deny('La orden debe estar asignada a ti para registrar ejecución o cambiar su estado.');
  if (editsExecution && !(manager(user) || (user.rol === 'tecnico' && order.asignadoA === user.id))) deny('No puedes registrar ejecución en esta orden.');
  if (editsExecution && !['en_proceso', 'en_espera'].includes(order.estado)) deny(order.estado === 'abierta' ? 'Inicia la orden antes de registrar su ejecución.' : 'Devuelve o reabre la orden antes de cambiar evidencia de ejecución.', 409);
  if ((isReturn || isReview) && (editsExecution || editsAssignment || editsMetadata)) deny('La revisión o devolución debe enviarse separada de cambios de ejecución, equipo o asignación.', 400);
  if (input.verificacionNotas !== undefined && !isReview) deny('Las notas de verificación solo se registran al verificar.', 400);
  if (!manager(user) && !['tecnico'].includes(user.rol) && !isReturn && !isReview) deny('No tienes permisos para modificar órdenes.');
  if (['completada','verificada','cerrada','cancelada'].includes(order.estado) && (editsMetadata || editsAssignment)) deny('Devuelve o reabre la orden antes de cambiar sus datos.', 409);
  if (input.vencimiento !== undefined && input.vencimiento !== order.vencimiento && !motivo?.trim()) deny('Registra el motivo de la reprogramación.', 400);
  // Enviada o cerrada, la causa raíz ya es evidencia del cierre: la jefatura la
  // corrige, pero no la deja vacía ni más corta. En proceso guarda un borrador.
  const causaNueva = input.causaRaiz !== undefined ? textoComparable(input.causaRaiz) : null;
  if (causaNueva !== null && causaNueva.length < MIN_CAUSA_RAIZ && ['completada', 'verificada', 'cerrada'].includes(order.estado)) {
    const criticidad = await criticidadDeActivo(db, input.activoId !== undefined ? input.activoId : order.activoId);
    if (requiereCausaRaiz(input.tipo ?? order.tipo, criticidad).requiere) deny(`La causa raíz necesita al menos ${MIN_CAUSA_RAIZ} caracteres: con la orden enviada a verificación o cerrada no puede quedar vacía ni más corta.`, 400);
  }

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
    // El valor de un paso se lee con numero.ts: «1,200» puede ser 1200 o 1,2 y no
    // se adivina. Solo se revisa el valor que cambió; uno que llega como número pasa.
    const previos = listaChecklist(order.checklistEjecucion) ?? [];
    incoming.forEach((punto: any, i: number) => {
      const valor = punto?.valorMedido, antes = (previos[i] as any)?.valorMedido;
      if (valor === antes) return;
      const leido = leerNumero(valor);
      if (leido.tipo === 'ambiguo') deny(leido.mensaje, 400);
    });
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
    await validarCierreDocumental(db, order, user, causaDeJefatura ? { causaRaiz: input.causaRaiz } : {}, data, now, cierreSinLecturaMotivo, 'verificacion');
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
      await validarCierreDocumental(db, order, user, input, data, now, cierreSinLecturaMotivo, 'envio');
      data.completadaEn = now; eventAction = 'ejecucion_completada';
      Object.assign(data, { verificadoPor: null, verificadoEn: null, verificacionNotas: null, cerradoPor: null, cerradoEn: null });
      stateData.ejecutadoPor = user.id;
      if (order.iniciadaEn) data.horasTrabajadas = Math.round(Math.max(0, (Date.parse(now) - Date.parse(order.iniciadaEn) - (order.tiempoPausadoMin ?? 0) * 60000) / 3600000) * 100) / 100;
    }
  }
  if (editsExecution || isComplete) stateData.executoresJson = JSON.stringify([...new Set([...ejecutoresDeOrden(state), user.id])]);
  if (editsExecution && eventAction === 'edicion') eventAction = 'ejecucion';
  if (causaDeJefatura && eventAction === 'edicion') eventAction = 'causa_raiz';
  if (input.vencimiento !== undefined && input.vencimiento !== order.vencimiento) eventAction = 'reprogramacion';
  if (reprogramarPreventivos !== undefined) {
    if (!(manager(user) || (user.rol === 'tecnico' && order.asignadoA === user.id)) || !['en_proceso','en_espera'].includes(order.estado)) deny('No puedes cambiar la decisión de reprogramación preventiva en este estado.');
    stateData.reprogramarPreventivos = reprogramarPreventivos;
  }
  if (editsAssignment) data.asignadoEn = input.asignadoA ? now : null;
  // Lo que quedó igual a lo guardado no se escribe: una pestaña vieja que vuelve a
  // enviar a verificación una orden ya enviada no deja un evento vacío.
  for (const key of Object.keys(data)) if (data[key] === (order as any)[key]) { delete data[key]; sinCambio = true; }
  if (!Object.keys(data).length && !Object.keys(stateData).length) {
    // Todo lo que llegó era igual a lo guardado: no hay nada que escribir ni que rechazar.
    if (sinCambio) return { row: order, estado: order.estado, accion: 'sin_cambios', advancePM: false };
    deny('No hay cambios.', 400);
  }
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
    db.update(ordenVerificacion).set(stateData).where(and(eq(ordenVerificacion.ordenId, order.id), eq(ordenVerificacion.version, state.version), sql`exists (select 1 from ordenes where id = ${order.id} and estado = ${order.estado})`,
      // La fusión se hizo contra este checklist: si otra escritura lo cambió en medio, no se pisa.
      checklistFusionado ? sql`exists (select 1 from ordenes where id = ${order.id} and checklist_ejecucion is ${order.checklistEjecucion})` : undefined,
      attachmentsUnchanged)).returning({ ordenId: ordenVerificacion.ordenId }),
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
