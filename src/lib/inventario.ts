export const UNIDADES = [
  { value: "unidad", label: "Unidad" },
  { value: "caja", label: "Caja" },
  { value: "litro", label: "Litro" },
  { value: "ml", label: "ml" },
  { value: "kg", label: "Kilogramo" },
  { value: "g", label: "Gramo" },
  { value: "metro", label: "Metro" },
  { value: "rollo", label: "Rollo" },
  { value: "par", label: "Par" },
  { value: "set", label: "Set" },
] as const;

export const TIPO_MOV = ["entrada", "salida", "ajuste"] as const;
export type TipoMov = (typeof TIPO_MOV)[number];

export const MOTIVO_MOV: Record<string, string> = {
  recepcion: "Recepción de proveedor",
  consumo_ot: "Consumo en OT",
  ajuste_manual: "Ajuste manual",
  transferencia_in: "Transferencia (entrada)",
  transferencia_out: "Transferencia (salida)",
  devolucion: "Devolución",
  inicial: "Inventario inicial",
};

export const TIPO_MOV_COLOR: Record<TipoMov, string> = {
  entrada: "bg-emerald-100 text-emerald-700",
  salida: "bg-red-100 text-red-700",
  ajuste: "bg-amber-100 text-amber-700",
};

export const TIPO_MOV_LABEL: Record<TipoMov, string> = {
  entrada: "Entrada",
  salida: "Salida",
  ajuste: "Ajuste",
};

// Convierte cantidad firmada al tipo + cantidad positiva
export function signedToMov(delta: number): { tipo: TipoMov; cantidad: number } {
  if (delta > 0) return { tipo: "entrada", cantidad: delta };
  if (delta < 0) return { tipo: "salida", cantidad: Math.abs(delta) };
  return { tipo: "ajuste", cantidad: 0 };
}

// Convierte tipo + cantidad positiva al delta firmado para sumar al stock
export function movToSigned(tipo: TipoMov, cantidad: number): number {
  if (tipo === "entrada") return cantidad;
  if (tipo === "salida") return -cantidad;
  return cantidad; // ajuste: se interpreta como nueva cantidad o delta segun el endpoint
}

export function fmtCantidad(n: number, unidad?: string | null): string {
  const formatted = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return unidad ? `${formatted} ${unidad}` : formatted;
}
