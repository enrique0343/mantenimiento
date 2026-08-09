-- Fase 45: Registro de alertas y retiros de equipo (JCI FMS.07.1)
-- Monitoreo de alertas de fabricantes, retiros del mercado (recalls) y avisos
-- de seguridad, con los equipos afectados y la acción tomada documentada.

CREATE TABLE alertas_equipo (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  tipo text NOT NULL DEFAULT 'alerta',        -- retiro | alerta | aviso
  fuente text NOT NULL DEFAULT 'fabricante',  -- fabricante | regulador | proveedor | interna
  titulo text NOT NULL,
  descripcion text,
  referencia text,                            -- nº de aviso / boletín / carta del fabricante
  fecha_alerta text NOT NULL,                 -- fecha de emisión de la alerta
  estado text NOT NULL DEFAULT 'abierta',     -- abierta | en_proceso | cerrada
  accion_tomada text,                         -- qué se hizo (retiro de servicio, corrección, verificación…)
  cerrada_en text,
  cerrada_por integer REFERENCES usuarios(id),
  creado_por integer REFERENCES usuarios(id),
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_alertas_estado ON alertas_equipo(estado);

-- Equipos afectados por cada alerta
CREATE TABLE alertas_equipo_activos (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  alerta_id integer NOT NULL REFERENCES alertas_equipo(id) ON DELETE CASCADE,
  activo_id integer NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
  UNIQUE(alerta_id, activo_id)
);
