// Categorías predefinidas de equipos / activos.
// Sugerencias para el datalist; el usuario puede escribir libre.

export const CATEGORIAS_GENERAL = [
  "Aires acondicionados",
  "Generadores eléctricos",
  "UPS / respaldo eléctrico",
  "Electrodomésticos",
  "Cuartos fríos / refrigeración",
  "Compresores",
  "Bombas y motores",
  "Iluminación",
  "Sistemas eléctricos",
  "Plantas tratadoras de agua",
  "Tanques presurizados",
  "Calderas / calentadores",
  "Equipos de gimnasio",
  "Equipos de oficina (impresoras, etc.)",
  "Telecomunicaciones / TI",
  "Cocina industrial",
  "Lavandería industrial",
  "Otros",
] as const;

export const CATEGORIAS_BIOMEDICO = [
  "Ventiladores mecánicos",
  "Monitores de signos vitales",
  "Bombas de infusión",
  "Desfibriladores",
  "Electrocardiógrafos",
  "Equipos de imagen (rayos X / ultrasonido)",
  "Equipos de laboratorio",
  "Esterilizadores / autoclaves",
  "Camas y mobiliario clínico",
  "Equipos quirúrgicos",
  "Anestesia",
  "Endoscopia",
  "Diálisis",
  "Incubadoras / cunas",
  "Aspiradores y succión",
  "Bombas de jeringa",
  "Oxigenoterapia",
  "Otros biomédicos",
] as const;

export function categoriasParaTipo(tipo: "general" | "biomedico"): readonly string[] {
  return tipo === "biomedico" ? CATEGORIAS_BIOMEDICO : CATEGORIAS_GENERAL;
}

// Para vista agrupada: dado un texto libre devuelve un grupo "normalizado"
// (busca coincidencia parcial; si no encaja, lo devuelve como "Otros")
export function normalizarCategoria(cat: string | null | undefined, tipo: string | null | undefined): string {
  if (!cat) return "Sin categoría";
  const lista = tipo === "biomedico" ? CATEGORIAS_BIOMEDICO : CATEGORIAS_GENERAL;
  const lower = cat.toLowerCase();
  for (const c of lista) {
    if (lower.includes(c.toLowerCase().split(" ")[0])) return c;
  }
  // Reglas adicionales: HVAC = Aires acondicionados
  if (lower.includes("hvac") || lower.includes("aire") || lower.includes("ac ")) return "Aires acondicionados";
  if (lower.includes("ups") || lower.includes("bateri")) return "UPS / respaldo eléctrico";
  if (lower.includes("generador")) return "Generadores eléctricos";
  if (lower.includes("ventilador")) return "Ventiladores mecánicos";
  if (lower.includes("monitor")) return "Monitores de signos vitales";
  return cat; // devuelve tal cual si no coincide
}
