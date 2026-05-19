-- Fase 18: Inventario de bodega única + stock máximo + presentaciones de compra

-- ─── 1) items: nuevas columnas (stock_maximo, presentacion, factor_presentacion)
ALTER TABLE items ADD COLUMN stock_maximo REAL NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN presentacion TEXT;
ALTER TABLE items ADD COLUMN factor_presentacion REAL NOT NULL DEFAULT 1;

-- ─── 2) stock: consolidar por item (drop sucursal_id, item_id ahora UNIQUE)
PRAGMA foreign_keys=OFF;

CREATE TABLE stock_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  item_id INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
  cantidad REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO stock_new (item_id, cantidad)
  SELECT item_id, COALESCE(SUM(cantidad), 0) FROM stock GROUP BY item_id;
DROP TABLE stock;
ALTER TABLE stock_new RENAME TO stock;
CREATE INDEX IF NOT EXISTS idx_stock_item ON stock (item_id);

-- ─── 3) movimientos_inventario: sucursal_id pasa a nullable
CREATE TABLE movimientos_inventario_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id),
  sucursal_id INTEGER REFERENCES sucursales(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'salida', 'ajuste')),
  cantidad REAL NOT NULL,
  motivo TEXT,
  referencia TEXT,
  orden_id INTEGER REFERENCES ordenes(id),
  recepcion_id INTEGER,
  usuario_id INTEGER REFERENCES usuarios(id),
  notas TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO movimientos_inventario_new (id, item_id, sucursal_id, tipo, cantidad, motivo, referencia, orden_id, recepcion_id, usuario_id, notas, created_at)
  SELECT id, item_id, sucursal_id, tipo, cantidad, motivo, referencia, orden_id, recepcion_id, usuario_id, notas, created_at
  FROM movimientos_inventario;
DROP TABLE movimientos_inventario;
ALTER TABLE movimientos_inventario_new RENAME TO movimientos_inventario;
CREATE INDEX IF NOT EXISTS idx_mov_item ON movimientos_inventario (item_id);
CREATE INDEX IF NOT EXISTS idx_mov_orden ON movimientos_inventario (orden_id);

-- ─── 4) recepciones: sucursal_id pasa a nullable
CREATE TABLE recepciones_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  proveedor_id INTEGER REFERENCES proveedores(id),
  sucursal_id INTEGER REFERENCES sucursales(id),
  numero_factura TEXT,
  fecha TEXT NOT NULL,
  total REAL,
  notas TEXT,
  recibido_por INTEGER REFERENCES usuarios(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO recepciones_new (id, proveedor_id, sucursal_id, numero_factura, fecha, total, notas, recibido_por, created_at)
  SELECT id, proveedor_id, sucursal_id, numero_factura, fecha, total, notas, recibido_por, created_at
  FROM recepciones;
DROP TABLE recepciones;
ALTER TABLE recepciones_new RENAME TO recepciones;

-- ─── 5) orden_repuestos: sucursal_id pasa a nullable
CREATE TABLE orden_repuestos_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  orden_id INTEGER NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  sucursal_id INTEGER REFERENCES sucursales(id),
  cantidad REAL NOT NULL,
  precio_unitario REAL,
  notas TEXT,
  registrado_por INTEGER REFERENCES usuarios(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO orden_repuestos_new (id, orden_id, item_id, sucursal_id, cantidad, precio_unitario, notas, registrado_por, created_at)
  SELECT id, orden_id, item_id, sucursal_id, cantidad, precio_unitario, notas, registrado_por, created_at
  FROM orden_repuestos;
DROP TABLE orden_repuestos;
ALTER TABLE orden_repuestos_new RENAME TO orden_repuestos;

PRAGMA foreign_keys=ON;
