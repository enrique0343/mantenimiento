// Fase 59 · WP-D: archivos de documentos, licencias y capacitaciones (R2) y
// respuestas de error de sus APIs. Servidor.
//
// Una sola forma de recibir, guardar y servir un archivo: el tipo se decide por
// el contenido (no por la extensión ni por lo que dice el navegador), se guarda
// el tipo detectado y al servir siempre va `nosniff`. Así un HTML renombrado a
// .pdf no se guarda, y un archivo viejo con otro tipo sale como descarga.
import type { APIContext } from "astro";
import { requireUser } from "./auth";
import type { Rol } from "./schema";
import {
  ARCHIVO_MAX_BYTES, contentDisposition, esTipoArchivoPermitido, nombreSeguroR2, validarArchivo, type TipoArchivo,
} from "./biomedico";

/** Error de la API: siempre `{ error: "texto" }`. */
export const errorJson = (status: number, error: string): Response => Response.json({ error }, { status });

/** requireUser con el error en JSON y en español: 401 sin sesión, 403 fuera de rol. */
export async function exigirRol(ctx: APIContext, roles: Rol[], sinPermiso = "No tienes permiso para esta acción.") {
  const r = await requireUser(ctx, roles);
  if (!r.user) {
    const status = r.response.status;
    return { user: null as null, response: errorJson(status, status === 401 ? "Tu sesión terminó. Vuelve a iniciar sesión." : sinPermiso) };
  }
  return { user: r.user, response: null as null };
}

/** Id entero positivo de la ruta o de un campo; cualquier otra cosa → null. */
export function idPositivo(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(String(valor).trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** JSON del cuerpo; si no es un objeto → null. */
export async function leerJson(ctx: APIContext): Promise<Record<string, unknown> | null> {
  const body: unknown = await ctx.request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

export type ArchivoLeido =
  | { ok: true; file: File; nombre: string; datos: ArrayBuffer; contentType: TipoArchivo; tamano: number }
  | { ok: false; status: 400 | 413 | 415; error: string };

/**
 * El archivo del formulario, ya revisado: sin archivo → 400 «Elige un archivo.»; vacío → 400;
 * más de 15 MB → 413 (sin leerlo); tipo real que no es PDF, JPG, PNG ni WEBP → 415.
 */
export async function leerArchivoDelFormulario(form: FormData | null, campo = "file"): Promise<ArchivoLeido> {
  const file = form?.get(campo) ?? null;
  if (!file || typeof file === "string") return { ok: false, status: 400, error: "Elige un archivo." };
  if (!(file.size > 0) || file.size > ARCHIVO_MAX_BYTES) {
    const previo = validarArchivo({ tamano: file.size, cabecera: new Uint8Array(0) });
    if (!previo.ok) return previo;
  }
  const datos = await file.arrayBuffer();
  const v = validarArchivo({ tamano: datos.byteLength, cabecera: new Uint8Array(datos, 0, Math.min(1024, datos.byteLength)) });
  if (!v.ok) return v;
  return { ok: true, file, nombre: nombreVisible(file.name, v.extension), datos, contentType: v.contentType, tamano: datos.byteLength };
}

/** Nombre que se guarda y se muestra: sin caracteres de control ni rutas, hasta 200 caracteres. */
export function nombreVisible(nombre: string | null | undefined, extension: string): string {
  const limpio = String(nombre ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").split(/[\\/]/).pop()!.replace(/\s+/g, " ").trim();
  if (!limpio) return `archivo.${extension}`;
  return limpio.length > 200 ? limpio.slice(limpio.length - 200) : limpio;
}

/** Guarda en R2 con el tipo detectado; clave `<prefijo>/<ms>-<uuid>-<nombre seguro>`. */
export async function guardarArchivoR2(env: Env, prefijo: string, nombre: string, datos: ArrayBuffer, contentType: TipoArchivo): Promise<string> {
  const clave = `${prefijo}/${Date.now()}-${crypto.randomUUID()}-${nombreSeguroR2(nombre)}`;
  await env.R2.put(clave, datos, { httpMetadata: { contentType } });
  return clave;
}

/** Borra de R2 sin fallar: un archivo suelto no debe cortar la operación. */
export async function borrarArchivoR2(env: Env, r2Key: string | null | undefined): Promise<void> {
  if (!r2Key) return;
  try { await env.R2.delete(r2Key); } catch { /* queda suelto en R2 */ }
}

/**
 * Sirve un archivo guardado. En línea solo los cuatro tipos permitidos; cualquier otro
 * (datos viejos) sale como descarga `application/octet-stream`. Siempre `nosniff`.
 */
export async function respuestaArchivo(env: Env, a: { r2Key: string; nombre: string; contentType: string | null }): Promise<Response> {
  const obj = await env.R2.get(a.r2Key).catch(() => null);
  if (!obj) return errorJson(404, "Archivo no encontrado");
  const tipo = String(a.contentType ?? "").split(";")[0].trim().toLowerCase();
  const permitido = esTipoArchivoPermitido(tipo);
  return new Response(await obj.arrayBuffer(), {
    headers: {
      "content-type": permitido ? tipo : "application/octet-stream",
      "content-disposition": contentDisposition(a.nombre, permitido ? "inline" : "attachment"),
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
    },
  });
}
