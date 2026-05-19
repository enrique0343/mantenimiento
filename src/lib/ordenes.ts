import type { Rol } from "./schema";

export const TIPOS_OT = ["preventivo", "correctivo", "predictivo"] as const;
export type TipoOT = (typeof TIPOS_OT)[number];

export const ESTADOS_OT = [
  "abierta",
  "en_proceso",
  "en_espera",
  "completada",
  "verificada",
  "cerrada",
  "cancelada",
] as const;
export type EstadoOT = (typeof ESTADOS_OT)[number];

export const ESTADO_LABEL: Record<EstadoOT, string> = {
  abierta: "Abierta",
  en_proceso: "En proceso",
  en_espera: "En espera",
  completada: "Completada",
  verificada: "Verificada",
  cerrada: "Cerrada",
  cancelada: "Cancelada",
};

export const ESTADO_COLOR: Record<EstadoOT, string> = {
  abierta: "bg-blue-100 text-blue-700",
  en_proceso: "bg-amber-100 text-amber-700",
  en_espera: "bg-purple-100 text-purple-700",
  completada: "bg-emerald-100 text-emerald-700",
  verificada: "bg-teal-100 text-teal-700",
  cerrada: "bg-slate-200 text-slate-700",
  cancelada: "bg-red-50 text-red-600",
};

export const TIPO_COLOR: Record<TipoOT, string> = {
  preventivo: "bg-purple-100 text-purple-700",
  correctivo: "bg-orange-100 text-orange-700",
  predictivo: "bg-sky-100 text-sky-700",
};

export const PRIO_COLOR: Record<string, string> = {
  baja: "bg-slate-100 text-slate-600",
  media: "bg-blue-100 text-blue-700",
  alta: "bg-orange-100 text-orange-700",
  urgente: "bg-red-100 text-red-700",
};

// Transiciones permitidas: { from: [...allowedTo] }. Aparte: cancelada por admin/jefe en cualquier momento.
const TRANSICIONES: Record<EstadoOT, EstadoOT[]> = {
  abierta: ["en_proceso", "cancelada"],
  en_proceso: ["en_espera", "completada", "abierta", "cancelada"],
  en_espera: ["en_proceso", "cancelada"],
  completada: ["verificada", "en_proceso", "cancelada"],
  verificada: ["cerrada", "completada"],
  cerrada: [],
  cancelada: ["abierta"],
};

export function transicionesPermitidas(actual: EstadoOT, rol: Rol, esAsignado: boolean): EstadoOT[] {
  const candidatos = TRANSICIONES[actual] ?? [];
  return candidatos.filter((to) => puedeTransicionar(actual, to, rol, esAsignado));
}

function puedeTransicionar(from: EstadoOT, to: EstadoOT, rol: Rol, esAsignado: boolean): boolean {
  // Visualizador y proveedor no transicionan
  if (rol === "visualizador" || rol === "proveedor") return false;

  // Admin y jefe pueden todo
  if (rol === "admin" || rol === "jefe") return true;

  // Cancelar / cerrar: solo admin o jefe
  if (to === "cancelada" || to === "cerrada") return false;

  // Verificar: solo admin o jefe
  if (to === "verificada") return false;

  // Tecnico/solicitante asignado: tomar (abierta→en_proceso) y completar
  if (rol === "tecnico" && (esAsignado || from === "abierta")) {
    return to === "en_proceso" || to === "completada";
  }

  // Solicitante: solo crear (no transiciones)
  return false;
}

// Acciones especiales por rol (no son cambios de estado puros)
export function puedeAsignarse(rol: Rol): boolean {
  return rol === "admin" || rol === "jefe" || rol === "tecnico";
}

export function puedeEditarEjecucion(rol: Rol, esAsignado: boolean, estado: EstadoOT): boolean {
  if (estado === "abierta" || estado === "cancelada" || estado === "cerrada") return false;
  if (rol === "admin" || rol === "jefe") return true;
  if (rol === "tecnico" && esAsignado) {
    return estado === "en_proceso" || estado === "en_espera" || estado === "completada" || estado === "verificada";
  }
  return false;
}

// Checklist parsing helpers
export type ChecklistEstado = "pendiente" | "ok" | "na" | "desviacion";
export type ChecklistItem = { texto: string; estado: ChecklistEstado; notas?: string };

const ESTADOS_VALIDOS: ChecklistEstado[] = ["pendiente", "ok", "na", "desviacion"];

export function parseChecklist(json: string | null | undefined): ChecklistItem[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((it) => {
        const texto = String(it?.texto ?? "");
        // Compat retroactiva: si el item viene con el formato viejo {hecho:bool},
        // lo mapeamos al nuevo modelo de estado.
        let estado: ChecklistEstado;
        if (typeof it?.estado === "string" && (ESTADOS_VALIDOS as string[]).includes(it.estado)) {
          estado = it.estado as ChecklistEstado;
        } else if (typeof it?.hecho === "boolean") {
          estado = it.hecho ? "ok" : "pendiente";
        } else {
          estado = "pendiente";
        }
        return {
          texto,
          estado,
          notas: it?.notas ? String(it.notas) : undefined,
        };
      })
      .filter((it) => it.texto.length > 0);
  } catch {
    return [];
  }
}

export function progresoChecklist(items: ChecklistItem[]): { hechos: number; total: number; pct: number; desviaciones: number; pendientes: number } {
  const total = items.length;
  const hechos = items.filter((i) => i.estado === "ok" || i.estado === "na" || i.estado === "desviacion").length;
  const desviaciones = items.filter((i) => i.estado === "desviacion").length;
  const pendientes = items.filter((i) => i.estado === "pendiente").length;
  const pct = total === 0 ? 0 : Math.round((hechos / total) * 100);
  return { hechos, total, pct, desviaciones, pendientes };
}

// Valida si el checklist permite cerrar la OT.
// Reglas:
//   - No puede haber items en estado "pendiente"
//   - Los items en "desviacion" deben tener notas (mín 10 chars)
export function validarChecklistParaCierre(items: ChecklistItem[]): { ok: boolean; error?: string } {
  if (items.length === 0) return { ok: true };
  const pendientes = items.filter((i) => i.estado === "pendiente");
  if (pendientes.length > 0) {
    return { ok: false, error: `No puedes completar: hay ${pendientes.length} item${pendientes.length === 1 ? "" : "s"} pendiente${pendientes.length === 1 ? "" : "s"} en el checklist. Marca cada uno como OK, N/A o Desviación.` };
  }
  const desvSinNota = items.filter((i) => i.estado === "desviacion" && (!i.notas || i.notas.trim().length < 10));
  if (desvSinNota.length > 0) {
    return { ok: false, error: `No puedes completar: hay ${desvSinNota.length} desviación${desvSinNota.length === 1 ? "" : "es"} sin describir. Cada desviación necesita una nota de al menos 10 caracteres.` };
  }
  return { ok: true };
}
