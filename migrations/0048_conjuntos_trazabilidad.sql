-- La agrupación no duplica activos. Los vínculos y las órdenes conservan su origen.
CREATE TABLE conjuntos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(codigo)) BETWEEN 1 AND 60),
  nombre TEXT NOT NULL CHECK(length(trim(nombre)) BETWEEN 1 AND 200),
  descripcion TEXT,
  rubro TEXT NOT NULL CHECK(rubro IN ('aires','infraestructura','equipo_general','biomedico')),
  criticidad TEXT NOT NULL CHECK(criticidad IN ('alta','media','baja')),
  ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE RESTRICT,
  activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  ultima_operacion_id TEXT NOT NULL UNIQUE,
  creado_por INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_conjuntos_rubro_activo ON conjuntos(rubro,activo);
CREATE TABLE conjunto_puestos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conjunto_id INTEGER NOT NULL REFERENCES conjuntos(id) ON DELETE RESTRICT,
  funcion TEXT NOT NULL CHECK(length(trim(funcion)) BETWEEN 1 AND 100),
  esencial INTEGER NOT NULL CHECK(esencial IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(conjunto_id,funcion COLLATE NOCASE)
);
CREATE TABLE conjunto_componentes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  puesto_id INTEGER NOT NULL REFERENCES conjunto_puestos(id) ON DELETE RESTRICT,
  activo_id INTEGER NOT NULL REFERENCES activos(id) ON DELETE RESTRICT,
  incorporado_en TEXT NOT NULL,
  retirado_en TEXT,
  incorporado_por INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  retirado_por INTEGER REFERENCES usuarios(id) ON DELETE RESTRICT,
  motivo_alta TEXT NOT NULL CHECK(length(trim(motivo_alta)) BETWEEN 3 AND 500),
  motivo_retiro TEXT CHECK(motivo_retiro IS NULL OR length(trim(motivo_retiro)) BETWEEN 3 AND 500),
  activo_codigo TEXT NOT NULL,
  activo_nombre TEXT NOT NULL,
  activo_serial TEXT,
  incorporado_por_nombre TEXT NOT NULL,
  retirado_por_nombre TEXT,
  CHECK(retirado_en IS NULL OR retirado_en >= incorporado_en),
  CHECK((retirado_en IS NULL AND retirado_por IS NULL AND motivo_retiro IS NULL AND retirado_por_nombre IS NULL)
     OR (retirado_en IS NOT NULL AND retirado_por IS NOT NULL AND motivo_retiro IS NOT NULL AND retirado_por_nombre IS NOT NULL))
);
CREATE UNIQUE INDEX uq_conjunto_puesto_abierto ON conjunto_componentes(puesto_id) WHERE retirado_en IS NULL;
CREATE UNIQUE INDEX uq_conjunto_activo_abierto ON conjunto_componentes(activo_id) WHERE retirado_en IS NULL;
CREATE INDEX idx_componentes_activo_historia ON conjunto_componentes(activo_id,incorporado_en);
CREATE INDEX idx_componentes_puesto_historia ON conjunto_componentes(puesto_id,incorporado_en);
CREATE TABLE conjunto_eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conjunto_id INTEGER NOT NULL REFERENCES conjuntos(id) ON DELETE RESTRICT,
  fecha TEXT NOT NULL,
  accion TEXT NOT NULL CHECK(accion IN ('crear','editar','archivar','reactivar','incorporar','retirar','reemplazar')),
  motivo TEXT NOT NULL CHECK(length(trim(motivo)) BETWEEN 3 AND 500),
  actor_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  actor_nombre TEXT NOT NULL,
  antes TEXT CHECK(antes IS NULL OR json_valid(antes)),
  despues TEXT NOT NULL CHECK(json_valid(despues))
);
CREATE INDEX idx_conjunto_eventos_fecha ON conjunto_eventos(conjunto_id,fecha,id);
CREATE TABLE orden_conjuntos (
  orden_id INTEGER PRIMARY KEY REFERENCES ordenes(id) ON DELETE RESTRICT,
  conjunto_id INTEGER NOT NULL REFERENCES conjuntos(id) ON DELETE RESTRICT,
  puesto_id INTEGER NOT NULL REFERENCES conjunto_puestos(id) ON DELETE RESTRICT,
  componente_id INTEGER NOT NULL REFERENCES conjunto_componentes(id) ON DELETE RESTRICT,
  activo_id INTEGER NOT NULL REFERENCES activos(id) ON DELETE RESTRICT,
  fecha TEXT NOT NULL,
  funcion TEXT NOT NULL,
  activo_codigo TEXT NOT NULL,
  activo_nombre TEXT NOT NULL,
  activo_serial TEXT
);
CREATE INDEX idx_orden_conjunto_fecha ON orden_conjuntos(conjunto_id,fecha);

CREATE TRIGGER conjuntos_no_delete BEFORE DELETE ON conjuntos BEGIN SELECT RAISE(ABORT,'CONJUNTO_NO_DELETE'); END;
CREATE TRIGGER conjuntos_identidad_fija BEFORE UPDATE ON conjuntos
WHEN NEW.id IS NOT OLD.id OR NEW.codigo IS NOT OLD.codigo OR NEW.rubro IS NOT OLD.rubro OR NEW.creado_por IS NOT OLD.creado_por OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'CONJUNTO_IDENTIDAD_INMUTABLE'); END;
CREATE TRIGGER conjuntos_version BEFORE UPDATE ON conjuntos
WHEN NEW.version != OLD.version + 1 OR NEW.ultima_operacion_id = OLD.ultima_operacion_id
BEGIN SELECT RAISE(ABORT,'CONJUNTO_VERSION_INVALIDA'); END;
CREATE TRIGGER conjuntos_archivar_vacio BEFORE UPDATE OF activo ON conjuntos
WHEN NEW.activo = 0 AND EXISTS(SELECT 1 FROM conjunto_puestos p JOIN conjunto_componentes c ON c.puesto_id=p.id WHERE p.conjunto_id=OLD.id AND c.retirado_en IS NULL)
BEGIN SELECT RAISE(ABORT,'CONJUNTO_NO_VACIO'); END;
CREATE TRIGGER conjunto_puestos_no_delete BEFORE DELETE ON conjunto_puestos BEGIN SELECT RAISE(ABORT,'PUESTO_NO_DELETE'); END;
CREATE TRIGGER conjunto_puestos_no_update BEFORE UPDATE ON conjunto_puestos BEGIN SELECT RAISE(ABORT,'PUESTO_INMUTABLE'); END;
CREATE TRIGGER conjunto_puestos_solo_activo BEFORE INSERT ON conjunto_puestos
WHEN NOT EXISTS(SELECT 1 FROM conjuntos WHERE id=NEW.conjunto_id AND activo=1)
BEGIN SELECT RAISE(ABORT,'CONJUNTO_ARCHIVADO'); END;
CREATE TRIGGER conjunto_componentes_no_delete BEFORE DELETE ON conjunto_componentes BEGIN SELECT RAISE(ABORT,'VINCULO_NO_DELETE'); END;
CREATE TRIGGER conjunto_componentes_cierre_unico BEFORE UPDATE ON conjunto_componentes
WHEN OLD.retirado_en IS NOT NULL OR NEW.retirado_en IS NULL
 OR NEW.id IS NOT OLD.id OR NEW.puesto_id IS NOT OLD.puesto_id OR NEW.activo_id IS NOT OLD.activo_id
 OR NEW.incorporado_en IS NOT OLD.incorporado_en OR NEW.incorporado_por IS NOT OLD.incorporado_por
 OR NEW.motivo_alta IS NOT OLD.motivo_alta OR NEW.activo_codigo IS NOT OLD.activo_codigo
 OR NEW.activo_nombre IS NOT OLD.activo_nombre OR NEW.activo_serial IS NOT OLD.activo_serial
 OR NEW.incorporado_por_nombre IS NOT OLD.incorporado_por_nombre
BEGIN SELECT RAISE(ABORT,'VINCULO_HISTORICO_INMUTABLE'); END;
CREATE TRIGGER conjunto_componentes_validar_alta BEFORE INSERT ON conjunto_componentes
WHEN NEW.retirado_en IS NOT NULL OR NOT EXISTS(SELECT 1 FROM activos WHERE id=NEW.activo_id AND estado!='baja')
 OR NOT EXISTS(SELECT 1 FROM conjunto_puestos p JOIN conjuntos c ON c.id=p.conjunto_id WHERE p.id=NEW.puesto_id AND c.activo=1)
BEGIN SELECT RAISE(ABORT,'COMPONENTE_ALTA_INVALIDA'); END;
CREATE TRIGGER conjunto_eventos_no_update BEFORE UPDATE ON conjunto_eventos BEGIN SELECT RAISE(ABORT,'EVENTO_INMUTABLE'); END;
CREATE TRIGGER conjunto_eventos_no_delete BEFORE DELETE ON conjunto_eventos BEGIN SELECT RAISE(ABORT,'EVENTO_NO_DELETE'); END;
CREATE TRIGGER orden_conjuntos_no_update BEFORE UPDATE ON orden_conjuntos BEGIN SELECT RAISE(ABORT,'ORDEN_CONJUNTO_INMUTABLE'); END;
CREATE TRIGGER orden_conjuntos_no_delete BEFORE DELETE ON orden_conjuntos BEGIN SELECT RAISE(ABORT,'ORDEN_CONJUNTO_NO_DELETE'); END;
CREATE TRIGGER ordenes_conjunto_no_delete BEFORE DELETE ON ordenes
WHEN EXISTS(SELECT 1 FROM orden_conjuntos WHERE orden_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'ORDEN_CONJUNTO_NO_DELETE'); END;
CREATE TRIGGER ordenes_conjunto_activo_fijo BEFORE UPDATE OF activo_id ON ordenes
WHEN NEW.activo_id IS NOT OLD.activo_id AND EXISTS(SELECT 1 FROM orden_conjuntos WHERE orden_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'ORDEN_CONJUNTO_ACTIVO_INMUTABLE'); END;
CREATE TRIGGER activos_conjunto_no_delete BEFORE DELETE ON activos
WHEN EXISTS(SELECT 1 FROM conjunto_componentes WHERE activo_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'ACTIVO_CON_HISTORIA_CONJUNTO'); END;
-- Capture at creation only, so earlier work is never reassigned retroactively.
CREATE TRIGGER ordenes_capturar_conjunto AFTER INSERT ON ordenes
WHEN NEW.activo_id IS NOT NULL
BEGIN
 INSERT INTO orden_conjuntos (orden_id,conjunto_id,puesto_id,componente_id,activo_id,fecha,funcion,activo_codigo,activo_nombre,activo_serial)
 SELECT NEW.id,p.conjunto_id,p.id,c.id,c.activo_id,MAX(strftime('%Y-%m-%dT%H:%M:%fZ','now'),c.incorporado_en),p.funcion,c.activo_codigo,c.activo_nombre,c.activo_serial
 FROM conjunto_componentes c JOIN conjunto_puestos p ON p.id=c.puesto_id
 WHERE c.activo_id=NEW.activo_id AND c.retirado_en IS NULL;
END;
-- Un trabajo sin asociación puede adquirirla cuando se le asigna un componente.
-- Una asociación que ya existe permanece inmutable.
CREATE TRIGGER ordenes_capturar_conjunto_al_asignar AFTER UPDATE OF activo_id ON ordenes
WHEN NEW.activo_id IS NOT NULL AND NEW.activo_id IS NOT OLD.activo_id
 AND NOT EXISTS(SELECT 1 FROM orden_conjuntos WHERE orden_id=NEW.id)
BEGIN
 INSERT INTO orden_conjuntos (orden_id,conjunto_id,puesto_id,componente_id,activo_id,fecha,funcion,activo_codigo,activo_nombre,activo_serial)
 SELECT NEW.id,p.conjunto_id,p.id,c.id,c.activo_id,MAX(strftime('%Y-%m-%dT%H:%M:%fZ','now'),c.incorporado_en),p.funcion,c.activo_codigo,c.activo_nombre,c.activo_serial
 FROM conjunto_componentes c JOIN conjunto_puestos p ON p.id=c.puesto_id
 WHERE c.activo_id=NEW.activo_id AND c.retirado_en IS NULL;
END;
