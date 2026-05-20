-- Contratos de mantenimiento con proveedores externos
-- Permite registrar contratos vinculados a equipos, con alertas a 90/60/30 dias antes del vencimiento
CREATE TABLE contratos_mantenimiento (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
  tipo TEXT NOT NULL DEFAULT 'preventivo',
  alcance TEXT,
  fecha_inicio TEXT NOT NULL,
  fecha_fin TEXT NOT NULL,
  costo REAL NOT NULL DEFAULT 0,
  periodicidad_costo TEXT DEFAULT 'anual',
  numero_contrato_externo TEXT,
  contacto_proveedor TEXT,
  telefono_contacto TEXT,
  email_contacto TEXT,
  responsable_id INTEGER REFERENCES usuarios(id),
  estado TEXT NOT NULL DEFAULT 'vigente',
  renovacion_de_id INTEGER REFERENCES contratos_mantenimiento(id),
  notas TEXT,
  notas_renovacion TEXT,
  notas_cancelacion TEXT,
  creado_por INTEGER NOT NULL REFERENCES usuarios(id),
  alerta_90d_enviada_en TEXT,
  alerta_60d_enviada_en TEXT,
  alerta_30d_enviada_en TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
);

CREATE INDEX idx_contratos_estado_fecha_fin ON contratos_mantenimiento(estado, fecha_fin);

CREATE TABLE contrato_equipos (
  contrato_id INTEGER NOT NULL REFERENCES contratos_mantenimiento(id) ON DELETE CASCADE,
  activo_id INTEGER NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
  PRIMARY KEY (contrato_id, activo_id)
);

CREATE TABLE contrato_adjuntos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id INTEGER NOT NULL REFERENCES contratos_mantenimiento(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  content_type TEXT NOT NULL,
  tamano INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  categoria TEXT DEFAULT 'contrato',
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE contrato_comentarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id INTEGER NOT NULL REFERENCES contratos_mantenimiento(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  texto TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
