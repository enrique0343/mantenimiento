// Fase 59 · WP-D: piezas comunes de los scripts del navegador de documentos,
// licencias y capacitaciones. Solo navegador.
import { ARCHIVO_MAX_BYTES } from "@/lib/biomedico";

/** El texto de `error` que manda el servidor o, si no viene, el de respaldo. */
export async function errorDe(res: Response, respaldo: string): Promise<string> {
  const j = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return j && typeof j.error === "string" && j.error ? j.error : respaldo;
}

/** Confirmación con el diálogo de la app (o el del navegador si no está). */
export async function confirmar(titulo: string, mensaje: string, etiqueta = "Eliminar"): Promise<boolean> {
  if (window.confirmAction) return window.confirmAction(titulo, mensaje, { danger: true, confirmLabel: etiqueta });
  return window.confirm(`${titulo}\n\n${mensaje}`);
}

/** Muestra un mensaje (rojo si es error) en un párrafo; vacío lo oculta. */
export function mostrar(p: HTMLElement | null, texto: string, ok = false): void {
  if (!p) return;
  p.textContent = texto;
  p.classList.toggle("hidden", !texto);
  p.classList.toggle("text-red-600", !ok);
  p.classList.toggle("text-emerald-700", ok);
}

const EXTENSIONES = /\.(pdf|jpe?g|png|webp)$/i;

/** Revisión en el navegador antes de subir: el servidor vuelve a revisar el contenido. */
export function revisarArchivo(f: File | null | undefined): string | null {
  if (!f) return "Elige un archivo.";
  if (!(f.size > 0)) return "El archivo está vacío.";
  if (f.size > ARCHIVO_MAX_BYTES) return "El archivo pesa más de 15 MB. Comprímelo o divídelo en partes.";
  if (!EXTENSIONES.test(f.name)) return "Solo se aceptan archivos PDF o fotos (JPG, PNG o WEBP).";
  return null;
}

/** Sube un archivo como multipart a `url` con su categoría. */
export async function subirArchivo(url: string, archivo: File, categoria: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const fd = new FormData();
  fd.append("file", archivo);
  fd.append("categoria", categoria);
  try {
    const res = await fetch(url, { method: "POST", body: fd });
    if (res.ok) return { ok: true };
    return { ok: false, error: await errorDe(res, "No se pudo subir el archivo.") };
  } catch {
    return { ok: false, error: "Sin conexión. Revisa la señal e intenta de nuevo." };
  }
}

// workers-types declara su propio `Element` (HTMLRewriter) y choca con el del DOM en
// HTMLSelectElement: los controles se buscan como `unknown` y se reconocen con instanceof.
type ConQuerySelector = { querySelector(selector: string): unknown } | null | undefined;

/** Un input, select o textarea dentro de `raiz`. */
export function control(raiz: ConQuerySelector, selector: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null {
  const c: unknown = raiz?.querySelector(selector);
  return c instanceof HTMLInputElement || c instanceof HTMLSelectElement || c instanceof HTMLTextAreaElement ? c : null;
}

/** Un select dentro de `raiz`. */
export function selectDe(raiz: ConQuerySelector, selector: string): HTMLSelectElement | null {
  const c: unknown = raiz?.querySelector(selector);
  return c instanceof HTMLSelectElement ? c : null;
}

/** fetch que no lanza: si no hay red, devuelve null. */
export async function pedir(url: string, init?: RequestInit): Promise<Response | null> {
  try { return await fetch(url, init); } catch { return null; }
}

export const SIN_RED = "Sin conexión. Revisa la señal e intenta de nuevo.";
