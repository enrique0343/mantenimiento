// Tablero biomédico y empresa externa (pedido de la gerencia de operaciones,
// 14/11/2026). Lo usan /preventivos en el espacio Biomédico, la ficha del equipo,
// la vista de la OT y POST /api/activos/asignar-ubicacion.
//
// Definiciones:
// - Empresa externa (opcional) de un equipo: activos.proveedor_id, «Empresa que da
//   mantenimiento». Vacío = lo hace el personal propio. Un plan puede traer su
//   propia empresa (planes_mantenimiento.proveedor_id, fase 59); si no la trae, el
//   preventivo lo realiza la empresa del equipo. Cualquier equipo puede tener
//   empresa; solo el tablero biomédico la destaca.
// - Ubicación pendiente: el equipo no tiene ubicacion_id. Si activos.ubicacion trae
//   el texto del inventario, se muestra «Pendiente de asignar · según inventario:
//   <texto>». La jefatura la asigna con el árbol sede → ubicación y queda en
//   audit_log (quién, cuándo, antes → después), en el mismo lote que el cambio.
// - Calibraciones del tablero: la regla única de la fase 59 (estadoCalibracion vía
//   cargarFilasCal), solo biomédicos: vencidas, y las que vencen en 30 días o menos.
//
// D1: listas de ids en un solo parámetro (json_each), nunca inArray.
import { and, asc, eq, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { getDb } from "./db";
import { activos, auditLog, centrosCosto, planesMantenimiento, proveedores, sucursales, ubicaciones } from "./schema";
import { condicionActivoEspacio, espacioDeActivo, mensajeOtroEspacio, puedeEntrar, type UsuarioEspacio } from "./espacio";
import { cargarFilasCal } from "./metrologia-db";
import { ordenarFilasCal } from "./metrologia";
import { DIAS_AVISO, ESTADO_CALIBRACION_LABEL, fechaCorta, textoVence, type EstadoCalibracion } from "./biomedico";

type Db = ReturnType<typeof getDb>;

// ─── Ubicaciones: rutas y árbol ──────────────────────────────────────────────
export interface UbicacionMin { id: number; nombre: string; padreId: number | null }

/** Ruta «Nivel 2 · Bloque quirúrgico · Sunshine» de cada ubicación (hasta 6 niveles arriba). */
export function rutasDeUbicaciones(ubs: readonly UbicacionMin[]): (id: number | null | undefined) => string | null {
  const porId = new Map(ubs.map((u) => [u.id, u]));
  return (id) => {
    const u = id ? porId.get(id) : undefined;
    if (!u) return null;
    const partes = [u.nombre];
    let p = u.padreId ? porId.get(u.padreId) : undefined;
    for (let i = 0; p && i < 6; i++) { partes.unshift(p.nombre); p = p.padreId ? porId.get(p.padreId) : undefined; }
    return partes.join(" · ");
  };
}

export interface ArbolUbicaciones {
  sedes: { id: number; nombre: string }[];
  ubicaciones: { id: number; sedeId: number; ruta: string }[];
}

/** Sedes activas con sus ubicaciones activas, cada una con su ruta. Una consulta por tabla, sin parámetros. */
export async function arbolUbicaciones(db: Db): Promise<ArbolUbicaciones> {
  const [ubs, sedes] = await Promise.all([
    db.select({ id: ubicaciones.id, nombre: ubicaciones.nombre, padreId: ubicaciones.padreId, sucursalId: ubicaciones.sucursalId, activa: ubicaciones.activa }).from(ubicaciones),
    db.select({ id: sucursales.id, nombre: sucursales.nombre, activa: sucursales.activa }).from(sucursales).orderBy(asc(sucursales.nombre)),
  ]);
  const ruta = rutasDeUbicaciones(ubs);
  const activas = new Set(sedes.filter((s) => s.activa).map((s) => s.id));
  const lista = ubs.filter((u) => u.activa && activas.has(u.sucursalId))
    .map((u) => ({ id: u.id, sedeId: u.sucursalId, ruta: ruta(u.id)! }))
    .sort((a, b) => a.ruta.localeCompare(b.ruta, "es", { numeric: true }));
  const conUbicaciones = new Set(lista.map((u) => u.sedeId));
  return { sedes: sedes.filter((s) => conUbicaciones.has(s.id)).map(({ id, nombre }) => ({ id, nombre })), ubicaciones: lista };
}

/** Texto de un equipo sin ubicación: «Pendiente de asignar · según inventario: …». */
export function textoUbicacionPendiente(inventario: string | null | undefined): string {
  const t = inventario?.trim();
  return t ? `Pendiente de asignar · según inventario: ${t}` : "Pendiente de asignar";
}

// ─── Empresa externa ─────────────────────────────────────────────────────────
export const PERSONAL_PROPIO = "Personal propio";
export const ETIQUETA_EMPRESA = "Empresa que da mantenimiento (opcional)";
export const AYUDA_EMPRESA = "Vacío = lo hace el personal propio.";
export const MENSAJE_EMPRESA_JEFATURA = "Solo la jefatura asigna o cambia la empresa que da mantenimiento al equipo.";

/** Quién realiza el preventivo: la empresa del plan; si no tiene, la del equipo. */
export const empresaDelPlanSql = sql<number | null>`coalesce(${planesMantenimiento.proveedorId}, ${activos.proveedorId})`;
export const textoLoRealiza = (empresa: string | null | undefined) => empresa?.trim() || PERSONAL_PROPIO;

/** null = todas; «propio» = sin empresa; «externa» = con alguna; número = esa empresa. */
export type FiltroEmpresa = null | "propio" | "externa" | number;
export function leerFiltroEmpresa(valor: string | null | undefined): FiltroEmpresa {
  if (valor === "propio" || valor === "externa") return valor;
  const n = Number(valor);
  return valor && Number.isInteger(n) && n > 0 ? n : null;
}
export function condicionEmpresa(f: FiltroEmpresa): SQL | undefined {
  if (f === null) return undefined;
  if (f === "propio") return sql`${empresaDelPlanSql} is null`;
  if (f === "externa") return sql`${empresaDelPlanSql} is not null`;
  return sql`${empresaDelPlanSql} = ${f}`;
}

/** La empresa que realiza el trabajo de una OT: la de su plan, o la del equipo. */
export async function empresaQueRealiza(db: Db, a: { planId: number | null | undefined; activoId: number | null | undefined }) {
  if (a.planId) {
    const [p] = await db.select({ id: proveedores.id, nombre: proveedores.nombre }).from(planesMantenimiento)
      .innerJoin(activos, eq(activos.id, planesMantenimiento.activoId))
      .innerJoin(proveedores, sql`${proveedores.id} = ${empresaDelPlanSql}`)
      .where(eq(planesMantenimiento.id, a.planId)).limit(1);
    if (p) return p;
  }
  if (!a.activoId) return null;
  const [e] = await db.select({ id: proveedores.id, nombre: proveedores.nombre }).from(activos)
    .innerJoin(proveedores, eq(proveedores.id, activos.proveedorId)).where(eq(activos.id, a.activoId)).limit(1);
  return e ?? null;
}

/**
 * ¿Puede guardarse esa empresa en el equipo? Existe y está activa (o es la que ya
 * tenía), y solo la jefatura la pone o la cambia. null si se puede.
 */
export async function errorEmpresaEquipo(db: Db, rol: string, nueva: number | null | undefined, actual: number | null): Promise<{ status: number; error: string } | null> {
  if (nueva === undefined || (nueva ?? null) === actual) return null;
  if (rol !== "admin" && rol !== "jefe") return { status: 403, error: MENSAJE_EMPRESA_JEFATURA };
  if (nueva === null) return null;
  const [p] = await db.select({ activo: proveedores.activo }).from(proveedores).where(eq(proveedores.id, nueva)).limit(1);
  if (!p) return { status: 400, error: "Esa empresa no existe. Elige otra de la lista." };
  if (!p.activo) return { status: 400, error: "Esa empresa está desactivada. Elige otra de la lista o actívala en Proveedores." };
  return null;
}

// ─── Lo propio del tablero biomédico ─────────────────────────────────────────
export interface FilaCalTablero {
  activoId: number; codigo: string; nombre: string; ubicacion: string | null; sede: string | null;
  estado: EstadoCalibracion; estadoTexto: string; ultimaTexto: string; proxima: string | null; proximaTexto: string;
  dias: number | null; vence: string;
}
export interface PendienteUbicacion {
  activoId: number; codigo: string; nombre: string; marcaModelo: string; inventario: string | null; texto: string;
  empresa: string | null; estado: string;
}
export const LIMITE_PENDIENTES = 500;

/**
 * Calibraciones (vencidas y por vencer en 30 días), equipos pendientes de
 * ubicación, cuántos equipos tienen empresa externa y las empresas para el filtro.
 * Solo biomédicos y sin bajas. La sede filtra las calibraciones y la cuenta de
 * empresa; un pendiente no tiene sede.
 */
export async function datosBiomedicos(db: Db, opciones: { hoy: string; sedeId: number | null }) {
  const { hoy, sedeId } = opciones;
  const bio = condicionActivoEspacio("biomedico");
  const filasCal = (await cargarFilasCal(db, { hoy })).filter((f) => f.area === "biomedico" && (sedeId == null || f.sedeId === sedeId));
  const aFila = (f: (typeof filasCal)[number]): FilaCalTablero => ({
    activoId: f.activoId, codigo: f.codigo, nombre: f.nombre, ubicacion: f.ubicacion, sede: f.sede,
    estado: f.estado, estadoTexto: ESTADO_CALIBRACION_LABEL[f.estado], ultimaTexto: fechaCorta(f.ultima), proxima: f.proxima,
    proximaTexto: fechaCorta(f.proxima), dias: f.dias, vence: textoVence(f.dias),
  });
  // Vencida = la regla única (sin próxima o ya pasada). Por vencer = vence en 30 días
  // o menos, aunque le falte el certificado; una no conforme no tiene próxima.
  const vencidas = ordenarFilasCal(filasCal.filter((f) => f.estado === "vencida")).map(aFila);
  const porVencer = ordenarFilasCal(filasCal.filter((f) => f.estado !== "vencida" && f.estado !== "no_conforme" && f.estado !== "no_aplica"
    && f.dias !== null && f.dias >= 0 && f.dias <= DIAS_AVISO.calibracion)).map(aFila);

  const pend = await db.select({
    id: activos.id, codigo: activos.codigo, nombre: activos.nombre, marca: activos.marca, modelo: activos.modelo,
    ubicacion: activos.ubicacion, estado: activos.estado, empresa: proveedores.nombre,
  }).from(activos).leftJoin(proveedores, eq(proveedores.id, activos.proveedorId))
    .where(and(bio, isNull(activos.ubicacionId), ne(activos.estado, "baja")))
    .orderBy(asc(activos.codigo)).limit(LIMITE_PENDIENTES + 1);
  const pendientes: PendienteUbicacion[] = pend.slice(0, LIMITE_PENDIENTES).map((p) => ({
    activoId: p.id, codigo: p.codigo, nombre: p.nombre, marcaModelo: [p.marca, p.modelo].filter(Boolean).join(" · "),
    inventario: p.ubicacion?.trim() || null, texto: textoUbicacionPendiente(p.ubicacion), empresa: p.empresa ?? null, estado: p.estado,
  }));

  // Equipos con empresa externa: la del equipo o la de alguno de sus preventivos activos.
  const conEmpresaSql = or(isNotNull(activos.proveedorId), sql`exists (select 1 from planes_mantenimiento pe where pe.activo_id = "activos"."id" and pe.activo = 1 and pe.proveedor_id is not null)`);
  const [cuenta] = await db.select({ n: sql<number>`count(*)` }).from(activos)
    .leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId))
    .where(and(bio, ne(activos.estado, "baja"), conEmpresaSql, sedeId ? eq(ubicaciones.sucursalId, sedeId) : undefined));

  // Empresas para el filtro: las que tienen algún equipo o preventivo biomédico.
  const empresas = await db.select({ id: proveedores.id, nombre: proveedores.nombre }).from(proveedores)
    .where(or(
      sql`${proveedores.id} in (select a2.proveedor_id from activos a2 where a2.proveedor_id is not null and (${sql.raw(BIO_A2)}))`,
      sql`${proveedores.id} in (select p2.proveedor_id from planes_mantenimiento p2 join activos a2 on a2.id = p2.activo_id where p2.proveedor_id is not null and (${sql.raw(BIO_A2)}))`,
    )).orderBy(asc(proveedores.nombre));

  return {
    calibraciones: { vencidas, porVencer },
    pendientes, pendientesTruncado: pend.length > LIMITE_PENDIENTES,
    conEmpresa: Number(cuenta?.n ?? 0),
    empresas,
  };
}
/** La regla de activoAreaExpression (biomédico) sobre el alias a2 de una subconsulta. */
const BIO_A2 = `CASE WHEN a2.rubro IN ('aires','infraestructura','equipo_general','biomedico') THEN a2.rubro WHEN a2.tipo = 'biomedico' THEN 'biomedico' ELSE 'equipo_general' END = 'biomedico'`;

// ─── Asignar la ubicación pendiente ──────────────────────────────────────────
export const ROLES_UBICACION = ["admin", "jefe"] as const;
export const MAX_EQUIPOS_UBICACION = 500;
type UsuarioUbicacion = NonNullable<UsuarioEspacio> & { id: number };
export type ResultadoUbicacion = { ok: true; n: number; ruta: string } | { ok: false; status: number; error: string };

/**
 * Pone la ubicación a equipos que no tienen (todo o nada): la ubicación existe y
 * está activa, cada equipo existe, sigue sin ubicación, es de un espacio al que el
 * usuario entra y su centro de costo es de la misma sede. Cada equipo deja su
 * registro (antes → después) en el mismo lote que el cambio.
 */
export async function asignarUbicacionPendiente(db: Db, usuario: UsuarioUbicacion, activoIds: number[], ubicacionId: number): Promise<ResultadoUbicacion> {
  const ids = [...new Set(activoIds)];
  if (!ids.length) return { ok: false, status: 400, error: "Elige al menos un equipo." };
  if (ids.length > MAX_EQUIPOS_UBICACION) return { ok: false, status: 400, error: `Asigna como máximo ${MAX_EQUIPOS_UBICACION} equipos a la vez.` };
  const [ub] = await db.select({ id: ubicaciones.id, activa: ubicaciones.activa, sedeId: ubicaciones.sucursalId, sede: sucursales.nombre, sedeActiva: sucursales.activa })
    .from(ubicaciones).innerJoin(sucursales, eq(sucursales.id, ubicaciones.sucursalId)).where(eq(ubicaciones.id, ubicacionId)).limit(1);
  if (!ub) return { ok: false, status: 404, error: "Esa ubicación ya no existe. Actualiza la página." };
  if (!ub.activa || !ub.sedeActiva) return { ok: false, status: 400, error: "Esa ubicación está desactivada. Elige otra." };

  const enLista = sql`${activos.id} in (select value from json_each(${JSON.stringify(ids)}))`;
  const equipos = await db.select({
    id: activos.id, codigo: activos.codigo, rubro: activos.rubro, tipo: activos.tipo, ubicacionId: activos.ubicacionId,
    centroSede: centrosCosto.sucursalId, centroCodigo: centrosCosto.codigo,
  }).from(activos).leftJoin(centrosCosto, eq(centrosCosto.id, activos.centroCostoId)).where(enLista);
  if (equipos.length !== ids.length) return { ok: false, status: 404, error: "Alguno de los equipos ya no existe. Actualiza la página." };
  const ajeno = equipos.find((e) => !puedeEntrar(usuario, espacioDeActivo(e)));
  if (ajeno) return { ok: false, status: 403, error: mensajeOtroEspacio(espacioDeActivo(ajeno)) };
  const conUbicacion = equipos.filter((e) => e.ubicacionId !== null);
  if (conUbicacion.length) {
    return { ok: false, status: 409, error: `${conUbicacion.map((e) => e.codigo).slice(0, 5).join(", ")} ya ${conUbicacion.length === 1 ? "tiene" : "tienen"} ubicación (otra persona la asignó). Actualiza la página; no se cambió ningún equipo.` };
  }
  const otraSede = equipos.find((e) => e.centroSede != null && e.centroSede !== ub.sedeId);
  if (otraSede) {
    return { ok: false, status: 409, error: `El centro de costo «${otraSede.centroCodigo}» de ${otraSede.codigo} es de otra sede, no de «${ub.sede}». Elige una ubicación de su sede o cambia su centro de costo; no se cambió ningún equipo.` };
  }

  const rutas = rutasDeUbicaciones(await db.select({ id: ubicaciones.id, nombre: ubicaciones.nombre, padreId: ubicaciones.padreId }).from(ubicaciones));
  const ruta = `${ub.sede} · ${rutas(ub.id)}`;
  // Todo o nada también si otra persona asigna uno en medio: si ya no siguen todos
  // sin ubicación, ni el cambio ni el registro. (Dentro del UPDATE, los que ya cambió
  // la misma sentencia tienen la ubicación nueva: por eso cuentan también.)
  const siguenTodos = sql`(select count(*) from activos ax where ax.id in (select value from json_each(${JSON.stringify(ids)})) and (ax.ubicacion_id is null or ax.ubicacion_id = ${ub.id})) = ${ids.length}`;
  const donde = and(enLista, isNull(activos.ubicacionId), siguenTodos)!;
  const antes = sql`case when trim(coalesce(${activos.ubicacion}, '')) = '' then 'Pendiente de asignar' else 'Pendiente de asignar · según inventario: ' || trim(${activos.ubicacion}) end`;
  const registro = db.insert(auditLog).select(db.select({
    id: sql<number>`null`.as("id"),
    entidad: sql<string>`'activo'`.as("entidad"),
    entidadId: sql<number>`${activos.id}`.as("entidad_id"),
    accion: sql<string>`'ubicacion'`.as("accion"),
    usuarioId: sql<number>`${usuario.id}`.as("usuario_id"),
    cambios: sql<string>`json_object('ubicacion', json_object('antes', ${antes}, 'despues', ${ruta}))`.as("cambios"),
    resumen: sql<string>`${`Asignó la ubicación: ${ruta}`}`.as("resumen"),
    createdAt: sql<string>`CURRENT_TIMESTAMP`.as("created_at"),
  }).from(activos).where(donde));
  const r = await db.batch([registro, db.update(activos).set({ ubicacionId: ub.id }).where(donde).returning({ id: activos.id })]);
  const n = (r[1] as unknown[]).length;
  if (n !== ids.length) return { ok: false, status: 409, error: "Otra persona cambió alguno de los equipos mientras asignabas. Actualiza la página; no se cambió ningún equipo." };
  return { ok: true, n, ruta };
}
