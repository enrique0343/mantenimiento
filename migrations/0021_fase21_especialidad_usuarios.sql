-- Fase 21: Especialidad por usuario (general | biomedico | ambos)
-- Permite separar jefes/tecnicos por dominio para filtrar vistas y dirigir
-- notificaciones automaticas.
-- NULL = sin especialidad asignada (admin, solicitante, motorista, etc.)

ALTER TABLE usuarios ADD COLUMN especialidad TEXT
  CHECK (especialidad IN ('general', 'biomedico', 'ambos'));
CREATE INDEX IF NOT EXISTS idx_usuarios_especialidad ON usuarios (especialidad);
