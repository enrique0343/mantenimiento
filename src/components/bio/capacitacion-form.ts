// Fase 59 · WP-D: script del formulario de capacitación. Filtra y marca equipos (también
// «los del mismo modelo»), muestra la vista previa de asistentes con el mismo lector que
// usa el servidor, guarda y sube la lista firmada. Solo navegador; nada de innerHTML con datos.
import { normalizarTexto } from "@/lib/biomedico";
import { leerAsistentes, validarCapacitacion } from "@/lib/capacitaciones";
import { SIN_RED, control, errorDe, mostrar, pedir, revisarArchivo, selectDe, subirArchivo } from "./bio-ui";

const montados = new WeakSet<Element>();
const MAX_MARCAR = 200;

export function instalarCapacitacionForm(): void {
  document.querySelectorAll<HTMLFormElement>("form[data-capacitacion-form]").forEach((form) => {
    if (montados.has(form)) return;
    montados.add(form);
    instalar(form);
  });
}

function celda(texto: string): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "px-2 py-1";
  td.textContent = texto;
  return td;
}

function instalar(form: HTMLFormElement): void {
  const el = <T extends Element>(sel: string) => form.querySelector<T>(sel);
  const valor = (nombre: string) => (control(form, `[name="${nombre}"]`)?.value ?? "").trim();
  const msg = el<HTMLElement>("[data-msg]");
  const guardar = el<HTMLButtonElement>("[data-guardar]");
  const modo = form.dataset.modo ?? "nueva";
  const area = form.dataset.area ?? "";

  // ── Instructor interno o externo ──
  const ajustarInstructor = () => {
    const externo = el<HTMLInputElement>("[name=instructorTipo]:checked")?.value === "externo";
    form.querySelectorAll<HTMLElement>("[data-solo-externo]").forEach((d) => d.classList.toggle("hidden", !externo));
  };
  form.querySelectorAll("[name=instructorTipo]").forEach((r) => r.addEventListener("change", ajustarInstructor));
  ajustarInstructor();

  // ── Equipos ──
  const filas = Array.from(form.querySelectorAll<HTMLElement>("[data-equipo]"));
  const casilla = (f: HTMLElement) => f.querySelector<HTMLInputElement>("input[type=checkbox]")!;
  const textos = new Map(filas.map((f) => [f, normalizarTexto(f.dataset.texto)]));
  const filtroSede = selectDe(form, "[data-filtro-sede]");
  const filtroTexto = el<HTMLInputElement>("[data-filtro-texto]");
  const fichas = el<HTMLElement>("[data-fichas]");
  const estado = el<HTMLElement>("[data-equipos-estado]");
  const mismoModelo = el<HTMLButtonElement>("[data-mismo-modelo]");
  const visibles = () => filas.filter((f) => !f.classList.contains("hidden"));

  const filtrar = () => {
    const sede = filtroSede?.value ?? "";
    const q = normalizarTexto(filtroTexto?.value);
    for (const f of filas) {
      const ok = (!sede || f.dataset.sede === sede) && (!q || (textos.get(f) ?? "").includes(q));
      f.classList.toggle("hidden", !ok);
    }
  };
  const pendientesMismoModelo = () => {
    const modelos = new Set(filas.filter((f) => casilla(f).checked && f.dataset.modelo).map((f) => f.dataset.modelo!));
    return filas.filter((f) => !casilla(f).checked && f.dataset.modelo && modelos.has(f.dataset.modelo));
  };
  const actualizar = () => {
    const marcadas = filas.filter((f) => casilla(f).checked);
    if (fichas) {
      fichas.replaceChildren(...marcadas.map((f) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "badge bg-brand-50 text-brand-700";
        b.title = "Quitar";
        b.textContent = `${casilla(f).dataset.codigo ?? ""} ✕`;
        b.addEventListener("click", () => { casilla(f).checked = false; actualizar(); });
        return b;
      }));
    }
    if (estado) estado.textContent = marcadas.length ? `${marcadas.length} equipo${marcadas.length === 1 ? "" : "s"} elegido${marcadas.length === 1 ? "" : "s"}` : "Ningún equipo elegido";
    const pendientes = pendientesMismoModelo();
    if (mismoModelo) {
      mismoModelo.classList.toggle("hidden", pendientes.length === 0);
      mismoModelo.textContent = pendientes.length === 1
        ? "Agregar el otro equipo del mismo modelo"
        : `Agregar los ${pendientes.length} equipos del mismo modelo`;
    }
  };
  filtroSede?.addEventListener("change", filtrar);
  filtroTexto?.addEventListener("input", filtrar);
  filas.forEach((f) => casilla(f).addEventListener("change", actualizar));
  el("[data-marcar-filtrados]")?.addEventListener("click", () => {
    const lista = visibles();
    lista.slice(0, MAX_MARCAR).forEach((f) => { casilla(f).checked = true; });
    actualizar();
    if (lista.length > MAX_MARCAR && estado) estado.textContent += ` · se marcaron los primeros ${MAX_MARCAR}; filtra más para marcar el resto.`;
  });
  mismoModelo?.addEventListener("click", () => {
    pendientesMismoModelo().forEach((f) => { casilla(f).checked = true; });
    actualizar();
  });
  actualizar();

  // ── Asistentes: vista previa con el mismo lector del servidor ──
  const asistentes = el<HTMLTextAreaElement>("[name=asistentesTexto]");
  const conteo = el<HTMLElement>("[data-asistentes-conteo]");
  const errores = el<HTMLElement>("[data-asistentes-errores]");
  const vista = el<HTMLElement>("[data-asistentes-vista]");
  const cuerpo = el<HTMLElement>("[data-asistentes-filas]");
  let hayErrores = false;
  const previa = () => {
    const r = leerAsistentes(asistentes?.value ?? "");
    hayErrores = r.errores.length > 0;
    if (conteo) conteo.textContent = r.asistentes.length ? `${r.asistentes.length} asistente${r.asistentes.length === 1 ? "" : "s"}` : "Sin asistentes todavía.";
    if (errores) {
      errores.replaceChildren(...r.errores.map((t) => { const li = document.createElement("li"); li.textContent = t; return li; }));
      errores.classList.toggle("hidden", !hayErrores);
    }
    if (cuerpo) {
      cuerpo.replaceChildren(...r.asistentes.map((a, i) => {
        const tr = document.createElement("tr");
        for (const t of [String(i + 1), a.nombre, a.cargo ?? "—", a.servicio ?? "—"]) tr.appendChild(celda(t));
        return tr;
      }));
    }
    vista?.classList.toggle("hidden", r.asistentes.length === 0);
    if (guardar) guardar.disabled = hayErrores;
  };
  let espera: number | undefined;
  asistentes?.addEventListener("input", () => { window.clearTimeout(espera); espera = window.setTimeout(previa, 250); });
  previa();

  el("[data-cancelar]")?.addEventListener("click", () => {
    form.classList.add("hidden");
    document.querySelectorAll<HTMLElement>("[data-ver-capacitacion]").forEach((d) => d.classList.remove("hidden"));
  });

  // ── Guardar ──
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    previa();
    if (hayErrores) { mostrar(msg, "Revisa la lista de asistentes."); return; }
    const entrada = {
      fecha: valor("fecha"), tema: valor("tema"), tipo: valor("tipo"),
      instructorTipo: el<HTMLInputElement>("[name=instructorTipo]:checked")?.value ?? "",
      instructorNombre: valor("instructorNombre"), proveedorId: valor("proveedorId"), instructorEntidad: valor("instructorEntidad"),
      equipoIds: filas.filter((f) => casilla(f).checked).map((f) => Number(casilla(f).value)),
      modeloCubierto: valor("modeloCubierto"), duracionMinutos: valor("duracionMinutos"), sucursalId: valor("sucursalId"),
      lugar: valor("lugar"), servicio: valor("servicio"), notas: el<HTMLTextAreaElement>("[name=notas]")?.value ?? "",
      asistentesTexto: asistentes?.value ?? "",
    };
    const v = validarCapacitacion(entrada);
    if (!v.ok) { mostrar(msg, v.error); return; }
    const listas = Array.from(el<HTMLInputElement>("[name=listas]")?.files ?? []);
    for (const f of listas) {
      const problema = revisarArchivo(f);
      if (problema) { mostrar(msg, `«${f.name}»: ${problema}`); return; }
    }
    if (guardar) guardar.disabled = true;
    mostrar(msg, "Guardando…", true);
    const editar = modo === "editar";
    const res = await pedir(editar ? `/api/capacitaciones/${form.dataset.id}` : "/api/capacitaciones", {
      method: editar ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(entrada),
    });
    if (!res?.ok) {
      if (guardar) guardar.disabled = false;
      mostrar(msg, res ? await errorDe(res, "No se pudo guardar la capacitación.") : SIN_RED);
      return;
    }
    const j = (await res.json().catch(() => null)) as { capacitacion?: { id?: number } } | null;
    const id = j?.capacitacion?.id ?? Number(form.dataset.id);
    const destino = `/capacitaciones/${id}${area ? `?area=${encodeURIComponent(area)}` : ""}`;
    const fallidas: string[] = [];
    for (const [i, f] of listas.entries()) {
      mostrar(msg, `Subiendo la lista firmada (${i + 1} de ${listas.length})…`, true);
      const r = await subirArchivo(`/api/capacitaciones/${id}/archivos`, f, "lista_firmada");
      if (!r.ok) fallidas.push(`«${f.name}»: ${r.error}`);
    }
    if (fallidas.length) {
      mostrar(msg, `La capacitación se guardó, pero no se subió: ${fallidas.join(" ")} Ábrela y súbelo de nuevo.`);
      const enlace = document.createElement("a");
      enlace.href = destino;
      enlace.className = "ml-1 font-semibold underline";
      enlace.textContent = "Abrir la capacitación";
      msg?.appendChild(enlace);
      return;
    }
    if (editar) location.reload();
    else location.href = destino;
  });
}
