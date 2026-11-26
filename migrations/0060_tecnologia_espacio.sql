-- Tecnología: ampliar solo CHECKs, conservando IDs, datos, FKs y permisos existentes.
-- Aplicar como una migración atómica D1; no se borran ni reconstruyen tablas.
-- Se suspenden únicamente índices/triggers/vistas que dependen de las columnas.
-- Las vistas SGO se restauran idénticas: su contrato sigue en cuatro áreas.

DROP INDEX idx_usuarios_especialidad;
DROP INDEX idx_tickets_rubro_estado;
DROP INDEX idx_ordenes_rubro_estado;
DROP INDEX idx_actividades_rubro;
DROP INDEX idx_conjuntos_rubro_activo;
DROP TRIGGER conjuntos_identidad_fija;
DROP TRIGGER conjuntos_version;
DROP TRIGGER ordenes_codigo_asignar;
DROP TRIGGER sgo_ordenes_update;
DROP TRIGGER sgo_actividades_update;
DROP TRIGGER sgo_refresh_entity;
DROP VIEW sgo_asset_source;
DROP VIEW sgo_activity_scope;
DROP VIEW sgo_order_source;
DROP VIEW sgo_source_records;

ALTER TABLE tickets RENAME COLUMN rubro TO rubro_anterior;
ALTER TABLE tickets ADD COLUMN rubro TEXT CHECK (rubro IN ('aires','infraestructura','equipo_general','biomedico','tecnologia'));
UPDATE tickets SET rubro = rubro_anterior;
ALTER TABLE tickets DROP COLUMN rubro_anterior;

ALTER TABLE ordenes RENAME COLUMN rubro TO rubro_anterior;
ALTER TABLE ordenes ADD COLUMN rubro TEXT CHECK (rubro IN ('aires','infraestructura','equipo_general','biomedico','tecnologia'));
UPDATE ordenes SET rubro = rubro_anterior;
ALTER TABLE ordenes DROP COLUMN rubro_anterior;

ALTER TABLE actividades RENAME COLUMN rubro TO rubro_anterior;
ALTER TABLE actividades ADD COLUMN rubro TEXT CHECK (rubro IN ('aires','infraestructura','equipo_general','biomedico','tecnologia'));
UPDATE actividades SET rubro = rubro_anterior;
ALTER TABLE actividades DROP COLUMN rubro_anterior;

ALTER TABLE conjuntos RENAME COLUMN rubro TO rubro_anterior;
ALTER TABLE conjuntos ADD COLUMN rubro TEXT NOT NULL DEFAULT 'equipo_general' CHECK (rubro IN ('aires','infraestructura','equipo_general','biomedico','tecnologia'));
UPDATE conjuntos SET rubro = rubro_anterior;
ALTER TABLE conjuntos DROP COLUMN rubro_anterior;

ALTER TABLE usuarios RENAME COLUMN especialidad TO especialidad_anterior;
ALTER TABLE usuarios ADD COLUMN especialidad TEXT CHECK (especialidad IN ('general','biomedico','ambos','tecnologia'));
UPDATE usuarios SET especialidad = especialidad_anterior;
ALTER TABLE usuarios DROP COLUMN especialidad_anterior;

CREATE VIEW sgo_asset_source AS
SELECT 'asset' AS resource,a.id AS source_id,CAST(a.id AS TEXT) AS id,
 CASE WHEN l.activa=1 AND s.activa=1 AND a.rubro IN('aires','infraestructura','equipo_general','biomedico') AND a.estado IN('operativo','averiado','mantenimiento','baja') THEN CAST(s.id AS TEXT) END AS site_id,
 CASE WHEN l.activa=1 AND s.activa=1 AND a.rubro IN('aires','infraestructura','equipo_general','biomedico') AND a.estado IN('operativo','averiado','mantenimiento','baja') THEN a.rubro END AS maintenance_area_id,
 json_object('id',CAST(a.id AS TEXT),'scope_origin','location_current','created_at',a.created_at,
 'display_code',NULL,'location_id',CAST(a.ubicacion_id AS TEXT),'status',a.estado,
 'criticality',CASE WHEN a.criticidad_operacional IN('alta','media','baja') THEN a.criticidad_operacional END) AS raw_payload
FROM activos a LEFT JOIN ubicaciones l ON l.id=a.ubicacion_id LEFT JOIN sucursales s ON s.id=l.sucursal_id;

CREATE VIEW sgo_activity_scope AS
SELECT t.id,t.rubro,
 CASE WHEN t.sucursal_id IS NOT NULL THEN
   CASE WHEN es.activa=1 AND (t.ubicacion_id IS NULL OR (l.activa=1 AND ls.activa=1 AND l.sucursal_id=t.sucursal_id)) THEN CAST(t.sucursal_id AS TEXT) END
 ELSE CASE WHEN l.activa=1 AND ls.activa=1 THEN CAST(l.sucursal_id AS TEXT) END END AS site_id
FROM actividades t LEFT JOIN sucursales es ON es.id=t.sucursal_id
LEFT JOIN ubicaciones l ON l.id=t.ubicacion_id LEFT JOIN sucursales ls ON ls.id=l.sucursal_id;

CREATE VIEW sgo_order_source AS
WITH refs AS (
 SELECT o.*,CASE WHEN l.activa=1 AND ls.activa=1 THEN CAST(l.sucursal_id AS TEXT) END AS location_site,
 es.activa AS explicit_site_active,t.site_id AS activity_site,t.rubro AS activity_area,
 a.site_id AS asset_site,a.maintenance_area_id AS asset_area
 FROM ordenes o LEFT JOIN ubicaciones l ON l.id=o.ubicacion_id
 LEFT JOIN sucursales ls ON ls.id=l.sucursal_id LEFT JOIN sucursales es ON es.id=o.sucursal_id
 LEFT JOIN sgo_activity_scope t ON t.id=o.actividad_id LEFT JOIN sgo_asset_source a ON a.source_id=o.activo_id
), resolved AS (
 SELECT *, CASE
 WHEN rubro NOT IN('aires','infraestructura','equipo_general','biomedico') OR rubro IS NULL THEN NULL
 WHEN estado NOT IN('abierta','en_proceso','en_espera','completada','verificada','cerrada','cancelada') OR tipo NOT IN('correctivo','preventivo','predictivo') OR prioridad NOT IN('baja','media','alta','urgente') THEN NULL
 WHEN ubicacion_id IS NOT NULL AND location_site IS NULL THEN NULL
 WHEN sucursal_id IS NOT NULL THEN CASE WHEN explicit_site_active=1 AND (location_site IS NULL OR location_site=CAST(sucursal_id AS TEXT)) THEN CAST(sucursal_id AS TEXT) END
 WHEN location_site IS NOT NULL AND activity_site IS NOT NULL AND location_site<>activity_site THEN NULL
 WHEN location_site IS NOT NULL AND asset_site IS NOT NULL AND location_site<>asset_site THEN NULL
 WHEN activity_site IS NOT NULL AND asset_site IS NOT NULL AND activity_site<>asset_site THEN NULL
 ELSE COALESCE(location_site,activity_site,asset_site) END AS resolved_site
 FROM refs
)
SELECT 'order' AS resource,id AS source_id,CAST(id AS TEXT) AS id,resolved_site AS site_id,
 CASE WHEN resolved_site IS NOT NULL THEN rubro END AS maintenance_area_id,
 json_object('id',CAST(id AS TEXT),'scope_origin',CASE WHEN sucursal_id IS NOT NULL THEN 'explicit_order' WHEN location_site IS NOT NULL THEN 'location_current' WHEN activity_site IS NOT NULL THEN 'activity_current' ELSE 'location_current' END,
 'created_at',created_at,
 'asset_id',CASE WHEN asset_site=resolved_site AND asset_area=rubro THEN CAST(activo_id AS TEXT) END,
 'plan_id',NULL,
 'activity_id',CASE WHEN activity_site=resolved_site AND activity_area=rubro THEN CAST(actividad_id AS TEXT) END,
 'type',tipo,'status',estado,'priority',prioridad,'assigned',CASE WHEN asignado_a IS NULL THEN 0 ELSE 1 END,
 'assigned_at',asignado_en,'started_at',iniciada_en,'paused_at',pausada_en,
 'paused_minutes',CASE WHEN tiempo_pausado_min>=0 AND typeof(tiempo_pausado_min)='integer' THEN tiempo_pausado_min END,
 'due_raw',vencimiento,'completed_at',completada_en,'verified_at',verificado_en,'closed_at',cerrado_en,
 'automatic_elapsed_hours',CASE WHEN horas_trabajadas>=0 AND typeof(horas_trabajadas) IN('integer','real') THEN horas_trabajadas END,
 'duration_kind','workflow_elapsed_minus_recorded_wait','due_basis','legacy_unknown',
 'location_id',CASE WHEN location_site=resolved_site THEN CAST(ubicacion_id AS TEXT) END) AS raw_payload
FROM resolved;

CREATE VIEW sgo_source_records AS
SELECT resource,source_id,id,site_id,maintenance_area_id,
 CASE WHEN site_id IS NOT NULL THEN json_set(raw_payload,'$.site_id',site_id,'$.maintenance_area_id',maintenance_area_id) END AS payload
FROM sgo_asset_source
UNION ALL
SELECT resource,source_id,id,site_id,maintenance_area_id,
 CASE WHEN site_id IS NOT NULL THEN json_set(raw_payload,'$.site_id',site_id,'$.maintenance_area_id',maintenance_area_id) END AS payload
FROM sgo_order_source;

CREATE INDEX idx_usuarios_especialidad ON usuarios (especialidad);

CREATE INDEX idx_tickets_rubro_estado ON tickets(rubro, estado);

CREATE INDEX idx_ordenes_rubro_estado ON ordenes(rubro, estado);

CREATE INDEX idx_actividades_rubro ON actividades(rubro);

CREATE INDEX idx_conjuntos_rubro_activo ON conjuntos(rubro,activo);

CREATE TRIGGER conjuntos_identidad_fija BEFORE UPDATE ON conjuntos
WHEN NEW.id IS NOT OLD.id OR NEW.codigo IS NOT OLD.codigo OR NEW.rubro IS NOT OLD.rubro OR NEW.creado_por IS NOT OLD.creado_por OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'CONJUNTO_IDENTIDAD_INMUTABLE'); END;

CREATE TRIGGER conjuntos_version BEFORE UPDATE ON conjuntos
WHEN NEW.version != OLD.version + 1 OR NEW.ultima_operacion_id = OLD.ultima_operacion_id
BEGIN SELECT RAISE(ABORT,'CONJUNTO_VERSION_INVALIDA'); END;

CREATE TRIGGER ordenes_codigo_asignar AFTER INSERT ON ordenes WHEN NEW.codigo IS NULL
BEGIN
  UPDATE orden_series SET ultimo = ultimo + 1
   WHERE serie = CASE WHEN NEW.rubro = 'biomedico' OR (NEW.rubro IS NULL AND (SELECT tipo FROM activos WHERE id = NEW.activo_id) = 'biomedico') THEN 'MB' ELSE 'MG' END;
  UPDATE ordenes SET codigo = (
    SELECT 'OT-' || serie || printf('%04d', ultimo) FROM orden_series
     WHERE serie = CASE WHEN NEW.rubro = 'biomedico' OR (NEW.rubro IS NULL AND (SELECT tipo FROM activos WHERE id = NEW.activo_id) = 'biomedico') THEN 'MB' ELSE 'MG' END
  ) WHERE id = NEW.id;
END;

CREATE TRIGGER sgo_ordenes_update AFTER UPDATE ON ordenes BEGIN
 INSERT OR IGNORE INTO sgo_refresh VALUES('order',CAST(NEW.id AS TEXT));

END;

CREATE TRIGGER sgo_actividades_update AFTER UPDATE ON actividades BEGIN
 INSERT OR IGNORE INTO sgo_refresh SELECT 'order',CAST(id AS TEXT) FROM ordenes WHERE actividad_id=NEW.id;
END;

CREATE TRIGGER sgo_refresh_entity AFTER INSERT ON sgo_refresh BEGIN
 INSERT INTO sgo_entities(resource,id,revision,site_id,maintenance_area_id,payload,source_updated_at,deleted)
 SELECT resource,id,1,site_id,maintenance_area_id,payload,
 iif((SELECT bootstrapping FROM sgo_instance WHERE id=1)=0,strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL),0
 FROM sgo_source_records WHERE resource=NEW.resource AND source_id=CAST(NEW.id AS INTEGER)
 ON CONFLICT(resource,id) DO UPDATE SET revision=sgo_entities.revision+1,
 site_id=excluded.site_id,maintenance_area_id=excluded.maintenance_area_id,payload=excluded.payload,
 source_updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),deleted=0
 WHERE sgo_entities.payload IS NOT excluded.payload OR sgo_entities.deleted<>0;
 UPDATE sgo_entities SET revision=revision+1,site_id=NULL,maintenance_area_id=NULL,payload=NULL,
 source_updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),deleted=1
 WHERE resource=NEW.resource AND id=NEW.id AND deleted=0
 AND NOT EXISTS(SELECT 1 FROM sgo_source_records WHERE resource=NEW.resource AND source_id=CAST(NEW.id AS INTEGER));
 DELETE FROM sgo_refresh WHERE resource=NEW.resource AND id=NEW.id;
END;

