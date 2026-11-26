-- Custodia TI independiente del responsable técnico. No cambia activos ni usuarios existentes.
CREATE TABLE tecnologia_custodia (
  activo_id INTEGER PRIMARY KEY REFERENCES activos(id),
  usuario_id INTEGER REFERENCES usuarios(id),
  nombre TEXT,
  departamento TEXT,
  cargo TEXT,
  asignado_en TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  mutation_token TEXT,
  updated_at TEXT NOT NULL,
  CHECK ((nombre IS NULL AND usuario_id IS NULL AND departamento IS NULL AND cargo IS NULL AND asignado_en IS NULL)
    OR (nombre IS NOT NULL AND length(trim(nombre)) > 0 AND asignado_en IS NOT NULL))
);
CREATE TABLE tecnologia_custodia_eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activo_id INTEGER NOT NULL REFERENCES activos(id),
  accion TEXT NOT NULL CHECK (accion IN ('asignar','reasignar','devolver','trasladar')),
  request_id TEXT NOT NULL,
  mutation_token TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  revision INTEGER NOT NULL CHECK (revision > 0),
  actor_id INTEGER NOT NULL REFERENCES usuarios(id),
  actor_nombre TEXT NOT NULL,
  fecha TEXT NOT NULL,
  motivo TEXT NOT NULL CHECK (length(trim(motivo)) >= 3),
  antes_json TEXT NOT NULL CHECK (json_valid(antes_json)),
  despues_json TEXT NOT NULL CHECK (json_valid(despues_json)),
  UNIQUE(activo_id, request_id),
  UNIQUE(activo_id, revision)
);
CREATE INDEX idx_tecnologia_custodia_usuario ON tecnologia_custodia(usuario_id);
CREATE INDEX idx_tecnologia_custodia_historial ON tecnologia_custodia_eventos(activo_id, id DESC);
CREATE TRIGGER tecnologia_evento_inmutable_update BEFORE UPDATE ON tecnologia_custodia_eventos
BEGIN SELECT RAISE(ABORT, 'El historial de custodia es inmutable'); END;
CREATE TRIGGER tecnologia_evento_inmutable_delete BEFORE DELETE ON tecnologia_custodia_eventos
BEGIN SELECT RAISE(ABORT, 'El historial de custodia es inmutable'); END;
CREATE TRIGGER tecnologia_custodia_no_reclasificar BEFORE UPDATE OF rubro ON activos
WHEN OLD.rubro = 'tecnologia' AND NEW.rubro IS NOT 'tecnologia'
 AND EXISTS (SELECT 1 FROM tecnologia_custodia_eventos WHERE activo_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'El equipo conserva historial de custodia de tecnologia'); END;
-- Una autorización existe solo dentro del batch, entre actualizar custodia e insertar el evento.
-- También cubre importaciones, cambios masivos y futuras rutas que actualicen activos directamente.
CREATE TRIGGER tecnologia_ubicacion_con_trazabilidad BEFORE UPDATE OF ubicacion_id, ubicacion ON activos
WHEN OLD.rubro = 'tecnologia' AND (NEW.ubicacion_id IS NOT OLD.ubicacion_id OR NEW.ubicacion IS NOT OLD.ubicacion)
 AND NOT EXISTS (
   SELECT 1 FROM tecnologia_custodia c WHERE c.activo_id = OLD.id AND c.mutation_token IS NOT NULL
    AND c.revision > 0 AND NOT EXISTS (
      SELECT 1 FROM tecnologia_custodia_eventos e WHERE e.activo_id = OLD.id AND e.mutation_token = c.mutation_token
    )
 )
BEGIN SELECT RAISE(ABORT, 'Traslada el equipo desde Custodia para conservar la trazabilidad'); END;
