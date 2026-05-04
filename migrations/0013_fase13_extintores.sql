-- Fase 13: Modulo de seguridad - extintores con tracking individual
-- Cada extintor lleva fechas regulatorias de inspeccion, recarga y prueba hidrostatica.
-- Cada cambio se registra en extintor_eventos para historial completo.

CREATE TABLE extintores (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  codigo text NOT NULL UNIQUE,
  numero_serie text,
  marca text,
  modelo text,
  foto_r2 text,
  -- Tipo y capacidad
  tipo_agente text NOT NULL,             -- pqs | co2 | agua | espuma | k | d
  capacidad real,                         -- numero
  capacidad_unidad text DEFAULT 'kg',     -- 'kg' | 'lb'
  -- Ubicacion
  sucursal_id integer NOT NULL REFERENCES sucursales(id),
  ubicacion_id integer REFERENCES ubicaciones(id),
  ubicacion_detalle text,
  zona text,                              -- cocina | oficina | bodega | ti | exterior | etc.
  -- Fechas regulatorias
  fecha_fabricacion text,                 -- YYYY-MM-DD
  fecha_compra text,
  ultima_recarga text,
  proxima_recarga text,
  ultima_prueba_hidrostatica text,
  proxima_prueba_hidrostatica text,
  ultima_inspeccion text,
  proxima_inspeccion text,
  -- Frecuencias (en su unidad respectiva)
  dias_inspeccion integer NOT NULL DEFAULT 30,
  meses_recarga integer NOT NULL DEFAULT 12,
  anios_prueba integer NOT NULL DEFAULT 5,
  -- Estado y QR
  estado text NOT NULL DEFAULT 'activo',  -- activo | mantenimiento | baja
  qr_token text NOT NULL UNIQUE,
  notas text,
  activo integer NOT NULL DEFAULT 1,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_extintores_sucursal ON extintores (sucursal_id);
CREATE INDEX IF NOT EXISTS idx_extintores_ubicacion ON extintores (ubicacion_id);
CREATE INDEX IF NOT EXISTS idx_extintores_zona ON extintores (zona);
CREATE INDEX IF NOT EXISTS idx_extintores_tipo ON extintores (tipo_agente);
CREATE INDEX IF NOT EXISTS idx_extintores_proxima_recarga ON extintores (proxima_recarga);
CREATE INDEX IF NOT EXISTS idx_extintores_proxima_prueba ON extintores (proxima_prueba_hidrostatica);
CREATE INDEX IF NOT EXISTS idx_extintores_proxima_inspeccion ON extintores (proxima_inspeccion);
CREATE INDEX IF NOT EXISTS idx_extintores_qr ON extintores (qr_token);

CREATE TABLE extintor_eventos (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  extintor_id integer NOT NULL REFERENCES extintores(id) ON DELETE CASCADE,
  tipo text NOT NULL,                     -- inspeccion | recarga | prueba_hidrostatica | reemplazo | baja | otro
  fecha text NOT NULL,
  proxima_fecha text,
  responsable_id integer REFERENCES usuarios(id),
  proveedor_id integer REFERENCES proveedores(id),
  costo real,
  notas text,
  evidencia_r2 text,
  ot_id integer REFERENCES ordenes(id),
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ext_evt_extintor ON extintor_eventos (extintor_id);
CREATE INDEX IF NOT EXISTS idx_ext_evt_tipo ON extintor_eventos (tipo);
CREATE INDEX IF NOT EXISTS idx_ext_evt_fecha ON extintor_eventos (fecha);
