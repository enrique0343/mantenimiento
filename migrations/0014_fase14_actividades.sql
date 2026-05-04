-- Fase 14: Actividades recurrentes (no son equipo individual)
-- Ej: limpieza trampa de grasa, lavado de tanques, fumigación, jardinería
-- Cada actividad es su propio plan: tiene frecuencia + proxima_fecha, y cuando
-- vence el cron diario crea una OT preventiva con actividad_id.

CREATE TABLE actividad_categorias (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  nombre text NOT NULL UNIQUE,
  icono text,                              -- emoji corto
  orden integer NOT NULL DEFAULT 0,
  activo integer NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO actividad_categorias (nombre, icono, orden) VALUES
  ('Limpieza', '🧹', 1),
  ('Fumigación / control de plagas', '🐛', 2),
  ('Tanques de agua', '💧', 3),
  ('Trampas de grasa', '🍳', 4),
  ('Áreas comunes', '🏢', 5),
  ('Jardinería', '🌱', 6),
  ('Sistemas eléctricos generales', '⚡', 7),
  ('Otros', '📋', 99);

CREATE TABLE actividades (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  codigo text NOT NULL UNIQUE,
  titulo text NOT NULL,
  descripcion text,
  categoria_id integer REFERENCES actividad_categorias(id),
  sucursal_id integer REFERENCES sucursales(id),
  ubicacion_id integer REFERENCES ubicaciones(id),
  ubicacion_detalle text,
  frecuencia text NOT NULL,               -- diaria | semanal | quincenal | mensual | bimestral | trimestral | semestral | anual
  proxima_fecha text NOT NULL,            -- YYYY-MM-DD
  alerta_dias_antes integer NOT NULL DEFAULT 7,
  prioridad text NOT NULL DEFAULT 'media',
  horas_estimadas real,
  checklist text,                         -- JSON: [{texto,hecho:false}]
  asignado_a integer REFERENCES usuarios(id),
  proveedor_externo_id integer REFERENCES proveedores(id),
  activo integer NOT NULL DEFAULT 1,
  ultima_generacion text,
  ultima_ejecucion text,                  -- fecha real en que se completó la última OT
  notas text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_actividades_categoria ON actividades (categoria_id);
CREATE INDEX IF NOT EXISTS idx_actividades_sucursal ON actividades (sucursal_id);
CREATE INDEX IF NOT EXISTS idx_actividades_proxima ON actividades (proxima_fecha);
CREATE INDEX IF NOT EXISTS idx_actividades_activo ON actividades (activo);

ALTER TABLE ordenes ADD COLUMN actividad_id integer REFERENCES actividades(id);
CREATE INDEX IF NOT EXISTS idx_ordenes_actividad ON ordenes (actividad_id);
