-- Fase 15: Trazabilidad - tickets ahora referencian ubicacion del catalogo

ALTER TABLE tickets ADD COLUMN ubicacion_id integer REFERENCES ubicaciones(id);
CREATE INDEX IF NOT EXISTS idx_tickets_ubicacion ON tickets (ubicacion_id);
