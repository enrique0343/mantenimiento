-- Fase 50: el juego de documentos se aplica POR FAMILIA DE EQUIPO.
-- "Todos los aires acondicionados deben aplicarse los mismos 5 documentos."
-- Un documento puede cubrir varias familias: la ronda por turno (SOP-MG-01)
-- recorre energia, gases, climatizacion, agua, incendios y ascensores en un
-- mismo recorrido, y hasta ahora quedaba suelta en el sistema "otro".

CREATE TABLE procedimiento_sistemas (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  procedimiento_id integer NOT NULL REFERENCES procedimientos(id) ON DELETE CASCADE,
  sistema text NOT NULL,
  UNIQUE(procedimiento_id, sistema)
);
CREATE INDEX idx_proc_sis ON procedimiento_sistemas(sistema);

-- Todo documento cubre, de entrada, su propio sistema
INSERT OR IGNORE INTO procedimiento_sistemas (procedimiento_id, sistema)
SELECT id, sistema FROM procedimientos WHERE sistema IS NOT NULL;

-- La ronda de sistemas criticos por turno los recorre todos.
-- (D1 limita los UNION ALL encadenados: una insercion por sistema.)
INSERT OR IGNORE INTO procedimiento_sistemas (procedimiento_id, sistema)
SELECT id, 'electrico' FROM procedimientos WHERE codigo_corto = 'SOP-MG-01';
INSERT OR IGNORE INTO procedimiento_sistemas (procedimiento_id, sistema)
SELECT id, 'hvac' FROM procedimientos WHERE codigo_corto = 'SOP-MG-01';
INSERT OR IGNORE INTO procedimiento_sistemas (procedimiento_id, sistema)
SELECT id, 'gases' FROM procedimientos WHERE codigo_corto = 'SOP-MG-01';
INSERT OR IGNORE INTO procedimiento_sistemas (procedimiento_id, sistema)
SELECT id, 'agua' FROM procedimientos WHERE codigo_corto = 'SOP-MG-01';
INSERT OR IGNORE INTO procedimiento_sistemas (procedimiento_id, sistema)
SELECT id, 'incendios' FROM procedimientos WHERE codigo_corto = 'SOP-MG-01';
INSERT OR IGNORE INTO procedimiento_sistemas (procedimiento_id, sistema)
SELECT id, 'ascensores' FROM procedimientos WHERE codigo_corto = 'SOP-MG-01';
