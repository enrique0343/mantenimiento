// Fase 59 · WP-B · Metrología: consultas de Calibraciones, archivos en R2 y permisos
// de sus APIs. Solo lo usan las páginas y APIs de WP-B.
//
// D1 corta el resultado a 100 columnas y acepta hasta 100 parámetros por consulta:
// aquí siempre se eligen columnas y nunca se pasa una lista de ids (se usan uniones
// y subconsultas).
import type { APIContext } from "astro";
import { and, asc, desc, eq, gte, isNotNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { getDb } from "./db";
import { requireUser } from "./auth";
import { activoAreaCondition } from "./areas";
import { activos, calibraciones, proveedores, sucursales, ubicaciones, usuarios, type Rol } from "./schema";
import {
  ARCHIVO_MAX_BYTES, aplicaCalibracion, contentDisposition, esTipoArchivoPermitido, fechasEquipoDesdeCalibraciones,
  infoCalibracion, motivosCritico, nombreSeguroR2, patronVigenteEn, validarArchivo,
  type CalMin, type EquipoCalibracion, type TipoArchivo,
} from "./biomedico";
import { rubroDeActivo } from "./rubros";
import { acreditacionHoy, type FilaCal, type FilaLab, type FilaPatron, type RegistroCal } from "./metrologia";

type Db = ReturnType<typeof getDb>;
type Usuario = NonNullable<App.Locals["user"]>;

// ═══ Permisos y cuerpo de la petición ════════════════════════════════════════

/**
 * Sesión y rol de una API de Calibraciones. Igual que requireUser (401 sin sesión, 403
 * fuera de rol), pero el error va como { error } en español para que la pantalla lo muestre.
 */
export async function exigirRol(
  ctx: APIContext, roles: readonly Rol[], mensaje403 = "No tienes permiso para hacer esto.",
): Promise<{ user: Usuario; response: null } | { user: null; response: Response }> {
  const { user } = await requireUser(ctx);
  if (!user) return { user: null, response: Response.json({ error: "Tu sesión terminó. Vuelve a entrar." }, { status: 401 }) };
  if (!(roles as readonly string[]).includes(user.rol)) return { user: null, response: Response.json({ error: mensaje403 }, { status: 403 }) };
  return { user, response: null };
}

export const errorJson = (error: string, status: number) => Response.json({ error }, { status });

/** Id positivo de la ruta o null. */
export function idDeRuta(valor: string | undefined): number | null {
  return valor && /^\d{1,12}$/.test(valor) && Number(valor) > 0 ? Number(valor) : null;
}

/** Cuerpo multipart (con su archivo `file`) o JSON. */
export async function leerCuerpo(request: Request):
  Promise<{ ok: true; fuente: FormData | Record<string, unknown>; file: File | null } | { ok: false; error: string }> {
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return { ok: false, error: "No se pudo leer el formulario. Vuelve a intentarlo." };
    const raw = form.get("file");
    // Un campo de archivo vacío (sin elegir) llega sin nombre y con 0 bytes: no es un archivo.
    const file = typeof raw === "object" && raw !== null && (raw.size > 0 || !!raw.name) ? (raw as File) : null;
    return { ok: true, fuente: form, file };
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Datos no válidos." };
  return { ok: true, fuente: body as Record<string, unknown>, file: null };
}

// ═══ Archivos en R2 ══════════════════════════════════════════════════════════

/**
 * Valida el archivo por su contenido (PDF, JPG, PNG o WEBP; 15 MB) y lo sube a R2 con el
 * tipo detectado. El objeto reemplazado de antes no se borra (queda su clave en la bitácora).
 */
export async function guardarArchivoEvidencia(env: Env, prefijo: string, file: File):
  Promise<{ ok: true; r2Key: string; contentType: TipoArchivo; extension: string; nombre: string } | { ok: false; status: number; error: string }> {
  if (!(file.size > 0) || file.size > ARCHIVO_MAX_BYTES) {
    const v = validarArchivo({ tamano: file.size, cabecera: new Uint8Array(0) });
    return v.ok ? { ok: false, status: 400, error: "El archivo no es válido." } : { ok: false, status: v.status, error: v.error };
  }
  const datos = await file.arrayBuffer();
  const v = validarArchivo({ tamano: datos.byteLength, cabecera: new Uint8Array(datos, 0, Math.min(1024, datos.byteLength)) });
  if (!v.ok) return { ok: false, status: v.status, error: v.error };
  const nombre = (file.name || "").trim() || `archivo.${v.extension}`;
  const r2Key = `${prefijo}/${Date.now()}-${crypto.randomUUID()}-${nombreSeguroR2(nombre)}`;
  await env.R2.put(r2Key, datos, { httpMetadata: { contentType: v.contentType } });
  return { ok: true, r2Key, contentType: v.contentType, extension: v.extension, nombre };
}

/** Borra un objeto que se subió para una escritura que después falló (no corta si falla). */
export async function borrarObjetoR2(env: Env, r2Key: string): Promise<void> {
  try { await env.R2.delete(r2Key); } catch { /* el objeto queda huérfano; no es grave */ }
}

const EXTENSION_TIPO: Record<TipoArchivo, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * Entrega un archivo de R2 en línea. Un tipo que no es PDF ni foto (archivos de antes de la
 * fase 59) se entrega como descarga y sin adivinar el tipo (`nosniff`).
 */
export async function respuestaArchivoR2(env: Env, r2Key: string, nombreBase: string): Promise<Response> {
  const obj = await env.R2.get(r2Key);
  if (!obj) return errorJson("Archivo no encontrado.", 404);
  const ct = obj.httpMetadata?.contentType ?? "";
  const tipo = esTipoArchivoPermitido(ct) ? (ct.split(";")[0].trim().toLowerCase() as TipoArchivo) : null;
  const nombre = tipo ? `${nombreBase}.${EXTENSION_TIPO[tipo]}` : nombreBase;
  return new Response(await obj.arrayBuffer(), {
    headers: {
      "content-type": tipo ?? "application/octet-stream",
      "content-disposition": contentDisposition(nombre, tipo ? "inline" : "attachment"),
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
    },
  });
}

// ═══ Calibraciones de un equipo ══════════════════════════════════════════════

const COLS_CALMIN = {
  id: calibraciones.id,
  fechaCalibracion: calibraciones.fechaCalibracion,
  proximaCalibracion: calibraciones.proximaCalibracion,
  resultado: calibraciones.resultado,
  certificadoR2Key: calibraciones.certificadoR2Key,
};

/** Calibraciones del equipo con lo que necesita la regla de estado. */
export async function calibracionesDe(db: Db, activoId: number): Promise<CalMin[]> {
  return db.select(COLS_CALMIN).from(calibraciones).where(eq(calibraciones.activoId, activoId));
}

/**
 * Copia en el equipo la última calibración (activos.ultima_calibracion y proxima_calibracion).
 * Ninguna pantalla decide con esa copia; se escribe solo aquí. Devuelve las calibraciones leídas.
 */
export async function sincronizarFechasEquipo(db: Db, activoId: number): Promise<CalMin[]> {
  const calibs = await calibracionesDe(db, activoId);
  await db.update(activos).set(fechasEquipoDesdeCalibraciones(calibs)).where(eq(activos.id, activoId));
  return calibs;
}

/** Datos del equipo que usan las reglas de calibración. */
export async function equipoCalibracion(db: Db, activoId: number) {
  const [e] = await db.select({
    id: activos.id, codigo: activos.codigo, nombre: activos.nombre, estado: activos.estado, tipo: activos.tipo, rubro: activos.rubro,
    requiereCalibracion: activos.requiereCalibracion, esPatron: activos.esPatron,
    calibracionNoAplica: activos.calibracionNoAplica, calibracionNoAplicaMotivo: activos.calibracionNoAplicaMotivo,
  }).from(activos).where(eq(activos.id, activoId)).limit(1);
  return e ?? null;
}

/** Laboratorio de la lista con su acreditación actual. */
export async function laboratorioPorId(db: Db, id: number) {
  const [lab] = await db.select({
    id: proveedores.id, nombre: proveedores.nombre, esLaboratorioAcreditado: proveedores.esLaboratorioAcreditado,
    acreditacionVigencia: proveedores.acreditacionVigencia, acreditacionOrgano: proveedores.acreditacionOrgano,
    acreditacionNumero: proveedores.acreditacionNumero,
  }).from(proveedores).where(eq(proveedores.id, id)).limit(1);
  return lab ?? null;
}

/** Equipo elegido como patrón: válido si está marcado como patrón y no está de baja. */
export async function patronPorId(db: Db, id: number) {
  const [p] = await db.select({ id: activos.id, codigo: activos.codigo, esPatron: activos.esPatron, estado: activos.estado })
    .from(activos).where(eq(activos.id, id)).limit(1);
  return p ?? null;
}

// ═══ Tablero de Calibraciones ════════════════════════════════════════════════

/**
 * Población de Calibraciones: no de baja y (patrón, «Requiere calibración» o biomédico).
 * Los marcados «No requiere» entran para contarlos aparte (estado no_aplica).
 */
const condPoblacion = (soloPatrones = false): SQL =>
  and(
    ne(activos.estado, "baja"),
    soloPatrones ? eq(activos.esPatron, true) : or(eq(activos.esPatron, true), eq(activos.requiereCalibracion, true), activoAreaCondition("biomedico")),
  ) as SQL;

/** Calibraciones de los equipos citados como patrón en alguna calibración. */
async function calibracionesDePatrones(db: Db): Promise<Map<number, CalMin[]>> {
  const filas = await db.select({ activoId: calibraciones.activoId, ...COLS_CALMIN }).from(calibraciones)
    .where(sql`${calibraciones.activoId} IN (SELECT c2.patron_activo_id FROM calibraciones c2 WHERE c2.patron_activo_id IS NOT NULL)`);
  const m = new Map<number, CalMin[]>();
  for (const { activoId, ...c } of filas) {
    const lista = m.get(activoId);
    if (lista) lista.push(c); else m.set(activoId, [c]);
  }
  return m;
}

async function cargarDatosCal(db: Db, opciones: { hoy: string; soloPatrones?: boolean }) {
  const { hoy, soloPatrones = false } = opciones;
  const patron = alias(activos, "patron");
  const [equipos, cals, calsPatron] = await Promise.all([
    db.select({
      id: activos.id, codigo: activos.codigo, nombre: activos.nombre, marca: activos.marca, modelo: activos.modelo, serial: activos.serial,
      tipo: activos.tipo, rubro: activos.rubro, estado: activos.estado, requiereCalibracion: activos.requiereCalibracion,
      esPatron: activos.esPatron, calibracionNoAplica: activos.calibracionNoAplica, calibracionNoAplicaMotivo: activos.calibracionNoAplicaMotivo,
      subcategoria: activos.subcategoria, criticidad: activos.criticidadOperacional, clase: activos.claseRiesgo,
      ubicacionTexto: activos.ubicacion, ubicacionId: activos.ubicacionId, ubicacion: ubicaciones.nombre,
      sedeId: sucursales.id, sede: sucursales.nombre,
    }).from(activos)
      .leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId))
      .leftJoin(sucursales, eq(sucursales.id, ubicaciones.sucursalId))
      .where(condPoblacion(soloPatrones)),
    db.select({
      activoId: calibraciones.activoId, ...COLS_CALMIN,
      numeroCertificado: calibraciones.numeroCertificado, laboratorioExterno: calibraciones.laboratorioExterno, labNombre: proveedores.nombre,
      labAcreditado: calibraciones.labAcreditado, labAcreditacionRef: calibraciones.labAcreditacionRef,
      patronActivoId: calibraciones.patronActivoId, patronCodigo: patron.codigo, patronReferencia: calibraciones.patronReferencia,
      incertidumbre: calibraciones.incertidumbre, notas: calibraciones.notas,
    }).from(calibraciones)
      .innerJoin(activos, eq(activos.id, calibraciones.activoId))
      .leftJoin(proveedores, eq(proveedores.id, calibraciones.laboratorioId))
      .leftJoin(patron, eq(patron.id, calibraciones.patronActivoId))
      .where(condPoblacion(soloPatrones)),
    calibracionesDePatrones(db),
  ]);

  const porActivo = new Map<number, (typeof cals)[number][]>();
  for (const c of cals) {
    const lista = porActivo.get(c.activoId);
    if (lista) lista.push(c); else porActivo.set(c.activoId, [c]);
  }

  const filas: Array<FilaCal & { calibs: CalMin[] }> = [];
  for (const e of equipos) {
    const regla: EquipoCalibracion = {
      tipo: e.tipo, rubro: e.rubro, estado: e.estado, requiereCalibracion: e.requiereCalibracion,
      esPatron: e.esPatron, calibracionNoAplica: e.calibracionNoAplica,
    };
    // La consulta trae lo biomédico por su área; la regla común decide quién entra.
    if (!aplicaCalibracion({ ...regla, calibracionNoAplica: false })) continue;
    const lista = porActivo.get(e.id) ?? [];
    const info = infoCalibracion(regla, lista, hoy);
    const u = info.calibracionId != null ? lista.find((c) => c.id === info.calibracionId) ?? null : null;
    const area = rubroDeActivo(e.rubro, e.tipo);
    filas.push({
      activoId: e.id, codigo: e.codigo, nombre: e.nombre, marca: e.marca, modelo: e.modelo, serial: e.serial,
      area, esBio: area === "biomedico", esPatron: e.esPatron,
      sedeId: e.sedeId ?? null, sede: e.sede ?? null, ubicacionId: e.ubicacionId, ubicacion: e.ubicacion ?? e.ubicacionTexto ?? null,
      subcategoria: e.subcategoria, criticidad: e.criticidad, clase: e.clase,
      motivos: motivosCritico({ subcategoria: e.subcategoria, criticidadOperacional: e.criticidad, claseRiesgo: e.clase }),
      estado: info.estado, ultima: info.ultima, proxima: info.proxima, dias: info.dias,
      noAplicaMotivo: e.calibracionNoAplica ? e.calibracionNoAplicaMotivo : null,
      cal: u ? {
        id: u.id, fecha: u.fechaCalibracion, proxima: u.proximaCalibracion, numeroCertificado: u.numeroCertificado,
        tieneArchivo: !!u.certificadoR2Key, laboratorio: u.labNombre ?? u.laboratorioExterno ?? null,
        labAcreditado: u.labAcreditado ?? null, labAcreditacionRef: u.labAcreditacionRef, resultado: u.resultado,
        patronActivoId: u.patronActivoId, patronCodigo: u.patronCodigo ?? null,
        patronVigente: u.patronActivoId ? patronVigenteEn(calsPatron.get(u.patronActivoId) ?? [], u.fechaCalibracion).vigente : null,
        patronTexto: u.patronReferencia, incertidumbre: u.incertidumbre, notas: u.notas,
      } : null,
      calibs: lista.map(({ id, fechaCalibracion, proximaCalibracion, resultado, certificadoR2Key }) => ({ id, fechaCalibracion, proximaCalibracion, resultado, certificadoR2Key })),
    });
  }
  return filas;
}

/** Una fila por equipo que lleva calibración (sin bajas), con su estado según la regla única. */
export async function cargarFilasCal(db: Db, opciones: { hoy: string; soloPatrones?: boolean }): Promise<FilaCal[]> {
  return cargarDatosCal(db, opciones);
}

/** Equipos patrón (sin bajas) con su estado, sus calibraciones y en cuántas calibraciones se usaron. */
export async function listarPatrones(db: Db, hoy: string): Promise<FilaPatron[]> {
  const [filas, usos] = await Promise.all([
    cargarDatosCal(db, { hoy, soloPatrones: true }),
    db.select({ patronId: calibraciones.patronActivoId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(calibraciones).where(isNotNull(calibraciones.patronActivoId)).groupBy(calibraciones.patronActivoId),
  ]);
  const usosPor = new Map(usos.map((u) => [u.patronId, u.n]));
  return filas
    .map((f) => ({ ...f, usos: usosPor.get(f.activoId) ?? 0 }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo, "es", { numeric: true }));
}

/** Historial de calibraciones de los equipos elegidos, entre dos fechas (CSV «registros»). */
export async function cargarRegistrosCal(db: Db, opciones: { desde: string | null; hasta: string | null; activoIds: ReadonlySet<number> }): Promise<RegistroCal[]> {
  const patron = alias(activos, "patron");
  const corrector = alias(usuarios, "corrector");
  const { desde, hasta, activoIds } = opciones;
  const [filas, calsPatron] = await Promise.all([
    db.select({
      id: calibraciones.id, activoId: calibraciones.activoId, codigo: activos.codigo, equipo: activos.nombre, sede: sucursales.nombre,
      fecha: calibraciones.fechaCalibracion, proxima: calibraciones.proximaCalibracion, resultado: calibraciones.resultado,
      numeroCertificado: calibraciones.numeroCertificado, certificadoR2Key: calibraciones.certificadoR2Key,
      labNombre: proveedores.nombre, laboratorioExterno: calibraciones.laboratorioExterno,
      labAcreditado: calibraciones.labAcreditado, labAcreditacionRef: calibraciones.labAcreditacionRef,
      patronActivoId: calibraciones.patronActivoId, patronCodigo: patron.codigo, patronReferencia: calibraciones.patronReferencia,
      incertidumbre: calibraciones.incertidumbre, realizadoPor: calibraciones.realizadoPor, notas: calibraciones.notas,
      registradoPor: usuarios.nombre, registradoEn: calibraciones.createdAt, corregidaEn: calibraciones.corregidaEn, corregidaPor: corrector.nombre,
    }).from(calibraciones)
      .innerJoin(activos, eq(activos.id, calibraciones.activoId))
      .leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId))
      .leftJoin(sucursales, eq(sucursales.id, ubicaciones.sucursalId))
      .leftJoin(proveedores, eq(proveedores.id, calibraciones.laboratorioId))
      .leftJoin(patron, eq(patron.id, calibraciones.patronActivoId))
      .leftJoin(usuarios, eq(usuarios.id, calibraciones.usuarioId))
      .leftJoin(corrector, eq(corrector.id, calibraciones.corregidaPor))
      .where(and(desde ? gte(calibraciones.fechaCalibracion, desde) : undefined, hasta ? lte(calibraciones.fechaCalibracion, hasta) : undefined))
      .orderBy(asc(activos.codigo), desc(calibraciones.fechaCalibracion), desc(calibraciones.id)),
    calibracionesDePatrones(db),
  ]);
  return filas.filter((r) => activoIds.has(r.activoId)).map((r) => ({
    id: r.id, activoId: r.activoId, codigo: r.codigo, equipo: r.equipo, sede: r.sede ?? null, fecha: r.fecha, proxima: r.proxima,
    resultado: r.resultado, numeroCertificado: r.numeroCertificado, tieneArchivo: !!r.certificadoR2Key,
    laboratorio: r.labNombre ?? r.laboratorioExterno ?? null, labAcreditado: r.labAcreditado ?? null, labAcreditacionRef: r.labAcreditacionRef,
    patronActivoId: r.patronActivoId, patronCodigo: r.patronCodigo ?? null,
    patronVigente: r.patronActivoId ? patronVigenteEn(calsPatron.get(r.patronActivoId) ?? [], r.fecha).vigente : null,
    patronTexto: r.patronReferencia, incertidumbre: r.incertidumbre, realizadoPor: r.realizadoPor, notas: r.notas,
    registradoPor: r.registradoPor ?? null, registradoEn: r.registradoEn, corregidaEn: r.corregidaEn, corregidaPor: r.corregidaPor ?? null,
  }));
}

// ═══ Proveedores y laboratorios ══════════════════════════════════════════════

/** Todos los proveedores con su acreditación de hoy y cuántas calibraciones firmaron. */
export async function cargarProveedoresCal(db: Db, hoy: string): Promise<FilaLab[]> {
  const filas = await db.select({
    id: proveedores.id, nombre: proveedores.nombre, nit: proveedores.nit, contacto: proveedores.contacto, telefono: proveedores.telefono,
    email: proveedores.email, notas: proveedores.notas, activo: proveedores.activo, esLaboratorioAcreditado: proveedores.esLaboratorioAcreditado,
    acreditacionOrgano: proveedores.acreditacionOrgano, acreditacionNumero: proveedores.acreditacionNumero,
    acreditacionAlcance: proveedores.acreditacionAlcance, acreditacionVigencia: proveedores.acreditacionVigencia,
    acreditacionR2Key: proveedores.acreditacionR2Key,
    calibraciones: sql<number>`count(${calibraciones.id})`.mapWith(Number),
    ultimaCalibracion: sql<string | null>`max(${calibraciones.fechaCalibracion})`,
  }).from(proveedores)
    .leftJoin(calibraciones, eq(calibraciones.laboratorioId, proveedores.id))
    .groupBy(proveedores.id)
    .orderBy(asc(proveedores.nombre));
  return filas.map((p) => {
    const { estado, dias } = acreditacionHoy(p, hoy);
    return {
      id: p.id, nombre: p.nombre, nit: p.nit, contacto: p.contacto, telefono: p.telefono, email: p.email, notas: p.notas, activo: p.activo,
      esLaboratorioAcreditado: p.esLaboratorioAcreditado, acreditacionOrgano: p.acreditacionOrgano, acreditacionNumero: p.acreditacionNumero,
      acreditacionAlcance: p.acreditacionAlcance, acreditacionVigencia: p.acreditacionVigencia, tieneCertificado: !!p.acreditacionR2Key,
      estado, dias, calibraciones: p.calibraciones, ultimaCalibracion: p.ultimaCalibracion ?? null,
    };
  });
}

/** Laboratorios: acreditados o citados en alguna calibración. */
export async function cargarLaboratorios(db: Db, hoy: string): Promise<FilaLab[]> {
  return (await cargarProveedoresCal(db, hoy)).filter((p) => p.esLaboratorioAcreditado || p.calibraciones > 0);
}
