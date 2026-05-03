-- Fase 3: OT enriquecidas (predictivo, estados verificada/cerrada,
-- checklist de ejecucion, trabajos realizados, fotos categorizadas)
-- Migracion ADITIVA. Estados/tipos se controlan a nivel app (Drizzle enum).

-- ── Extension de tabla ordenes ──────────────────────────────────────────────
ALTER TABLE ordenes ADD COLUMN trabajos_realizados text;
ALTER TABLE ordenes ADD COLUMN causa_raiz text;
ALTER TABLE ordenes ADD COLUMN solucion_aplicada text;
ALTER TABLE ordenes ADD COLUMN horas_trabajadas real;
ALTER TABLE ordenes ADD COLUMN checklist_ejecucion text; -- JSON: [{texto,hecho,notas}]
ALTER TABLE ordenes ADD COLUMN verificado_por integer REFERENCES usuarios(id);
ALTER TABLE ordenes ADD COLUMN verificado_en text;
ALTER TABLE ordenes ADD COLUMN verificacion_notas text;
ALTER TABLE ordenes ADD COLUMN cerrado_por integer REFERENCES usuarios(id);
ALTER TABLE ordenes ADD COLUMN cerrado_en text;

CREATE INDEX IF NOT EXISTS idx_ordenes_estado ON ordenes (estado);
CREATE INDEX IF NOT EXISTS idx_ordenes_tipo ON ordenes (tipo);
CREATE INDEX IF NOT EXISTS idx_ordenes_verificado_por ON ordenes (verificado_por);

-- ── Extension de tabla adjuntos: categoria (antes/despues/documento/general) ─
ALTER TABLE adjuntos ADD COLUMN categoria text NOT NULL DEFAULT 'general';
CREATE INDEX IF NOT EXISTS idx_adjuntos_categoria ON adjuntos (categoria);
