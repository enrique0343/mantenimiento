-- Fase 5: Helpdesk - tickets publicos con tracking token, conversion a OT

CREATE TABLE tickets (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  tracking_token text NOT NULL UNIQUE,
  -- Solicitante (externo o usuario interno)
  solicitante_nombre text NOT NULL,
  solicitante_email text NOT NULL,
  solicitante_telefono text,
  solicitante_usuario_id integer REFERENCES usuarios(id),
  -- Contenido
  asunto text NOT NULL,
  descripcion text NOT NULL,
  prioridad text NOT NULL DEFAULT 'media',
  -- Ubicacion / contexto
  sucursal_id integer REFERENCES sucursales(id),
  ubicacion text,
  activo_id integer REFERENCES activos(id),
  -- Estado y SLA
  estado text NOT NULL DEFAULT 'nuevo',
  sla_horas integer,
  vencimiento_sla text,
  -- Asignacion / resolucion
  asignado_a integer REFERENCES usuarios(id),
  ot_id integer REFERENCES ordenes(id),
  resuelto_en text,
  resolucion_notas text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tickets_estado ON tickets (estado);
CREATE INDEX IF NOT EXISTS idx_tickets_asignado ON tickets (asignado_a);
CREATE INDEX IF NOT EXISTS idx_tickets_vencimiento ON tickets (vencimiento_sla);

CREATE TABLE ticket_comentarios (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  ticket_id integer NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  usuario_id integer REFERENCES usuarios(id),
  autor_externo text,
  texto text NOT NULL,
  publico integer NOT NULL DEFAULT 1,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ticket_com_ticket ON ticket_comentarios (ticket_id);
