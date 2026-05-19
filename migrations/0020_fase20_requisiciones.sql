-- Fase 20: Requisiciones de compra (con auto-disparo por stock mínimo)

CREATE TABLE requisiciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  numero TEXT NOT NULL UNIQUE,
  estado TEXT NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador', 'enviada', 'aprobada', 'rechazada', 'recibida_parcial', 'recibida', 'cancelada')),
  proveedor_id INTEGER REFERENCES proveedores(id),
  fecha_solicitud TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_necesidad TEXT,
  total REAL,
  notas TEXT,
  origen TEXT NOT NULL DEFAULT 'manual'
    CHECK (origen IN ('manual', 'auto_stock_minimo')),
  creado_por INTEGER REFERENCES usuarios(id),
  aprobado_por INTEGER REFERENCES usuarios(id),
  aprobado_en TEXT,
  rechazado_motivo TEXT,
  recepcion_id INTEGER REFERENCES recepciones(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_req_estado ON requisiciones (estado);
CREATE INDEX IF NOT EXISTS idx_req_proveedor ON requisiciones (proveedor_id);

CREATE TABLE requisicion_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  requisicion_id INTEGER NOT NULL REFERENCES requisiciones(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  cantidad REAL NOT NULL,
  precio_unitario REAL,
  notas TEXT,
  cantidad_recibida REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_req_items_req ON requisicion_items (requisicion_id);
