// ─── Rubros de mantenimiento ─────────────────────────────────────────────────
// Taxonomía institucional (alineada a la estructura de un Plan de
// Mantenimiento Hospitalario): agrupa equipos, actividades, presupuesto y
// gastos bajo los mismos rubros para reportes y control gerencial.

export const RUBROS = {
  locativo:   { label: "Mantenimiento locativo",      icono: "🏗", orden: 1 },
  redes:      { label: "Redes (agua, gases, incendio)", icono: "🔗", orden: 2 },
  biomedico:  { label: "Dotación biomédica",          icono: "🩺", orden: 3 },
  industrial: { label: "Equipo industrial",           icono: "⚙️", orden: 4 },
  ti:         { label: "TI y comunicaciones",         icono: "💻", orden: 5 },
  mobiliario: { label: "Mobiliario",                  icono: "🪑", orden: 6 },
  flota:      { label: "Vehículos / flota",           icono: "🚗", orden: 7 },
} as const;

export type RubroKey = keyof typeof RUBROS;

export const RUBRO_KEYS = (Object.keys(RUBROS) as RubroKey[]).sort(
  (a, b) => RUBROS[a].orden - RUBROS[b].orden,
);

export const rubroLabel = (k: string | null | undefined): string =>
  k && k in RUBROS ? RUBROS[k as RubroKey].label : "Sin rubro";

export const rubroIcono = (k: string | null | undefined): string =>
  k && k in RUBROS ? RUBROS[k as RubroKey].icono : "📋";

export const MODALIDAD_LABEL: Record<string, string> = {
  interno: "Personal propio",
  contratado: "Empresa externa",
  mixto: "Mixto (propio + externo)",
};

export const fmtMonto = (n: number) =>
  "$" + n.toLocaleString("es-SV", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
