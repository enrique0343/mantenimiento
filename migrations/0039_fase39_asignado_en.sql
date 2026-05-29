-- Fase 39: registrar cuándo se asigna una OT.
-- Permite mostrar en la lista de OTs la fecha de asignación y los días
-- transcurridos desde entonces, útil para detectar OTs estancadas.

ALTER TABLE ordenes ADD COLUMN asignado_en TEXT;

-- Backfill: para OTs ya asignadas, asumimos que fueron asignadas al crearse.
-- Es la mejor aproximación disponible sin escarbar el log de auditoría.
UPDATE ordenes SET asignado_en = created_at WHERE asignado_a IS NOT NULL;
