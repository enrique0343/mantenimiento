-- Fase 11: Log de envíos de email (auditoria)

CREATE TABLE email_log (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  destinatario text NOT NULL,
  asunto text NOT NULL,
  tipo text,           -- 'ticket_nuevo' | 'ot_asignada' | 'plan_vence' | etc.
  referencia text,     -- 'orden:123' | 'ticket:45'
  estado text NOT NULL DEFAULT 'enviado',  -- 'enviado' | 'error'
  error text,
  enviado_por integer REFERENCES usuarios(id),
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_log_referencia ON email_log (referencia);
CREATE INDEX IF NOT EXISTS idx_email_log_created ON email_log (created_at);
