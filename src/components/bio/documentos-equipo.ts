// Fase 59 · WP-D: script de la sección «Documentos del equipo» de la ficha.
// Subir, corregir datos, eliminar y marcar o quitar «No aplica» del expediente.
// Los datos vienen en atributos data-*; nada de innerHTML con datos.
import { leerMetadatosDocumento } from "@/lib/inventario-jci";
import { SIN_RED, confirmar, errorDe, mostrar, pedir, revisarArchivo, selectDe } from "./bio-ui";

const montadas = new WeakSet<Element>();

const AYUDA: Record<string, string> = {
  licencia: "Para que el sistema avise antes de que venza, regístrala también en Licencias y permisos.",
  capacitacion: "Para el registro completo (tema, instructor y asistentes) usa Capacitaciones.",
};

export function instalarDocumentosEquipo(): void {
  document.querySelectorAll<HTMLElement>("[data-bio-documentos]").forEach((seccion) => {
    if (montadas.has(seccion)) return;
    montadas.add(seccion);
    instalar(seccion);
  });
}

function instalar(seccion: HTMLElement): void {
  const activoId = seccion.dataset.activoId ?? "";
  const form = seccion.querySelector<HTMLFormElement>("[data-doc-form]");
  const campo = <T extends HTMLElement>(nombre: string) => form?.querySelector<T>(`[name="${nombre}"]`) ?? null;
  const archivo = campo<HTMLInputElement>("file");
  const categoria = selectDe(form, '[name="categoria"]');
  const version = campo<HTMLInputElement>("version");
  const fecha = campo<HTMLInputElement>("fechaDocumento");
  const vence = campo<HTMLInputElement>("fechaVencimiento");
  const nota = campo<HTMLInputElement>("nota");
  const titulo = form?.querySelector<HTMLElement>("[data-doc-form-titulo]") ?? null;
  const bloqueArchivo = form?.querySelector<HTMLElement>("[data-doc-campo-archivo]") ?? null;
  const guardar = form?.querySelector<HTMLButtonElement>("[data-doc-guardar]") ?? null;
  const msg = form?.querySelector<HTMLElement>("[data-doc-msg]") ?? null;
  const ayuda = form?.querySelector<HTMLElement>("[data-doc-ayuda]") ?? null;
  const opcionHeredada = categoria?.querySelector<HTMLOptionElement>("option[data-heredada]") ?? null;
  let editando: string | null = null;

  const mostrarAyuda = () => {
    const t = AYUDA[categoria?.value ?? ""] ?? "";
    if (ayuda) { ayuda.textContent = t; ayuda.classList.toggle("hidden", !t); }
  };
  categoria?.addEventListener("change", mostrarAyuda);

  const abrir = (modo: "nuevo" | "editar", datos: Partial<Record<"id" | "categoria" | "version" | "fecha" | "vence" | "nota" | "nombre", string>> = {}) => {
    if (!form) return;
    form.reset();
    mostrar(msg, "");
    editando = modo === "editar" ? datos.id ?? null : null;
    const heredada = modo === "editar" && datos.categoria === "manual";
    if (opcionHeredada) { opcionHeredada.hidden = !heredada; opcionHeredada.disabled = !heredada; }
    if (categoria) categoria.value = datos.categoria ?? "";
    if (version) version.value = datos.version ?? "";
    if (fecha) fecha.value = datos.fecha ?? "";
    if (vence) vence.value = datos.vence ?? "";
    if (nota) nota.value = datos.nota ?? "";
    bloqueArchivo?.classList.toggle("hidden", modo === "editar");
    if (titulo) titulo.textContent = modo === "editar" ? `Editar datos de «${datos.nombre ?? "documento"}»` : "Subir documento";
    if (guardar) guardar.textContent = modo === "editar" ? "Guardar cambios" : "Subir documento";
    mostrarAyuda();
    form.classList.remove("hidden");
    form.scrollIntoView({ behavior: "smooth", block: "nearest" });
    (modo === "editar" ? categoria : archivo)?.focus();
  };

  seccion.querySelector("[data-doc-abrir]")?.addEventListener("click", () => abrir("nuevo"));
  seccion.querySelectorAll<HTMLElement>("[data-doc-subir]").forEach((b) =>
    b.addEventListener("click", () => abrir("nuevo", { categoria: b.dataset.categoria ?? "" })));
  seccion.querySelectorAll<HTMLElement>("[data-doc-editar]").forEach((b) =>
    b.addEventListener("click", () => abrir("editar", { ...b.dataset })));
  form?.querySelector("[data-doc-cancelar]")?.addEventListener("click", () => { form.classList.add("hidden"); editando = null; });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const entrada = {
      categoria: categoria?.value ?? "", version: version?.value ?? "", fechaDocumento: fecha?.value ?? "",
      fechaVencimiento: vence?.value ?? "", nota: nota?.value ?? "",
    };
    const meta = leerMetadatosDocumento(entrada, { parcial: false });
    if (!meta.ok) { mostrar(msg, meta.error); return; }
    let res: Response | null;
    if (editando) {
      if (guardar) guardar.disabled = true;
      res = await pedir(`/api/activos/documento/${editando}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(entrada),
      });
    } else {
      const f = archivo?.files?.[0];
      const problema = revisarArchivo(f);
      if (problema || !f) { mostrar(msg, problema ?? "Elige un archivo."); return; }
      const fd = new FormData();
      fd.append("file", f);
      for (const [k, v] of Object.entries(entrada)) fd.append(k, v);
      if (guardar) guardar.disabled = true;
      mostrar(msg, "Subiendo…", true);
      res = await pedir(`/api/activos/${activoId}/documentos`, { method: "POST", body: fd });
    }
    if (res?.ok) { location.reload(); return; }
    if (guardar) guardar.disabled = false;
    mostrar(msg, res ? await errorDe(res, "No se pudo guardar el documento.") : SIN_RED);
  });

  seccion.querySelectorAll<HTMLButtonElement>("[data-doc-eliminar]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!(await confirmar("¿Eliminar este documento?", `«${b.dataset.nombre ?? ""}». No se puede deshacer.`))) return;
      b.disabled = true;
      const res = await pedir(`/api/activos/${activoId}/documentos?documentoId=${encodeURIComponent(b.dataset.id ?? "")}`, { method: "DELETE" });
      if (res?.ok) { location.reload(); return; }
      b.disabled = false;
      const texto = res ? await errorDe(res, "No se pudo eliminar el documento.") : SIN_RED;
      if (window.showToast) window.showToast(texto, "error"); else window.alert(texto);
    }));

  // «No aplica» de un requisito del expediente.
  seccion.querySelectorAll<HTMLElement>("[data-na-abrir]").forEach((b) =>
    b.addEventListener("click", () => {
      const f = seccion.querySelector<HTMLFormElement>(`[data-na-form="${b.dataset.requisito}"]`);
      f?.classList.toggle("hidden");
      f?.querySelector<HTMLInputElement>("[name=motivo]")?.focus();
    }));
  seccion.querySelectorAll<HTMLFormElement>("[data-na-form]").forEach((f) => {
    const p = f.querySelector<HTMLElement>("[data-na-msg]");
    f.querySelector("[data-na-cancelar]")?.addEventListener("click", () => f.classList.add("hidden"));
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const motivo = (f.querySelector<HTMLInputElement>("[name=motivo]")?.value ?? "").trim();
      if (motivo.length < 5) { mostrar(p, "Escribe el motivo (al menos 5 letras)."); return; }
      const boton = f.querySelector<HTMLButtonElement>("button[type=submit]");
      if (boton) boton.disabled = true;
      const res = await pedir(`/api/activos/${activoId}/expediente`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ requisito: f.dataset.naForm, motivo }),
      });
      if (res?.ok) { location.reload(); return; }
      if (boton) boton.disabled = false;
      mostrar(p, res ? await errorDe(res, "No se pudo guardar.") : SIN_RED);
    });
  });
  seccion.querySelectorAll<HTMLButtonElement>("[data-na-quitar]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!(await confirmar("¿Quitar «No aplica»?", `«${b.dataset.etiqueta ?? ""}» vuelve a ser requerido en el expediente.`, "Quitar"))) return;
      b.disabled = true;
      const res = await pedir(`/api/activos/${activoId}/expediente?requisito=${encodeURIComponent(b.dataset.requisito ?? "")}`, { method: "DELETE" });
      if (res?.ok) { location.reload(); return; }
      b.disabled = false;
      const texto = res ? await errorDe(res, "No se pudo quitar.") : SIN_RED;
      if (window.showToast) window.showToast(texto, "error"); else window.alert(texto);
    }));
}
