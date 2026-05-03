-- Fase 10: Firmas digitales (canvas → PNG en R2) y referencia para PDFs

ALTER TABLE ordenes ADD COLUMN firma_tecnico_r2 text;
ALTER TABLE ordenes ADD COLUMN firma_tecnico_nombre text;
ALTER TABLE ordenes ADD COLUMN firma_tecnico_fecha text;
ALTER TABLE ordenes ADD COLUMN firma_jefe_r2 text;
ALTER TABLE ordenes ADD COLUMN firma_jefe_nombre text;
ALTER TABLE ordenes ADD COLUMN firma_jefe_fecha text;
ALTER TABLE ordenes ADD COLUMN firma_solicitante_r2 text;
ALTER TABLE ordenes ADD COLUMN firma_solicitante_nombre text;
ALTER TABLE ordenes ADD COLUMN firma_solicitante_fecha text;
