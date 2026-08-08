// ─── Dominios de mantenimiento ───────────────────────────────────────────────
// Taxonomía institucional del "Sistema de Planificación de Mantenimiento
// General" (GO-PRY-0XX-2026): cuatro dominios que agrupan equipos,
// actividades, presupuesto, gastos y el plan anual.

export const RUBROS = {
  infraestructura: { label: "Infraestructura",       icono: "🏗", orden: 1 },
  aires:           { label: "Aires acondicionados",  icono: "❄️", orden: 2 },
  equipo_general:  { label: "Equipo general",        icono: "⚙️", orden: 3 },
  biomedico:       { label: "Equipo biomédico",      icono: "🩺", orden: 4 },
} as const;

export type RubroKey = keyof typeof RUBROS;

export const RUBRO_KEYS = (Object.keys(RUBROS) as RubroKey[]).sort(
  (a, b) => RUBROS[a].orden - RUBROS[b].orden,
);

export const rubroLabel = (k: string | null | undefined): string =>
  k && k in RUBROS ? RUBROS[k as RubroKey].label : "Sin categoría";

export const rubroIcono = (k: string | null | undefined): string =>
  k && k in RUBROS ? RUBROS[k as RubroKey].icono : "📋";

// Dominio por defecto cuando un registro aún no fue clasificado
export const rubroDeActivo = (rubro: string | null | undefined, tipo?: string | null): RubroKey => {
  if (rubro && rubro in RUBROS) return rubro as RubroKey;
  return tipo === "biomedico" ? "biomedico" : "equipo_general";
};
export const rubroDeActividad = (rubro: string | null | undefined): RubroKey =>
  rubro && rubro in RUBROS ? (rubro as RubroKey) : "infraestructura";

// ─── Subcategorías del dominio biomédico ─────────────────────────────────────
// Segmentación por función clínica (referencia JCI FMS / clasificación ECRI).
export const SUBCATS_BIOMEDICO = {
  soporte_vida:   { label: "Soporte de vida",        icono: "🫀", orden: 1 },
  diagnostico:    { label: "Diagnóstico",            icono: "🔬", orden: 2 },
  tratamiento:    { label: "Tratamiento",            icono: "💉", orden: 3 },
  esterilizacion: { label: "Esterilización (CEYE)",  icono: "♨️", orden: 4 },
  cadena_frio:    { label: "Cadena de frío",         icono: "🧊", orden: 5 },
  imagenologia:   { label: "Imagenología",           icono: "📷", orden: 6 },
  apoyo:          { label: "Apoyo clínico",          icono: "🛏", orden: 7 },
} as const;

export type SubcatKey = keyof typeof SUBCATS_BIOMEDICO;

export const SUBCAT_KEYS = (Object.keys(SUBCATS_BIOMEDICO) as SubcatKey[]).sort(
  (a, b) => SUBCATS_BIOMEDICO[a].orden - SUBCATS_BIOMEDICO[b].orden,
);

export const subcatLabel = (k: string | null | undefined): string =>
  k && k in SUBCATS_BIOMEDICO ? SUBCATS_BIOMEDICO[k as SubcatKey].label : "Sin segmentar";

export const subcatIcono = (k: string | null | undefined): string =>
  k && k in SUBCATS_BIOMEDICO ? SUBCATS_BIOMEDICO[k as SubcatKey].icono : "📋";

export const MODALIDAD_LABEL: Record<string, string> = {
  interno: "Personal propio",
  contratado: "Empresa externa",
  mixto: "Mixto (propio + externo)",
};

export const fmtMonto = (n: number) =>
  "$" + n.toLocaleString("es-SV", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
