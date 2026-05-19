-- Fase 12: Modulo Flota - vehiculos, documentos, viajes con QR, cargas combustible,
-- planes de mantenimiento por km y por fecha. Rol motorista.

-- Vehiculos
CREATE TABLE vehiculos (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  codigo text NOT NULL UNIQUE,
  placa text NOT NULL UNIQUE,
  marca text NOT NULL,
  modelo text NOT NULL,
  anio integer,
  color text,
  vin text,
  tipo text NOT NULL DEFAULT 'carro',
  combustible text NOT NULL DEFAULT 'gasolina',
  capacidad_tanque real,
  kilometraje_actual real NOT NULL DEFAULT 0,
  foto_r2 text,
  qr_token text NOT NULL UNIQUE,
  estado text NOT NULL DEFAULT 'disponible',
  notas text,
  activo integer NOT NULL DEFAULT 1,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vehiculos_estado ON vehiculos (estado);
CREATE INDEX IF NOT EXISTS idx_vehiculos_qr ON vehiculos (qr_token);

-- Documentos del vehiculo
CREATE TABLE vehiculo_documentos (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  vehiculo_id integer NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  numero text,
  vencimiento text,
  r2_key text,
  notas text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_veh_doc_vehiculo ON vehiculo_documentos (vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_veh_doc_vencimiento ON vehiculo_documentos (vencimiento);

-- Propositos de viaje (lista editable por admin)
CREATE TABLE viaje_propositos (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  nombre text NOT NULL UNIQUE,
  activo integer NOT NULL DEFAULT 1,
  orden integer NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO viaje_propositos (nombre, orden) VALUES
  ('Pasajeros', 1),
  ('Carga / mercaderia', 2),
  ('Gestion administrativa', 3),
  ('Emergencia', 4),
  ('Mantenimiento del vehiculo', 5),
  ('Otro', 99);

-- Viajes
CREATE TABLE viajes (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  vehiculo_id integer NOT NULL REFERENCES vehiculos(id),
  motorista_id integer NOT NULL REFERENCES usuarios(id),
  proposito_id integer REFERENCES viaje_propositos(id),
  destino text,
  notas text,
  km_inicial real NOT NULL,
  km_final real,
  km_recorrido real,
  inicio text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fin text,
  duracion_min integer,
  inicio_lat real,
  inicio_lng real,
  fin_lat real,
  fin_lng real,
  distancia_gps_km real,
  foto_odometro_inicio_r2 text,
  foto_odometro_fin_r2 text,
  estado text NOT NULL DEFAULT 'en_curso',
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_viajes_vehiculo ON viajes (vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_viajes_motorista ON viajes (motorista_id);
CREATE INDEX IF NOT EXISTS idx_viajes_estado ON viajes (estado);
CREATE INDEX IF NOT EXISTS idx_viajes_inicio ON viajes (inicio);

-- Cargas de combustible
CREATE TABLE cargas_combustible (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  vehiculo_id integer NOT NULL REFERENCES vehiculos(id),
  motorista_id integer REFERENCES usuarios(id),
  fecha text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  litros real NOT NULL,
  monto real NOT NULL,
  precio_litro real,
  km_al_cargar real,
  estacion text,
  recibo_r2 text,
  notas text
);
CREATE INDEX IF NOT EXISTS idx_cargas_vehiculo ON cargas_combustible (vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_cargas_fecha ON cargas_combustible (fecha);

-- Planes de mantenimiento de vehiculos (km y/o fecha)
CREATE TABLE planes_vehiculo (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  vehiculo_id integer NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  descripcion text,
  km_intervalo real,
  km_proximo real,
  frecuencia_meses integer,
  proxima_fecha text,
  prioridad text NOT NULL DEFAULT 'media',
  asignado_a integer REFERENCES usuarios(id),
  activo integer NOT NULL DEFAULT 1,
  ultima_generacion text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_planes_veh_vehiculo ON planes_vehiculo (vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_planes_veh_km ON planes_vehiculo (km_proximo);
CREATE INDEX IF NOT EXISTS idx_planes_veh_fecha ON planes_vehiculo (proxima_fecha);

-- Ordenes vinculadas a vehiculo
ALTER TABLE ordenes ADD COLUMN vehiculo_id integer REFERENCES vehiculos(id);
CREATE INDEX IF NOT EXISTS idx_ordenes_vehiculo ON ordenes (vehiculo_id);
