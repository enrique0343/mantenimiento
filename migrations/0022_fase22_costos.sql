-- Fase 22: Tarifa horaria por usuario (técnicos) para cálculo de costo de OT

ALTER TABLE usuarios ADD COLUMN tarifa_hora REAL NOT NULL DEFAULT 0;
