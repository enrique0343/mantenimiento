// Seguridad eléctrica IEC 62353 (Fase 59): lo que las páginas y las API de este
// módulo leen de la tabla pruebas_seguridad_electrica.
//
// Las reglas (límites, evaluación, vigencia, etiquetas) viven en biomedico.ts;
// aquí solo se consulta la base. La ficha del equipo y Cumplimiento leen la tabla
// por su cuenta con la misma regla: última prueba = la válida más reciente por
// fecha y luego por id; su estado sale de estadoSeguridadElectrica.
//
// Límites de D1: cada consulta elige sus columnas (activos tiene 53) y ninguna
// pasa listas de ids como parámetros: el tablero lee las pruebas válidas sin
// filtro y elige la última de cada equipo en memoria.
import type { APIContext } from "astro";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { getDb } from "./db";
import {
  activos, appConfig, calibraciones, ordenes, pruebasSeguridadElectrica, sucursales, ubicaciones, usuarios,
  type PruebaSeguridadElectrica, type Rol,
} from "./schema";
import { activoAreaCondition } from "./areas";
import { requireUser } from "./auth";
import { leerNumero } from "./numero";
import { etiquetaOT } from "./orden-codigo";
import {
  CLAVE_PERIODICIDAD_SEGURIDAD_ELECTRICA, ESTADO_SEG_ELEC_ORDEN, PERIODICIDAD_SEGURIDAD_ELECTRICA_MESES,
  cumpleSeguridadElectrica, esFechaISO, estadoSeguridadElectrica, fechaCorta, hoySV, patronVigenteEn, ultimaCalibracion, ultimaPorEquipo,
  type CalMin, type ClaseProteccion, type EstadoSeguridadElectrica, type ParteAplicada,
  type ResultadoPruebaElectrica, type TipoPruebaElectrica,
} from "./biomedico";

type Db = ReturnType<typeof getDb>;

// ═══ Permisos con respuesta en texto ════════════════════════════════════════

/**
 * requireUser con el error como { error } en español, para que la pantalla lo
 * muestre tal cual: 401 sin sesión, 403 fuera de rol.
 */
export async function exigirRol(ctx: APIContext, roles: Rol[]) {
  const r = await requireUser(ctx, roles);
  if (r.user) return { user: r.user, response: null };
  const status = r.response?.status === 401 ? 401 : 403;
  return {
    user: null,
    response: Response.json(
      { error: status === 401 ? "Tu sesión terminó. Vuelve a entrar." : "No tienes permiso para esto." },
      { status },
    ),
  };
}

export const errorJson = (status: number, error: string) => Response.json({ error }, { status });

/** Entero positivo de un texto o número; si no, null. */
export function idPositivo(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ═══ Periodicidad ═══════════════════════════════════════════════════════════

/** Meses entre pruebas como entero de 1 a 60; cualquier otra cosa → null. */
export function mesesValidos(v: unknown): number | null {
  const t = typeof v === "number" ? String(v) : String(v ?? "").trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 60 ? n : null;
}

/** La periodicidad guardada en app_config (1 a 60 meses) o 12. */
export async function periodicidadSeguridadElectrica(db: Db): Promise<number> {
  const [fila] = await db
    .select({ valor: appConfig.valor })
    .from(appConfig)
    .where(eq(appConfig.clave, CLAVE_PERIODICIDAD_SEGURIDAD_ELECTRICA))
    .limit(1);
  return mesesValidos(fila?.valor) ?? PERIODICIDAD_SEGURIDAD_ELECTRICA_MESES;
}

// ═══ Lecturas escritas a mano ═══════════════════════════════════════════════

/**
 * Una medición del formulario: vacío → null; número ≥ 0 → el número; lo demás,
 * un error con la etiqueta delante.
 */
export function leerMedida(texto: unknown, etiqueta: string): { valor: number | null } | { error: string } {
  const r = leerNumero(texto);
  if (r.tipo === "vacio") return { valor: null };
  if (r.tipo === "ambiguo") return { error: `${etiqueta}: ${r.mensaje}` };
  if (r.tipo === "texto") return { error: `${etiqueta}: escribe solo el número, por ejemplo 0.12` };
  if (r.valor < 0) return { error: "Los valores no pueden ser negativos." };
  return { valor: r.valor };
}

/** Marca y modelo del analizador o, si no tiene, su nombre. */
export function descripcionAnalizador(a: { nombre: string; marca: string | null; modelo: string | null }): string {
  return [a.marca, a.modelo].map((s) => (s ?? "").trim()).filter(Boolean).join(" ") || a.nombre.trim();
}

export const mensajeAnalizadorVencido = (vence: string | null) =>
  `El analizador tenía la calibración vencida el día de la prueba (venció el ${fechaCorta(vence)}). Usa uno con calibración vigente.`;

/**
 * ¿Sirve el analizador patrón en la fecha de la prueba? Decide patronVigenteEn
 * (la regla de Calibraciones: su última calibración con fecha ≤ la de la prueba,
 * conforme, con certificado y sin vencer); si no sirve, aquí se dice por qué.
 */
export function revisarCalibracionAnalizador(calibs: readonly CalMin[], fecha: string): { ok: true; hasta: string } | { ok: false; error: string } {
  const veredicto = patronVigenteEn(calibs, fecha);
  if (veredicto.vigente && veredicto.hasta) return { ok: true, hasta: veredicto.hasta };
  const u = ultimaCalibracion(calibs.filter((c) => c.fechaCalibracion <= fecha));
  if (!u) return { ok: false, error: "El analizador elegido no tiene calibración registrada." };
  if (u.resultado === "no_conforme") return { ok: false, error: "La última calibración del analizador antes de la prueba fue no conforme. Usa uno con calibración vigente." };
  if (!esFechaISO(u.proximaCalibracion)) return { ok: false, error: "La calibración del analizador no tiene fecha de vencimiento. Complétala en Calibraciones o usa otro analizador." };
  if (u.proximaCalibracion < fecha) return { ok: false, error: mensajeAnalizadorVencido(u.proximaCalibracion) };
  return { ok: false, error: "La calibración del analizador no tiene el certificado adjunto. Adjúntalo en Calibraciones o usa otro analizador." };
}

/** Las calibraciones de un equipo con lo que piden las reglas de vigencia. */
export async function calibracionesDe(db: Db, activoId: number): Promise<CalMin[]> {
  return db
    .select({
      id: calibraciones.id,
      fechaCalibracion: calibraciones.fechaCalibracion,
      proximaCalibracion: calibraciones.proximaCalibracion,
      resultado: calibraciones.resultado,
      certificadoR2Key: calibraciones.certificadoR2Key,
    })
    .from(calibraciones)
    .where(eq(calibraciones.activoId, activoId));
}

// ═══ Última prueba ══════════════════════════════════════════════════════════

export type UltimaPruebaElectrica = {
  id: number; activoId: number; fecha: string; tipo: TipoPruebaElectrica; resultado: ResultadoPruebaElectrica;
  proximaFecha: string; claseProteccion: ClaseProteccion; parteAplicada: ParteAplicada; analizadorDescripcion: string;
  analizadorSerie: string; analizadorCalVence: string; realizadoPor: string; tieneInforme: boolean;
};

const columnasUltima = {
  id: pruebasSeguridadElectrica.id,
  activoId: pruebasSeguridadElectrica.activoId,
  fecha: pruebasSeguridadElectrica.fecha,
  tipo: pruebasSeguridadElectrica.tipo,
  resultado: pruebasSeguridadElectrica.resultado,
  proximaFecha: pruebasSeguridadElectrica.proximaFecha,
  claseProteccion: pruebasSeguridadElectrica.claseProteccion,
  parteAplicada: pruebasSeguridadElectrica.parteAplicada,
  analizadorDescripcion: pruebasSeguridadElectrica.analizadorDescripcion,
  analizadorSerie: pruebasSeguridadElectrica.analizadorSerie,
  analizadorCalVence: pruebasSeguridadElectrica.analizadorCalVence,
  realizadoPor: pruebasSeguridadElectrica.realizadoPor,
  informeR2Key: pruebasSeguridadElectrica.informeR2Key,
};
type FilaUltima = Omit<UltimaPruebaElectrica, "tieneInforme"> & { informeR2Key: string | null };

const aUltima = ({ informeR2Key, ...f }: FilaUltima): UltimaPruebaElectrica => ({ ...f, tieneInforme: !!informeR2Key });

/** Por equipo, su última prueba válida (fecha mayor; si empatan, id mayor). */
export async function ultimasPruebasElectricas(db: Db): Promise<Map<number, UltimaPruebaElectrica>> {
  const filas = await db.select(columnasUltima).from(pruebasSeguridadElectrica).where(eq(pruebasSeguridadElectrica.estado, "valida"));
  const ultimas = ultimaPorEquipo(filas);
  return new Map([...ultimas].map(([id, f]) => [id, aUltima(f)]));
}

export type ResumenSeguridadElectrica = {
  estado: EstadoSeguridadElectrica;
  ultima: UltimaPruebaElectrica | null;
  /** La prueba válida de aceptación más reciente. */
  aceptacion: { id: number; fecha: string; resultado: ResultadoPruebaElectrica } | null;
  /** Pruebas válidas del equipo. */
  total: number;
};

/** Estado, última prueba, aceptación y cuántas pruebas válidas tiene un equipo. */
export async function resumenSeguridadElectrica(db: Db, activoId: number, hoy: string = hoySV()): Promise<ResumenSeguridadElectrica> {
  const filas = await db
    .select(columnasUltima)
    .from(pruebasSeguridadElectrica)
    .where(and(eq(pruebasSeguridadElectrica.activoId, activoId), eq(pruebasSeguridadElectrica.estado, "valida")))
    .orderBy(desc(pruebasSeguridadElectrica.fecha), desc(pruebasSeguridadElectrica.id));
  const ultima = filas[0] ? aUltima(filas[0]) : null;
  const acep = filas.find((f) => f.tipo === "aceptacion");
  return {
    estado: estadoSeguridadElectrica(ultima, hoy),
    ultima,
    aceptacion: acep ? { id: acep.id, fecha: acep.fecha, resultado: acep.resultado } : null,
    total: filas.length,
  };
}

// ═══ Pruebas de un equipo ═══════════════════════════════════════════════════

export type PruebaConNombres = PruebaSeguridadElectrica & {
  registradoPorNombre: string | null; anuladaPorNombre: string | null; ordenEtiqueta: string | null;
};

const registro = alias(usuarios, "se_registro");
const anulacion = alias(usuarios, "se_anulacion");

/** Todas las pruebas del equipo, válidas y anuladas, las más nuevas primero. */
export async function pruebasDeActivo(db: Db, activoId: number): Promise<PruebaConNombres[]> {
  const filas = await db
    .select({
      p: pruebasSeguridadElectrica,
      registradoPorNombre: registro.nombre,
      anuladaPorNombre: anulacion.nombre,
      ordenCodigo: ordenes.codigo,
    })
    .from(pruebasSeguridadElectrica)
    .leftJoin(registro, eq(registro.id, pruebasSeguridadElectrica.registradoPor))
    .leftJoin(anulacion, eq(anulacion.id, pruebasSeguridadElectrica.anuladaPor))
    .leftJoin(ordenes, eq(ordenes.id, pruebasSeguridadElectrica.ordenId))
    .where(eq(pruebasSeguridadElectrica.activoId, activoId))
    .orderBy(desc(pruebasSeguridadElectrica.fecha), desc(pruebasSeguridadElectrica.id));
  return filas.map((f) => ({
    ...f.p,
    registradoPorNombre: f.registradoPorNombre ?? null,
    anuladaPorNombre: f.anuladaPorNombre ?? null,
    ordenEtiqueta: f.p.ordenId ? etiquetaOT({ id: f.p.ordenId, codigo: f.ordenCodigo }) : null,
  }));
}

/** Una prueba con su equipo, quién la registró o anuló y su orden; null si no existe. */
export async function cargarPrueba(db: Db, id: number) {
  const [f] = await db
    .select({
      p: pruebasSeguridadElectrica,
      registradoPorNombre: registro.nombre,
      anuladaPorNombre: anulacion.nombre,
      ordenCodigo: ordenes.codigo,
      ordenTipo: ordenes.tipo,
      equipo: {
        id: activos.id, codigo: activos.codigo, nombre: activos.nombre, marca: activos.marca, modelo: activos.modelo,
        serial: activos.serial, numeroActivo: activos.numeroActivo, claseRiesgo: activos.claseRiesgo, estado: activos.estado,
        tipo: activos.tipo, rubro: activos.rubro, ubicacionTexto: activos.ubicacion,
      },
      ubicacion: ubicaciones.nombre,
      sucursal: sucursales.nombre,
    })
    .from(pruebasSeguridadElectrica)
    .innerJoin(activos, eq(activos.id, pruebasSeguridadElectrica.activoId))
    .leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId))
    .leftJoin(sucursales, eq(sucursales.id, ubicaciones.sucursalId))
    .leftJoin(registro, eq(registro.id, pruebasSeguridadElectrica.registradoPor))
    .leftJoin(anulacion, eq(anulacion.id, pruebasSeguridadElectrica.anuladaPor))
    .leftJoin(ordenes, eq(ordenes.id, pruebasSeguridadElectrica.ordenId))
    .where(eq(pruebasSeguridadElectrica.id, id))
    .limit(1);
  if (!f) return null;
  return {
    prueba: f.p,
    equipo: f.equipo,
    ubicacion: f.ubicacion ?? f.equipo.ubicacionTexto ?? null,
    sucursal: f.sucursal ?? null,
    registradoPorNombre: f.registradoPorNombre ?? null,
    anuladaPorNombre: f.anuladaPorNombre ?? null,
    orden: f.p.ordenId ? { id: f.p.ordenId, etiqueta: etiquetaOT({ id: f.p.ordenId, codigo: f.ordenCodigo }), tipo: f.ordenTipo ?? null } : null,
  };
}

// ═══ Formulario: órdenes del equipo y quién realiza ═════════════════════════

/** Las 30 órdenes más recientes del equipo que no están canceladas. */
export async function ordenesDelEquipo(db: Db, activoId: number) {
  return db
    .select({
      id: ordenes.id, codigo: ordenes.codigo, tipo: ordenes.tipo, estado: ordenes.estado, titulo: ordenes.titulo,
      createdAt: ordenes.createdAt, completadaEn: ordenes.completadaEn, asignadoA: ordenes.asignadoA,
    })
    .from(ordenes)
    .where(and(eq(ordenes.activoId, activoId), ne(ordenes.estado, "cancelada")))
    .orderBy(desc(ordenes.id))
    .limit(30);
}

export const ROLES_REALIZAN: Rol[] = ["admin", "jefe", "tecnico"];

/** Usuarios activos que pueden figurar como «quién realizó»: admin, jefe y técnico. */
export async function personasQueRealizan(db: Db) {
  return db
    .select({ id: usuarios.id, nombre: usuarios.nombre, rol: usuarios.rol })
    .from(usuarios)
    .where(and(eq(usuarios.activo, true), inArray(usuarios.rol, ROLES_REALIZAN)))
    .orderBy(asc(usuarios.nombre));
}

// ═══ Tablero ════════════════════════════════════════════════════════════════

export type AlcanceSE = "clase3" | "biomedicos";
export const ALCANCE_SE_LABEL: Record<AlcanceSE, string> = { clase3: "Clase de riesgo III", biomedicos: "Todos los biomédicos" };
export const leerAlcance = (v: unknown): AlcanceSE => (v === "biomedicos" ? "biomedicos" : "clase3");

export type FilaTableroSE = {
  activoId: number; codigo: string; nombre: string; marca: string | null; modelo: string | null; serial: string | null;
  numeroActivo: string | null; sucursal: string | null; ubicacion: string | null; claseRiesgo: string | null; estadoEquipo: string;
  ultima: UltimaPruebaElectrica | null; estado: EstadoSeguridadElectrica;
};

export type TableroSE = {
  filas: FilaTableroSE[]; conteo: Record<EstadoSeguridadElectrica, number>; total: number; cumplen: number;
  periodicidadMeses: number; hoy: string;
};

/**
 * Equipos biomédicos no dados de baja (sin los equipos patrón) con su última
 * prueba y su estado; en «clase3», solo los de clase de riesgo III. Lo más grave
 * primero, luego por próxima fecha y código.
 */
export async function tableroSeguridadElectrica(
  db: Db,
  opts: { alcance?: AlcanceSE; sucursalId?: number | null; hoy?: string } = {},
): Promise<TableroSE> {
  const hoy = opts.hoy ?? hoySV();
  const condiciones = [activoAreaCondition("biomedico"), ne(activos.estado, "baja"), eq(activos.esPatron, false)];
  if ((opts.alcance ?? "clase3") === "clase3") condiciones.push(eq(activos.claseRiesgo, "III"));
  if (opts.sucursalId) condiciones.push(eq(ubicaciones.sucursalId, opts.sucursalId));
  const [equipos, ultimas, periodicidadMeses] = await Promise.all([
    db
      .select({
        activoId: activos.id, codigo: activos.codigo, nombre: activos.nombre, marca: activos.marca, modelo: activos.modelo,
        serial: activos.serial, numeroActivo: activos.numeroActivo, sucursal: sucursales.nombre, ubicacion: ubicaciones.nombre,
        ubicacionTexto: activos.ubicacion, claseRiesgo: activos.claseRiesgo, estadoEquipo: activos.estado,
      })
      .from(activos)
      .leftJoin(ubicaciones, eq(ubicaciones.id, activos.ubicacionId))
      .leftJoin(sucursales, eq(sucursales.id, ubicaciones.sucursalId))
      .where(and(...condiciones)),
    ultimasPruebasElectricas(db),
    periodicidadSeguridadElectrica(db),
  ]);
  const filas: FilaTableroSE[] = equipos.map(({ ubicacionTexto, ...e }) => {
    const ultima = ultimas.get(e.activoId) ?? null;
    return { ...e, ubicacion: e.ubicacion ?? ubicacionTexto ?? null, ultima, estado: estadoSeguridadElectrica(ultima, hoy) };
  });
  filas.sort((a, b) =>
    ESTADO_SEG_ELEC_ORDEN[a.estado] - ESTADO_SEG_ELEC_ORDEN[b.estado]
    || (a.ultima?.proximaFecha ?? "").localeCompare(b.ultima?.proximaFecha ?? "")
    || a.codigo.localeCompare(b.codigo, "es"));
  const conteo: Record<EstadoSeguridadElectrica, number> = { vigente: 0, por_vencer: 0, vencida: 0, no_pasa: 0, sin_prueba: 0 };
  for (const f of filas) conteo[f.estado]++;
  const cumplen = filas.filter((f) => cumpleSeguridadElectrica(f.estado)).length;
  return { filas, conteo, total: filas.length, cumplen, periodicidadMeses, hoy };
}

/** «Al día» en porcentaje entero; sin equipos → null. */
export const porcentajeAlDia = (t: { total: number; cumplen: number }): number | null =>
  t.total > 0 ? Math.round((t.cumplen / t.total) * 100) : null;
