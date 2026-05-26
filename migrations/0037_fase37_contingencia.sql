-- Fase 37: Gestión de contingencia (JCI FMS.9 — continuidad de servicios esenciales).
-- Vincula equipos críticos con sus equipos de respaldo y define el protocolo de
-- escalación por nivel de criticidad.

-- Equipos de respaldo: un equipo principal puede tener varios respaldos.
CREATE TABLE activo_respaldos (
  activo_id INTEGER NOT NULL REFERENCES activos(id) ON DELETE CASCADE,    -- equipo principal
  respaldo_id INTEGER NOT NULL REFERENCES activos(id) ON DELETE CASCADE,  -- equipo de respaldo
  notas TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (activo_id, respaldo_id)
);

-- Protocolo de escalación: niveles con contacto, tiempo y acción por criticidad.
CREATE TABLE escalacion_niveles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  criticidad TEXT NOT NULL DEFAULT 'alta',   -- alta | media | baja | todas
  nivel INTEGER NOT NULL DEFAULT 1,
  minutos_para_escalar INTEGER,
  contacto_nombre TEXT,
  contacto_cargo TEXT,
  contacto_telefono TEXT,
  contacto_email TEXT,
  accion TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Protocolo base de ejemplo para criticidad alta.
INSERT INTO escalacion_niveles (criticidad, nivel, minutos_para_escalar, contacto_cargo, accion) VALUES
  ('alta', 1, 0,   'Técnico de turno',        'Atender de inmediato y activar equipo de respaldo si existe.'),
  ('alta', 2, 60,  'Jefe de mantenimiento',   'Si no se resuelve en 1 h, notificar al jefe del área correspondiente.'),
  ('alta', 3, 240, 'Dirección / Gerencia',    'Si persiste a las 4 h, escalar a dirección y evaluar plan de contingencia.');
