-- Private, opt-in integration. No users, credentials, narrative, prices or serials.
-- Journal sequence belongs to a site/area pair and never resets on version changes.
-- Baseline captures current facts, not invented historical modification times.
CREATE TABLE sgo_instance (
 id INTEGER PRIMARY KEY CHECK(id=1), source_instance_id TEXT NOT NULL UNIQUE,
 installed_at TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
 bootstrapping INTEGER NOT NULL DEFAULT 1 CHECK(bootstrapping IN(0,1)),
 projection_version TEXT NOT NULL DEFAULT 'correctivos-projection-1',
 resource_set_version TEXT NOT NULL DEFAULT 'correctivos-resources-1',
 snapshot_ttl_seconds INTEGER CHECK(snapshot_ttl_seconds>0)
);
INSERT INTO sgo_instance(id,source_instance_id,installed_at)
VALUES(1,lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TRIGGER sgo_instance_identity_immutable BEFORE UPDATE OF source_instance_id,installed_at ON sgo_instance BEGIN SELECT RAISE(ABORT,'sgo_instance_immutable'); END;
CREATE TRIGGER sgo_instance_no_delete BEFORE DELETE ON sgo_instance BEGIN SELECT RAISE(ABORT,'sgo_instance_immutable'); END;

-- No FK to operational sites: old scope journals must survive operational deletion.
CREATE TABLE sgo_scopes (
 site_id TEXT NOT NULL, maintenance_area_id TEXT NOT NULL CHECK(maintenance_area_id IN('aires','infraestructura','equipo_general','biomedico')),
 seq INTEGER NOT NULL DEFAULT 0 CHECK(seq>=0), minimum_available_seq INTEGER NOT NULL DEFAULT 1 CHECK(minimum_available_seq>=1),
 source_updated_at TEXT, history_available_from TEXT NOT NULL,
 asset_coverage TEXT NOT NULL DEFAULT 'unknown' CHECK(asset_coverage IN('unknown','partial','complete')),
 order_coverage TEXT NOT NULL DEFAULT 'unknown' CHECK(order_coverage IN('unknown','partial','complete')),
 PRIMARY KEY(site_id,maintenance_area_id)
);
CREATE TRIGGER sgo_scopes_no_rewind BEFORE UPDATE ON sgo_scopes
WHEN NEW.seq<OLD.seq OR NEW.minimum_available_seq<OLD.minimum_available_seq OR NEW.site_id<>OLD.site_id OR NEW.maintenance_area_id<>OLD.maintenance_area_id
BEGIN SELECT RAISE(ABORT,'sgo_scope_sequence_immutable'); END;
CREATE TRIGGER sgo_scopes_no_delete BEFORE DELETE ON sgo_scopes BEGIN SELECT RAISE(ABORT,'sgo_scope_sequence_immutable'); END;
CREATE TABLE sgo_entities (
 resource TEXT NOT NULL CHECK(resource IN('asset','order')), id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=1), site_id TEXT, maintenance_area_id TEXT,
 payload TEXT CHECK(payload IS NULL OR json_valid(payload)), source_updated_at TEXT,
 deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1)),
 PRIMARY KEY(resource,id), CHECK((site_id IS NULL)=(maintenance_area_id IS NULL)),
 CHECK((site_id IS NULL)=(payload IS NULL))
);
CREATE INDEX sgo_entities_scope ON sgo_entities(site_id,maintenance_area_id,resource,id);
CREATE TABLE sgo_journal (
 site_id TEXT NOT NULL, maintenance_area_id TEXT NOT NULL, seq INTEGER NOT NULL,
 resource TEXT NOT NULL CHECK(resource IN('asset','order')), id TEXT NOT NULL, revision INTEGER NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN('upsert','remove')),
 reason TEXT CHECK(reason IN('deleted','scope_changed')), payload TEXT,
 changed_at TEXT NOT NULL, source_updated_at TEXT,
 PRIMARY KEY(site_id,maintenance_area_id,seq),
 CHECK((operation='upsert' AND reason IS NULL AND json_valid(payload)) OR (operation='remove' AND reason IS NOT NULL AND payload IS NULL))
);
CREATE TRIGGER sgo_journal_no_update BEFORE UPDATE ON sgo_journal BEGIN SELECT RAISE(ABORT,'sgo_journal_immutable'); END;
CREATE TRIGGER sgo_journal_no_delete BEFORE DELETE ON sgo_journal BEGIN SELECT RAISE(ABORT,'sgo_journal_immutable'); END;
CREATE TABLE sgo_refresh (resource TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(resource,id));

-- Internal materialization: draft is not readable by connector; seal after SHA-256.
CREATE TABLE sgo_snapshots (
 snapshot_id TEXT PRIMARY KEY, source_instance_id TEXT NOT NULL, cutoff_at TEXT NOT NULL,
 projection_version TEXT NOT NULL, resource_set_version TEXT NOT NULL,
 snapshot_expires_at TEXT NOT NULL, snapshot_published_at TEXT, source_hash TEXT,
 materialized INTEGER NOT NULL DEFAULT 0 CHECK(materialized IN(0,1)),
 CHECK((snapshot_published_at IS NULL)=(source_hash IS NULL))
);
CREATE TABLE sgo_snapshot_scopes (
 snapshot_id TEXT NOT NULL REFERENCES sgo_snapshots(snapshot_id), site_id TEXT NOT NULL,
 maintenance_area_id TEXT NOT NULL, through_seq INTEGER NOT NULL, minimum_available_seq INTEGER NOT NULL,
 source_updated_at TEXT, history_available_from TEXT, asset_coverage TEXT NOT NULL, order_coverage TEXT NOT NULL,
 site_code TEXT, site_name TEXT NOT NULL,site_active INTEGER NOT NULL CHECK(site_active IN(0,1)),
 PRIMARY KEY(snapshot_id,site_id,maintenance_area_id)
);
CREATE TABLE sgo_snapshot_records (
 snapshot_id TEXT NOT NULL REFERENCES sgo_snapshots(snapshot_id),site_id TEXT NOT NULL,maintenance_area_id TEXT NOT NULL,
 resource TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,source_updated_at TEXT,
 PRIMARY KEY(snapshot_id,site_id,maintenance_area_id,resource,id)
);
CREATE TRIGGER sgo_snapshot_no_update BEFORE UPDATE ON sgo_snapshots
WHEN OLD.snapshot_published_at IS NOT NULL OR NEW.snapshot_id<>OLD.snapshot_id OR NEW.source_instance_id<>OLD.source_instance_id OR NEW.cutoff_at<>OLD.cutoff_at OR NEW.projection_version<>OLD.projection_version OR NEW.resource_set_version<>OLD.resource_set_version OR NEW.snapshot_expires_at<>OLD.snapshot_expires_at OR NOT ((OLD.materialized=0 AND NEW.materialized=1 AND NEW.source_hash IS NULL AND NEW.snapshot_published_at IS NULL) OR (OLD.materialized=1 AND NEW.materialized=1 AND NEW.source_hash IS NOT NULL AND length(NEW.source_hash)=64 AND NEW.snapshot_published_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'sgo_snapshot_immutable'); END;
CREATE TRIGGER sgo_snapshot_no_delete BEFORE DELETE ON sgo_snapshots BEGIN SELECT RAISE(ABORT,'sgo_snapshot_immutable'); END;

CREATE TRIGGER sgo_snapshot_scopes_no_update BEFORE UPDATE ON sgo_snapshot_scopes BEGIN SELECT RAISE(ABORT,'sgo_snapshot_immutable'); END;
CREATE TRIGGER sgo_snapshot_scopes_no_delete BEFORE DELETE ON sgo_snapshot_scopes BEGIN SELECT RAISE(ABORT,'sgo_snapshot_immutable'); END;
CREATE TRIGGER sgo_snapshot_scopes_no_append BEFORE INSERT ON sgo_snapshot_scopes
WHEN EXISTS(SELECT 1 FROM sgo_snapshots WHERE snapshot_id=NEW.snapshot_id AND materialized=1)
BEGIN SELECT RAISE(ABORT,'sgo_snapshot_immutable'); END;

CREATE TRIGGER sgo_snapshot_records_no_update BEFORE UPDATE ON sgo_snapshot_records BEGIN SELECT RAISE(ABORT,'sgo_snapshot_immutable'); END;
CREATE TRIGGER sgo_snapshot_records_no_delete BEFORE DELETE ON sgo_snapshot_records BEGIN SELECT RAISE(ABORT,'sgo_snapshot_immutable'); END;
CREATE TRIGGER sgo_snapshot_records_no_append BEFORE INSERT ON sgo_snapshot_records
WHEN EXISTS(SELECT 1 FROM sgo_snapshots WHERE snapshot_id=NEW.snapshot_id AND materialized=1)
BEGIN SELECT RAISE(ABORT,'sgo_snapshot_immutable'); END;

-- Site/rubro are structured source IDs. No name matching and no default scope.
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

-- Reconciliation runs inside the triggering business statement. Any journal
-- failure rolls back its business write too. Equal safe projections are no-ops.
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

CREATE TRIGGER sgo_entity_insert AFTER INSERT ON sgo_entities WHEN NEW.site_id IS NOT NULL BEGIN
 INSERT INTO sgo_scopes(site_id,maintenance_area_id,history_available_from)
 SELECT NEW.site_id,NEW.maintenance_area_id,(SELECT installed_at FROM sgo_instance WHERE id=1)
 WHERE NOT EXISTS(SELECT 1 FROM sgo_scopes WHERE site_id=NEW.site_id AND maintenance_area_id=NEW.maintenance_area_id);
 UPDATE sgo_scopes SET seq=seq+1,source_updated_at=NEW.source_updated_at WHERE site_id=NEW.site_id AND maintenance_area_id=NEW.maintenance_area_id;
 INSERT INTO sgo_journal(site_id,maintenance_area_id,seq,resource,id,revision,operation,payload,changed_at,source_updated_at)
 SELECT NEW.site_id,NEW.maintenance_area_id,seq,NEW.resource,NEW.id,NEW.revision,'upsert',NEW.payload,strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.source_updated_at
 FROM sgo_scopes WHERE site_id=NEW.site_id AND maintenance_area_id=NEW.maintenance_area_id;
END;
CREATE TRIGGER sgo_entity_update AFTER UPDATE ON sgo_entities BEGIN
 -- Withdraw only the OLD membership; the destination is never serialized here.
 UPDATE sgo_scopes SET seq=seq+1,source_updated_at=NEW.source_updated_at
 WHERE site_id=OLD.site_id AND maintenance_area_id=OLD.maintenance_area_id
 AND (NEW.site_id IS NOT OLD.site_id OR NEW.maintenance_area_id IS NOT OLD.maintenance_area_id);
 INSERT INTO sgo_journal(site_id,maintenance_area_id,seq,resource,id,revision,operation,reason,payload,changed_at,source_updated_at)
 SELECT OLD.site_id,OLD.maintenance_area_id,seq,NEW.resource,NEW.id,NEW.revision,'remove',iif(NEW.deleted=1,'deleted','scope_changed'),NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.source_updated_at
 FROM sgo_scopes WHERE site_id=OLD.site_id AND maintenance_area_id=OLD.maintenance_area_id
 AND (NEW.site_id IS NOT OLD.site_id OR NEW.maintenance_area_id IS NOT OLD.maintenance_area_id);
 INSERT INTO sgo_scopes(site_id,maintenance_area_id,history_available_from)
 SELECT NEW.site_id,NEW.maintenance_area_id,(SELECT installed_at FROM sgo_instance WHERE id=1) WHERE NEW.site_id IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM sgo_scopes WHERE site_id=NEW.site_id AND maintenance_area_id=NEW.maintenance_area_id);
 UPDATE sgo_scopes SET seq=seq+1,source_updated_at=NEW.source_updated_at WHERE site_id=NEW.site_id AND maintenance_area_id=NEW.maintenance_area_id;
 INSERT INTO sgo_journal(site_id,maintenance_area_id,seq,resource,id,revision,operation,payload,changed_at,source_updated_at)
 SELECT NEW.site_id,NEW.maintenance_area_id,seq,NEW.resource,NEW.id,NEW.revision,'upsert',NEW.payload,strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.source_updated_at
 FROM sgo_scopes WHERE site_id=NEW.site_id AND maintenance_area_id=NEW.maintenance_area_id;
END;
CREATE TRIGGER sgo_entities_no_delete BEFORE DELETE ON sgo_entities BEGIN SELECT RAISE(ABORT,'sgo_entity_identity_immutable'); END;
CREATE TRIGGER sgo_entities_revision BEFORE UPDATE ON sgo_entities
WHEN NEW.resource<>OLD.resource OR NEW.id<>OLD.id OR NEW.revision<>OLD.revision+1
BEGIN SELECT RAISE(ABORT,'sgo_entity_revision_invalid'); END;

CREATE TRIGGER sgo_activos_insert AFTER INSERT ON activos BEGIN
 INSERT OR IGNORE INTO sgo_refresh VALUES('asset',CAST(NEW.id AS TEXT));
 INSERT OR IGNORE INTO sgo_refresh SELECT 'order',CAST(id AS TEXT) FROM ordenes WHERE activo_id=NEW.id;
END;

CREATE TRIGGER sgo_ordenes_insert AFTER INSERT ON ordenes BEGIN
 INSERT OR IGNORE INTO sgo_refresh VALUES('order',CAST(NEW.id AS TEXT));

END;

CREATE TRIGGER sgo_ubicaciones_insert AFTER INSERT ON ubicaciones BEGIN
 INSERT OR IGNORE INTO sgo_refresh SELECT 'asset',CAST(id AS TEXT) FROM activos WHERE ubicacion_id=NEW.id;
 INSERT OR IGNORE INTO sgo_refresh SELECT 'order',CAST(o.id AS TEXT) FROM ordenes o
 LEFT JOIN activos a ON a.id=o.activo_id LEFT JOIN actividades t ON t.id=o.actividad_id
 WHERE o.ubicacion_id=NEW.id OR a.ubicacion_id=NEW.id OR t.ubicacion_id=NEW.id;
END;

CREATE TRIGGER sgo_actividades_insert AFTER INSERT ON actividades BEGIN
 INSERT OR IGNORE INTO sgo_refresh SELECT 'order',CAST(id AS TEXT) FROM ordenes WHERE actividad_id=NEW.id;
END;

CREATE TRIGGER sgo_sucursales_insert AFTER INSERT ON sucursales BEGIN
 INSERT OR IGNORE INTO sgo_refresh SELECT 'asset',CAST(id AS TEXT) FROM activos;
 INSERT OR IGNORE INTO sgo_refresh SELECT 'order',CAST(id AS TEXT) FROM ordenes;
END;

CREATE TRIGGER sgo_activos_update AFTER UPDATE ON activos BEGIN
 INSERT OR IGNORE INTO sgo_refresh VALUES('asset',CAST(NEW.id AS TEXT));
 INSERT OR IGNORE INTO sgo_refresh SELECT 'order',CAST(id AS TEXT) FROM ordenes WHERE activo_id=NEW.id;
END;

CREATE TRIGGER sgo_ordenes_update AFTER UPDATE ON ordenes BEGIN
 INSERT OR IGNORE INTO sgo_refresh VALUES('order',CAST(NEW.id AS TEXT));

END;

CREATE TRIGGER sgo_ubicaciones_update AFTER UPDATE ON ubicaciones BEGIN
 INSERT OR IGNORE INTO sgo_refresh SELECT 'asset',CAST(id AS TEXT) FROM activos WHERE ubicacion_id=NEW.id;
 INSERT OR IGNORE INTO sgo_refresh SELECT 'order',CAST(o.id AS TEXT) FROM ordenes o
 LEFT JOIN activos a ON a.id=o.activo_id LEFT JOIN actividades t ON t.id=o.actividad_id
 WHERE o.ubicacion_id=NEW.id OR a.ubicacion_id=NEW.id OR t.ubicacion_id=NEW.id;
END;

CREATE TRIGGER sgo_actividades_update AFTER UPDATE ON actividades BEGIN
 INSERT OR IGNORE INTO sgo_refresh SELECT 'order',CAST(id AS TEXT) FROM ordenes WHERE actividad_id=NEW.id;
END;

CREATE TRIGGER sgo_sucursales_update AFTER UPDATE ON sucursales BEGIN
 INSERT OR IGNORE INTO sgo_refresh SELECT 'asset',CAST(id AS TEXT) FROM activos;
 INSERT OR IGNORE INTO sgo_refresh SELECT 'order',CAST(id AS TEXT) FROM ordenes;
END;

CREATE TRIGGER sgo_activos_delete AFTER DELETE ON activos BEGIN
 INSERT OR IGNORE INTO sgo_refresh VALUES('asset',CAST(OLD.id AS TEXT));
 INSERT OR IGNORE INTO sgo_refresh SELECT 'order',CAST(id AS TEXT) FROM ordenes WHERE activo_id=OLD.id;
END;

CREATE TRIGGER sgo_ordenes_delete AFTER DELETE ON ordenes BEGIN
 INSERT OR IGNORE INTO sgo_refresh VALUES('order',CAST(OLD.id AS TEXT));

END;

CREATE TRIGGER sgo_ubicaciones_delete AFTER DELETE ON ubicaciones BEGIN
 INSERT OR IGNORE INTO sgo_refresh SELECT 'asset',CAST(id AS TEXT) FROM activos WHERE ubicacion_id=OLD.id;
 INSERT OR IGNORE INTO sgo_refresh SELECT 'order',CAST(o.id AS TEXT) FROM ordenes o
 LEFT JOIN activos a ON a.id=o.activo_id LEFT JOIN actividades t ON t.id=o.actividad_id
 WHERE o.ubicacion_id=OLD.id OR a.ubicacion_id=OLD.id OR t.ubicacion_id=OLD.id;
END;

CREATE TRIGGER sgo_actividades_delete AFTER DELETE ON actividades BEGIN
 INSERT OR IGNORE INTO sgo_refresh SELECT 'order',CAST(id AS TEXT) FROM ordenes WHERE actividad_id=OLD.id;
END;

CREATE TRIGGER sgo_sucursales_delete AFTER DELETE ON sucursales BEGIN
 INSERT OR IGNORE INTO sgo_refresh SELECT 'asset',CAST(id AS TEXT) FROM activos;
 INSERT OR IGNORE INTO sgo_refresh SELECT 'order',CAST(id AS TEXT) FROM ordenes;
END;

-- Empty site/area pairs are still addressable, with UNKNOWN operational coverage.
INSERT INTO sgo_scopes(site_id,maintenance_area_id,history_available_from)
SELECT CAST(s.id AS TEXT),a.area,(SELECT installed_at FROM sgo_instance WHERE id=1)
FROM sucursales s CROSS JOIN (SELECT 'aires' AS area UNION ALL SELECT 'infraestructura' UNION ALL SELECT 'equipo_general' UNION ALL SELECT 'biomedico') a;
CREATE TRIGGER sgo_new_site_scopes AFTER INSERT ON sucursales BEGIN
 INSERT INTO sgo_scopes(site_id,maintenance_area_id,history_available_from)
 SELECT CAST(NEW.id AS TEXT),area,(SELECT installed_at FROM sgo_instance WHERE id=1)
 FROM (SELECT 'aires' AS area UNION ALL SELECT 'infraestructura' UNION ALL SELECT 'equipo_general' UNION ALL SELECT 'biomedico') a
 WHERE NOT EXISTS(SELECT 1 FROM sgo_scopes WHERE site_id=CAST(NEW.id AS TEXT) AND maintenance_area_id=a.area);
END;
INSERT OR IGNORE INTO sgo_refresh SELECT resource,id FROM sgo_source_records;
UPDATE sgo_instance SET bootstrapping=0 WHERE id=1;
CREATE TRIGGER sgo_no_rebootstrap BEFORE UPDATE OF bootstrapping ON sgo_instance BEGIN SELECT RAISE(ABORT,'sgo_baseline_immutable'); END;
