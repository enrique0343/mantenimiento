-- Fase 1: Mantenimiento preventivo + extension de equipos
-- Esta migracion es ADITIVA, no toca columnas existentes.

-- ── Extension de tabla activos ──────────────────────────────────────────────
ALTER TABLE activos ADD COLUMN marca text;
ALTER TABLE activos ADD COLUMN modelo text;
ALTER TABLE activos ADD COLUMN serial text;
ALTER TABLE activos ADD COLUMN anio integer;
ALTER TABLE activos ADD COLUMN categoria text;
ALTER TABLE activos ADD COLUMN numero_activo text;
ALTER TABLE activos ADD COLUMN qr_code text;
ALTER TABLE activos ADD COLUMN tipo text NOT NULL DEFAULT 'general';
ALTER TABLE activos ADD COLUMN registro_sanitario text;
ALTER TABLE activos ADD COLUMN clase_riesgo text;
ALTER TABLE activos ADD COLUMN ultima_calibracion text;
ALTER TABLE activos ADD COLUMN proxima_calibracion text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_activos_qr ON activos (qr_code);
CREATE INDEX IF NOT EXISTS idx_activos_tipo ON activos (tipo);
CREATE INDEX IF NOT EXISTS idx_activos_categoria ON activos (categoria);

-- ── Tabla de planes de mantenimiento ────────────────────────────────────────
CREATE TABLE planes_mantenimiento (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  activo_id integer NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  descripcion text,
  frecuencia text NOT NULL,
  proxima_fecha text NOT NULL,
  alerta_dias_antes integer NOT NULL DEFAULT 7,
  prioridad text NOT NULL DEFAULT 'media',
  horas_estimadas real,
  checklist text,
  asignado_a integer REFERENCES usuarios(id),
  activo integer NOT NULL DEFAULT 1,
  ultima_generacion text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_planes_activo ON planes_mantenimiento (activo_id);
CREATE INDEX idx_planes_proxima ON planes_mantenimiento (proxima_fecha);
CREATE INDEX idx_planes_activo_estado ON planes_mantenimiento (activo);

-- ── Relacion orden → plan generador ─────────────────────────────────────────
ALTER TABLE ordenes ADD COLUMN plan_id integer REFERENCES planes_mantenimiento(id);
CREATE INDEX idx_ordenes_plan ON ordenes (plan_id);
