// Categorías predefinidas del inventario (sugerencias para datalist).
// El usuario puede seleccionar una o escribir otra libre.

export interface GrupoCategorias {
  grupo: string;
  icono: string;
  items: string[];
}

export const CATEGORIAS_INVENTARIO: GrupoCategorias[] = [
  {
    grupo: "Mantenimiento general",
    icono: "🔧",
    items: [
      "Filtros HVAC / aire",
      "Refrigerantes y gases (R-410A, R-22, etc.)",
      "Lubricantes y aceites",
      "Tornillería y ferretería",
      "Eléctrico (cables, breakers, contactos)",
      "Iluminación (lámparas, focos, tubos)",
      "Plomería (tuberías, válvulas, conexiones)",
      "Pintura y químicos",
      "Limpieza y consumibles",
      "Herramientas",
      "EPP (equipo de protección personal)",
      "Repuestos generales",
      "Bandas y poleas",
      "Sellos, empaques y o-rings",
      "Baterías generales",
    ],
  },
  {
    grupo: "Mantenimiento biomédico",
    icono: "🩺",
    items: [
      "Filtros HEPA / médicos",
      "Sensores médicos (SpO₂, ECG, temperatura)",
      "Baterías de respaldo (UPS y equipos)",
      "Accesorios de monitoreo de paciente",
      "Cables de paciente",
      "Electrodos y geles conductores",
      "Sondas y catéteres",
      "Kits de calibración",
      "Repuestos biomédicos",
      "Mangueras y tubuladuras médicas",
      "Lámparas quirúrgicas / endoscópicas",
      "Consumibles de esterilización",
      "Filtros de oxígeno y mezcladores",
    ],
  },
];
