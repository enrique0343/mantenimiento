-- Tipo de mantenimiento (general/biomedico) en tickets para routing
ALTER TABLE tickets ADD COLUMN tipo_mantenimiento TEXT DEFAULT 'general';

-- Adjuntos públicos asociados a un ticket (fotos del solicitante).
-- Cuando el ticket se convierte en OT, estos se copian como adjuntos "antes".
CREATE TABLE IF NOT EXISTS ticket_adjuntos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  content_type TEXT NOT NULL,
  tamano INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
