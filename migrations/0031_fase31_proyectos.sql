-- Módulo de Proyectos: para casos que requieren evaluación, aprobación,
-- presupuesto detallado y ejecución por etapas (vs OTs individuales).

CREATE TABLE IF NOT EXISTS proyectos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  estado TEXT NOT NULL DEFAULT 'evaluacion',
    -- evaluacion | aprobado | rechazado | en_ejecucion | en_pausa | completado | cancelado
  prioridad TEXT NOT NULL DEFAULT 'media',
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  sucursal_id INTEGER REFERENCES sucursales(id),
  ubicacion_id INTEGER REFERENCES ubicaciones(id),
  ubicacion_detalle TEXT,
  activo_id INTEGER REFERENCES activos(id),

  -- Evaluación (factibilidad + viabilidad combinadas)
  justificacion TEXT,
  alcance TEXT,
  factibilidad TEXT,
  viabilidad TEXT,
  beneficios_esperados TEXT,
  riesgos TEXT,

  -- Plazos
  fecha_inicio_estimada TEXT,
  fecha_fin_estimada TEXT,
  fecha_inicio_real TEXT,
  fecha_fin_real TEXT,

  -- Presupuesto y avance
  presupuesto_estimado REAL DEFAULT 0,
  avance_manual INTEGER,

  -- Personas
  responsable_id INTEGER REFERENCES usuarios(id),
  creado_por INTEGER NOT NULL REFERENCES usuarios(id),
  aprobado_por INTEGER REFERENCES usuarios(id),
  aprobado_en TEXT,
  notas_aprobacion TEXT,
  cerrado_por INTEGER REFERENCES usuarios(id),
  cerrado_en TEXT,
  notas_cierre TEXT,
  lecciones_aprendidas TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS proyecto_presupuesto_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proyecto_id INTEGER NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  descripcion TEXT NOT NULL,
  categoria TEXT,
  cantidad REAL NOT NULL DEFAULT 1,
  unidad TEXT,
  precio_estimado REAL NOT NULL DEFAULT 0,
  precio_real REAL,
  proveedor_id INTEGER REFERENCES proveedores(id),
  notas TEXT,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS proyecto_hitos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proyecto_id INTEGER NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  fecha_objetivo TEXT,
  fecha_completado TEXT,
  completado INTEGER NOT NULL DEFAULT 0,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS proyecto_adjuntos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proyecto_id INTEGER NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  content_type TEXT NOT NULL,
  tamano INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  categoria TEXT DEFAULT 'general',
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS proyecto_comentarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proyecto_id INTEGER NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  texto TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Vínculo OT → Proyecto: una OT puede vivir sola o pertenecer a un proyecto
ALTER TABLE ordenes ADD COLUMN proyecto_id INTEGER REFERENCES proyectos(id) ON DELETE SET NULL;

-- Vínculo Ticket → Proyecto: si un ticket se convierte a proyecto, NO se
-- auto-crea OT al asignar técnico
ALTER TABLE tickets ADD COLUMN proyecto_id INTEGER REFERENCES proyectos(id) ON DELETE SET NULL;
