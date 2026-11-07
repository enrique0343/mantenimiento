import type { APIContext } from "astro";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getCurrentUser } from "./auth";
import { getDb } from "./db";
import { activos, modelosAire, modelosAireHistorial, sucursales, ubicaciones } from "./schema";

export const CATALOGO_AIRES_GESTORES = ["admin", "tecnico"] as const;
type Context = APIContext | { locals: App.Locals };
type Actor = { id: number; nombre: string };
const identificador = z.number().int().positive().safe();
const texto = (max: number) => z.string().trim().toUpperCase().max(max).nullable().optional();
export const datosTecnicosModeloAireSchema = z.object({
  tipoUnidad: texto(200),
  capacidadBtuH: z.number().finite().positive().max(10000000).nullable().optional(),
  refrigerante: texto(200),
}).strict().nullable().optional();
const camposModelo = {
  nombre: z.string().trim().toUpperCase().min(1).max(200),
  descripcion: texto(2000), categoria: texto(200), marca: texto(200), modelo: texto(200),
  datosTecnicos: datosTecnicosModeloAireSchema,
};
export const modeloAireCrearSchema = z.object(camposModelo).strict();
export const modeloAireEditarSchema = z.object(camposModelo).partial().extend({
  version: identificador, activo: z.boolean().optional(),
}).strict().refine(value => Object.keys(value).some(key => key !== "version"), "Indica qué dato deseas cambiar");
type NuevoModelo = z.infer<typeof modeloAireCrearSchema>;
type CambiosModelo = z.infer<typeof modeloAireEditarSchema>;

export class CatalogoAireError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = "CatalogoAireError"; }
}
export function modeloAireId(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new CatalogoAireError("Identificador de ficha inválido");
  }
  return Number(value);
}
function mensajesError(error: unknown): string {
  const mensajes: string[] = [];
  let current = error;
  for (let i = 0; i < 6 && current instanceof Error; i++) {
    mensajes.push(current.message);
    current = current.cause;
  }
  return mensajes.join("\n");
}
export function errorCatalogoAire(error: unknown): CatalogoAireError | null {
  if (error instanceof CatalogoAireError) return error;
  const mensaje = mensajesError(error);
  if (mensaje.includes("UNIQUE constraint failed") && /modelos_aire\.(nombre)|modelos_aire_nombre_normalizado_idx/.test(mensaje)) {
    return new CatalogoAireError("Ya existe una ficha con ese nombre. Revisa también las fichas archivadas.", 409);
  }
  if (/CATALOGO_AIRES_DESACTUALIZADO|CATALOGO_AIRES_VERSION_INVALIDA/.test(mensaje)) {
    return new CatalogoAireError("La ficha cambió o fue archivada. Actualiza la página y vuelve a seleccionarla.", 409);
  }
  if (/CATALOGO_AIRES_VINCULO_INVALIDO|CATALOGO_AIRES_ORIGEN_INMUTABLE/.test(mensaje)) {
    return new CatalogoAireError("La ficha de origen debe conservarse y solo corresponde a aires acondicionados.", 409);
  }
  return null;
}
export function respuestaErrorCatalogoAire(error: unknown): Response {
  const conocido = errorCatalogoAire(error);
  if (conocido) return Response.json({ error: conocido.message }, { status: conocido.status });
  console.error("Error al consultar el catálogo de aires:", error);
  return Response.json({ error: "No se pudo completar la operación. Vuelve a intentarlo." }, { status: 500 });
}
async function lector(ctx: Context) {
  const user = ctx.locals.user ?? ("request" in ctx ? await getCurrentUser(ctx as APIContext) : null);
  if (!user) throw new CatalogoAireError("Inicia sesión para consultar el catálogo", 401);
  return user;
}
function datosParaGuardar(value: NuevoModelo["datosTecnicos"]): string | null {
  if (!value) return null;
  const entries = Object.entries(value).filter(([, v]) => v != null && v !== "");
  return entries.length ? JSON.stringify(Object.fromEntries(entries)) : null;
}
export function modeloAireDto(row: typeof modelosAire.$inferSelect) {
  return { ...row, datosTecnicos: row.datosTecnicos ? JSON.parse(row.datosTecnicos) as Exclude<NuevoModelo["datosTecnicos"], undefined | null> : null };
}
export type ModeloAire = ReturnType<typeof modeloAireDto>;
export function snapshotModeloAire(row: ModeloAire) {
  return { id: row.id, version: row.version, nombre: row.nombre, descripcion: row.descripcion,
    categoria: row.categoria, marca: row.marca, modelo: row.modelo, datosTecnicos: row.datosTecnicos };
}

export async function getModelosAire(ctx: Context, incluirArchivados = false) {
  await lector(ctx);
  return (await getDb(ctx).select().from(modelosAire)
    .where(incluirArchivados ? undefined : eq(modelosAire.activo, true)).orderBy(asc(modelosAire.nombre))).map(modeloAireDto);
}
export async function getModeloAireDetalle(ctx: Context, id: number) {
  await lector(ctx);
  const db = getDb(ctx);
  const [row] = await db.select().from(modelosAire).where(eq(modelosAire.id, id)).limit(1);
  if (!row) return null;
  const [unidades, historial] = await Promise.all([
    db.select({ id: activos.id, codigo: activos.codigo, nombre: activos.nombre, serial: activos.serial,
      ubicacion: activos.ubicacion, ubicacionNombre: ubicaciones.nombre, sucursalNombre: sucursales.nombre,
      estado: activos.estado }).from(activos).leftJoin(ubicaciones, eq(activos.ubicacionId, ubicaciones.id))
      .leftJoin(sucursales, eq(ubicaciones.sucursalId, sucursales.id)).where(eq(activos.modeloAireId, id)).orderBy(desc(activos.id)),
    db.select().from(modelosAireHistorial).where(eq(modelosAireHistorial.modeloAireId, id)).orderBy(desc(modelosAireHistorial.version)),
  ]);
  return { modelo: modeloAireDto(row), unidades: unidades.map(({ ubicacionNombre, sucursalNombre, ...unidad }) => ({
    ...unidad, ubicacion: [...new Set([sucursalNombre, ubicacionNombre, unidad.ubicacion].filter(Boolean))].join(" · ") || null,
  })), historial: historial.map(evento => ({ ...evento, snapshot: JSON.parse(evento.snapshot) })) };
}
export async function crearModeloAire(ctx: Context, actor: Actor, values: NuevoModelo) {
  const fecha = new Date().toISOString();
  const [row] = await getDb(ctx).insert(modelosAire).values({
    ...values, datosTecnicos: datosParaGuardar(values.datosTecnicos),
    creadoPor: actor.id, creadoPorNombre: actor.nombre, actualizadoPor: actor.id, actualizadoPorNombre: actor.nombre,
    createdAt: fecha, updatedAt: fecha,
  }).returning();
  return { modelo: modeloAireDto(row) };
}
export async function editarModeloAire(ctx: Context, actor: Actor, id: number, values: CambiosModelo) {
  const db = getDb(ctx);
  const { version, datosTecnicos, ...campos } = values;
  const [row] = await db.update(modelosAire).set({
    ...campos,
    ...(datosTecnicos !== undefined ? { datosTecnicos: datosParaGuardar(datosTecnicos) } : {}),
    version: version + 1, actualizadoPor: actor.id, actualizadoPorNombre: actor.nombre, updatedAt: new Date().toISOString(),
  }).where(and(eq(modelosAire.id, id), eq(modelosAire.version, version))).returning();
  if (!row) {
    const [existe] = await db.select({ id: modelosAire.id }).from(modelosAire).where(eq(modelosAire.id, id)).limit(1);
    throw new CatalogoAireError(existe ? "Otra persona modificó la ficha. Actualiza la página antes de guardar." : "Ficha no encontrada", existe ? 409 : 404);
  }
  return { modelo: modeloAireDto(row) };
}

/** Checks early for a useful error; the database trigger repeats the check at insertion. */
export async function modeloAireParaAlta(ctx: Context, id: number, version: number): Promise<ModeloAire> {
  const [row] = await getDb(ctx).select().from(modelosAire).where(eq(modelosAire.id, id)).limit(1);
  if (!row) throw new CatalogoAireError("La ficha seleccionada no existe", 404);
  if (!row.activo) throw new CatalogoAireError("La ficha está archivada. Selecciona una ficha activa.", 409);
  if (row.version !== version) throw new CatalogoAireError("La ficha cambió. Actualiza la página y vuelve a seleccionarla.", 409);
  return modeloAireDto(row);
}
