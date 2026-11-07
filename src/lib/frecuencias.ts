export type Frecuencia =
  | "turno"
  | "diaria"
  | "semanal"
  | "quincenal"
  | "mensual"
  | "bimestral"
  | "cuatrimestral"
  | "trimestral"
  | "semestral"
  | "anual";

export const FRECUENCIAS: { value: Frecuencia; label: string; dias: number }[] = [
  { value: "turno", label: "Por turno", dias: 1 },
  { value: "diaria", label: "Diaria", dias: 1 },
  { value: "semanal", label: "Semanal", dias: 7 },
  { value: "quincenal", label: "Quincenal (15 dias)", dias: 15 },
  { value: "mensual", label: "Mensual", dias: 30 },
  { value: "bimestral", label: "Bimestral (2 meses)", dias: 60 },
  { value: "trimestral", label: "Trimestral (3 meses)", dias: 90 },
  { value: "cuatrimestral", label: "Cuatrimestral (3 veces al año)", dias: 120 },
  { value: "semestral", label: "Semestral (6 meses)", dias: 180 },
  { value: "anual", label: "Anual", dias: 365 },
];

export function siguienteFecha(desde: string | Date, frecuencia: Frecuencia): string {
  const base = typeof desde === "string" ? new Date(desde) : desde;
  const next = new Date(base);
  switch (frecuencia) {
    case "turno":
    case "diaria":
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    case "semanal":
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case "quincenal":
      next.setUTCDate(next.getUTCDate() + 15);
      break;
    case "mensual":
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
    case "bimestral":
      next.setUTCMonth(next.getUTCMonth() + 2);
      break;
    case "trimestral":
      next.setUTCMonth(next.getUTCMonth() + 3);
      break;
    case "cuatrimestral":
      next.setUTCMonth(next.getUTCMonth() + 4);
      break;
    case "semestral":
      next.setUTCMonth(next.getUTCMonth() + 6);
      break;
    case "anual":
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
  }
  return next.toISOString().slice(0, 10);
}
