-- Fase 17: Encuestas de satisfacción para órdenes de trabajo

CREATE TABLE encuestas_satisfaccion (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  orden_id integer REFERENCES ordenes(id) ON DELETE CASCADE,
  ticket_id integer REFERENCES tickets(id) ON DELETE SET NULL,
  token text NOT NULL UNIQUE,
  destinatario_email text NOT NULL,
  destinatario_nombre text,
  calificacion integer,           -- 1..5, NULL si no respondida
  comentario text,
  respondida_en text,
  enviada_en text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  recordatorio_enviado_en text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_encuestas_orden ON encuestas_satisfaccion (orden_id);
CREATE INDEX IF NOT EXISTS idx_encuestas_token ON encuestas_satisfaccion (token);
CREATE INDEX IF NOT EXISTS idx_encuestas_calificacion ON encuestas_satisfaccion (calificacion);
CREATE INDEX IF NOT EXISTS idx_encuestas_respondida ON encuestas_satisfaccion (respondida_en);
