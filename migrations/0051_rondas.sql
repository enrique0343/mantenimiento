-- Additive, independent rounds module. No UPDATE/DELETE of PM plans or calendars.
PRAGMA foreign_keys = ON;
CREATE TABLE rondas_templates (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 config_json TEXT NOT NULL, mutation_token TEXT NOT NULL, created_by INTEGER NOT NULL REFERENCES usuarios(id), created_at TEXT NOT NULL
);
CREATE TABLE rondas_template_versions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER NOT NULL REFERENCES rondas_templates(id),
 version INTEGER NOT NULL, config_json TEXT NOT NULL, reason TEXT NOT NULL, created_by INTEGER NOT NULL REFERENCES usuarios(id), created_at TEXT NOT NULL,
 UNIQUE(template_id,version)
);
CREATE TABLE rondas_executions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER NOT NULL REFERENCES rondas_templates(id), template_version INTEGER NOT NULL,
 name TEXT NOT NULL, site_id INTEGER NOT NULL REFERENCES sucursales(id), location_id INTEGER NOT NULL REFERENCES ubicaciones(id),
 scheduled_date TEXT NOT NULL, shift TEXT NOT NULL, due_at TEXT NOT NULL, original_due_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pendiente' CHECK(status IN ('pendiente','en_curso','pendiente_validacion','devuelta','validada','omitida')),
 owner_id INTEGER NOT NULL REFERENCES usuarios(id), backup_id INTEGER REFERENCES usuarios(id), reviewer_id INTEGER NOT NULL REFERENCES usuarios(id), reviewer_backup_id INTEGER REFERENCES usuarios(id),
 snapshot_json TEXT NOT NULL, data_json TEXT NOT NULL, equipment_snapshot_json TEXT,
 executed_by INTEGER REFERENCES usuarios(id), executed_at TEXT, reviewed_by INTEGER REFERENCES usuarios(id), reviewed_at TEXT,
 revision INTEGER NOT NULL DEFAULT 0, mutation_token TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(template_id, scheduled_date, shift)
);
CREATE INDEX rondas_execution_scope ON rondas_executions(site_id,location_id,status,due_at);
CREATE TABLE rondas_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, execution_id INTEGER NOT NULL REFERENCES rondas_executions(id),
 action TEXT NOT NULL, actor_id INTEGER NOT NULL REFERENCES usuarios(id), actor_name TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE rondas_proposals (
 id INTEGER PRIMARY KEY AUTOINCREMENT, execution_id INTEGER NOT NULL REFERENCES rondas_executions(id), point_id TEXT NOT NULL,
 asset_id INTEGER REFERENCES activos(id), plan_id INTEGER REFERENCES planes_mantenimiento(id), kind TEXT NOT NULL CHECK(kind IN ('correctivo','preventivo')),
 reason TEXT NOT NULL, cycle_date TEXT, executor_type TEXT NOT NULL DEFAULT 'internal', provider_id INTEGER REFERENCES proveedores(id), status TEXT NOT NULL DEFAULT 'pendiente_aprobacion' CHECK(status IN ('pendiente_aprobacion','aprobada','devuelta','rechazada')),
 dedup_key TEXT NOT NULL UNIQUE, priority TEXT, due_at TEXT, assigned_to INTEGER REFERENCES usuarios(id),
 order_id INTEGER REFERENCES ordenes(id), created_by INTEGER NOT NULL REFERENCES usuarios(id), created_at TEXT NOT NULL,
 decided_by INTEGER REFERENCES usuarios(id), decided_at TEXT, decision_reason TEXT, mutation_token TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE rondas_proposal_links (
 execution_id INTEGER NOT NULL REFERENCES rondas_executions(id), point_id TEXT NOT NULL,
 proposal_id INTEGER NOT NULL REFERENCES rondas_proposals(id), PRIMARY KEY(execution_id,point_id,proposal_id)
);
CREATE TABLE rondas_order_links (
 execution_id INTEGER NOT NULL REFERENCES rondas_executions(id), point_id TEXT NOT NULL,
 order_id INTEGER NOT NULL REFERENCES ordenes(id), proposal_id INTEGER NOT NULL REFERENCES rondas_proposals(id),
 PRIMARY KEY(execution_id,point_id,order_id)
);
CREATE TABLE rondas_notifications (
 id INTEGER PRIMARY KEY AUTOINCREMENT, execution_id INTEGER NOT NULL REFERENCES rondas_executions(id),
 event TEXT NOT NULL, event_revision INTEGER NOT NULL, recipient_id INTEGER NOT NULL REFERENCES usuarios(id),
 status TEXT NOT NULL DEFAULT 'dry_run', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
 next_attempt_at TEXT, delivered_at TEXT, created_at TEXT NOT NULL,
 UNIQUE(execution_id,event,event_revision,recipient_id)
);
CREATE TABLE rondas_notification_attempts (
 id INTEGER PRIMARY KEY AUTOINCREMENT, notification_id INTEGER NOT NULL REFERENCES rondas_notifications(id),
 status TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER rondas_versions_immutable_update BEFORE UPDATE ON rondas_template_versions BEGIN SELECT RAISE(ABORT,'Published versions are immutable'); END;
CREATE TRIGGER rondas_versions_immutable_delete BEFORE DELETE ON rondas_template_versions BEGIN SELECT RAISE(ABORT,'Published versions are immutable'); END;
CREATE TRIGGER rondas_events_immutable_update BEFORE UPDATE ON rondas_events BEGIN SELECT RAISE(ABORT,'Audit events are immutable'); END;
CREATE TRIGGER rondas_events_immutable_delete BEFORE DELETE ON rondas_events BEGIN SELECT RAISE(ABORT,'Audit events are immutable'); END;
CREATE TRIGGER rondas_snapshot_immutable BEFORE UPDATE OF snapshot_json,original_due_at,template_version,scheduled_date,owner_id,backup_id,reviewer_id,reviewer_backup_id ON rondas_executions BEGIN SELECT RAISE(ABORT,'Execution identity and original schedule are immutable'); END;
CREATE TABLE rondas_schedule_cursors (
 template_id INTEGER PRIMARY KEY REFERENCES rondas_templates(id), last_date TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TRIGGER rondas_notification_attempts_immutable_update BEFORE UPDATE ON rondas_notification_attempts BEGIN SELECT RAISE(ABORT,'Delivery audit is immutable'); END;
CREATE TRIGGER rondas_notification_attempts_immutable_delete BEFORE DELETE ON rondas_notification_attempts BEGIN SELECT RAISE(ABORT,'Delivery audit is immutable'); END;
CREATE TABLE rondas_evidence (
 id INTEGER PRIMARY KEY AUTOINCREMENT, execution_id INTEGER NOT NULL REFERENCES rondas_executions(id), point_id TEXT NOT NULL,
 uploaded_by INTEGER NOT NULL REFERENCES usuarios(id), filename TEXT NOT NULL, content_type TEXT NOT NULL,
 byte_size INTEGER NOT NULL CHECK(byte_size>0), r2_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE TRIGGER rondas_evidence_immutable_update BEFORE UPDATE ON rondas_evidence BEGIN SELECT RAISE(ABORT,'Inspection evidence is immutable'); END;
CREATE TRIGGER rondas_evidence_immutable_delete BEFORE DELETE ON rondas_evidence BEGIN SELECT RAISE(ABORT,'Inspection evidence is immutable'); END;
