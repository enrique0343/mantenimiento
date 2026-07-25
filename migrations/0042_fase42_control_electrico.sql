-- Fase 42: Control eléctrico por sede
-- Subestaciones / puntos de alimentación con capacidad (kVA) y cargas
-- conectadas (kW), para calcular disponibilidad eléctrica antes de
-- incorporar equipos nuevos a la red.

CREATE TABLE subestaciones (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  sucursal_id integer NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  nombre text NOT NULL,                    -- "Subestación 1", "Acometida principal"
  codigo text,                             -- código interno opcional
  capacidad_kva real NOT NULL,             -- capacidad del transformador/acometida
  voltaje text,                            -- "480V", "240/120V", "13.2kV/480V"
  factor_potencia real NOT NULL DEFAULT 0.9,   -- para convertir kVA → kW útiles
  factor_seguridad real NOT NULL DEFAULT 0.8,  -- % máximo de carga recomendado (NEC 80%)
  ubicacion_detalle text,                  -- ubicación física dentro de la sede
  activo_id integer REFERENCES activos(id),-- vínculo opcional al inventario (para darle mantenimiento)
  notas text,
  activa integer NOT NULL DEFAULT 1,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_subestaciones_sucursal ON subestaciones(sucursal_id);

CREATE TABLE cargas_electricas (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  subestacion_id integer NOT NULL REFERENCES subestaciones(id) ON DELETE CASCADE,
  nombre text NOT NULL,                    -- "Aire acondicionado UCI", "Iluminación piso 2"
  activo_id integer REFERENCES activos(id),-- vínculo opcional al equipo del inventario
  tablero text,                            -- tablero/circuito al que está conectada
  potencia_kw real,                        -- potencia directa en kW (si se conoce)
  amperaje real,                           -- alternativa: A + V (+fases) para calcular kW
  voltaje_carga real,
  fases integer NOT NULL DEFAULT 1,        -- 1, 2 o 3
  notas text,
  activa integer NOT NULL DEFAULT 1,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cargas_subestacion ON cargas_electricas(subestacion_id);
