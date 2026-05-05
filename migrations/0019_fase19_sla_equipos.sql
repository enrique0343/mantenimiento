-- Fase 19: SLA por equipo (4 niveles según prioridad)
-- Las horas indican el plazo desde apertura de la OT hasta su completado

ALTER TABLE activos ADD COLUMN sla_urgente_horas INTEGER NOT NULL DEFAULT 4;
ALTER TABLE activos ADD COLUMN sla_alta_horas    INTEGER NOT NULL DEFAULT 24;
ALTER TABLE activos ADD COLUMN sla_media_horas   INTEGER NOT NULL DEFAULT 72;
ALTER TABLE activos ADD COLUMN sla_baja_horas    INTEGER NOT NULL DEFAULT 168;
