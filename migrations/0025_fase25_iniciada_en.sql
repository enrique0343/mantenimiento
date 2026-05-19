-- Fase 25: Hora de inicio de OT (para calcular horas trabajadas automáticamente)
-- iniciada_en se setea cuando la OT pasa de "abierta" a "en_proceso"
-- al completarse, horas_trabajadas = (completada_en - iniciada_en) / 3600

ALTER TABLE ordenes ADD COLUMN iniciada_en TEXT;
