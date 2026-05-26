-- Fase 36: Medición e indicadores JCI.
-- Snapshot mensual persistente de KPIs para documentar tendencia 6-12 meses
-- (requisito JCI "medir y mejorar"). Una fila por período y alcance.

CREATE TABLE metricas_kpi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  periodo TEXT NOT NULL,                       -- 'YYYY-MM'
  scope TEXT NOT NULL DEFAULT 'global',        -- global | general | biomedico
  cumplimiento_preventivo REAL,                -- % preventivos programados ejecutados a tiempo
  mttr_horas REAL,                             -- tiempo medio de reparación (correctivos)
  mtbf_horas REAL,                             -- tiempo medio entre fallas
  disponibilidad_pct REAL,                     -- disponibilidad estimada del parque
  backlog_correctivos INTEGER NOT NULL DEFAULT 0,
  costo_total REAL NOT NULL DEFAULT 0,
  costo_por_activo REAL NOT NULL DEFAULT 0,
  ots_completadas INTEGER NOT NULL DEFAULT 0,
  ots_correctivas INTEGER NOT NULL DEFAULT 0,
  ots_preventivas INTEGER NOT NULL DEFAULT 0,
  preventivos_programados INTEGER NOT NULL DEFAULT 0,
  num_activos INTEGER NOT NULL DEFAULT 0,
  capturado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_metricas_periodo_scope ON metricas_kpi(periodo, scope);
