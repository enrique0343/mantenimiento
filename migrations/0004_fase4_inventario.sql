-- Fase 4: Inventario - catalogo de items, stock por sucursal,
-- movimientos auditados, recepciones de proveedor, repuestos consumidos por OT.

-- ── Catalogo de items / repuestos / insumos ─────────────────────────────────
CREATE TABLE items (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  codigo text NOT NULL UNIQUE,
  nombre text NOT NULL,
  descripcion text,
  categoria text,
  unidad text NOT NULL DEFAULT 'unidad',
  stock_minimo real NOT NULL DEFAULT 0,
  proveedor_principal_id integer REFERENCES proveedores(id),
  precio_referencia real,
  activo integer NOT NULL DEFAULT 1,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_items_categoria ON items (categoria);
CREATE INDEX IF NOT EXISTS idx_items_proveedor ON items (proveedor_principal_id);

-- ── Stock actual por sucursal (UNIQUE para upsert) ──────────────────────────
CREATE TABLE stock (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  item_id integer NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  sucursal_id integer NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  cantidad real NOT NULL DEFAULT 0,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (item_id, sucursal_id)
);
CREATE INDEX IF NOT EXISTS idx_stock_item ON stock (item_id);
CREATE INDEX IF NOT EXISTS idx_stock_sucursal ON stock (sucursal_id);

-- ── Auditoria de movimientos ────────────────────────────────────────────────
CREATE TABLE movimientos_inventario (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  item_id integer NOT NULL REFERENCES items(id),
  sucursal_id integer NOT NULL REFERENCES sucursales(id),
  tipo text NOT NULL,         -- 'entrada' | 'salida' | 'ajuste'
  cantidad real NOT NULL,     -- positivo = suma; negativo = resta
  motivo text,                -- 'recepcion' | 'consumo_ot' | 'ajuste_manual' | 'transferencia_in' | 'transferencia_out'
  referencia text,            -- 'recepcion:123' | 'orden:456' | 'transfer:789'
  orden_id integer REFERENCES ordenes(id),
  recepcion_id integer,       -- FK declarada despues (recepciones se crea abajo)
  usuario_id integer REFERENCES usuarios(id),
  notas text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mov_item ON movimientos_inventario (item_id);
CREATE INDEX IF NOT EXISTS idx_mov_sucursal ON movimientos_inventario (sucursal_id);
CREATE INDEX IF NOT EXISTS idx_mov_orden ON movimientos_inventario (orden_id);
CREATE INDEX IF NOT EXISTS idx_mov_recepcion ON movimientos_inventario (recepcion_id);
CREATE INDEX IF NOT EXISTS idx_mov_created ON movimientos_inventario (created_at);

-- ── Recepciones de proveedor ────────────────────────────────────────────────
CREATE TABLE recepciones (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  proveedor_id integer REFERENCES proveedores(id),
  sucursal_id integer NOT NULL REFERENCES sucursales(id),
  numero_factura text,
  fecha text NOT NULL,        -- YYYY-MM-DD
  total real,
  notas text,
  recibido_por integer REFERENCES usuarios(id),
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_recep_proveedor ON recepciones (proveedor_id);
CREATE INDEX IF NOT EXISTS idx_recep_sucursal ON recepciones (sucursal_id);
CREATE INDEX IF NOT EXISTS idx_recep_fecha ON recepciones (fecha);

CREATE TABLE recepcion_items (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  recepcion_id integer NOT NULL REFERENCES recepciones(id) ON DELETE CASCADE,
  item_id integer NOT NULL REFERENCES items(id),
  cantidad real NOT NULL,
  precio_unitario real
);
CREATE INDEX IF NOT EXISTS idx_recep_items_recep ON recepcion_items (recepcion_id);
CREATE INDEX IF NOT EXISTS idx_recep_items_item ON recepcion_items (item_id);

-- ── Repuestos consumidos por orden de trabajo ───────────────────────────────
CREATE TABLE orden_repuestos (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  orden_id integer NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
  item_id integer NOT NULL REFERENCES items(id),
  sucursal_id integer NOT NULL REFERENCES sucursales(id),
  cantidad real NOT NULL,
  precio_unitario real,
  notas text,
  registrado_por integer REFERENCES usuarios(id),
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_orden_repuestos_orden ON orden_repuestos (orden_id);
CREATE INDEX IF NOT EXISTS idx_orden_repuestos_item ON orden_repuestos (item_id);
