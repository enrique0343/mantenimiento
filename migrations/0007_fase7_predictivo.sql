-- Fase 7: Mantenimiento predictivo - variables monitoreadas, mediciones, umbrales

CREATE TABLE variables_predictivas (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  activo_id integer NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  unidad text,
  -- Rangos: alerta entre warning y critical
  min_critico real,
  min_warning real,
  max_warning real,
  max_critico real,
  activo integer NOT NULL DEFAULT 1,
  notas text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_var_pred_activo ON variables_predictivas (activo_id);

CREATE TABLE mediciones (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  variable_id integer NOT NULL REFERENCES variables_predictivas(id) ON DELETE CASCADE,
  valor real NOT NULL,
  fecha text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  estado_alerta text, -- 'ok' | 'warning' | 'critico'
  usuario_id integer REFERENCES usuarios(id),
  notas text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_med_variable ON mediciones (variable_id);
CREATE INDEX IF NOT EXISTS idx_med_fecha ON mediciones (fecha);
