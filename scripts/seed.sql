-- Datos de ejemplo. Ejecuta despues de las migraciones.
-- El primer usuario admin se crea desde /login (boostrap automatico cuando no hay usuarios).

INSERT INTO activos (codigo, nombre, descripcion, ubicacion, estado) VALUES
  ('EQ-001', 'Compresor de aire', 'Compresor industrial 50HP', 'Planta - Sala de maquinas', 'operativo'),
  ('EQ-002', 'Generador electrico', 'Generador diesel 100kVA', 'Exterior - Caseta', 'operativo'),
  ('EQ-003', 'Cinta transportadora A', 'Linea de produccion 1', 'Planta - Linea 1', 'mantenimiento'),
  ('EQ-004', 'Cinta transportadora B', 'Linea de produccion 2', 'Planta - Linea 2', 'operativo'),
  ('EQ-005', 'Aire acondicionado oficinas', 'Sistema central 10TR', 'Oficinas - Tercer piso', 'averiado');
