-- OTs creadas directamente sin equipo asociado: permiten sucursal y ubicación
-- propias (antes solo se derivaban del activo).
ALTER TABLE ordenes ADD COLUMN sucursal_id INTEGER REFERENCES sucursales(id);
ALTER TABLE ordenes ADD COLUMN ubicacion_id INTEGER REFERENCES ubicaciones(id);
ALTER TABLE ordenes ADD COLUMN ubicacion_detalle TEXT;
