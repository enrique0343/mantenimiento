import type { APIContext } from 'astro';
import { z } from 'zod';
import { getEnv } from './db';
import { puedeEntrar, type UsuarioEspacio } from './espacio';

export const ROLES_CUSTODIA_LECTURA = ['admin', 'jefe', 'tecnico', 'visualizador'] as const;
export const ROLES_CUSTODIA_EDICION = ['admin', 'jefe', 'tecnico'] as const;
export const MENSAJE_TRASLADO_TI = 'Para cambiar la ubicación de un equipo de tecnología, utiliza Custodia y traslado en su ficha.';
type Contexto = APIContext | { locals: App.Locals };
type Usuario = { id: number; nombre: string; rol: string; especialidad?: string | null };
export function puedeVerCustodia(user: UsuarioEspacio) {
  return !!user && (ROLES_CUSTODIA_LECTURA as readonly string[]).includes(user.rol) && puedeEntrar(user, 'tecnologia');
}
export function puedeEditarCustodia(user: UsuarioEspacio) {
  return !!user && (ROLES_CUSTODIA_EDICION as readonly string[]).includes(user.rol) && puedeEntrar(user, 'tecnologia');
}
const texto = z.string().trim().toUpperCase();
/** Datos opcionales al dar de alta; la persona no necesita una cuenta. */
export const custodiaInicialSchema = z.object({
  nombre: texto.max(180).default(''),
  departamento: texto.max(180).nullable().optional(),
  cargo: texto.max(180).nullable().optional(),
}).strict().superRefine((v, ctx) => {
  if (!v.nombre && (v.departamento || v.cargo)) ctx.addIssue({ code:'custom', path:['nombre'], message:'Escribe el nombre de la persona para registrar su departamento o cargo.' });
});
type CustodiaInicial = z.infer<typeof custodiaInicialSchema>;
export const MOTIVO_CUSTODIA_INICIAL = 'ASIGNACIÓN INICIAL AL REGISTRAR EL EQUIPO';

/** Se anexan al mismo batch que INSERT activo y plan. La sede/ubicación se leen dentro de esa transacción. */
export function sentenciasCustodiaInicial(ctx: APIContext, user: Usuario, codigo: string, datos: CustodiaInicial, resumenAlta: string): D1PreparedStatement[] {
  if (!puedeEditarCustodia(user)) throw new ErrorCustodia('No tienes permiso para gestionar la custodia de Tecnología.', 403);
  const persona = custodiaInicialSchema.parse(datos);
  if (!persona.nombre) throw new ErrorCustodia('Escribe el nombre de la persona.', 400);
  const db = getEnv(ctx).DB, now = new Date().toISOString();
  const requestId = crypto.randomUUID(), mutationToken = crypto.randomUUID();
  const lugar = `'ubicacionId',a.ubicacion_id,'ubicacionNombre',COALESCE(l.nombre,a.ubicacion),'ubicacionDetalle',a.ubicacion,
    'sedeId',l.sucursal_id,'sedeNombre',s.nombre,'centroCostoId',a.centro_costo_id`;
  const antes = `json_object('revision',0,'usuarioId',NULL,'nombre',NULL,'departamento',NULL,'cargo',NULL,'asignadoEn',NULL,${lugar},'actualizadoEn',NULL)`;
  const despues = `json_object('revision',c.revision,'usuarioId',c.usuario_id,'nombre',c.nombre,'departamento',c.departamento,'cargo',c.cargo,'asignadoEn',c.asignado_en,${lugar},'actualizadoEn',c.updated_at)`;
  return [
    db.prepare(`INSERT INTO tecnologia_custodia(activo_id,usuario_id,nombre,departamento,cargo,asignado_en,revision,mutation_token,updated_at)
      SELECT id,NULL,?,?,?,?,1,?,? FROM activos WHERE codigo=? AND rubro='tecnologia'`)
      .bind(persona.nombre,persona.departamento || null,persona.cargo || null,now,mutationToken,now,codigo),
    db.prepare(`INSERT INTO tecnologia_custodia_eventos(activo_id,accion,request_id,mutation_token,request_json,revision,actor_id,actor_nombre,fecha,motivo,antes_json,despues_json)
      SELECT a.id,'asignar',?,c.mutation_token,
        json_object('accion','asignar','revision',0,'ubicacionActualId',a.ubicacion_id,'requestId',?,'motivo',?,'usuarioId',NULL,'nombre',c.nombre,'departamento',c.departamento,'cargo',c.cargo),
        1,?,?,c.updated_at,?,${antes},${despues}
      FROM activos a JOIN tecnologia_custodia c ON c.activo_id=a.id
      LEFT JOIN ubicaciones l ON l.id=a.ubicacion_id LEFT JOIN sucursales s ON s.id=l.sucursal_id
      WHERE a.codigo=? AND c.mutation_token=?`)
      .bind(requestId,requestId,MOTIVO_CUSTODIA_INICIAL,user.id,user.nombre,MOTIVO_CUSTODIA_INICIAL,codigo,mutationToken),
    db.prepare(`INSERT INTO audit_log(entidad,entidad_id,accion,usuario_id,resumen,created_at)
      SELECT 'activo',activo_id,'create',?,?,fecha FROM tecnologia_custodia_eventos WHERE mutation_token=?`)
      .bind(user.id,resumenAlta,mutationToken),
    db.prepare(`INSERT INTO audit_log(entidad,entidad_id,accion,usuario_id,cambios,resumen,created_at)
      SELECT 'activo',activo_id,'custodia',?,json_object('custodia',json_object('antes',json(antes_json),'despues',json(despues_json))),?,fecha
      FROM tecnologia_custodia_eventos WHERE mutation_token=?`)
      .bind(user.id,`CUSTODIA TI: ASIGNAR — ${MOTIVO_CUSTODIA_INICIAL}`,mutationToken),
  ];
}

export const movimientoCustodiaSchema = z.object({
  accion: z.enum(['asignar', 'reasignar', 'devolver', 'trasladar']),
  revision: z.number().int().nonnegative(),
  ubicacionActualId: z.number().int().positive().nullable(),
  requestId: z.string().uuid(),
  motivo: texto.min(3, 'Describe el motivo del movimiento.').max(2000),
  usuarioId: z.number().int().positive().nullable().optional(),
  nombre: texto.max(180).optional(),
  departamento: texto.max(180).optional(),
  cargo: texto.max(180).optional(),
  ubicacionId: z.number().int().positive().optional(),
  centroCostoId: z.null().optional(),
}).strict().superRefine((v, ctx) => {
  const asigna = v.accion === 'asignar' || v.accion === 'reasignar';
  if (asigna && !v.usuarioId && !v.nombre) ctx.addIssue({ code: 'custom', path: ['nombre'], message: 'Selecciona un usuario o escribe el nombre del colaborador.' });
  if (!asigna && ['usuarioId', 'nombre', 'departamento', 'cargo'].some((k) => k in v)) ctx.addIssue({ code: 'custom', message: 'Este movimiento conserva o retira el custodio; no admite un nuevo colaborador.' });
  if (v.accion === 'trasladar' && !v.ubicacionId) ctx.addIssue({ code: 'custom', path: ['ubicacionId'], message: 'Selecciona la ubicación de destino.' });
  if ('centroCostoId' in v && !v.ubicacionId) ctx.addIssue({ code: 'custom', message: 'Solo se puede retirar el centro de costo al indicar una ubicación de destino.' });
});
export type MovimientoCustodia = z.infer<typeof movimientoCustodiaSchema>;
export class ErrorCustodia extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

type Fila = {
  id: number; rubro: string | null; estado: string; ubicacion_id: number | null; ubicacion: string | null;
  centro_costo_id: number | null; centro_sede_id: number | null;
  ubicacion_nombre: string | null; sede_id: number | null; sede_nombre: string | null;
  usuario_id: number | null; nombre: string | null; departamento: string | null; cargo: string | null;
  asignado_en: string | null; revision: number; updated_at: string | null;
};
const SQL_ACTIVO = `SELECT a.id,a.rubro,a.estado,a.ubicacion_id,a.ubicacion,a.centro_costo_id,cc.sucursal_id AS centro_sede_id,
  l.nombre AS ubicacion_nombre,l.sucursal_id AS sede_id,s.nombre AS sede_nombre,
  c.usuario_id,c.nombre,c.departamento,c.cargo,c.asignado_en,COALESCE(c.revision,0) AS revision,c.updated_at
  FROM activos a LEFT JOIN tecnologia_custodia c ON c.activo_id=a.id
  LEFT JOIN ubicaciones l ON l.id=a.ubicacion_id LEFT JOIN sucursales s ON s.id=l.sucursal_id
  LEFT JOIN centros_costo cc ON cc.id=a.centro_costo_id WHERE a.id=?`;
async function leerActivo(db: D1Database, id: number) {
  const row = await db.prepare(SQL_ACTIVO).bind(id).first<Fila>();
  if (!row) throw new ErrorCustodia('Equipo no encontrado.', 404);
  if (row.rubro !== 'tecnologia') throw new ErrorCustodia('La custodia de hardware solo está disponible para equipos de Tecnología.', 403);
  return row;
}
function snapshot(row: Fila) {
  return {
    revision: row.revision, usuarioId: row.usuario_id, nombre: row.nombre, departamento: row.departamento,
    cargo: row.cargo, asignadoEn: row.asignado_en, ubicacionId: row.ubicacion_id,
    ubicacionNombre: row.ubicacion_nombre ?? row.ubicacion, ubicacionDetalle: row.ubicacion, sedeId: row.sede_id, sedeNombre: row.sede_nombre,
    centroCostoId: row.centro_costo_id, actualizadoEn: row.updated_at,
  };
}
export async function leerCustodia(ctx: Contexto, user: Usuario, id: number, before?: number) {
  if (!puedeVerCustodia(user)) throw new ErrorCustodia('No tienes permiso para consultar la custodia de Tecnología.', 403);
  const db = getEnv(ctx).DB;
  const activo = await leerActivo(db, id);
  const puedeEditar = puedeEditarCustodia(user) && activo.estado !== 'baja';
  const [eventos, usuarios, ubicaciones] = await Promise.all([
    db.prepare(`SELECT id,accion,motivo,actor_id,actor_nombre,fecha,antes_json,despues_json FROM tecnologia_custodia_eventos
      WHERE activo_id=? AND revision<=? AND (? IS NULL OR id<?) ORDER BY id DESC LIMIT 51`).bind(id, activo.revision, before ?? null, before ?? null).all<{
        id:number; accion:string; motivo:string; actor_id:number; actor_nombre:string; fecha:string; antes_json:string; despues_json:string;
      }>(),
    puedeEditar ? db.prepare('SELECT id,nombre FROM usuarios WHERE activo=1 ORDER BY nombre,id').all<{ id:number; nombre:string }>() : Promise.resolve({ results: [] }),
    puedeEditar ? db.prepare(`SELECT l.id,l.nombre,l.sucursal_id AS sucursalId,s.nombre AS sucursalNombre FROM ubicaciones l
      JOIN sucursales s ON s.id=l.sucursal_id WHERE l.activa=1 AND s.activa=1 ORDER BY s.nombre,l.nombre,l.id`).all() : Promise.resolve({ results: [] }),
  ]);
  return {
    custodia: snapshot(activo), puedeEditar,
    historial: eventos.results.slice(0, 50).map((e) => ({ id:e.id, accion:e.accion, motivo:e.motivo, actorId:e.actor_id,
      actorNombre:e.actor_nombre, fecha:e.fecha, antes:JSON.parse(e.antes_json), despues:JSON.parse(e.despues_json) })),
    nextCursor: eventos.results.length > 50 ? eventos.results[49].id : null,
    usuarios: usuarios.results, ubicaciones: ubicaciones.results, zonaHoraria: 'America/El_Salvador',
  };
}

/** Una consulta y un parámetro JSON; no revela custodios de otros espacios ni usuarios sin permiso. */
export async function custodiasParaInventario(ctx: Contexto, activoIds: number[]) {
  if (!puedeVerCustodia(ctx.locals.user) || !activoIds.length) return [];
  const ids = [...new Set(activoIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  const rows = await getEnv(ctx).DB.prepare(`SELECT c.activo_id AS activoId,c.nombre,c.usuario_id AS usuarioId,c.departamento
    FROM tecnologia_custodia c JOIN activos a ON a.id=c.activo_id WHERE a.rubro='tecnologia'
    AND c.nombre IS NOT NULL AND a.id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids)).all<{
      activoId: number; nombre: string; usuarioId: number | null; departamento: string | null;
    }>();
  return rows.results;
}

export async function registrarMovimientoCustodia(ctx: Contexto, user: Usuario, id: number, data: MovimientoCustodia) {
  if (!puedeEditarCustodia(user)) throw new ErrorCustodia('No tienes permiso para gestionar la custodia de Tecnología.', 403);
  const db = getEnv(ctx).DB;
  const actual = await leerActivo(db, id);
  const requestJson = JSON.stringify(data);
  const mutationToken = crypto.randomUUID();
  const repetido = await db.prepare('SELECT request_json FROM tecnologia_custodia_eventos WHERE activo_id=? AND request_id=?')
    .bind(id, data.requestId).first<{ request_json:string }>();
  if (repetido) {
    if (repetido.request_json !== requestJson) throw new ErrorCustodia('Este identificador ya se utilizó para un movimiento diferente.');
    return { ...await leerCustodia(ctx, user, id), repetido: true };
  }
  if (actual.estado === 'baja') throw new ErrorCustodia('Un equipo dado de baja conserva su historial y no admite movimientos de custodia.');
  if (actual.revision !== data.revision || actual.ubicacion_id !== data.ubicacionActualId) throw new ErrorCustodia('El equipo cambió desde que abriste la ficha. Actualízala antes de continuar.');
  const asigna = data.accion === 'asignar' || data.accion === 'reasignar';
  if (data.accion === 'asignar' && actual.nombre) throw new ErrorCustodia('El equipo ya tiene custodio. Utiliza Reasignar.');
  if ((data.accion === 'reasignar' || data.accion === 'devolver') && !actual.nombre) throw new ErrorCustodia('El equipo no tiene un custodio asignado.');
  const siguiente = { ...actual, revision: actual.revision + 1, updated_at: new Date().toISOString() };
  if (asigna) {
    const titular = data.usuarioId ? await db.prepare('SELECT id,nombre FROM usuarios WHERE id=? AND activo=1').bind(data.usuarioId).first<{id:number;nombre:string}>() : null;
    if (data.usuarioId && !titular) throw new ErrorCustodia('El usuario seleccionado no está activo o ya no existe.', 400);
    siguiente.usuario_id = titular?.id ?? null;
    siguiente.nombre = (titular?.nombre ?? data.nombre ?? '').trim().toUpperCase();
    siguiente.departamento = data.departamento || null;
    siguiente.cargo = data.cargo || null;
    siguiente.asignado_en = siguiente.updated_at;
    if (data.accion === 'reasignar' && siguiente.usuario_id === actual.usuario_id && siguiente.nombre === actual.nombre
      && siguiente.departamento === actual.departamento && siguiente.cargo === actual.cargo) throw new ErrorCustodia('Selecciona otro custodio o modifica sus datos para registrar la reasignación.');
  } else if (data.accion === 'devolver') {
    siguiente.usuario_id = null; siguiente.nombre = null; siguiente.departamento = null; siguiente.cargo = null; siguiente.asignado_en = null;
  }
  if (data.ubicacionId !== undefined) {
    const lugar = await db.prepare(`SELECT l.nombre,l.sucursal_id,s.nombre AS sede_nombre FROM ubicaciones l JOIN sucursales s ON s.id=l.sucursal_id
      WHERE l.id=? AND l.activa=1 AND s.activa=1`).bind(data.ubicacionId).first<{nombre:string;sucursal_id:number;sede_nombre:string}>();
    if (!lugar) throw new ErrorCustodia('La ubicación de destino o su sede no están activas.', 400);
    if (data.accion === 'trasladar' && data.ubicacionId === actual.ubicacion_id) throw new ErrorCustodia('Selecciona una ubicación diferente para el traslado.');
    if (actual.centro_sede_id && actual.centro_sede_id !== lugar.sucursal_id && data.centroCostoId !== null) {
      throw new ErrorCustodia('El centro de costo pertenece a otra sede. Confirma retirarlo al trasladar el equipo.');
    }
    siguiente.ubicacion_id = data.ubicacionId; siguiente.ubicacion_nombre = lugar.nombre;
    siguiente.ubicacion = lugar.nombre.toUpperCase(); siguiente.sede_id = lugar.sucursal_id; siguiente.sede_nombre = lugar.sede_nombre;
    if (data.centroCostoId === null) siguiente.centro_costo_id = null;
  }
  const antes = snapshot(actual), despues = snapshot(siguiente);
  // Todas las escrituras, incluidas ubicación, historial y auditoría, se confirman juntas.
  // El token evita que un CAS fallido escriba un evento o mueva el activo.
  const vigente = `EXISTS (SELECT 1 FROM activos a WHERE a.id=? AND a.rubro='tecnologia' AND a.estado<>'baja'
    AND a.ubicacion_id IS ? AND a.ubicacion IS ? AND a.centro_costo_id IS ?)
    AND (? IS NULL OR EXISTS (SELECT 1 FROM usuarios WHERE id=? AND activo=1))
    AND (? IS NULL OR EXISTS (SELECT 1 FROM ubicaciones l JOIN sucursales s ON s.id=l.sucursal_id
      WHERE l.id=? AND l.activa=1 AND s.activa=1 AND l.sucursal_id=? AND l.nombre=? AND s.nombre=?))`;
  const vigencia = [id, actual.ubicacion_id, actual.ubicacion, actual.centro_costo_id,
    asigna ? siguiente.usuario_id : null, asigna ? siguiente.usuario_id : null, data.ubicacionId ?? null, data.ubicacionId ?? null,
    siguiente.sede_id, siguiente.ubicacion_nombre, siguiente.sede_nombre];
  const token = `EXISTS (SELECT 1 FROM tecnologia_custodia WHERE activo_id=? AND mutation_token=? AND revision=?)`;
  const resultados = await db.batch([
    db.prepare(`INSERT INTO tecnologia_custodia(activo_id,updated_at) SELECT ?,? WHERE ?=0 AND ${vigente} ON CONFLICT(activo_id) DO NOTHING`)
      .bind(id, siguiente.updated_at, data.revision, ...vigencia),
    db.prepare(`UPDATE tecnologia_custodia SET usuario_id=?,nombre=?,departamento=?,cargo=?,asignado_en=?,revision=revision+1,mutation_token=?,updated_at=?
      WHERE activo_id=? AND revision=? AND ${vigente}`)
      .bind(siguiente.usuario_id,siguiente.nombre,siguiente.departamento,siguiente.cargo,siguiente.asignado_en,mutationToken,siguiente.updated_at,id,data.revision,...vigencia),
    db.prepare(`UPDATE activos SET ubicacion_id=?,ubicacion=?,centro_costo_id=? WHERE id=? AND ${token}`)
      .bind(siguiente.ubicacion_id,siguiente.ubicacion,siguiente.centro_costo_id,id,id,mutationToken,siguiente.revision),
    db.prepare(`INSERT INTO tecnologia_custodia_eventos(activo_id,accion,request_id,mutation_token,request_json,revision,actor_id,actor_nombre,fecha,motivo,antes_json,despues_json)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${token}`)
      .bind(id,data.accion,data.requestId,mutationToken,requestJson,siguiente.revision,user.id,user.nombre,siguiente.updated_at,data.motivo,JSON.stringify(antes),JSON.stringify(despues),id,mutationToken,siguiente.revision),
    db.prepare(`INSERT INTO audit_log(entidad,entidad_id,accion,usuario_id,cambios,resumen,created_at) SELECT 'activo',?,'custodia',?,?,?,? WHERE ${token}`)
      .bind(id,user.id,JSON.stringify({custodia:{antes,despues}}),`CUSTODIA TI: ${data.accion.toUpperCase()} — ${data.motivo}`,siguiente.updated_at,id,mutationToken,siguiente.revision),
  ]);
  if (!resultados[1].meta.changes) {
    const concurrente = await db.prepare('SELECT request_json FROM tecnologia_custodia_eventos WHERE activo_id=? AND request_id=?')
      .bind(id, data.requestId).first<{ request_json:string }>();
    if (concurrente?.request_json === requestJson) return { ...await leerCustodia(ctx, user, id), repetido:true };
    throw new ErrorCustodia('El equipo o los datos de destino cambiaron. Actualiza la ficha antes de continuar.');
  }
  return { ...await leerCustodia(ctx, user, id), repetido: false };
}
