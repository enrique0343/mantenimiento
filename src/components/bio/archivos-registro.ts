// Fase 59 · WP-D: acciones de las páginas de una licencia y de una capacitación:
// mostrar el formulario de edición, anular, eliminar el registro, subir y eliminar
// archivos. Datos en atributos data-*. Solo navegador.
import { SIN_RED, confirmar, errorDe, mostrar, pedir, revisarArchivo, selectDe, subirArchivo } from "./bio-ui";

const montadas = new WeakSet<Element>();

function aviso(texto: string): void {
  if (window.showToast) window.showToast(texto, "error");
  else window.alert(texto);
}

/**
 * Raíz con data-registro-api="/api/licencias/7" (o /api/capacitaciones/7) y
 * data-registro-lista="/licencias" (a dónde ir después de eliminar).
 */
export function instalarAccionesRegistro(): void {
  document.querySelectorAll<HTMLElement>("[data-registro-api]").forEach((raiz) => {
    if (montadas.has(raiz)) return;
    montadas.add(raiz);
    instalar(raiz);
  });
}

function instalar(raiz: HTMLElement): void {
  const api = raiz.dataset.registroApi ?? "";
  const lista = raiz.dataset.registroLista ?? "/";

  // Editar: muestra el formulario y oculta la hoja.
  raiz.querySelectorAll("[data-editar]").forEach((b) => b.addEventListener("click", () => {
    const form = document.querySelector<HTMLElement>("[data-licencia-form], [data-capacitacion-form]");
    if (!form) return;
    form.classList.remove("hidden");
    document.querySelectorAll<HTMLElement>("[data-ver-licencia], [data-ver-capacitacion]").forEach((d) => d.classList.add("hidden"));
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }));

  // Anular con motivo.
  const formAnular = raiz.querySelector<HTMLFormElement>("[data-anular-form]");
  raiz.querySelector("[data-anular]")?.addEventListener("click", () => {
    formAnular?.classList.toggle("hidden");
    formAnular?.querySelector<HTMLInputElement>("[name=motivo]")?.focus();
  });
  formAnular?.querySelector("[data-anular-cancelar]")?.addEventListener("click", () => formAnular.classList.add("hidden"));
  formAnular?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const p = formAnular.querySelector<HTMLElement>("[data-msg]");
    const motivo = (formAnular.querySelector<HTMLInputElement>("[name=motivo]")?.value ?? "").trim();
    if (motivo.length < 5) { mostrar(p, "Escribe el motivo (al menos 5 letras)."); return; }
    const boton = formAnular.querySelector<HTMLButtonElement>("button[type=submit]");
    if (boton) boton.disabled = true;
    const res = await pedir(api, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ accion: "anular", motivo }) });
    if (res?.ok) { location.reload(); return; }
    if (boton) boton.disabled = false;
    mostrar(p, res ? await errorDe(res, "No se pudo anular.") : SIN_RED);
  });

  // Eliminar el registro completo.
  raiz.querySelector<HTMLButtonElement>("[data-eliminar]")?.addEventListener("click", async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    if (!(await confirmar(b.dataset.titulo ?? "¿Eliminar?", b.dataset.mensaje ?? "No se puede deshacer."))) return;
    b.disabled = true;
    const res = await pedir(api, { method: "DELETE" });
    if (res?.ok) { location.href = lista; return; }
    b.disabled = false;
    aviso(res ? await errorDe(res, "No se pudo eliminar.") : SIN_RED);
  });

  // Subir un archivo con su categoría.
  const formArchivo = raiz.querySelector<HTMLFormElement>("[data-archivo-form]");
  raiz.querySelector("[data-archivo-abrir]")?.addEventListener("click", () => formArchivo?.classList.toggle("hidden"));
  formArchivo?.querySelector("[data-archivo-cancelar]")?.addEventListener("click", () => formArchivo.classList.add("hidden"));
  formArchivo?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const p = formArchivo.querySelector<HTMLElement>("[data-msg]");
    const archivos = Array.from(formArchivo.querySelector<HTMLInputElement>("[name=file]")?.files ?? []);
    const categoria = selectDe(formArchivo, "[name=categoria]")?.value ?? "";
    if (!archivos.length) { mostrar(p, "Elige un archivo."); return; }
    for (const f of archivos) {
      const problema = revisarArchivo(f);
      if (problema) { mostrar(p, `«${f.name}»: ${problema}`); return; }
    }
    const boton = formArchivo.querySelector<HTMLButtonElement>("button[type=submit]");
    if (boton) boton.disabled = true;
    const fallas: string[] = [];
    for (const [i, f] of archivos.entries()) {
      mostrar(p, `Subiendo ${i + 1} de ${archivos.length}…`, true);
      const r = await subirArchivo(`${api}/archivos`, f, categoria);
      if (!r.ok) fallas.push(`«${f.name}»: ${r.error}`);
    }
    if (!fallas.length) { location.reload(); return; }
    if (boton) boton.disabled = false;
    mostrar(p, fallas.length < archivos.length ? `Se subieron algunos, pero no: ${fallas.join(" ")} Recarga la página para verlos.` : fallas.join(" "));
  });

  // Eliminar un archivo.
  raiz.querySelectorAll<HTMLButtonElement>("[data-archivo-eliminar]").forEach((b) => b.addEventListener("click", async () => {
    if (!(await confirmar("¿Eliminar este archivo?", `«${b.dataset.nombre ?? ""}». No se puede deshacer.`))) return;
    b.disabled = true;
    const res = await pedir(`${api}/archivos?archivoId=${encodeURIComponent(b.dataset.id ?? "")}`, { method: "DELETE" });
    if (res?.ok) { location.reload(); return; }
    b.disabled = false;
    aviso(res ? await errorDe(res, "No se pudo eliminar el archivo.") : SIN_RED);
  }));
}
