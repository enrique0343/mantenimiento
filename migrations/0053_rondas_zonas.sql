-- Operational round zones group existing locations without changing their hierarchy or PM data.
PRAGMA foreign_keys = ON;
CREATE TABLE rondas_zones (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
 site_id INTEGER NOT NULL REFERENCES sucursales(id),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
 snapshot_json TEXT NOT NULL,
 mutation_token TEXT NOT NULL,
 created_by INTEGER NOT NULL REFERENCES usuarios(id),
 created_at TEXT NOT NULL
);
CREATE TABLE rondas_zone_locations (
 zone_id INTEGER NOT NULL REFERENCES rondas_zones(id),
 location_id INTEGER NOT NULL UNIQUE REFERENCES ubicaciones(id),
 position INTEGER NOT NULL CHECK(position >= 0),
 PRIMARY KEY(zone_id,location_id), UNIQUE(zone_id,position)
);
CREATE TABLE rondas_zone_versions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 zone_id INTEGER NOT NULL REFERENCES rondas_zones(id),
 version INTEGER NOT NULL,
 snapshot_json TEXT NOT NULL,
 reason TEXT NOT NULL,
 created_by INTEGER NOT NULL REFERENCES usuarios(id),
 created_at TEXT NOT NULL,
 UNIQUE(zone_id,version)
);
CREATE TRIGGER rondas_zone_location_valid BEFORE INSERT ON rondas_zone_locations
WHEN NOT EXISTS (
 SELECT 1 FROM ubicaciones u JOIN rondas_zones z ON z.id=NEW.zone_id
 JOIN sucursales s ON s.id=z.site_id
 WHERE u.id=NEW.location_id AND u.sucursal_id=z.site_id AND u.activa=1 AND s.activa=1
)
BEGIN SELECT RAISE(ABORT,'Zone location must be active and in the same site'); END;
CREATE TRIGGER rondas_zone_versions_immutable_update BEFORE UPDATE ON rondas_zone_versions
BEGIN SELECT RAISE(ABORT,'Zone versions are immutable'); END;
CREATE TRIGGER rondas_zone_versions_immutable_delete BEFORE DELETE ON rondas_zone_versions
BEGIN SELECT RAISE(ABORT,'Zone versions are immutable'); END;
ALTER TABLE rondas_executions ADD COLUMN zone_id INTEGER REFERENCES rondas_zones(id);
CREATE INDEX rondas_execution_zone ON rondas_executions(zone_id,scheduled_date);
CREATE TRIGGER rondas_zone_identity_immutable BEFORE UPDATE OF zone_id,site_id,location_id ON rondas_executions
BEGIN SELECT RAISE(ABORT,'Execution location identity is immutable'); END;
CREATE TRIGGER rondas_zone_execution_scope BEFORE INSERT ON rondas_executions
WHEN NEW.zone_id IS NOT NULL AND (
 NOT EXISTS(SELECT 1 FROM sucursales WHERE id=NEW.site_id AND activa=1)
 OR EXISTS(SELECT 1 FROM json_each(NEW.snapshot_json,'$.locations') member
  LEFT JOIN ubicaciones u ON u.id=json_extract(member.value,'$.id')
  WHERE u.id IS NULL OR u.activa<>1 OR u.sucursal_id<>NEW.site_id)
)
BEGIN SELECT RAISE(ABORT,'Round zone physical scope changed'); END;
ALTER TABLE rondas_proposals ADD COLUMN location_id INTEGER REFERENCES ubicaciones(id);
ALTER TABLE rondas_proposals ADD COLUMN point_code TEXT;
CREATE INDEX rondas_proposal_location ON rondas_proposals(location_id,point_code,asset_id,kind);
CREATE TRIGGER rondas_zone_proposal_asset_scope BEFORE INSERT ON rondas_proposals
WHEN NEW.asset_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM rondas_executions WHERE id=NEW.execution_id AND zone_id IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM activos WHERE id=NEW.asset_id AND ubicacion_id=NEW.location_id AND estado<>'baja')
BEGIN SELECT RAISE(ABORT,'Round proposal equipment location changed'); END;
