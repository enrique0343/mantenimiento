-- Fase 2: Empresa, sucursales, ubicaciones jerarquicas, proveedores, roles ampliados

-- ── Empresa (singleton, id siempre = 1) ──────────────────────────────────────
CREATE TABLE empresa (
  id integer PRIMARY KEY NOT NULL DEFAULT 1,
  nombre text NOT NULL DEFAULT 'Mi Empresa',
  nit text,
  logo_r2_key text,
  pais text DEFAULT 'SV',
  moneda text DEFAULT 'USD',
  telefono text,
  direccion text,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO empresa (id, nombre) VALUES (1, 'Mi Empresa');

-- ── Sucursales ────────────────────────────────────────────────────────────────
CREATE TABLE sucursales (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  nombre text NOT NULL,
  codigo text,
  direccion text,
  telefono text,
  activa integer NOT NULL DEFAULT 1,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── Ubicaciones (arbol: sucursal > edificio > piso > area) ────────────────────
CREATE TABLE ubicaciones (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  sucursal_id integer NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  tipo text NOT NULL DEFAULT 'area',
  padre_id integer REFERENCES ubicaciones(id),
  activa integer NOT NULL DEFAULT 1,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_ubicaciones_sucursal ON ubicaciones (sucursal_id);
CREATE INDEX idx_ubicaciones_padre ON ubicaciones (padre_id);

-- ── Proveedores ───────────────────────────────────────────────────────────────
CREATE TABLE proveedores (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  nombre text NOT NULL,
  nit text,
  contacto text,
  telefono text,
  email text,
  activo integer NOT NULL DEFAULT 1,
  notas text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── Extiende usuarios: sucursal asignada ──────────────────────────────────────
ALTER TABLE usuarios ADD COLUMN sucursal_id integer REFERENCES sucursales(id);

-- ── Extiende activos: ubicacion estructurada + proveedor ─────────────────────
ALTER TABLE activos ADD COLUMN ubicacion_id integer REFERENCES ubicaciones(id);
ALTER TABLE activos ADD COLUMN proveedor_id integer REFERENCES proveedores(id);
CREATE INDEX idx_activos_ubicacion ON activos (ubicacion_id);
CREATE INDEX idx_activos_proveedor ON activos (proveedor_id);
