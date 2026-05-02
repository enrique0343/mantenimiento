-- ⚠️  USO UNICO: limpia las tablas creadas por la otra rama (Antigravity)
-- para dejar la D1 lista y aplicar las migraciones de este branch.
-- Despues de correr esto, ejecuta:
--   npx wrangler d1 migrations apply mantenimiento-db --remote
-- Borra esta archivo despues de usarlo si quieres.

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS ticket_comments;
DROP TABLE IF EXISTS spare_part_movements;
DROP TABLE IF EXISTS spare_part_stock;
DROP TABLE IF EXISTS wo_spare_parts;
DROP TABLE IF EXISTS work_orders;
DROP TABLE IF EXISTS helpdesk_tickets;
DROP TABLE IF EXISTS maintenance_plans;
DROP TABLE IF EXISTS predictive_measurements;
DROP TABLE IF EXISTS attachments;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS equipment;
DROP TABLE IF EXISTS locations;
DROP TABLE IF EXISTS spare_parts;
DROP TABLE IF EXISTS providers;
DROP TABLE IF EXISTS branches;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS company;
DROP TABLE IF EXISTS d1_migrations;

-- Tambien limpia ids autoincrement
DELETE FROM sqlite_sequence;

PRAGMA foreign_keys = ON;
