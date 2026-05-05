-- Fase 23: Telegram chat_id por usuario + notificaciones in-app + token de calendario

ALTER TABLE usuarios ADD COLUMN telegram_chat_id TEXT;
ALTER TABLE usuarios ADD COLUMN calendar_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_calendar_token ON usuarios (calendar_token);

CREATE TABLE notificaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  mensaje TEXT,
  link TEXT,
  leida INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notif_usuario_leida ON notificaciones (usuario_id, leida);
CREATE INDEX IF NOT EXISTS idx_notif_created ON notificaciones (created_at);
