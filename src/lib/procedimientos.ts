// Biblioteca de procedimientos modelo · GO-GUI-011-2026
//
// Los 25 documentos del volumen como entidad de primera clase. Cinco tipos que
// se encadenan (cap. 01): el SCP dice como esta configurado un sistema, el SOP
// lo opera a diario, el AOP responde cuando un valor se sale de rango, el EOP
// cuando el sistema ya fallo y el MOP cambia su estado sin danar al paciente.
//
// Dos reglas del PDF viven aqui porque la API y la UI las necesitan igual:
//  - cap. 2.4: cada documento lleva DOS codigos. El institucional
//    ([AREA]-[TIPO]-[NNN]-[AAAA]) identifica la version aprobada; el codigo
//    corto (SCP-ELE-01) identifica sistema y tipo y es el que se escribe en el
//    activo y en la plantilla de orden.
//  - cap. 8.1: "Un SCP con una celda vacia es un SCP sin aprobar". Ver
//    puedeSerVigente().

export type TipoProc = "scp" | "sop" | "mop" | "eop" | "aop";
export type SistemaProc =
  | "electrico"
  | "hvac"
  | "gases"
  | "agua"
  | "incendios"
  | "ascensores"
  | "otro";
export type EstadoProc = "borrador" | "en_validacion" | "vigente" | "en_revision" | "retirado";
export type SemanaValidacion = 1 | 2 | 3 | 4;

export const TIPOS_PROC = ["scp", "sop", "mop", "eop", "aop"] as const;
export const SISTEMAS_PROC = [
  "electrico",
  "hvac",
  "gases",
  "agua",
  "incendios",
  "ascensores",
  "otro",
] as const;
export const ESTADOS_PROC = [
  "borrador",
  "en_validacion",
  "vigente",
  "en_revision",
  "retirado",
] as const;

// ─── Los cinco tipos ─────────────────────────────────────────────────────────

export interface TipoProcInfo {
  label: string;      // sigla, para badges y tablas
  nombre: string;     // nombre largo
  icono: string;
  color: string;      // clases del badge
  borde: string;      // clase de borde para la ficha
  pregunta: string;   // la pregunta que responde el documento (cap. 01)
  vive: string;       // como vive en el sistema de mantenimiento (cap. 02)
}

export const TIPO_PROC: Record<TipoProc, TipoProcInfo> = {
  scp: {
    label: "SCP",
    nombre: "Configuración de sitio",
    icono: "🗺️",
    color: "bg-sky-100 text-sky-700",
    borde: "border-sky-300",
    pregunta: "¿Cómo está configurado este sistema cuando todo está normal?",
    vive: "Como activo y sus atributos; la versión del SCP es atributo del activo.",
  },
  sop: {
    label: "SOP",
    nombre: "Rutina de operación",
    icono: "🔁",
    color: "bg-emerald-100 text-emerald-700",
    borde: "border-emerald-300",
    pregunta: "¿Qué se verifica cada turno, cada día, cada mes?",
    vive: "Como plan recurrente con lista de verificación y valores esperados.",
  },
  mop: {
    label: "MOP",
    nombre: "Intervención programada",
    icono: "🔧",
    color: "bg-amber-100 text-amber-700",
    borde: "border-amber-300",
    pregunta: "¿Cómo se cambia el estado del sistema sin dañar al paciente?",
    vive: "Como plantilla de orden con prerrequisitos y lecturas de liberación.",
  },
  eop: {
    label: "EOP",
    nombre: "Emergencia",
    icono: "🚨",
    color: "bg-red-100 text-red-700",
    borde: "border-red-300",
    pregunta: "¿Qué se hace cuando el sistema ya falló?",
    vive: "Como plan de contingencia impreso en pared y orden de emergencia.",
  },
  aop: {
    label: "AOP",
    nombre: "Condición anormal",
    icono: "⚠️",
    color: "bg-orange-100 text-orange-700",
    borde: "border-orange-300",
    pregunta: "¿Qué se hace cuando un valor se sale de rango y aún no es emergencia?",
    vive: "Como umbral sobre el activo; no ocupa filas del plan maestro.",
  },
};

// ─── Sistemas ────────────────────────────────────────────────────────────────

export interface SistemaInfo {
  value: SistemaProc;
  label: string;
  icono: string;
  color: string;
}

export const SISTEMAS: SistemaInfo[] = [
  { value: "electrico", label: "Energía eléctrica", icono: "⚡", color: "bg-yellow-100 text-yellow-800" },
  { value: "hvac", label: "Climatización", icono: "❄️", color: "bg-cyan-100 text-cyan-800" },
  { value: "gases", label: "Gases medicinales", icono: "🫁", color: "bg-indigo-100 text-indigo-800" },
  { value: "agua", label: "Agua", icono: "💧", color: "bg-blue-100 text-blue-800" },
  { value: "incendios", label: "Protección contra incendios", icono: "🧯", color: "bg-red-100 text-red-800" },
  { value: "ascensores", label: "Ascensores", icono: "🛗", color: "bg-slate-100 text-slate-700" },
  { value: "otro", label: "Otro", icono: "📋", color: "bg-slate-100 text-slate-600" },
];

export const sistemaInfo = (s: string | null | undefined): SistemaInfo =>
  SISTEMAS.find((x) => x.value === s) ?? SISTEMAS[SISTEMAS.length - 1];

// ─── Estados documentales ────────────────────────────────────────────────────

export interface EstadoProcInfo {
  label: string;
  icono: string;
  color: string;
  descripcion: string;
}

export const ESTADO_PROC: Record<EstadoProc, EstadoProcInfo> = {
  borrador: {
    label: "Borrador",
    icono: "✏️",
    color: "bg-slate-100 text-slate-600",
    descripcion: "Escrito pero sin dueño, sin calendario o sin campos completos.",
  },
  en_validacion: {
    label: "En validación",
    icono: "🔍",
    color: "bg-amber-100 text-amber-700",
    descripcion: "Con dueño y calendario; cada área confirma lo que le toca.",
  },
  vigente: {
    label: "Vigente",
    icono: "✅",
    color: "bg-emerald-100 text-emerald-700",
    descripcion: "Validado por todas las áreas, con código institucional y cargado en el sistema.",
  },
  en_revision: {
    label: "En revisión",
    icono: "🔄",
    color: "bg-blue-100 text-blue-700",
    descripcion: "Vigente pero con una versión nueva en preparación.",
  },
  retirado: {
    label: "Retirado",
    icono: "📦",
    color: "bg-slate-200 text-slate-500",
    descripcion: "Fuera de uso; se conserva como historial.",
  },
};

export const estadoInfo = (e: string | null | undefined): EstadoProcInfo =>
  ESTADO_PROC[(e ?? "borrador") as EstadoProc] ?? ESTADO_PROC.borrador;

// ─── Áreas validadoras (cap. 08) ─────────────────────────────────────────────
// Las áreas a las que el capítulo 08 asigna la validación de estos documentos.

export const AREAS_VALIDADORAS = [
  "Mantenimiento General",
  "Mantenimiento Biomédico",
  "Control de Infecciones",
  "Quirófanos",
  "Enfermería",
  "Esterilización",
  "Regencia del Botiquín",
  "Seguridad y Salud Ocupacional",
  "Calidad",
  "Tecnología",
  "Compras y Finanzas",
  "Legal",
  "Talento Humano",
] as const;

// La matriz del 8.2 llama además a estos actores en documentos concretos
// (clínicos, de apoyo y terceros). Se ofrecen en el selector para no inventar
// nombres de área al cargar la matriz real.
export const AREAS_ADICIONALES = [
  "Dirección Médica",
  "Anestesia",
  "Cirugía",
  "Terapia Respiratoria",
  "Hemodiálisis",
  "Laboratorio",
  "Almacén",
  "Cocina",
  "Servicios Generales",
  "Vigilancia",
  "Central telefónica",
  "Comité de Emergencias",
  "Gerencia de Operaciones",
  "Gerencia General",
  "Proveedor del gas",
  "Proveedor de plantas",
  "Proveedor de ascensores",
  "Proveedor de alarma y rociadores",
  "Contratista",
] as const;

export const TODAS_LAS_AREAS: string[] = [...AREAS_VALIDADORAS, ...AREAS_ADICIONALES];

// ─── Calendario de validación de cuatro semanas (cap. 08) ────────────────────
// "SCP en la primera semana, SOP y AOP en la segunda, EOP con simulacro de
//  mesa en la tercera, MOP en la cuarta."

export const SEMANAS_VALIDACION: Record<SemanaValidacion, { label: string; detalle: string }> = {
  1: { label: "Semana 1 · SCP", detalle: "Se validan primero: los otros veinte documentos toman de ellos sus valores." },
  2: { label: "Semana 2 · SOP y AOP", detalle: "Dependen de los umbrales que fija el SCP." },
  3: { label: "Semana 3 · EOP", detalle: "Se ensayan en simulacro de mesa antes de aprobarse." },
  4: { label: "Semana 4 · MOP", detalle: "Exigen la revisión más amplia." },
};

export function semanaSugerida(tipo: string | null | undefined): SemanaValidacion {
  switch (tipo) {
    case "scp":
      return 1;
    case "sop":
    case "aop":
      return 2;
    case "eop":
      return 3;
    case "mop":
      return 4;
    default:
      return 1;
  }
}

/** El EOP se ensaya en simulacro de mesa dentro de su semana de validación. */
export const exigeSimulacroDeMesa = (tipo: string | null | undefined): boolean => tipo === "eop";

// ─── Regla dura del cap. 8.1 ─────────────────────────────────────────────────

export interface CampoAzul {
  id?: number;
  etiqueta: string;
  valor?: string | null;
  unidad?: string | null;
  decideArea?: string | null;
}

export interface ValidacionArea {
  id?: number;
  area: string;
  estado: string; // pendiente | validado | observado
  fechaProgramada?: string | null;
}

export interface ResultadoVigencia {
  ok: boolean;
  /** Motivos de rechazo, listos para mostrar al usuario. */
  motivos: string[];
  /** No bloquean, pero conviene resolverlos antes de firmar. */
  advertencias: string[];
  camposFaltantes: string[];
  areasPendientes: string[];
  areasObservadas: string[];
}

const vacio = (v: string | null | undefined): boolean => v == null || v.trim() === "";

/**
 * Regla dura del capítulo 8.1: "se valida documento por documento, no por lote.
 * Un SCP con una celda vacía es un SCP sin aprobar."
 *
 * Un procedimiento NO puede pasar a 'vigente' si:
 *   (a) algún campo en azul sigue sin valor, o
 *   (b) alguna área validadora sigue en 'pendiente'.
 *
 * Se aplica en la API, no sólo en la UI.
 */
export function puedeSerVigente(
  campos: CampoAzul[],
  validaciones: ValidacionArea[],
): ResultadoVigencia {
  const camposFaltantes = campos.filter((c) => vacio(c.valor)).map((c) => c.etiqueta);
  const areasPendientes = validaciones.filter((v) => v.estado === "pendiente").map((v) => v.area);
  const areasObservadas = validaciones.filter((v) => v.estado === "observado").map((v) => v.area);

  const motivos: string[] = [];
  if (validaciones.length === 0) {
    motivos.push(
      "No hay matriz de validación: el capítulo 08 exige al menos un área validadora con fecha programada.",
    );
  }
  if (camposFaltantes.length > 0) {
    motivos.push(
      `${camposFaltantes.length} campo(s) en azul sin valor (${camposFaltantes.join(", ")}). ` +
        "Capítulo 8.1: un SCP con una celda vacía es un SCP sin aprobar.",
    );
  }
  if (areasPendientes.length > 0) {
    motivos.push(
      `${areasPendientes.length} área(s) sin confirmar todavía (${areasPendientes.join(", ")}). ` +
        "Ningún documento entra en vigor por haber sido escrito.",
    );
  }

  const advertencias: string[] = [];
  if (areasObservadas.length > 0) {
    advertencias.push(
      `${areasObservadas.length} área(s) dejaron observaciones (${areasObservadas.join(", ")}).`,
    );
  }

  return {
    ok: motivos.length === 0,
    motivos,
    advertencias,
    camposFaltantes,
    areasPendientes,
    areasObservadas,
  };
}

export interface Progreso {
  camposTotal: number;
  camposLlenos: number;
  camposFaltan: number;
  pctCampos: number;
  areasTotal: number;
  areasValidadas: number;
  areasPendientes: number;
  areasObservadas: number;
  pctAreas: number;
  /** Porcentaje único para la fila del listado: campos + áreas en un solo pozo. */
  pct: number;
  listo: boolean;
}

/**
 * Avance de validación de un documento. Cuenta campos en azul resueltos y
 * áreas que ya confirmaron, en un solo porcentaje para el listado.
 */
export function progresoValidacion(
  campos: CampoAzul[],
  validaciones: ValidacionArea[],
): Progreso {
  const camposTotal = campos.length;
  const camposLlenos = campos.filter((c) => !vacio(c.valor)).length;
  const areasTotal = validaciones.length;
  const areasValidadas = validaciones.filter((v) => v.estado === "validado").length;
  const areasPendientes = validaciones.filter((v) => v.estado === "pendiente").length;
  const areasObservadas = validaciones.filter((v) => v.estado === "observado").length;

  const total = camposTotal + areasTotal;
  const hechos = camposLlenos + areasValidadas;
  const pct = total === 0 ? 0 : Math.round((hechos / total) * 100);

  return {
    camposTotal,
    camposLlenos,
    camposFaltan: camposTotal - camposLlenos,
    pctCampos: camposTotal === 0 ? 100 : Math.round((camposLlenos / camposTotal) * 100),
    areasTotal,
    areasValidadas,
    areasPendientes,
    areasObservadas,
    pctAreas: areasTotal === 0 ? 0 : Math.round((areasValidadas / areasTotal) * 100),
    pct,
    listo: camposTotal - camposLlenos === 0 && areasPendientes === 0 && areasTotal > 0,
  };
}

/** Color de la barra de avance según cuánto falta. */
export function colorProgreso(pct: number): string {
  if (pct >= 100) return "bg-emerald-500";
  if (pct >= 60) return "bg-amber-500";
  if (pct > 0) return "bg-orange-400";
  return "bg-slate-300";
}

// ─── Matriz real del capítulo 8.2 ────────────────────────────────────────────
// Quién valida qué, y qué campos en azul decide cada documento. Sirve para
// precargar la matriz al crear uno de los 25 documentos del volumen, en lugar
// de teclear catorce áreas a mano.

export interface FilaMatriz {
  titulo: string;
  tipo: TipoProc;
  sistema: SistemaProc;
  nivelRiesgo?: "bajo" | "medio" | "alto";
  queConfirma: string;
  areas: string[];
  campos: string[];
}

export const MATRIZ_CAP08: Record<string, FilaMatriz> = {
  // ── Semana 1 · SCP
  "SCP-ELE-01": {
    titulo: "Sistema eléctrico esencial: configuración normal",
    tipo: "scp",
    sistema: "electrico",
    queConfirma:
      "Unifilar as-built, placas, ajustes reales de transferencias, combustible y autonomía, UPS, acuerdo de reabastecimiento, norma adoptada",
    areas: ["Mantenimiento General", "Tecnología", "Compras y Finanzas", "Calidad"],
    campos: ["kVA contratados", "Carga máxima", "kW de placa", "Litros de combustible", "Horas de autonomía", "Retardos de transferencia"],
  },
  "SCP-HVAC-01": {
    titulo: "Climatización de áreas críticas: puntos de ajuste y configuración",
    tipo: "scp",
    sistema: "hvac",
    queConfirma:
      "Inventario de manejadoras, salas servidas, filtros, sensores adquiridos y su calibración, rangos de operación y alerta",
    areas: [
      "Mantenimiento General",
      "Control de Infecciones",
      "Quirófanos",
      "Esterilización",
      "Mantenimiento Biomédico",
      "Calidad",
    ],
    campos: ["Tabla de manejadoras", "Presión diferencial de cambio de filtro", "Ubicación de sensores"],
  },
  "SCP-GAS-01": {
    titulo: "Gases medicinales: fuentes, presiones, válvulas de zona y alarmas",
    tipo: "scp",
    sistema: "gases",
    queConfirma:
      "Presiones de diseño, autonomía del tanque y de la reserva, válvulas y rótulos, paneles y umbrales, roles equivalentes, requisitos SRS",
    areas: [
      "Mantenimiento General",
      "Regencia del Botiquín",
      "Legal",
      "Enfermería",
      "Mantenimiento Biomédico",
      "Proveedor del gas",
    ],
    campos: ["kPa de diseño", "Capacidad y consumo", "Cilindros", "Lista de válvulas", "Paneles de alarma"],
  },
  "SCP-AGU-01": {
    titulo: "Agua potable y agua caliente: configuración y régimen de temperaturas",
    tipo: "scp",
    sistema: "agua",
    queConfirma:
      "Inventario, puntos centinela, salidas de poco uso, régimen de temperaturas, norma de agua potable y cloro residual",
    areas: [
      "Mantenimiento General",
      "Control de Infecciones",
      "Mantenimiento Biomédico",
      "Laboratorio",
      "Esterilización",
      "Legal",
    ],
    campos: ["Capacidades", "Niveles", "Presiones", "Lista de centinelas", "Valor de cloro"],
  },
  "SCP-INC-01": {
    titulo: "Protección contra incendios: configuración y calendario de pruebas",
    tipo: "scp",
    sistema: "incendios",
    queConfirma:
      "Inventarios, presiones normales, calendario de pruebas, requisitos del Cuerpo de Bomberos y del Decreto 254",
    areas: [
      "Mantenimiento General",
      "Seguridad y Salud Ocupacional",
      "Cocina",
      "Legal",
      "Calidad",
      "Proveedor de alarma y rociadores",
    ],
    campos: ["Zonas", "Presiones", "Lista de extintores", "Luminarias de emergencia", "Puertas cortafuego"],
  },

  // ── Semana 2 · SOP
  "SOP-MG-01": {
    titulo: "Ronda de sistemas críticos por turno",
    tipo: "sop",
    sistema: "otro",
    queConfirma: "Orden del recorrido, duración, cobertura de turnos, acceso a áreas clínicas, formato",
    areas: ["Mantenimiento General", "Talento Humano", "Enfermería", "Calidad"],
    campos: ["Minutos de ronda", "Niveles de reorden", "Frecuencia de prueba del teléfono de cabina"],
  },
  "SOP-MG-02": {
    titulo: "Inspección semanal de plantas de emergencia y transferencias automáticas",
    tipo: "sop",
    sistema: "electrico",
    queConfirma: "Valores del fabricante por planta, día fijo, equipo de protección",
    areas: ["Mantenimiento General", "Proveedor de plantas", "Seguridad y Salud Ocupacional"],
    campos: ["Litros de reorden", "Tensión de flotación", "Cargo suplente"],
  },
  "SOP-MG-03": {
    titulo: "Control mensual de temperaturas de agua en puntos centinela y purga semanal",
    tipo: "sop",
    sistema: "agua",
    queConfirma: "Lista de puntos, día fijo, programa de muestreo, norma aplicable",
    areas: ["Mantenimiento General", "Control de Infecciones", "Laboratorio", "Legal"],
    campos: ["Fecha de calibración", "Día del mes", "Cargo suplente"],
  },
  "SOP-MG-04": {
    titulo: "Verificación diaria de ambiente en quirófanos y cuartos de aislamiento",
    tipo: "sop",
    sistema: "hvac",
    queConfirma:
      "Banda de alerta, método de verificación de presión, hora de la lectura, firma de inicio de lista",
    areas: ["Control de Infecciones", "Quirófanos", "Mantenimiento General", "Calidad"],
    campos: ["Intervalo de relectura (horas)"],
  },
  "SOP-MG-05": {
    titulo: "Ronda mensual de protección contra incendios",
    tipo: "sop",
    sistema: "incendios",
    queConfirma: "Elementos de inspección, procedimiento de deterioro, pruebas anuales por contrato",
    areas: [
      "Seguridad y Salud Ocupacional",
      "Mantenimiento General",
      "Cocina",
      "Proveedor de alarma y rociadores",
    ],
    campos: ["Día fijo", "Cargo suplente"],
  },

  // ── Semana 2 · AOP
  "AOP-HVAC-01": {
    titulo: "Temperatura o humedad fuera de rango en quirófano o almacén estéril",
    tipo: "aop",
    sistema: "hvac",
    queConfirma:
      "Umbrales, tiempos tolerables, decisión sobre casos, medidas alternativas en aislamiento",
    areas: [
      "Control de Infecciones",
      "Quirófanos",
      "Esterilización",
      "Mantenimiento General",
      "Calidad",
    ],
    campos: ["Minutos de tolerancia en aislamiento", "Unidades HEPA disponibles"],
  },
  "AOP-HVAC-02": {
    titulo: "Pérdida de presión diferencial en un quirófano o en un cuarto de aislamiento",
    tipo: "aop",
    sistema: "hvac",
    queConfirma:
      "Umbrales, tiempos tolerables, decisión sobre casos, medidas alternativas en aislamiento",
    areas: [
      "Control de Infecciones",
      "Quirófanos",
      "Esterilización",
      "Mantenimiento General",
      "Calidad",
    ],
    campos: ["Minutos de tolerancia en aislamiento", "Unidades HEPA disponibles"],
  },
  "AOP-GAS-01": {
    titulo: "Alarma de gases medicinales sin pérdida de suministro",
    tipo: "aop",
    sistema: "gases",
    queConfirma: "Tiempos de reposición y corrección, criterio de calidad del aire, existencia de cilindros",
    areas: [
      "Mantenimiento General",
      "Proveedor del gas",
      "Regencia del Botiquín",
      "Enfermería",
      "Almacén",
    ],
    campos: ["Horas de reposición", "Minutos de corrección", "Horas sin redundancia"],
  },
  "AOP-ELE-01": {
    titulo: "Condición anormal del sistema eléctrico esencial sin pérdida de suministro",
    tipo: "aop",
    sistema: "electrico",
    queConfirma:
      "Umbrales de combustible y autonomía, contrato de planta de alquiler, autonomía del UPS, criterio de deterioro",
    areas: [
      "Mantenimiento General",
      "Tecnología",
      "Compras y Finanzas",
      "Comité de Emergencias",
      "Gerencia de Operaciones",
    ],
    campos: ["Litros", "Horas de autonomía", "Porcentaje del UPS"],
  },
  "AOP-AGU-01": {
    titulo: "Temperatura, nivel o residual de cloro fuera de rango en el sistema de agua",
    tipo: "aop",
    sistema: "agua",
    queConfirma: "Criterios de evaluación de riesgo y muestreo, tiempos de respuesta, valor de cloro",
    areas: ["Control de Infecciones", "Laboratorio", "Mantenimiento General", "Legal"],
    campos: ["Horas de corrección", "mg/L de cloro"],
  },

  // ── Semana 3 · EOP, con simulacro de mesa
  "EOP-ELE-01": {
    titulo: "Pérdida de red con transferencia fallida",
    tipo: "eop",
    sistema: "electrico",
    queConfirma:
      "Procedimiento manual de planta y transferencia, acciones clínicas, prioridades, umbral de activación del plan",
    areas: [
      "Mantenimiento General",
      "Enfermería",
      "Dirección Médica",
      "Tecnología",
      "Vigilancia",
      "Comité de Emergencias",
    ],
    campos: ["Extensión de la central", "Minutos de activación", "Autonomía del UPS"],
  },
  "EOP-GAS-01": {
    titulo: "Falla del suministro de oxígeno por tubería",
    tipo: "eop",
    sistema: "gases",
    queConfirma:
      "Acciones clínicas, dotación de cilindros por unidad, contacto del proveedor, criterio de traslado",
    areas: [
      "Anestesia",
      "Terapia Respiratoria",
      "Enfermería",
      "Regencia del Botiquín",
      "Almacén",
      "Mantenimiento General",
      "Dirección Médica",
    ],
    campos: ["Número de emergencia del proveedor", "Horas de autonomía de la reserva"],
  },
  "EOP-HVAC-01": {
    titulo: "Falla de ventilación o climatización de un quirófano con cirugía en curso",
    tipo: "eop",
    sistema: "hvac",
    queConfirma: "Decisión clínica, criterio de liberación, material expuesto, respaldo disponible",
    areas: [
      "Quirófanos",
      "Cirugía",
      "Anestesia",
      "Control de Infecciones",
      "Esterilización",
      "Mantenimiento General",
      "Calidad",
    ],
    campos: ["Extensión 24 horas", "Intervalo de informes", "Minutos de estabilización"],
  },
  "EOP-AGU-01": {
    titulo: "Pérdida o contaminación del suministro de agua",
    tipo: "eop",
    sistema: "agua",
    queConfirma: "Reglas por uso, guía de diálisis, contrato de cisterna móvil, autoridad sanitaria",
    areas: [
      "Control de Infecciones",
      "Hemodiálisis",
      "Mantenimiento Biomédico",
      "Esterilización",
      "Cocina",
      "Almacén",
      "Laboratorio",
      "Compras y Finanzas",
      "Legal",
    ],
    campos: ["Proveedor y tiempo de entrega", "Horas de autonomía"],
  },
  "EOP-ASC-01": {
    titulo: "Atrapamiento de personas en un ascensor",
    tipo: "eop",
    sistema: "ascensores",
    queConfirma:
      "Tiempo de respuesta contractual, lista de aviso, prohibición de liberación propia, criterio de aviso a Bomberos",
    areas: [
      "Mantenimiento General",
      "Proveedor de ascensores",
      "Vigilancia",
      "Central telefónica",
      "Enfermería",
      "Seguridad y Salud Ocupacional",
      "Gerencia General",
    ],
    campos: ["Cargo del coordinador fuera de horario", "Lista de aviso", "Número de Bomberos"],
  },

  // ── Semana 4 · MOP (riesgo alto en los cinco)
  "MOP-ELE-01": {
    titulo: "Prueba mensual de planta de emergencia con transferencia de carga",
    tipo: "mop",
    sistema: "electrico",
    nivelRiesgo: "alto",
    queConfirma:
      "Valores del fabricante, método de inicio por transferencia, ventana y confirmación por radio",
    areas: [
      "Mantenimiento General",
      "Quirófanos",
      "Enfermería",
      "Tecnología",
      "Seguridad y Salud Ocupacional",
      "Calidad",
    ],
    campos: ["kW de placa", "Tolerancia de frecuencia"],
  },
  "MOP-HVAC-01": {
    titulo: "Cambio de filtros y mantenimiento de la manejadora de un quirófano, con ICRA",
    tipo: "mop",
    sistema: "hvac",
    nivelRiesgo: "alto",
    queConfirma:
      "Clase de ICRA por tipo de trabajo, criterios de liberación, revalidación, bloqueo y etiquetado",
    areas: [
      "Control de Infecciones",
      "Quirófanos",
      "Mantenimiento General",
      "Servicios Generales",
      "Seguridad y Salud Ocupacional",
      "Contratista",
    ],
    campos: ["Presión diferencial de cambio", "Minutos de estabilización"],
  },
  "MOP-GAS-01": {
    titulo: "Aislamiento programado de una zona de gases medicinales",
    tipo: "mop",
    sistema: "gases",
    nivelRiesgo: "alto",
    queConfirma:
      "Papel de control de calidad, norma de pruebas, certificación del soldador, reserva mínima de cilindros",
    areas: [
      "Regencia del Botiquín",
      "Legal",
      "Enfermería",
      "Terapia Respiratoria",
      "Mantenimiento General",
      "Seguridad y Salud Ocupacional",
      "Proveedor del gas",
    ],
    campos: ["Presión y duración de prueba", "Criterio de concentración", "Cilindros de reserva"],
  },
  "MOP-AGU-01": {
    titulo: "Limpieza y desinfección de cisterna y desinfección de la red",
    tipo: "mop",
    sistema: "agua",
    nivelRiesgo: "alto",
    queConfirma:
      "Permiso de espacio confinado, dosis y tiempo de contacto, criterio de liberación, reinicio de equipos",
    areas: [
      "Seguridad y Salud Ocupacional",
      "Control de Infecciones",
      "Mantenimiento Biomédico",
      "Hemodiálisis",
      "Esterilización",
      "Laboratorio",
      "Cocina",
      "Legal",
    ],
    campos: ["Reserva de agua", "mg/L y horas", "Horas para resultado"],
  },
  "MOP-INC-01": {
    titulo: "Prueba anual de flujo de la bomba contra incendios con el sistema en deterioro",
    tipo: "mop",
    sistema: "incendios",
    nivelRiesgo: "alto",
    queConfirma:
      "Vigilancia contra incendios, puntos de la curva, aviso al Cuerpo de Bomberos, aseguradora",
    areas: [
      "Seguridad y Salud Ocupacional",
      "Mantenimiento General",
      "Contratista",
      "Legal",
      "Calidad",
    ],
    campos: ["Puntos de caudal", "Partes a notificar"],
  },

  // ── Fase 51 · los cinco que faltaban para cerrar el juego por familia
  // Escritos cortos a propósito: incendios y ascensores no tenían la cadena
  // completa, y una familia incompleta es una familia que el sistema no puede
  // gobernar cuando algo pasa.
  "AOP-INC-01": {
    titulo: "Sistema contra incendios fuera de servicio, total o parcial",
    tipo: "aop",
    sistema: "incendios",
    queConfirma:
      "Horas máximas de deterioro, vigilancia contra incendios, avisos a Bomberos y a la aseguradora, criterio de cierre de área",
    areas: [
      "Seguridad y Salud Ocupacional",
      "Mantenimiento General",
      "Legal",
      "Calidad",
      "Proveedor de alarma y rociadores",
    ],
    campos: [
      "Cargo que autoriza el deterioro",
      "Horas máximas sin vigilancia",
      "Número de Bomberos",
      "Contacto de la aseguradora",
    ],
  },
  "EOP-INC-01": {
    titulo: "Alarma de incendio o fuego confirmado",
    tipo: "eop",
    sistema: "incendios",
    queConfirma:
      "Las tres primeras acciones (rescatar, alarma, confinar), el mando, el criterio de evacuación horizontal y quién autoriza reocupar",
    areas: [
      "Seguridad y Salud Ocupacional",
      "Enfermería",
      "Dirección Médica",
      "Mantenimiento General",
      "Vigilancia",
      "Central telefónica",
      "Cocina",
    ],
    campos: [
      "Número de Bomberos",
      "Extensión de la central",
      "Texto del aviso por altavoz",
      "Punto de reunión",
      "Compartimiento de evacuación por piso",
    ],
  },
  "SCP-ASC-01": {
    titulo: "Ascensores: configuración normal",
    tipo: "scp",
    sistema: "ascensores",
    queConfirma:
      "Inventario y paradas, capacidad, rama eléctrica, teléfono de cabina, inspección vigente y quién puede liberar personas",
    areas: [
      "Mantenimiento General",
      "Proveedor de ascensores",
      "Seguridad y Salud Ocupacional",
      "Tecnología",
      "Calidad",
    ],
    campos: [
      "Identificación de cada ascensor",
      "Capacidad",
      "Paradas",
      "Rama eléctrica",
      "A dónde timbra el teléfono de cabina",
      "Tiempo de respuesta contractual",
    ],
  },
  "AOP-ASC-01": {
    titulo: "Ascensor con falla, sin personas atrapadas",
    tipo: "aop",
    sistema: "ascensores",
    queConfirma:
      "Criterio para sacarlo de servicio, tiempo de respuesta del proveedor y ruta alterna de traslado de pacientes",
    areas: ["Mantenimiento General", "Proveedor de ascensores", "Enfermería", "Seguridad y Salud Ocupacional"],
    campos: [
      "Tiempo de respuesta contractual",
      "Número de emergencia del proveedor",
      "Ruta alterna de traslado",
      "Horas máximas con un solo ascensor",
    ],
  },
  "MOP-ASC-01": {
    titulo: "Puesta fuera de servicio programada de un ascensor",
    tipo: "mop",
    sistema: "ascensores",
    nivelRiesgo: "alto",
    queConfirma:
      "Ventana autorizada, bloqueo y etiquetado, ruta alterna de traslado y la prueba de recorrido con la que se repone",
    areas: [
      "Mantenimiento General",
      "Proveedor de ascensores",
      "Enfermería",
      "Seguridad y Salud Ocupacional",
      "Servicios Generales",
    ],
    campos: ["Ventana autorizada", "Cargo que autoriza", "Ruta alterna de traslado", "Cargo que firma la prueba"],
  },
};

/** Los 30 códigos cortos del volumen y sus cinco complementos, en orden. */
export const CODIGOS_VOLUMEN = Object.keys(MATRIZ_CAP08);

/** Devuelve la fila del 8.2 para un código corto (tolera minúsculas y espacios). */
export function filaMatriz(codigoCorto: string | null | undefined): FilaMatriz | null {
  if (!codigoCorto) return null;
  return MATRIZ_CAP08[codigoCorto.trim().toUpperCase()] ?? null;
}

/** Áreas y campos que el cap. 08 asigna a un documento, para precargar la ficha. */
export function sugerenciaCap08(codigoCorto: string | null | undefined): {
  areas: Array<{ area: string; queConfirma: string }>;
  campos: string[];
} {
  const fila = filaMatriz(codigoCorto);
  if (!fila) return { areas: [], campos: [] };
  return {
    areas: fila.areas.map((area) => ({ area, queConfirma: fila.queConfirma })),
    campos: fila.campos,
  };
}

// ─── Permisos ────────────────────────────────────────────────────────────────

export const puedeVerProcedimientos = (rol: string): boolean =>
  ["admin", "jefe", "tecnico", "visualizador"].includes(rol);

export const puedeAdministrarProcedimientos = (rol: string): boolean =>
  ["admin", "jefe"].includes(rol);

// ─── Versión / revisión ──────────────────────────────────────────────────────

/** Suma 0.1 a la versión; 0.9 → 1.0, y de 1.0 en adelante sube de mayor en mayor. */
export function siguienteVersion(actual: string | null | undefined): string {
  const n = Number.parseFloat((actual ?? "0.1").replace(",", "."));
  if (!Number.isFinite(n)) return "1.0";
  if (n < 1) return (Math.round((n + 0.1) * 10) / 10).toFixed(1);
  return (Math.floor(n) + 1).toFixed(1);
}

/**
 * Revisión anual contada en texto, sin pasar por Date: "YYYY-MM-DD" + 1 año.
 * (new Date("YYYY-MM-DD") desfasa un día en UTC-6.)
 */
export function revisionAnual(desdeISO: string): string {
  const [y, m, d] = desdeISO.slice(0, 10).split("-");
  const anio = Number(y);
  if (!Number.isFinite(anio)) return desdeISO;
  // 29 de febrero → 28 de febrero del año siguiente.
  if (m === "02" && d === "29") return `${anio + 1}-02-28`;
  return `${anio + 1}-${m}-${d}`;
}

/** Hoy en El Salvador (UTC-6) como "YYYY-MM-DD", sin depender del TZ del worker. */
export function hoyISO(): string {
  return new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
