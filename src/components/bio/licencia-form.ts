// Fase 59 · WP-D: script del formulario de licencia (registrar, editar, renovar).
// Muestra solo los campos del ámbito elegido, revisa con validarLicencia, guarda y,
// si hay archivo, lo sube después. Solo navegador.
import { validarLicencia } from "@/lib/licencias";
import { SIN_RED, control, errorDe, mostrar, pedir, revisarArchivo, selectDe, subirArchivo } from "./bio-ui";

const montados = new WeakSet<Element>();

export function instalarLicenciaForm(): void {
  document.querySelectorAll<HTMLFormElement>("form[data-licencia-form]").forEach((form) => {
    if (montados.has(form)) return;
    montados.add(form);
    instalar(form);
  });
}

/** URL de la licencia conservando el área de la página (si viene). */
function urlLicencia(id: number | string, area: string): string {
  return `/licencias/${id}${area ? `?area=${encodeURIComponent(area)}` : ""}`;
}

function instalar(form: HTMLFormElement): void {
  const el = <T extends Element>(sel: string) => form.querySelector<T>(sel);
  const valor = (nombre: string) => (control(form, `[name="${nombre}"]`)?.value ?? "").trim();
  const entidad = selectDe(form, "[name=entidad]");
  const ambito = selectDe(form, "[name=ambito]");
  const vence = el<HTMLInputElement>("[name=fechaVencimiento]");
  const noVence = el<HTMLInputElement>("[name=noVence]");
  const msg = el<HTMLElement>("[data-msg]");
  const guardar = el<HTMLButtonElement>("[data-guardar]");
  const modo = form.dataset.modo ?? "nueva";
  const area = form.dataset.area ?? "";

  const ajustar = () => {
    el<HTMLElement>("[data-solo-entidad-otra]")?.classList.toggle("hidden", entidad?.value !== "otra");
    const a = ambito?.value ?? "";
    form.querySelectorAll<HTMLElement>("[data-ambitos]").forEach((d) => d.classList.toggle("hidden", !(d.dataset.ambitos ?? "").split(" ").includes(a)));
    el<HTMLElement>("[data-sede-obligatoria]")?.classList.toggle("hidden", a === "persona");
    if (vence && noVence) {
      vence.disabled = noVence.checked;
      if (noVence.checked) vence.value = "";
    }
  };
  entidad?.addEventListener("change", ajustar);
  ambito?.addEventListener("change", ajustar);
  noVence?.addEventListener("change", ajustar);
  ajustar();

  el("[data-cancelar]")?.addEventListener("click", () => {
    form.classList.add("hidden");
    document.querySelectorAll<HTMLElement>("[data-ver-licencia]").forEach((d) => d.classList.remove("hidden"));
  });

  const equipoId = (): number | null => {
    const texto = valor("equipoTexto");
    if (!texto) return null;
    const opcion = Array.from(el<HTMLDataListElement>("datalist[data-equipos]")?.options ?? []).find((o) => o.value === texto);
    const id = Number(opcion?.dataset.id);
    return Number.isInteger(id) && id > 0 ? id : null;
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const entrada: Record<string, unknown> = {
      entidad: valor("entidad"), entidadOtra: valor("entidadOtra"), tipo: valor("tipo"), nombre: valor("nombre"),
      numero: valor("numero"), ambito: valor("ambito"), sucursalId: valor("sucursalId"), servicio: valor("servicio"),
      activoId: equipoId(), titular: valor("titular"), fechaEmision: valor("fechaEmision"),
      fechaVencimiento: valor("fechaVencimiento"), noVence: !!noVence?.checked, responsableId: valor("responsableId"),
      estado: valor("estado"), notas: el<HTMLTextAreaElement>("[name=notas]")?.value ?? "",
    };
    const v = validarLicencia(entrada, { modo: modo === "editar" ? "editar" : "crear", estadoActual: form.dataset.estadoActual || null });
    if (!v.ok) { mostrar(msg, v.error); return; }
    const archivo = el<HTMLInputElement>("[name=file]")?.files?.[0] ?? null;
    if (archivo) {
      const problema = revisarArchivo(archivo);
      if (problema) { mostrar(msg, problema); return; }
    }
    if (modo === "renovar" && form.dataset.reemplaza) entrada.reemplazaAId = Number(form.dataset.reemplaza);

    if (guardar) guardar.disabled = true;
    mostrar(msg, "Guardando…", true);
    const editar = modo === "editar";
    const res = await pedir(editar ? `/api/licencias/${form.dataset.id}` : "/api/licencias", {
      method: editar ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(entrada),
    });
    if (!res?.ok) {
      if (guardar) guardar.disabled = false;
      mostrar(msg, res ? await errorDe(res, "No se pudo guardar la licencia.") : SIN_RED);
      return;
    }
    const j = (await res.json().catch(() => null)) as { licencia?: { id?: number } } | null;
    const id = j?.licencia?.id ?? Number(form.dataset.id);
    if (archivo && id) {
      mostrar(msg, "Subiendo el archivo…", true);
      const subida = await subirArchivo(`/api/licencias/${id}/archivos`, archivo, v.datos.estado === "en_tramite" ? "constancia_tramite" : "licencia");
      if (!subida.ok) {
        mostrar(msg, `La licencia se guardó, pero el archivo no se subió: ${subida.error} Ábrela y súbelo de nuevo.`);
        const enlace = document.createElement("a");
        enlace.href = urlLicencia(id, area);
        enlace.className = "ml-1 font-semibold underline";
        enlace.textContent = "Abrir la licencia";
        msg?.appendChild(enlace);
        return;
      }
    }
    if (editar) location.reload();
    else location.href = urlLicencia(id, area);
  });
}
