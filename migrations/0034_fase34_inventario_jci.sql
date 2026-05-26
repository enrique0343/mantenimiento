-- Fase 34: Fundamento documental JCI (FMS.8 / MINSAL)
-- Amplía el inventario con datos patrimoniales y de criticidad operacional,
-- crea trazabilidad metrológica para calibraciones y documentos por equipo.

-- ─── Activos: datos patrimoniales y criticidad operacional ───────────────────
ALTER TABLE activos ADD COLUMN fecha_adquisicion TEXT;
ALTER TABLE activos ADD COLUMN vida_util_anios INTEGER;
ALTER TABLE activos ADD COLUMN valor_adquisicion REAL;
ALTER TABLE activos ADD COLUMN responsable_id INTEGER REFERENCES usuarios(id);
-- Criticidad operacional (tolerancia a estar fuera de servicio), distinta de la
-- clase de riesgo regulatoria: alta | media | baja
ALTER TABLE activos ADD COLUMN criticidad_operacional TEXT DEFAULT 'media';
-- Marca equipos no biomédicos que igual requieren calibración (balanzas, manómetros…)
ALTER TABLE activos ADD COLUMN requiere_calibracion INTEGER NOT NULL DEFAULT 0;

-- ─── Calibraciones con trazabilidad metrológica ──────────────────────────────
CREATE TABLE calibraciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activo_id INTEGER NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
  fecha_calibracion TEXT NOT NULL,
  proxima_calibracion TEXT,
  laboratorio_id INTEGER REFERENCES proveedores(id),
  laboratorio_externo TEXT,
  numero_certificado TEXT,
  patron_referencia TEXT,
  resultado TEXT NOT NULL DEFAULT 'conforme',
  incertidumbre TEXT,
  certificado_r2_key TEXT,
  realizado_por TEXT,
  notas TEXT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_calibraciones_activo ON calibraciones(activo_id, fecha_calibracion);

-- ─── Documentos del equipo (ficha técnica, manual, garantía, instalación) ─────
CREATE TABLE activo_documentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activo_id INTEGER NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  content_type TEXT NOT NULL,
  tamano INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  categoria TEXT DEFAULT 'ficha_tecnica',
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_activo_documentos_activo ON activo_documentos(activo_id);

-- ─── Proveedores: acreditación de laboratorios de calibración ────────────────
ALTER TABLE proveedores ADD COLUMN es_laboratorio_acreditado INTEGER NOT NULL DEFAULT 0;
ALTER TABLE proveedores ADD COLUMN acreditacion_organo TEXT;
ALTER TABLE proveedores ADD COLUMN acreditacion_vigencia TEXT;
