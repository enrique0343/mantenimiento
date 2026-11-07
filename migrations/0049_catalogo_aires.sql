-- Catálogo de modelos: datos compartidos, sin identidad de la unidad física.
CREATE TABLE modelos_aire (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE CHECK (length(nombre) BETWEEN 1 AND 200 AND nombre = trim(nombre)),
  descripcion TEXT CHECK (descripcion IS NULL OR length(descripcion) <= 2000),
  categoria TEXT CHECK (categoria IS NULL OR length(categoria) <= 200),
  marca TEXT CHECK (marca IS NULL OR length(marca) <= 200),
  modelo TEXT CHECK (modelo IS NULL OR length(modelo) <= 200),
  datos_tecnicos TEXT CHECK (datos_tecnicos IS NULL OR json_valid(datos_tecnicos)),
  activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  creado_por INTEGER NOT NULL REFERENCES usuarios(id),
  creado_por_nombre TEXT NOT NULL,
  actualizado_por INTEGER NOT NULL REFERENCES usuarios(id),
  actualizado_por_nombre TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX modelos_aire_nombre_normalizado_idx ON modelos_aire(upper(trim(nombre)));
CREATE TABLE modelos_aire_historial (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  modelo_aire_id INTEGER NOT NULL REFERENCES modelos_aire(id),
  version INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  usuario_nombre TEXT NOT NULL,
  accion TEXT NOT NULL CHECK (accion IN ('crear', 'editar', 'archivar', 'reactivar')),
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  UNIQUE (modelo_aire_id, version)
);
CREATE INDEX modelos_aire_historial_modelo_idx ON modelos_aire_historial(modelo_aire_id);

-- Los eventos nacen dentro de la misma escritura: no puede faltar el historial.
CREATE TRIGGER modelos_aire_insertar_historial AFTER INSERT ON modelos_aire
BEGIN
  INSERT INTO modelos_aire_historial (modelo_aire_id, version, fecha, usuario_id, usuario_nombre, accion, snapshot)
  VALUES (NEW.id, NEW.version, NEW.created_at, NEW.creado_por, NEW.creado_por_nombre, 'crear', json_object('id', NEW.id, 'version', NEW.version, 'nombre', NEW.nombre, 'descripcion', NEW.descripcion, 'categoria', NEW.categoria, 'marca', NEW.marca, 'modelo', NEW.modelo, 'datosTecnicos', json(NEW.datos_tecnicos), 'activo', json( CASE WHEN NEW.activo = 1 THEN 'true' ELSE 'false' END )));
END;
CREATE TRIGGER modelos_aire_validar_version BEFORE UPDATE ON modelos_aire
WHEN NEW.id IS NOT OLD.id OR NEW.version != OLD.version + 1
  OR NEW.creado_por IS NOT OLD.creado_por OR NEW.creado_por_nombre IS NOT OLD.creado_por_nombre
  OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'CATALOGO_AIRES_VERSION_INVALIDA'); END;
CREATE TRIGGER modelos_aire_actualizar_historial AFTER UPDATE ON modelos_aire
BEGIN
  INSERT INTO modelos_aire_historial (modelo_aire_id, version, fecha, usuario_id, usuario_nombre, accion, snapshot)
  VALUES (NEW.id, NEW.version, NEW.updated_at, NEW.actualizado_por, NEW.actualizado_por_nombre,
    ( CASE WHEN OLD.activo = 1 AND NEW.activo = 0 THEN 'archivar'
         WHEN OLD.activo = 0 AND NEW.activo = 1 THEN 'reactivar' ELSE 'editar' END ), json_object('id', NEW.id, 'version', NEW.version, 'nombre', NEW.nombre, 'descripcion', NEW.descripcion, 'categoria', NEW.categoria, 'marca', NEW.marca, 'modelo', NEW.modelo, 'datosTecnicos', json(NEW.datos_tecnicos), 'activo', json( CASE WHEN NEW.activo = 1 THEN 'true' ELSE 'false' END )));
END;
CREATE TRIGGER modelos_aire_no_eliminar BEFORE DELETE ON modelos_aire
BEGIN SELECT RAISE(ABORT, 'CATALOGO_AIRES_ARCHIVAR'); END;
CREATE TRIGGER modelos_aire_historial_no_editar BEFORE UPDATE ON modelos_aire_historial
BEGIN SELECT RAISE(ABORT, 'CATALOGO_AIRES_HISTORIAL_INMUTABLE'); END;
CREATE TRIGGER modelos_aire_historial_no_eliminar BEFORE DELETE ON modelos_aire_historial
BEGIN SELECT RAISE(ABORT, 'CATALOGO_AIRES_HISTORIAL_INMUTABLE'); END;

ALTER TABLE activos ADD COLUMN modelo_aire_id INTEGER REFERENCES modelos_aire(id);
ALTER TABLE activos ADD COLUMN modelo_aire_snapshot TEXT;
CREATE INDEX activos_modelo_aire_idx ON activos(modelo_aire_id);

-- Se revalida la versión al insertar, cerrando la carrera entre lectura y alta.
CREATE TRIGGER activos_validar_modelo_aire BEFORE INSERT ON activos
WHEN NEW.modelo_aire_id IS NOT NULL OR NEW.modelo_aire_snapshot IS NOT NULL
BEGIN
  SELECT ( CASE WHEN NEW.modelo_aire_id IS NULL OR NEW.modelo_aire_snapshot IS NULL
    OR NEW.rubro IS NOT 'aires' OR NEW.tipo IS NOT 'general'
    OR NOT json_valid(NEW.modelo_aire_snapshot)
    THEN RAISE(ABORT, 'CATALOGO_AIRES_VINCULO_INVALIDO') END );
  SELECT ( CASE WHEN NOT EXISTS (
    SELECT 1 FROM modelos_aire m WHERE m.id = NEW.modelo_aire_id AND m.activo = 1
      AND m.id IS json_extract(NEW.modelo_aire_snapshot, '$.id')
      AND m.version IS json_extract(NEW.modelo_aire_snapshot, '$.version')
      AND m.nombre IS json_extract(NEW.modelo_aire_snapshot, '$.nombre')
      AND m.descripcion IS json_extract(NEW.modelo_aire_snapshot, '$.descripcion')
      AND m.categoria IS json_extract(NEW.modelo_aire_snapshot, '$.categoria')
      AND m.marca IS json_extract(NEW.modelo_aire_snapshot, '$.marca')
      AND m.modelo IS json_extract(NEW.modelo_aire_snapshot, '$.modelo')
      AND json(m.datos_tecnicos) IS json_extract(NEW.modelo_aire_snapshot, '$.datosTecnicos')
  ) THEN RAISE(ABORT, 'CATALOGO_AIRES_DESACTUALIZADO') END );
END;
-- Los datos propios de la unidad siguen editables; únicamente el origen se conserva.
CREATE TRIGGER activos_preservar_modelo_aire BEFORE UPDATE ON activos
WHEN NEW.modelo_aire_id IS NOT OLD.modelo_aire_id OR NEW.modelo_aire_snapshot IS NOT OLD.modelo_aire_snapshot
  OR (OLD.modelo_aire_id IS NOT NULL AND (NEW.rubro IS NOT 'aires' OR NEW.tipo IS NOT 'general'))
BEGIN SELECT RAISE(ABORT, 'CATALOGO_AIRES_ORIGEN_INMUTABLE'); END;
