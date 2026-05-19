-- Soporte para OT en estado "en_espera" (pausada por compra pendiente u otro motivo)
-- SQLite no valida enums, así que sólo necesitamos añadir las columnas de tracking
ALTER TABLE ordenes ADD COLUMN pausada_en TEXT;
ALTER TABLE ordenes ADD COLUMN tiempo_pausado_min INTEGER DEFAULT 0;
