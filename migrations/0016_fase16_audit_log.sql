-- Fase 16: Registro de auditoria - quien cambio que y cuando

CREATE TABLE audit_log (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  entidad text NOT NULL,           -- 'activo' | 'plan' | 'orden' | 'extintor' | etc.
  entidad_id integer NOT NULL,
  accion text NOT NULL,            -- 'create' | 'update' | 'delete' | 'estado'
  usuario_id integer REFERENCES usuarios(id),
  cambios text,                    -- JSON con { campo: { antes, despues } }
  resumen text,                    -- breve descripcion legible
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_entidad ON audit_log (entidad, entidad_id);
CREATE INDEX IF NOT EXISTS idx_audit_usuario ON audit_log (usuario_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at);
