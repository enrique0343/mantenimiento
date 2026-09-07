-- Áreas de trabajo compartiendo cuentas, ubicaciones y recursos existentes.
ALTER TABLE activos ADD COLUMN datos_tecnicos TEXT;
ALTER TABLE tickets ADD COLUMN rubro TEXT CHECK (rubro IN ('aires','infraestructura','equipo_general','biomedico'));
ALTER TABLE ordenes ADD COLUMN rubro TEXT CHECK (rubro IN ('aires','infraestructura','equipo_general','biomedico'));
ALTER TABLE actividades ADD COLUMN rubro TEXT CHECK (rubro IN ('aires','infraestructura','equipo_general','biomedico'));

UPDATE actividades SET rubro = COALESCE(
  (SELECT CASE WHEN c.rubro IN ('aires','infraestructura','equipo_general','biomedico') THEN c.rubro END
   FROM actividad_categorias c WHERE c.id = actividades.categoria_id), 'infraestructura');
UPDATE tickets SET rubro = COALESCE(
  (SELECT CASE WHEN a.rubro IN ('aires','infraestructura','equipo_general','biomedico') THEN a.rubro
    WHEN a.tipo = 'biomedico' THEN 'biomedico' ELSE 'equipo_general' END
   FROM activos a WHERE a.id = tickets.activo_id),
  CASE WHEN tipo_mantenimiento = 'biomedico' THEN 'biomedico' ELSE 'equipo_general' END);
UPDATE ordenes SET rubro = COALESCE(
  (SELECT CASE WHEN a.rubro IN ('aires','infraestructura','equipo_general','biomedico') THEN a.rubro
    WHEN a.tipo = 'biomedico' THEN 'biomedico' ELSE 'equipo_general' END
   FROM activos a WHERE a.id = ordenes.activo_id),
  (SELECT ac.rubro FROM actividades ac WHERE ac.id = ordenes.actividad_id),
  (SELECT t.rubro FROM tickets t WHERE t.ot_id = ordenes.id LIMIT 1), 'equipo_general');

CREATE INDEX IF NOT EXISTS idx_activos_rubro ON activos(rubro);
CREATE INDEX IF NOT EXISTS idx_tickets_rubro_estado ON tickets(rubro, estado);
CREATE INDEX IF NOT EXISTS idx_ordenes_rubro_estado ON ordenes(rubro, estado);
CREATE INDEX IF NOT EXISTS idx_actividades_rubro ON actividades(rubro);
