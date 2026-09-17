interface ModeloAire {
  id: number;
  version: number;
  nombre: string;
  descripcion?: string | null;
  categoria?: string | null;
  marca?: string | null;
  modelo?: string | null;
  datosTecnicos?: string | Record<string, unknown> | null;
}

const sharedFields = ["nombre", "descripcion", "categoria", "marca", "modelo", "tipoUnidad", "capacidadBtuH", "refrigerante"] as const;
const mounted = new WeakSet<Element>();

function technical(modelo: ModeloAire): Record<string, unknown> {
  try {
    const data = typeof modelo.datosTecnicos === "string" ? JSON.parse(modelo.datosTecnicos) : modelo.datosTecnicos;
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}

export function installModeloAireSelector() {
  const element = document.querySelector<HTMLElement>("#modeloAireSelector");
  if (!element || mounted.has(element)) return;
  const panel = element;
  mounted.add(panel);
  const form = panel.closest("form")!;
  const field = (id: string) => form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!;
  const selectField = (id: string) => {
    const control: unknown = form.querySelector(`#${id}`);
    if (!(control instanceof HTMLSelectElement)) throw new Error(`Falta el selector ${id}`);
    return control;
  };
  const area = selectField("rubro");
  const select = selectField("seleccionarModeloAire");
  const search = panel.querySelector<HTMLInputElement>("#buscarModeloAire")!;
  const state = panel.querySelector<HTMLElement>("#modeloAireEstado")!;
  const refresh = panel.querySelector<HTMLButtonElement>("#actualizarCatalogoAire")!;
  const confirmation = panel.querySelector<HTMLElement>("#modeloAireConfirmacion")!;
  let modelos: ModeloAire[] = [];
  let loaded = false;
  let loading = false;
  let selected: ModeloAire | undefined;
  let pending: ModeloAire | undefined;
  let lastApplied = "";
  let initialId = new URL(location.href).searchParams.get("modeloAireId");
  const values = () => JSON.stringify(sharedFields.map(id => field(id).value));
  const hasValues = () => sharedFields.some(id => field(id).value.trim());
  function clearSource() {
    selected = undefined;
    field("modeloAireId").value = "";
    field("modeloAireVersion").value = "";
  }
  function drawOptions(announce = false) {
    const selectedId = pending?.id ?? selected?.id;
    const term = search.value.trim().toLocaleUpperCase("es");
    const items = modelos.filter(m => m.id === selectedId || [m.nombre, m.marca, m.modelo, technical(m).capacidadBtuH].join(" ").toLocaleUpperCase("es").includes(term));
    const none = new Option("Sin ficha del catálogo", "");
    select.replaceChildren(none, ...items.map(m => new Option([m.nombre, m.marca, m.modelo].filter(Boolean).join(" · "), String(m.id))));
    select.value = selectedId ? String(selectedId) : "";
    if (announce) {
      state.textContent = !items.length && term ? "No hay fichas que coincidan con la búsqueda."
        : pending ? `Pendiente de aplicar: ${pending.nombre}. Confirma para reemplazar los datos comunes.`
        : selected ? `Ficha aplicada: ${selected.nombre}.`
        : modelos.length ? "Selecciona una ficha para completar los datos comunes."
        : "Todavía no hay fichas. Crea la primera o continúa con el registro manual.";
    }
  }
  function apply(modelo: ModeloAire) {
    const data = { ...modelo, ...technical(modelo) } as Record<string, unknown>;
    for (const id of sharedFields) {
      field(id).value = data[id] == null ? "" : String(data[id]).toUpperCase();
      field(id).dispatchEvent(new Event("input", { bubbles: true }));
    }
    selected = modelo;
    pending = undefined;
    lastApplied = values();
    field("modeloAireId").value = String(modelo.id);
    field("modeloAireVersion").value = String(modelo.version);
    select.value = String(modelo.id);
    confirmation.classList.add("hidden");
    state.textContent = `Ficha aplicada: ${modelo.nombre}. Puedes ajustar los datos de esta unidad; la serie y la ubicación son independientes.`;
  }
  function choose(modelo: ModeloAire) {
    if (hasValues() && values() !== lastApplied) {
      pending = modelo;
      confirmation.classList.remove("hidden");
      state.textContent = `Pendiente de aplicar: ${modelo.nombre}. Confirma para reemplazar los datos comunes.`;
    } else apply(modelo);
  }
  async function load() {
    if (loading) return;
    loading = true;
    select.disabled = true;
    refresh.disabled = true;
    state.textContent = "Cargando catálogo…";
    try {
      const res = await fetch("/api/catalogo-aires");
      const data = await res.json();
      if (!res.ok || !data || typeof data !== "object" || !("modelos" in data) || !Array.isArray(data.modelos)) throw new Error("catalog");
      modelos = data.modelos;
      loaded = true;
      // A refresh never silently changes the provenance of data already entered.
      if (selected) {
        const current = modelos.find(m => m.id === selected!.id);
        if (!current || current.version !== selected.version) {
          clearSource();
          state.textContent = "La ficha seleccionada cambió o fue archivada. Tus datos siguen en el formulario; selecciona una ficha actual para vincularla o continúa sin ficha.";
        } else state.textContent = `Ficha aplicada: ${selected.nombre}.`;
      } else state.textContent = modelos.length ? "Selecciona una ficha para completar los datos comunes." : "Todavía no hay fichas. Crea la primera o continúa con el registro manual.";
      drawOptions();
      if (initialId && area.value === "aires") {
        const model = modelos.find(m => String(m.id) === initialId);
        initialId = null;
        if (model) choose(model);
        else state.textContent = "La ficha solicitada no está disponible. Selecciona otra ficha o continúa sin ficha.";
      }
    } catch {
      state.textContent = "No se pudo cargar el catálogo. Pulsa Actualizar catálogo para reintentar; puedes continuar con los datos que ya tienes.";
    } finally {
      loading = false;
      select.disabled = false;
      refresh.disabled = false;
    }
  }
  search.addEventListener("input", () => drawOptions(true));
  refresh.addEventListener("click", () => { pending = undefined; confirmation.classList.add("hidden"); void load(); });
  select.addEventListener("change", () => {
    pending = undefined;
    confirmation.classList.add("hidden");
    const model = modelos.find(m => String(m.id) === select.value);
    if (model) choose(model);
    else { clearSource(); state.textContent = "Registro sin ficha del catálogo. Se conservan los datos del formulario."; }
  });
  panel.querySelector("#aplicarModeloAire")!.addEventListener("click", () => { if (pending) apply(pending); });
  panel.querySelector("#cancelarModeloAire")!.addEventListener("click", () => {
    pending = undefined;
    drawOptions();
    select.value = selected ? String(selected.id) : "";
    confirmation.classList.add("hidden");
    state.textContent = selected ? `Se conservan tus datos y la ficha ${selected.nombre}.` : "Se conservan tus datos, sin ficha del catálogo.";
  });
  // Prevent submitting an old model while a different selection is awaiting confirmation.
  form.addEventListener("submit", event => {
    if (loading && initialId && area.value === "aires") {
      event.preventDefault();
      event.stopImmediatePropagation();
      state.textContent = "Espera a que se cargue la ficha seleccionada antes de guardar.";
      return;
    }
    if (pending && area.value === "aires") {
      event.preventDefault();
      event.stopImmediatePropagation();
      state.textContent = "Aplica la ficha seleccionada o elige Conservar mis datos antes de guardar.";
      panel.querySelector<HTMLButtonElement>("#aplicarModeloAire")!.focus();
    }
  }, true);
  function changeArea() {
    const isAir = area.value === "aires";
    panel.classList.toggle("hidden", !isAir);
    if (!isAir) {
      clearSource(); pending = undefined; initialId = null;
      select.value = ""; confirmation.classList.add("hidden");
    } else if (!loaded) void load();
  }
  area.addEventListener("change", changeArea);
  changeArea();
}
