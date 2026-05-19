// Cálculo de SLA por equipo + prioridad
// Devuelve la fecha de vencimiento (ISO) de una OT en función de su equipo

export type Prioridad = "baja" | "media" | "alta" | "urgente";

interface EquipoSLA {
  slaUrgenteHoras: number;
  slaAltaHoras: number;
  slaMediaHoras: number;
  slaBajaHoras: number;
}

const SLA_DEFAULT_HORAS: Record<Prioridad, number> = {
  urgente: 4,
  alta: 24,
  media: 72,
  baja: 168,
};

export function horasSlaPara(equipo: EquipoSLA | null | undefined, prioridad: Prioridad): number {
  if (!equipo) return SLA_DEFAULT_HORAS[prioridad];
  switch (prioridad) {
    case "urgente": return equipo.slaUrgenteHoras ?? SLA_DEFAULT_HORAS.urgente;
    case "alta":    return equipo.slaAltaHoras ?? SLA_DEFAULT_HORAS.alta;
    case "media":   return equipo.slaMediaHoras ?? SLA_DEFAULT_HORAS.media;
    case "baja":    return equipo.slaBajaHoras ?? SLA_DEFAULT_HORAS.baja;
  }
}

export function calcularVencimiento(
  inicioISO: string,
  equipo: EquipoSLA | null | undefined,
  prioridad: Prioridad
): string {
  const horas = horasSlaPara(equipo, prioridad);
  const inicio = new Date(inicioISO);
  inicio.setHours(inicio.getHours() + horas);
  return inicio.toISOString();
}

export function estadoSla(vencimientoISO: string | null | undefined): {
  estado: "ok" | "warning" | "vencido" | "sin_sla";
  horasRestantes: number;
} {
  if (!vencimientoISO) return { estado: "sin_sla", horasRestantes: 0 };
  const venc = new Date(vencimientoISO).getTime();
  const ahora = Date.now();
  const horasRestantes = (venc - ahora) / 3600_000;
  if (horasRestantes < 0) return { estado: "vencido", horasRestantes };
  if (horasRestantes < 4) return { estado: "warning", horasRestantes };
  return { estado: "ok", horasRestantes };
}
