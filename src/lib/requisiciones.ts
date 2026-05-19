// Estados y etiquetas de requisiciones de compra

export type EstadoReq =
  | "borrador" | "enviada" | "aprobada" | "rechazada"
  | "recibida_parcial" | "recibida" | "cancelada";

export const REQ_LABEL: Record<EstadoReq, string> = {
  borrador:         "Borrador",
  enviada:          "Enviada",
  aprobada:         "Aprobada",
  rechazada:        "Rechazada",
  recibida_parcial: "Recibida parcial",
  recibida:         "Recibida",
  cancelada:        "Cancelada",
};

export const REQ_COLOR: Record<EstadoReq, string> = {
  borrador:         "bg-slate-100 text-slate-700",
  enviada:          "bg-blue-100 text-blue-700",
  aprobada:         "bg-emerald-100 text-emerald-700",
  rechazada:        "bg-red-100 text-red-700",
  recibida_parcial: "bg-amber-100 text-amber-700",
  recibida:         "bg-teal-100 text-teal-700",
  cancelada:        "bg-slate-200 text-slate-500",
};

// Transiciones permitidas según rol
export function transicionesReq(actual: EstadoReq, rol: string): EstadoReq[] {
  const esAdminJefe = rol === "admin" || rol === "jefe";
  const esTecnico = rol === "tecnico";

  switch (actual) {
    case "borrador":
      return esAdminJefe || esTecnico ? ["enviada", "cancelada"] : [];
    case "enviada":
      return esAdminJefe ? ["aprobada", "rechazada", "cancelada"] : [];
    case "aprobada":
      return esAdminJefe ? ["recibida_parcial", "recibida", "cancelada"] : [];
    case "recibida_parcial":
      return esAdminJefe ? ["recibida", "cancelada"] : [];
    default:
      return [];
  }
}
