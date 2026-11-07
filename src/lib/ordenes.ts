import type { Rol } from "./schema";

// Tipos de OT. "intervencion" es el MOP (método de procedimiento: cambia el
// estado de un sistema crítico con permiso, pasos y lecturas de liberación) y
// "emergencia" es el EOP (el sistema ya falló; se actúa primero y se registra
// después). Cap. 02 de GO-GUI-011-2026.
export const TIPOS_OT = ["preventivo", "correctivo", "predictivo", "intervencion", "emergencia"] as const;
export type TipoOT = (typeof TIPOS_OT)[number];

export const TIPO_LABEL: Record<TipoOT, string> = {
  preventivo: "Preventivo",
  correctivo: "Correctivo",
  predictivo: "Predictivo",
  intervencion: "Intervención (MOP)",
  emergencia: "Emergencia (EOP)",
};

export const TIPO_ICONO: Record<TipoOT, string> = {
  preventivo: "🗓",
  correctivo: "🔧",
  predictivo: "📈",
  intervencion: "🛠",
  emergencia: "🚨",
};

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
  intervencion: "bg-indigo-100 text-indigo-700",
  emergencia: "bg-red-600 text-white",
};

// ── Clase de prioridad P1–P4 del plan maestro de 52 semanas (cap. 02) ────────
// El tiempo de respuesta es el compromiso: P1 inmediata, P2 el día, P3 la
// semana, P4 entra en la próxima ruta. El indicador de mantenimiento diferido
// se calcula sobre las P1 vencidas más de 30 días sin riesgo aceptado por escrito.
export const CLASES_PRIORIDAD = ["P1", "P2", "P3", "P4"] as const;
export type ClasePrioridad = (typeof CLASES_PRIORIDAD)[number];

export const CLASE_PRIORIDAD_LABEL: Record<ClasePrioridad, string> = {
  P1: "P1 · Emergencia",
  P2: "P2 · Urgente",
  P3: "P3 · Programable",
  P4: "P4 · Menor",
};

export const CLASE_PRIORIDAD_PLAZO: Record<ClasePrioridad, string> = {
  P1: "Atención inmediata (≤ 1 h)",
  P2: "≤ 24 horas",
  P3: "≤ 7 días",
  P4: "Próxima ruta programada",
};

// Horas de compromiso. P4 no tiene reloj: entra en la próxima ruta.
export const CLASE_PRIORIDAD_HORAS: Record<ClasePrioridad, number | null> = {
  P1: 1,
  P2: 24,
  P3: 24 * 7,
  P4: null,
};

export const CLASE_PRIORIDAD_COLOR: Record<ClasePrioridad, string> = {
  P1: "bg-red-600 text-white",
  P2: "bg-orange-100 text-orange-800",
  P3: "bg-blue-100 text-blue-700",
  P4: "bg-slate-100 text-slate-600",
};

export const NIVEL_RIESGO_COLOR: Record<string, string> = {
  bajo: "bg-emerald-100 text-emerald-700",
  medio: "bg-amber-100 text-amber-800",
  alto: "bg-red-100 text-red-700",
};

// Mapea la prioridad libre de la OT a una clase P1–P4 cuando nadie la fijó.
export function clasePrioridadSugerida(
  tipo: string | null | undefined,
  prioridad: string | null | undefined
): ClasePrioridad {
  if (tipo === "emergencia") return "P1";
  if (prioridad === "urgente") return "P1";
  if (prioridad === "alta") return "P2";
  if (prioridad === "media") return "P3";
  return "P4";
}

// Fecha límite de respuesta a partir de la hora de alarma (o de creación).
export function limiteRespuesta(
  clase: ClasePrioridad | null | undefined,
  desde: string | null | undefined
): string | null {
  if (!clase || !desde) return null;
  const horas = CLASE_PRIORIDAD_HORAS[clase];
  if (horas == null) return null;
  const t = new Date(desde).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + horas * 3_600_000).toISOString();
}

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
export type ChecklistItem = {
  texto: string;
  estado: ChecklistEstado;
  notas?: string;
  // Procedimiento estándar (Fase 35): metadata heredada de la plantilla.
  criterio?: string;       // criterio de aceptación (valor/condición esperada)
  bloqueante?: boolean;    // punto crítico: una desviación impide cerrar la OT
  minutos?: number;        // tiempo estimado del paso
  materiales?: string;     // herramientas/materiales requeridos
  // Ejecución: lo que el técnico registró frente al criterio.
  valorMedido?: string;
  // ── SOP con lectura obligatoria (Fase 47, cap. 02 y 04) ──
  // "El sistema genera la orden en la fecha y exige el valor medido en cada
  // línea." Una línea con requiereValor no se cierra sin número.
  requiereValor?: boolean;    // la línea pide un número, no solo un visto
  unidad?: string;            // °C, Pa, kW, mg/L, Hz…
  esperadoMin?: number;       // rango normal tomado del SCP
  esperadoMax?: number;
  variableId?: number;        // variable predictiva / atributo del activo que alimenta
  hora?: string;              // columna "hora" del formato impreso del MOP
  iniciales?: string;         // columna "iniciales" — un MOP sin firmas es un MOP sin evidencia
};

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
        const minutos = Number(it?.minutos);
        const num = (v: unknown): number | undefined => {
          if (v === null || v === undefined || v === "") return undefined;
          const n = Number(v);
          return Number.isFinite(n) ? n : undefined;
        };
        // valorMedido puede ser "0": no se puede usar truthiness.
        const vm = it?.valorMedido;
        const varId = num(it?.variableId);
        return {
          texto,
          estado,
          notas: it?.notas ? String(it.notas) : undefined,
          criterio: it?.criterio ? String(it.criterio) : undefined,
          bloqueante: it?.bloqueante === true || it?.bloqueante === 1,
          minutos: Number.isFinite(minutos) && minutos > 0 ? minutos : undefined,
          materiales: it?.materiales ? String(it.materiales) : undefined,
          valorMedido: vm !== null && vm !== undefined && String(vm) !== "" ? String(vm) : undefined,
          requiereValor: it?.requiereValor === true || it?.requiereValor === 1,
          unidad: it?.unidad ? String(it.unidad) : undefined,
          esperadoMin: num(it?.esperadoMin),
          esperadoMax: num(it?.esperadoMax),
          variableId: varId !== undefined && varId > 0 ? varId : undefined,
          hora: it?.hora ? String(it.hora) : undefined,
          iniciales: it?.iniciales ? String(it.iniciales) : undefined,
        };
      })
      .filter((it) => it.texto.length > 0);
  } catch {
    return [];
  }
}

// Suma del tiempo estimado de todos los pasos con minutos definidos.
export function minutosEstimadosChecklist(items: ChecklistItem[]): number {
  return items.reduce((s, i) => s + (i.minutos ?? 0), 0);
}

// Evalúa la lectura de una línea frente a su rango esperado del SCP.
//   tiene  — hay un número registrado
//   dentro — true dentro del rango, false fuera, null sin rango que comparar
export function evaluarValorChecklist(it: ChecklistItem): {
  tiene: boolean;
  numero: number | null;
  dentro: boolean | null;
  rangoTexto: string | null;
} {
  const crudo = it.valorMedido;
  const tiene = crudo !== undefined && crudo !== null && String(crudo).trim() !== "";
  const n = tiene ? Number(String(crudo).replace(",", ".")) : NaN;
  const numero = Number.isFinite(n) ? n : null;
  const tieneMin = it.esperadoMin !== undefined && it.esperadoMin !== null;
  const tieneMax = it.esperadoMax !== undefined && it.esperadoMax !== null;
  const u = it.unidad ? ` ${it.unidad}` : "";
  const rangoTexto = tieneMin && tieneMax
    ? `${it.esperadoMin} a ${it.esperadoMax}${u}`
    : tieneMin ? `≥ ${it.esperadoMin}${u}`
    : tieneMax ? `≤ ${it.esperadoMax}${u}`
    : null;
  let dentro: boolean | null = null;
  if (numero !== null && (tieneMin || tieneMax)) {
    dentro = (!tieneMin || numero >= (it.esperadoMin as number)) && (!tieneMax || numero <= (it.esperadoMax as number));
  }
  return { tiene, numero, dentro, rangoTexto };
}

// Líneas que piden número y lo tienen fuera del rango del SCP. No abrimos el
// evento AOP aquí (lo hace el módulo de condición anormal): dejamos el dato.
export function lecturasFueraDeRango(items: ChecklistItem[]): number[] {
  const out: number[] = [];
  items.forEach((it, idx) => {
    const ev = evaluarValorChecklist(it);
    if (ev.dentro === false) out.push(idx);
  });
  return out;
}

export function progresoChecklist(items: ChecklistItem[]): { hechos: number; total: number; pct: number; desviaciones: number; pendientes: number; bloqueantesAbiertos: number; valoresFaltantes: number; fueraDeRango: number } {
  const total = items.length;
  const hechos = items.filter((i) => i.estado === "ok" || i.estado === "na" || i.estado === "desviacion").length;
  const desviaciones = items.filter((i) => i.estado === "desviacion").length;
  const pendientes = items.filter((i) => i.estado === "pendiente").length;
  // Puntos críticos en desviación: impiden devolver el equipo a servicio.
  const bloqueantesAbiertos = items.filter((i) => i.bloqueante && i.estado === "desviacion").length;
  // Lecturas obligatorias sin número: bloquean el cierre igual que un pendiente.
  // Un paso marcado N/A no se midió a propósito, así que no se le exige lectura.
  const valoresFaltantes = items.filter(
    (i) => i.requiereValor && i.estado !== "na" && !evaluarValorChecklist(i).tiene
  ).length;
  const fueraDeRango = lecturasFueraDeRango(items).length;
  const pct = total === 0 ? 0 : Math.round((hechos / total) * 100);
  return { hechos, total, pct, desviaciones, pendientes, bloqueantesAbiertos, valoresFaltantes, fueraDeRango };
}

// Valida si el checklist permite cerrar la OT.
// Reglas:
//   - No puede haber items en estado "pendiente"
//   - Los items en "desviacion" deben tener notas (mín 10 chars)
//   - Un punto crítico (bloqueante) en "desviacion" impide cerrar: el equipo no
//     debe volver a servicio; requiere resolver el punto o escalar a correctivo.
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
  const bloqueantes = items.filter((i) => i.bloqueante && i.estado === "desviacion");
  if (bloqueantes.length > 0) {
    return { ok: false, error: `No puedes completar: hay ${bloqueantes.length} punto${bloqueantes.length === 1 ? "" : "s"} crítico${bloqueantes.length === 1 ? "" : "s"} en desviación. El equipo no puede volver a servicio: resuelve el punto (márcalo OK) o escala a un correctivo.` };
  }
  // SOP con lectura: "el sistema exige el valor medido en cada línea".
  return validarLecturasChecklistParaCierre(items);
}

// Regla dura y aparte: una línea que pide número no se cierra sin número.
// Va separada de validarChecklistParaCierre porque esta no la salta nadie —
// es la evidencia del SOP («registro con fecha, hora, lectura y firma»).
export function validarLecturasChecklistParaCierre(items: ChecklistItem[]): { ok: boolean; error?: string } {
  const sinLectura = items
    .map((i, idx) => ({ i, idx }))
    .filter(({ i }) => i.requiereValor && i.estado !== "na" && !evaluarValorChecklist(i).tiene);
  if (sinLectura.length === 0) return { ok: true };
  const nombres = sinLectura.slice(0, 3).map(({ i, idx }) => `«${i.texto || `línea ${idx + 1}`}»`).join(", ");
  const resto = sinLectura.length > 3 ? ` y ${sinLectura.length - 3} más` : "";
  return {
    ok: false,
    error: `No puedes completar: ${sinLectura.length} línea${sinLectura.length === 1 ? "" : "s"} del checklist exige${sinLectura.length === 1 ? "" : "n"} valor medido y está${sinLectura.length === 1 ? "" : "n"} sin lectura: ${nombres}${resto}. Registra el número que leíste (o marca la línea N/A si no se midió).`,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// MOP — PRERREQUISITOS Y LIBERACIONES
// Cap. 02: «Cada MOP es una plantilla de orden con tipo "intervención
// planificada", nivel de riesgo, prerrequisitos como tareas previas
// bloqueantes (permiso firmado, ICRA, notificación) […] y una sección de
// cierre con las lecturas de liberación. La orden no cierra sin la lectura de
// liberación.»  Cap. 05: el permiso se emite «inmediatamente antes de
// empezar»; ICRA 2.0 asigna la clase de precaución I a V; OSHA 1910.147 fija
// la secuencia de bloqueo y etiquetado.
// ════════════════════════════════════════════════════════════════════════════

export const PRERREQ_TIPOS = [
  "permiso_trabajo", "icra", "notificacion", "loto", "espacio_confinado",
  "ventana", "instrumento", "reserva", "otro",
] as const;
export type PrerrequisitoTipo = (typeof PRERREQ_TIPOS)[number];

export const PRERREQ_LABEL: Record<PrerrequisitoTipo, string> = {
  permiso_trabajo: "Permiso de trabajo",
  icra: "ICRA firmada",
  notificacion: "Notificación a servicios",
  loto: "Bloqueo y etiquetado (LOTO)",
  espacio_confinado: "Permiso de espacio confinado",
  ventana: "Ventana pactada",
  instrumento: "Instrumento calibrado",
  reserva: "Reserva / respaldo disponible",
  otro: "Otro",
};

export const PRERREQ_ICONO: Record<PrerrequisitoTipo, string> = {
  permiso_trabajo: "📝",
  icra: "🦠",
  notificacion: "📣",
  loto: "🔒",
  espacio_confinado: "⛑",
  ventana: "🕐",
  instrumento: "📏",
  reserva: "🔋",
  otro: "•",
};

// Qué se escribe en el campo "referencia" de cada tipo: el dato que vuelve
// verificable el prerrequisito (n.º de permiso, clase de ICRA, id del candado).
export const PRERREQ_REFERENCIA_HINT: Record<PrerrequisitoTipo, string> = {
  permiso_trabajo: "N.º de permiso y quién lo emitió",
  icra: "Clase de precaución (I a V) y quién firmó",
  notificacion: "Servicios avisados y hora exacta del aviso",
  loto: "Id del candado y tarjeta, y quién lo colocó",
  espacio_confinado: "N.º de permiso de espacio confinado",
  ventana: "Fecha y hora pactadas, y con quién",
  instrumento: "Id del instrumento y vigencia de su calibración",
  reserva: "Qué respaldo quedó disponible",
  otro: "Referencia verificable",
};

export type PrerrequisitoLike = {
  texto: string;
  tipo?: string | null;
  obligatorio: boolean;
  cumplido: boolean;
};

// Regla dura del MOP: una intervención no arranca con prerrequisitos
// obligatorios pendientes. «En una intervención, la orden no le deja empezar
// sin el permiso firmado» (cap. 02, 2.5).
export function validarPrerrequisitosParaIniciar(
  tipo: string | null | undefined,
  prerrequisitos: PrerrequisitoLike[]
): { ok: boolean; error?: string; faltantes: string[] } {
  if (tipo !== "intervencion") return { ok: true, faltantes: [] };
  const faltantes = prerrequisitos
    .filter((p) => p.obligatorio && !p.cumplido)
    .map((p) => {
      const t = (p.tipo ?? "otro") as PrerrequisitoTipo;
      const etiqueta = PRERREQ_LABEL[t] ?? PRERREQ_LABEL.otro;
      return p.texto?.trim() ? `${etiqueta}: ${p.texto.trim()}` : etiqueta;
    });
  if (faltantes.length === 0) return { ok: true, faltantes: [] };
  return {
    ok: false,
    faltantes,
    error: `No puedes iniciar esta intervención (MOP): falta${faltantes.length === 1 ? "" : "n"} ${faltantes.length} prerrequisito${faltantes.length === 1 ? "" : "s"} obligatorio${faltantes.length === 1 ? "" : "s"}:\n· ${faltantes.join("\n· ")}\nMárcalos cumplidos con su referencia (n.º de permiso, clase de ICRA, id del candado) antes de empezar.`,
  };
}

export type LiberacionLike = {
  etiqueta: string;
  unidad?: string | null;
  obligatoria: boolean;
  valorMedido?: number | null;
  valorMedidoTexto?: string | null;
};

export function liberacionTieneLectura(l: LiberacionLike): boolean {
  if (l.valorMedido !== null && l.valorMedido !== undefined && Number.isFinite(Number(l.valorMedido))) return true;
  return !!(l.valorMedidoTexto && String(l.valorMedidoTexto).trim() !== "");
}

// Calcula "conforme" al escribir el valor medido. Sin rango que comparar no
// podemos juzgar: queda null y lo decide quien libera.
export function evaluarConformeLiberacion(
  min: number | null | undefined,
  max: number | null | undefined,
  valor: number | null | undefined
): boolean | null {
  if (valor === null || valor === undefined || !Number.isFinite(Number(valor))) return null;
  const tieneMin = min !== null && min !== undefined;
  const tieneMax = max !== null && max !== undefined;
  if (!tieneMin && !tieneMax) return null;
  const v = Number(valor);
  return (!tieneMin || v >= Number(min)) && (!tieneMax || v <= Number(max));
}

// Regla dura del MOP: no se cierra sin la lectura de liberación.
// El único escape es el cierre sin lectura con motivo escrito (admin o jefe).
export function validarLiberacionesParaCierre(
  tipo: string | null | undefined,
  liberaciones: LiberacionLike[]
): { ok: boolean; error?: string; faltantes: string[] } {
  if (tipo !== "intervencion") return { ok: true, faltantes: [] };
  const faltantes = liberaciones
    .filter((l) => l.obligatoria && !liberacionTieneLectura(l))
    .map((l) => (l.unidad ? `${l.etiqueta} (${l.unidad})` : l.etiqueta));
  if (faltantes.length === 0) return { ok: true, faltantes: [] };
  return {
    ok: false,
    faltantes,
    error: `No puedes cerrar esta intervención (MOP): falta${faltantes.length === 1 ? "" : "n"} ${faltantes.length} lectura${faltantes.length === 1 ? "" : "s"} de liberación obligatoria${faltantes.length === 1 ? "" : "s"}:\n· ${faltantes.join("\n· ")}\nRegistra el valor medido. Si de verdad no se pudo medir, la jefatura debe cerrar con motivo escrito (cierre sin lectura).`,
  };
}

export function puedeCerrarSinLectura(rol: Rol): boolean {
  return rol === "admin" || rol === "jefe";
}

// ════════════════════════════════════════════════════════════════════════════
// EOP — LOS TRES TIEMPOS Y LA CAUSA RAÍZ
// Cap. 02: «la falla abre una orden de emergencia con el código del EOP,
// registra la hora de alarma, la hora de llegada y la hora de
// restablecimiento, y obliga a cerrar con un análisis de causa raíz.»
// Cap. 06 (EOP-ELE-01): «Orden de emergencia con hora de alarma, de llegada,
// de energía de emergencia y de restablecimiento; causa raíz en [72] horas.»
// ════════════════════════════════════════════════════════════════════════════

export const HORAS_CAUSA_RAIZ = 72;

// La hora intermedia cambia de nombre según el EOP: en el eléctrico es la hora
// en que la energía de emergencia tomó la carga; en gases, la reserva en
// servicio. Por eso eopFicha.etiquetaHoraMitigacion la fija por procedimiento.
export const ETIQUETA_MITIGACION_DEFAULT = "Hora de mitigación";

export function etiquetaMitigacion(desdeFicha?: string | null): string {
  const t = (desdeFicha ?? "").trim();
  return t.length > 0 ? t : ETIQUETA_MITIGACION_DEFAULT;
}

function horas(desde: string | null | undefined, hasta: string | null | undefined): number | null {
  if (!desde || !hasta) return null;
  const a = new Date(desde).getTime();
  const b = new Date(hasta).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const h = (b - a) / 3_600_000;
  return Math.round(h * 100) / 100;
}

// Indicadores 5 y 7: tiempo de respuesta (llegada − alarma) y tiempo de
// reparación (restablecimiento − alarma).
export function tiemposEmergencia(o: {
  horaAlarma?: string | null;
  horaLlegada?: string | null;
  horaMitigacion?: string | null;
  horaRestablecimiento?: string | null;
}): {
  respuestaHoras: number | null;
  mitigacionHoras: number | null;
  reparacionHoras: number | null;
} {
  return {
    respuestaHoras: horas(o.horaAlarma, o.horaLlegada),
    mitigacionHoras: horas(o.horaAlarma, o.horaMitigacion),
    reparacionHoras: horas(o.horaAlarma, o.horaRestablecimiento),
  };
}

// Formatea horas decimales como "2 h 15 min" (lo que se lee en un informe).
export function fmtDuracionHoras(h: number | null | undefined): string {
  if (h === null || h === undefined || !Number.isFinite(h)) return "—";
  const negativo = h < 0;
  const abs = Math.abs(h);
  const totalMin = Math.round(abs * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  const txt = hh > 0 ? `${hh} h${mm > 0 ? ` ${mm} min` : ""}` : `${mm} min`;
  return negativo ? `−${txt}` : txt;
}

// causa_raiz_vencimiento = hora de alarma + 72 h.
export function vencimientoCausaRaiz(horaAlarma: string | null | undefined): string | null {
  if (!horaAlarma) return null;
  const t = new Date(horaAlarma).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + HORAS_CAUSA_RAIZ * 3_600_000).toISOString();
}

export function causaRaizVencida(vencimiento: string | null | undefined, causaRaiz: string | null | undefined): boolean {
  if (!vencimiento) return false;
  if (causaRaiz && causaRaiz.trim().length > 0) return false;
  const t = new Date(vencimiento).getTime();
  return Number.isFinite(t) && t < Date.now();
}

// ¿Esta OT exige causa raíz para cerrarse?
//   · toda orden de emergencia (EOP);
//   · toda OT correctiva sobre un activo de criticidad alta (clase A): «toda OT
//     correctiva sobre activo clase A genera un análisis breve de causa raíz».
export function requiereCausaRaiz(
  tipo: string | null | undefined,
  criticidadActivo: string | null | undefined
): { requiere: boolean; motivo: string | null } {
  if (tipo === "emergencia") {
    return { requiere: true, motivo: "Toda orden de emergencia (EOP) cierra con análisis de causa raíz." };
  }
  if (tipo === "correctivo" && criticidadActivo === "alta") {
    return { requiere: true, motivo: "Correctivo sobre activo de criticidad alta (clase A): exige análisis breve de causa raíz." };
  }
  return { requiere: false, motivo: null };
}

export const MIN_CAUSA_RAIZ = 20;

export function validarCausaRaizParaCierre(
  tipo: string | null | undefined,
  criticidadActivo: string | null | undefined,
  causaRaiz: string | null | undefined
): { ok: boolean; error?: string } {
  const r = requiereCausaRaiz(tipo, criticidadActivo);
  if (!r.requiere) return { ok: true };
  const txt = (causaRaiz ?? "").trim();
  if (txt.length >= MIN_CAUSA_RAIZ) return { ok: true };
  return {
    ok: false,
    error: `No puedes cerrar sin análisis de causa raíz. ${r.motivo} Escribe al menos ${MIN_CAUSA_RAIZ} caracteres en el campo «Causa raíz» (plazo: ${HORAS_CAUSA_RAIZ} h desde la hora de alarma).`,
  };
}

// Convierte un ISO a lo que acepta <input type="datetime-local"> en hora de
// El Salvador (UTC-6). No usamos toISOString: desfasaría 6 horas.
export function isoALocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const partes = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/El_Salvador",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(d);
  // "sv-SE" entrega "YYYY-MM-DD HH:mm"
  return partes.replace(" ", "T").slice(0, 16);
}
