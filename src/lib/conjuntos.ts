import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, getEnv } from "./db";
import { activos, conjuntos, conjuntoPuestos, conjuntoComponentes, conjuntoEventos, ordenConjuntos, ordenes, planesMantenimiento, ubicaciones } from "./schema";
import { AREA_KEYS, activoAreaExpression, type AreaKey } from "./areas";
import { rubroDeActivo } from "./rubros";
import type { APIContext } from "astro";
import { getCurrentUser } from "./auth";

type Context = APIContext | { locals: App.Locals };
type Actor = { id: number; nombre: string };
export class ConjuntoError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = "ConjuntoError"; }
}
export function respuestaErrorConjunto(error: unknown): Response {
  if (error instanceof ConjuntoError) return Response.json({ error: error.message }, { status: error.status });
  console.error("Error al consultar conjuntos:", error);
  return Response.json({ error: "No se pudo completar la operación. Vuelve a intentarlo." }, { status: 500 });
}
export const CONJUNTO_LECTORES = ["admin", "jefe", "tecnico", "visualizador"] as const;
export const CONJUNTO_GESTORES = ["admin", "jefe"] as const;
async function lectorConjuntos(ctx: Context) {
  const user = ctx.locals.user ?? ("request" in ctx ? await getCurrentUser(ctx as APIContext) : null);
  if (!user) throw new ConjuntoError("Inicia sesión para consultar conjuntos", 401);
  if (!CONJUNTO_LECTORES.some(rol => rol === user.rol)) throw new ConjuntoError("Sin permisos para consultar conjuntos", 403);
  return user;
}
const motivoSchema = z.string().trim().min(3).max(500);
const idSchema = z.number().int().positive().safe();
export const conjuntoCrearSchema = z.object({
  codigo: z.string().trim().min(1).max(60), nombre: z.string().trim().min(1).max(200),
  descripcion: z.string().trim().max(2000).nullable().optional(), rubro: z.enum(AREA_KEYS),
  criticidad: z.enum(["alta", "media", "baja"]), ubicacionId: idSchema.nullable().optional(), motivo: motivoSchema,
}).strict();
export const conjuntoEditarSchema = z.object({
  version: idSchema, nombre: z.string().trim().min(1).max(200).optional(),
  descripcion: z.string().trim().max(2000).nullable().optional(), criticidad: z.enum(["alta", "media", "baja"]).optional(),
  ubicacionId: idSchema.nullable().optional(), activo: z.boolean().optional(), motivo: motivoSchema,
}).strict().refine(value => Object.keys(value).some(key => key !== "version" && key !== "motivo"), "Indica qué dato deseas cambiar");
export const conjuntoComponenteSchema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("incorporar"), version: idSchema, activoId: idSchema, funcion: z.string().trim().min(1).max(100), esencial: z.boolean(), motivo: motivoSchema, puestoId: idSchema.optional() }).strict(),
  z.object({ accion: z.literal("retirar"), version: idSchema, puestoId: idSchema, motivo: motivoSchema }).strict(),
  z.object({ accion: z.literal("reemplazar"), version: idSchema, puestoId: idSchema, activoId: idSchema, motivo: motivoSchema }).strict(),
]);

export function conjuntoId(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) throw new ConjuntoError("Identificador de conjunto inválido");
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw new ConjuntoError("Identificador de conjunto inválido");
  return id;
}
export function normalizarFechaConjunto(value?: string | null): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new ConjuntoError("Indica una fecha y hora válida con zona horaria");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now()) throw new ConjuntoError("La fecha de consulta debe ser válida y no estar en el futuro");
  // Reject calendar dates that JavaScript silently rolls into the next month.
  const parts = value.slice(0, 10).split("-").map(Number);
  if (parts[1] < 1 || parts[1] > 12 || parts[2] < 1 || parts[2] > new Date(Date.UTC(parts[0], parts[1], 0)).getUTCDate()) throw new ConjuntoError("La fecha de consulta no existe");
  return date.toISOString();
}
export type DisponibilidadConjunto = { estado: "disponible" | "no_disponible" | "sin_definir"; motivos: string[] };
export function calcularDisponibilidadConjunto(puestos: Array<{ funcion: string; esencial: boolean; componente: { estado: string } | null }>): DisponibilidadConjunto {
  const esenciales = puestos.filter(p => p.esencial);
  if (!esenciales.length) return { estado: "sin_definir", motivos: ["Todavía no se han definido puestos esenciales."] };
  const motivos = esenciales.flatMap(p => !p.componente ? [`${p.funcion}: componente faltante.`] : p.componente.estado !== "operativo" ? [`${p.funcion}: componente ${p.componente.estado === "mantenimiento" ? "en mantenimiento" : p.componente.estado === "baja" ? "dado de baja" : "averiado"}.`] : []);
  return { estado: motivos.length ? "no_disponible" : "disponible", motivos };
}

export async function getConjuntos(ctx: Context, area?: AreaKey | null) {
  await lectorConjuntos(ctx);
  const db = getDb(ctx);
  const rows = await db.select().from(conjuntos).where(area ? eq(conjuntos.rubro, area) : undefined).orderBy(asc(conjuntos.nombre));
  if (!rows.length) return [];
  const puestos = await db.select({ p: conjuntoPuestos, c: conjuntoComponentes, a: activos }).from(conjuntoPuestos)
    .leftJoin(conjuntoComponentes, and(eq(conjuntoComponentes.puestoId, conjuntoPuestos.id), isNull(conjuntoComponentes.retiradoEn)))
    .leftJoin(activos, eq(activos.id, conjuntoComponentes.activoId)).where(inArray(conjuntoPuestos.conjuntoId, rows.map(r => r.id)));
  return rows.map(c => {
    const propios = puestos.filter(p => p.p.conjuntoId === c.id);
    return { id: c.id, codigo: c.codigo, nombre: c.nombre, rubro: c.rubro, criticidad: c.criticidad, activo: c.activo, version: c.version,
      componentes: propios.filter(p => p.c).length,
      disponibilidad: calcularDisponibilidadConjunto(propios.map(p => ({ funcion: p.p.funcion, esencial: p.p.esencial, componente: p.c && p.a ? { estado: p.a.estado } : null }))) };
  });
}

export async function getConjuntoDetalle(ctx: Context, id: number, fecha?: string | null) {
  const lector = await lectorConjuntos(ctx);
  const fechaConsulta = normalizarFechaConjunto(fecha);
  const db = getDb(ctx);
  const tecnicoId = lector.rol === "tecnico" ? lector.id : null;
  const [conjunto] = await db.select().from(conjuntos).where(eq(conjuntos.id, id)).limit(1);
  if (!conjunto) return null;
  const puestosRows = await db.select().from(conjuntoPuestos).where(eq(conjuntoPuestos.conjuntoId, id)).orderBy(asc(conjuntoPuestos.id));
  const vinculos = await db.select({ c: conjuntoComponentes, p: conjuntoPuestos, a: activos }).from(conjuntoComponentes)
    .innerJoin(conjuntoPuestos, eq(conjuntoPuestos.id, conjuntoComponentes.puestoId))
    .innerJoin(activos, eq(activos.id, conjuntoComponentes.activoId)).where(eq(conjuntoPuestos.conjuntoId, id)).orderBy(desc(conjuntoComponentes.id));
  const puestos = puestosRows.filter(p => !fechaConsulta || p.createdAt <= fechaConsulta).map(p => {
    const actual = vinculos.find(v => v.c.puestoId === p.id && (fechaConsulta
      ? v.c.incorporadoEn <= fechaConsulta && (!v.c.retiradoEn || v.c.retiradoEn > fechaConsulta)
      : !v.c.retiradoEn));
    return { id: p.id, funcion: p.funcion, esencial: p.esencial, componente: actual ? {
      vinculoId: actual.c.id, activoId: actual.c.activoId, codigo: actual.c.activoCodigo, nombre: actual.c.activoNombre, serial: actual.c.activoSerial,
      rubro: rubroDeActivo(actual.a.rubro, actual.a.tipo), estado: actual.a.estado, incorporadoEn: actual.c.incorporadoEn,
    } : null };
  });
  const historialComponentes = vinculos.map(({ c, p, a }) => ({ id: c.id, puestoId: p.id, funcion: p.funcion, activoId: c.activoId, rubro: rubroDeActivo(a.rubro, a.tipo),
    codigo: c.activoCodigo, nombre: c.activoNombre, serial: c.activoSerial, incorporadoEn: c.incorporadoEn, retiradoEn: c.retiradoEn,
    motivoAlta: c.motivoAlta, motivoRetiro: c.motivoRetiro, incorporadoPorNombre: c.incorporadoPorNombre, retiradoPorNombre: c.retiradoPorNombre,
  }));
  const eventosRows = await db.select().from(conjuntoEventos).where(eq(conjuntoEventos.conjuntoId, id)).orderBy(desc(conjuntoEventos.id));
  const eventos = eventosRows.map(e => ({ id: e.id, fecha: e.fecha, accion: e.accion, motivo: e.motivo, actorNombre: e.actorNombre,
    antes: e.antes ? JSON.parse(e.antes) : null, despues: JSON.parse(e.despues) }));
  const ordenRows = await db.select({ o: ordenes, v: ordenConjuntos }).from(ordenConjuntos).innerJoin(ordenes, eq(ordenes.id, ordenConjuntos.ordenId))
    .where(and(eq(ordenConjuntos.conjuntoId, id), tecnicoId ? eq(ordenes.asignadoA, tecnicoId) : undefined)).orderBy(desc(ordenConjuntos.fecha), desc(ordenConjuntos.ordenId));
  const ordenesLista = ordenRows.map(({ o, v }) => ({ id: o.id, titulo: o.titulo, tipo: o.tipo, estado: o.estado, createdAt: o.createdAt,
    activoId: v.activoId, activoCodigo: v.activoCodigo, activoNombre: v.activoNombre, funcion: v.funcion, rubro: o.rubro, vinculadaEn: v.fecha }));
  const miembroIds = puestos.flatMap(p => p.componente ? [p.componente.activoId] : []);
  const planes = !fechaConsulta && miembroIds.length ? await db.select({ id: planesMantenimiento.id, titulo: planesMantenimiento.titulo,
    frecuencia: planesMantenimiento.frecuencia, proximaFecha: planesMantenimiento.proximaFecha, activoId: activos.id, activoCodigo: activos.codigo, activoNombre: activos.nombre, rubro: activoAreaExpression,
  }).from(planesMantenimiento).innerJoin(activos, eq(activos.id, planesMantenimiento.activoId))
    .where(and(inArray(planesMantenimiento.activoId, miembroIds), eq(planesMantenimiento.activo, true), tecnicoId ? eq(planesMantenimiento.asignadoA, tecnicoId) : undefined)).orderBy(asc(planesMantenimiento.proximaFecha)) : [];
  return { conjunto, puestos, disponibilidad: fechaConsulta ? null : calcularDisponibilidadConjunto(puestos), historialComponentes, eventos, ordenes: ordenesLista, planes, fechaConsulta };
}
export async function getConjuntosDelActivo(ctx: Context, activoId: number) {
  await lectorConjuntos(ctx);
  const rows = await getDb(ctx).select({ conjuntoId: conjuntos.id, codigo: conjuntos.codigo, nombre: conjuntos.nombre, rubro: conjuntos.rubro,
    funcion: conjuntoPuestos.funcion, incorporadoEn: conjuntoComponentes.incorporadoEn, retiradoEn: conjuntoComponentes.retiradoEn,
    motivoAlta: conjuntoComponentes.motivoAlta, motivoRetiro: conjuntoComponentes.motivoRetiro,
  }).from(conjuntoComponentes).innerJoin(conjuntoPuestos, eq(conjuntoPuestos.id, conjuntoComponentes.puestoId))
    .innerJoin(conjuntos, eq(conjuntos.id, conjuntoPuestos.conjuntoId)).where(eq(conjuntoComponentes.activoId, activoId)).orderBy(desc(conjuntoComponentes.id));
  return rows;
}
export async function getConjuntoDeOrden(ctx: Context, ordenId: number) {
  await lectorConjuntos(ctx);
  const [row] = await getDb(ctx).select({ conjuntoId: conjuntos.id, codigo: conjuntos.codigo, nombre: conjuntos.nombre, rubro: conjuntos.rubro,
    funcion: ordenConjuntos.funcion, activoCodigo: ordenConjuntos.activoCodigo, activoNombre: ordenConjuntos.activoNombre, fecha: ordenConjuntos.fecha,
  }).from(ordenConjuntos).innerJoin(conjuntos, eq(conjuntos.id, ordenConjuntos.conjuntoId)).where(eq(ordenConjuntos.ordenId, ordenId)).limit(1);
  return row ?? null;
}

// A single snapshot schema supports readable before/after views for every event.
const snapshotSql = `json_object('conjunto',json_object('codigo',j.codigo,'nombre',j.nombre,'descripcion',j.descripcion,'rubro',j.rubro,'criticidad',j.criticidad,'ubicacionId',j.ubicacion_id,'ubicacionNombre',(SELECT nombre FROM ubicaciones WHERE id=j.ubicacion_id),'activo',json(CASE WHEN j.activo=1 THEN 'true' ELSE 'false' END),'version',j.version),
 'puestos',json(COALESCE((SELECT json_group_array(json_object('puestoId',p.id,'funcion',p.funcion,'esencial',json(CASE WHEN p.esencial=1 THEN 'true' ELSE 'false' END),'componente',CASE WHEN c.id IS NULL THEN NULL ELSE json_object('vinculoId',c.id,'activoId',c.activo_id,'codigo',c.activo_codigo,'nombre',c.activo_nombre,'serial',c.activo_serial,'incorporadoEn',c.incorporado_en) END)) FROM conjunto_puestos p LEFT JOIN conjunto_componentes c ON c.puesto_id=p.id AND c.retirado_en IS NULL WHERE p.conjunto_id=j.id),'[]')))`;
// The first write chooses time on D1 after earlier writes have committed. Move
// past both the prior operation and every linked OT, so closed intervals never
// exclude an order captured immediately before the operation.
const fechaOperacionSql = `MAX(strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  strftime('%Y-%m-%dT%H:%M:%fZ',updated_at,'+0.001 seconds'),
  COALESCE((SELECT strftime('%Y-%m-%dT%H:%M:%fZ',MAX(oc.fecha),'+0.001 seconds') FROM orden_conjuntos oc WHERE oc.conjunto_id=conjuntos.id),''))`;
function dbBinding(ctx: Context) { return getEnv(ctx as APIContext).DB; }
function eventStatement(ctx: Context, id: number, token: string, accion: string, motivo: string, actor: Actor, antes: string | null, completed?: { sql: string; params: (string | number)[] }) {
  // A successful CAS with an empty INSERT ... SELECT is still a failure. The
  // NOT NULL constraint aborts the whole batch if its expected result is absent.
  const despues = completed ? `CASE WHEN ${completed.sql} THEN ${snapshotSql} ELSE NULL END` : snapshotSql;
  return dbBinding(ctx).prepare(`INSERT INTO conjunto_eventos (conjunto_id,fecha,accion,motivo,actor_id,actor_nombre,antes,despues)
    SELECT j.id,j.updated_at,?,?,?,?,?,${despues} FROM conjuntos j WHERE j.id=? AND j.ultima_operacion_id=?`)
    .bind(accion, motivo, actor.id, actor.nombre, antes, ...(completed?.params ?? []), id, token);
}
async function snapshot(ctx: Context, id: number): Promise<string> {
  const row = await dbBinding(ctx).prepare(`SELECT ${snapshotSql} AS snapshot FROM conjuntos j WHERE j.id=?`).bind(id).first<{ snapshot: string }>();
  if (!row) throw new ConjuntoError("Conjunto no encontrado", 404);
  return row.snapshot;
}
function normalizeDbError(error: unknown): never {
  const detail = String((error as Error)?.message ?? error);
  if (/UNIQUE constraint failed: conjunto_componentes\.activo_id/.test(detail)) throw new ConjuntoError("Este activo ya está incorporado a otro puesto o conjunto", 409);
  if (/UNIQUE constraint failed: conjunto_componentes\.puesto_id/.test(detail)) throw new ConjuntoError("El puesto ya está ocupado. Actualiza la página", 409);
  if (/UNIQUE constraint failed: conjunto_puestos/.test(detail)) throw new ConjuntoError("Ya existe un puesto con esa función; selecciona el puesto vacante o utiliza un nombre diferente", 409);
  if (/UNIQUE constraint failed: conjuntos\.codigo/.test(detail)) throw new ConjuntoError("Ya existe un conjunto con ese código", 409);
  if (/CONJUNTO_NO_VACIO/.test(detail)) throw new ConjuntoError("Retira todos los componentes antes de archivar el conjunto", 409);
  if (/CONJUNTO_ARCHIVADO/.test(detail)) throw new ConjuntoError("Reactiva el conjunto antes de modificar sus componentes", 409);
  if (/COMPONENTE_ALTA_INVALIDA/.test(detail)) throw new ConjuntoError("El activo ya no está disponible para incorporarlo o el conjunto está archivado", 409);
  if (/NOT NULL constraint failed: conjunto_eventos\.despues/.test(detail)) throw new ConjuntoError("El componente o el puesto cambió durante la operación. No se aplicaron cambios; actualiza la página", 409);
  if (/FOREIGN KEY constraint failed/.test(detail)) throw new ConjuntoError("Una referencia cambió durante la operación. Actualiza la página", 409);
  console.error("No se guardó la operación del conjunto:", error);
  throw new ConjuntoError("No se pudo guardar la operación completa. No se aplicaron cambios; vuelve a intentarlo", 500);
}
async function validarUbicacion(ctx: Context, id: number | null | undefined) {
  if (id == null) return;
  const [row] = await getDb(ctx).select({ id: ubicaciones.id }).from(ubicaciones).where(and(eq(ubicaciones.id, id), eq(ubicaciones.activa, true))).limit(1);
  if (!row) throw new ConjuntoError("Selecciona una ubicación activa existente");
}
async function ejecutarBatch(ctx: Context, statements: D1PreparedStatement[]) {
  try { return await dbBinding(ctx).batch(statements); } catch (error) { return normalizeDbError(error); }
}
function versionConflict() { return new ConjuntoError("El conjunto cambió mientras trabajabas. Actualiza la página antes de continuar", 409); }

export async function crearConjunto(ctx: Context, actor: Actor, input: z.infer<typeof conjuntoCrearSchema>) {
  await validarUbicacion(ctx, input.ubicacionId);
  const db = dbBinding(ctx), token = crypto.randomUUID();
  const create = db.prepare(`INSERT INTO conjuntos (codigo,nombre,descripcion,rubro,criticidad,ubicacion_id,activo,version,ultima_operacion_id,creado_por,created_at,updated_at) VALUES (?,?,?,?,?,?,1,1,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) RETURNING id`)
    .bind(input.codigo, input.nombre, input.descripcion ?? null, input.rubro, input.criticidad, input.ubicacionId ?? null, token, actor.id);
  const event = db.prepare(`INSERT INTO conjunto_eventos (conjunto_id,fecha,accion,motivo,actor_id,actor_nombre,antes,despues) SELECT j.id,j.updated_at,'crear',?,?,?,NULL,${snapshotSql} FROM conjuntos j WHERE j.ultima_operacion_id=?`)
    .bind(input.motivo, actor.id, actor.nombre, token);
  const results = await ejecutarBatch(ctx, [create, event]);
  const id = Number((results[0].results[0] as { id: number }).id);
  return (await getConjuntoDetalle(ctx, id))!;
}

export async function editarConjunto(ctx: Context, actor: Actor, id: number, input: z.infer<typeof conjuntoEditarSchema>) {
  const [actual] = await getDb(ctx).select().from(conjuntos).where(eq(conjuntos.id, id)).limit(1);
  if (!actual) throw new ConjuntoError("Conjunto no encontrado", 404);
  if (actual.version !== input.version) throw versionConflict();
  await validarUbicacion(ctx, input.ubicacionId);
  const antes = await snapshot(ctx, id), token = crypto.randomUUID();
  const newActivo = input.activo ?? actual.activo;
  const accion = newActivo !== actual.activo ? newActivo ? "reactivar" : "archivar" : "editar";
  const change = dbBinding(ctx).prepare(`UPDATE conjuntos SET nombre=?,descripcion=?,criticidad=?,ubicacion_id=?,activo=?,version=version+1,ultima_operacion_id=?,updated_at=${fechaOperacionSql} WHERE id=? AND version=? RETURNING id`)
    .bind(input.nombre ?? actual.nombre, input.descripcion === undefined ? actual.descripcion : input.descripcion, input.criticidad ?? actual.criticidad,
      input.ubicacionId === undefined ? actual.ubicacionId : input.ubicacionId, newActivo ? 1 : 0, token, id, input.version);
  const results = await ejecutarBatch(ctx, [change, eventStatement(ctx, id, token, accion, input.motivo, actor, antes)]);
  if (!results[0].results.length) throw versionConflict();
  return (await getConjuntoDetalle(ctx, id))!;
}

export async function cambiarComponenteConjunto(ctx: Context, actor: Actor, id: number, input: z.infer<typeof conjuntoComponenteSchema>) {
  const detalle = await getConjuntoDetalle(ctx, id);
  if (!detalle) throw new ConjuntoError("Conjunto no encontrado", 404);
  if (detalle.conjunto.version !== input.version) throw versionConflict();
  if (!detalle.conjunto.activo) throw new ConjuntoError("Reactiva el conjunto antes de modificar sus componentes", 409);
  const puesto = input.puestoId ? detalle.puestos.find(p => p.id === input.puestoId) : undefined;
  if (input.puestoId && !puesto) throw new ConjuntoError("El puesto no pertenece a este conjunto");
  if (input.accion === "incorporar" && puesto?.componente) throw new ConjuntoError("El puesto ya está ocupado; utiliza Reemplazar", 409);
  if (input.accion !== "incorporar" && !puesto?.componente) throw new ConjuntoError("El puesto no tiene un componente para retirar o reemplazar", 409);
  if (input.accion === "reemplazar" && puesto?.componente?.activoId === input.activoId) throw new ConjuntoError("Selecciona un activo diferente para el reemplazo");
  if (input.accion !== "retirar") {
    const [a] = await getDb(ctx).select({ estado: activos.estado }).from(activos).where(eq(activos.id, input.activoId)).limit(1);
    if (!a) throw new ConjuntoError("Activo no encontrado", 404);
    if (a.estado === "baja") throw new ConjuntoError("No se puede incorporar un activo dado de baja");
  }
  const antes = await snapshot(ctx, id), token = crypto.randomUUID(), db = dbBinding(ctx);
  const guard = `EXISTS(SELECT 1 FROM conjuntos WHERE id=? AND ultima_operacion_id=?)`;
  const completed: { sql: string; params: (string | number)[] } = { sql: "1=1", params: [] };
  // A component moved between sets cannot begin before its previous interval
  // ended, even if the other set advanced its logical clock by a millisecond.
  const fechaComponenteSql = input.accion === "retirar" ? fechaOperacionSql
    : `MAX(${fechaOperacionSql},COALESCE((SELECT MAX(retirado_en) FROM conjunto_componentes WHERE activo_id=?),''))`;
  const fechaParams = input.accion === "retirar" ? [] : [input.activoId];
  const statements = [db.prepare(`UPDATE conjuntos SET version=version+1,ultima_operacion_id=?,updated_at=${fechaComponenteSql} WHERE id=? AND version=? AND activo=1 RETURNING id`).bind(token, ...fechaParams, id, input.version)];
  if (input.accion !== "incorporar") {
    statements.push(db.prepare(`UPDATE conjunto_componentes SET retirado_en=(SELECT updated_at FROM conjuntos WHERE id=? AND ultima_operacion_id=?),retirado_por=?,retirado_por_nombre=?,motivo_retiro=? WHERE id=? AND retirado_en IS NULL AND ${guard}`)
      .bind(id, token, actor.id, actor.nombre, input.motivo, puesto!.componente!.vinculoId, id, token));
    completed.sql += " AND EXISTS(SELECT 1 FROM conjunto_componentes WHERE id=? AND retirado_en=j.updated_at)";
    completed.params.push(puesto!.componente!.vinculoId);
  }
  if (input.accion === "incorporar" && !puesto) {
    statements.push(db.prepare(`INSERT INTO conjunto_puestos (conjunto_id,funcion,esencial,created_at) SELECT id,?,?,updated_at FROM conjuntos WHERE id=? AND ultima_operacion_id=?`)
      .bind(input.funcion, input.esencial ? 1 : 0, id, token));
  }
  if (input.accion !== "retirar") {
    const puestoLookup = puesto ? "p.id=?" : "p.conjunto_id=? AND p.funcion=? COLLATE NOCASE";
    const puestoParams = puesto ? [puesto.id] : [id, input.accion === "incorporar" ? input.funcion : ""];
    statements.push(db.prepare(`INSERT INTO conjunto_componentes (puesto_id,activo_id,incorporado_en,incorporado_por,motivo_alta,activo_codigo,activo_nombre,activo_serial,incorporado_por_nombre)
      SELECT p.id,a.id,(SELECT updated_at FROM conjuntos WHERE id=? AND ultima_operacion_id=?),?,?,a.codigo,a.nombre,a.serial,? FROM conjunto_puestos p JOIN activos a ON a.id=? WHERE ${puestoLookup} AND ${guard}`)
      .bind(id, token, actor.id, input.motivo, actor.nombre, input.activoId, ...puestoParams, id, token));
    completed.sql += ` AND EXISTS(SELECT 1 FROM conjunto_componentes v JOIN conjunto_puestos p ON p.id=v.puesto_id WHERE ${puestoLookup} AND v.activo_id=? AND v.incorporado_en=j.updated_at AND v.retirado_en IS NULL)`;
    completed.params.push(...puestoParams, input.activoId);
  } else {
    completed.sql += " AND NOT EXISTS(SELECT 1 FROM conjunto_componentes WHERE puesto_id=? AND retirado_en IS NULL)";
    completed.params.push(puesto!.id);
  }
  statements.push(eventStatement(ctx, id, token, input.accion, input.motivo, actor, antes, completed));
  const results = await ejecutarBatch(ctx, statements);
  if (!results[0].results.length) throw versionConflict();
  return (await getConjuntoDetalle(ctx, id))!;
}
