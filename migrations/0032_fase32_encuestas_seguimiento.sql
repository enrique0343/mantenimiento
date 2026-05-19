-- Seguimiento de encuestas por parte de admin/jefe
-- Permite marcar una respuesta como atendida y registrar la accion tomada
ALTER TABLE encuestas_satisfaccion ADD COLUMN leida_por INTEGER REFERENCES usuarios(id);
ALTER TABLE encuestas_satisfaccion ADD COLUMN leida_en TEXT;
ALTER TABLE encuestas_satisfaccion ADD COLUMN respuesta_jefe TEXT;
