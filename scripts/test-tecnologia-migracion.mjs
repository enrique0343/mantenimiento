// Verifica una base poblada: conservación completa, rollback e integración SGO.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
const files = fs.readdirSync(path.join(root, 'migrations')).filter(n => /^\d{4}.*\.sql$/.test(n)).sort();
for (const name of files.filter(n => n < '0060')) db.exec(fs.readFileSync(path.join(root, 'migrations', name), 'utf8'));
db.exec(`
 INSERT INTO usuarios(id,nombre,email,password_hash,rol,especialidad) VALUES
 (1,'ADMIN FICTICIO','admin@example.invalid','hash-local','admin',NULL),
 (2,'TÉCNICO FICTICIO','tecnico@example.invalid','hash-local','tecnico','general');
 INSERT INTO sucursales(id,nombre) VALUES (1,'SEDE FICTICIA');
 INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo) VALUES(1,1,'SALA FICTICIA','area');
 INSERT INTO activos(id,codigo,nombre,tipo,rubro,ubicacion_id) VALUES
 (1,'BIO-FICTICIO','MONITOR FICTICIO','biomedico','biomedico',1),
 (2,'EQ-FICTICIO','IMPRESORA YA CLASIFICADA','general','equipo_general',1);
 INSERT INTO tickets(id,tracking_token,solicitante_nombre,solicitante_email,asunto,descripcion,rubro,activo_id)
 VALUES(1,'ficticio','FICTICIO','f@example.invalid','SOLICITUD FICTICIA','PRUEBA','biomedico',1);
 INSERT INTO conjuntos(id,codigo,nombre,rubro,criticidad,ubicacion_id,ultima_operacion_id,creado_por)
 VALUES(1,'CJ-FICTICIO','CONJUNTO FICTICIO','biomedico','alta',1,'operacion-ficticia',1);
 INSERT INTO conjunto_puestos(id,conjunto_id,funcion,esencial) VALUES(1,1,'MONITOR',1);
 INSERT INTO conjunto_componentes(id,puesto_id,activo_id,incorporado_en,incorporado_por,motivo_alta,activo_codigo,activo_nombre,incorporado_por_nombre)
 VALUES(1,1,1,'2026-01-01T00:00:00Z',1,'PRUEBA MIGRACIÓN','BIO-FICTICIO','MONITOR FICTICIO','ADMIN FICTICIO');
 INSERT INTO ordenes(id,creado_por,titulo,rubro,activo_id) VALUES(1,1,'ORDEN FICTICIA','biomedico',1),(2,1,'ORDEN LEGACY',NULL,NULL);
 INSERT INTO comentarios(orden_id,usuario_id,texto) VALUES(1,1,'HISTORIAL FICTICIO');
 INSERT INTO adjuntos(orden_id,usuario_id,nombre,content_type,tamano,r2_key) VALUES(1,1,'evidencia.txt','text/plain',1,'fixture');
 INSERT INTO conjunto_eventos(conjunto_id,fecha,accion,motivo,actor_id,actor_nombre,despues)
 VALUES(1,'2026-01-01T00:00:00Z','crear','PRUEBA MIGRACIÓN',1,'ADMIN FICTICIO','{}');
`);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '%_fts%' ORDER BY name").all().map(r => r.name);
const snapshot = () => Object.fromEntries(tables.map(name => [name, db.prepare(`SELECT * FROM "${name}"`).all()]));
const objects = () => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('index','trigger','view') AND sql IS NOT NULL ORDER BY type,name").all().map(r=>({...r,sql:r.sql.replace(/[\"`]/g,'').replace(/\s+/g,' ')}));
const foreignKeys = () => Object.fromEntries(tables.map(name => [name, db.prepare(`PRAGMA foreign_key_list("${name}")`).all()]));
const before = snapshot(), schemaBefore = objects(), keysBefore = foreignKeys();
const migration = fs.readFileSync(path.join(root, 'migrations/0060_tecnologia_espacio.sql'), 'utf8');
// D1 ejecuta migraciones en transacción: una falla debe restaurar también CHECKs.
db.exec('BEGIN');
db.exec(migration);
assert.throws(() => db.exec('SELECT falla_inyectada()'));
db.exec('ROLLBACK');
assert.deepEqual(snapshot(), before, 'rollback conserva todos los datos');
assert.deepEqual(objects(), schemaBefore, 'rollback conserva triggers/vistas/índices');
assert.throws(() => db.exec("UPDATE usuarios SET especialidad='tecnologia' WHERE id=2"), /CHECK/);
db.exec('BEGIN');
db.exec(migration);
db.exec('COMMIT');
assert.deepEqual(snapshot(), before, 'ninguna tabla operativa, historial ni diario SGO cambia');
assert.deepEqual(objects(), schemaBefore, 'índices, triggers y vistas quedan idénticos');
assert.deepEqual(foreignKeys(), keysBefore, 'ninguna FK cambia');
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
assert.throws(() => db.exec("UPDATE conjuntos SET rubro='tecnologia' WHERE id=1"), /CONJUNTO_/);
assert.throws(() => db.exec('DELETE FROM conjunto_eventos WHERE id=1'), /EVENTO_/);
assert.equal(db.prepare("SELECT count(*) n FROM tickets_fts WHERE tickets_fts MATCH 'FICTICIA'").get().n, 1);
assert.equal(db.prepare("SELECT count(*) n FROM ordenes_fts WHERE ordenes_fts MATCH 'FICTICIA'").get().n, 1);
// Nuevas filas TI admitidas, sin inventar acceso SGO ni mover impresoras existentes.
const journalBefore = db.prepare('SELECT count(*) n FROM sgo_journal').get().n;
db.exec(`
 UPDATE usuarios SET especialidad='tecnologia' WHERE id=2;
 INSERT INTO activos(id,codigo,nombre,tipo,rubro,ubicacion_id) VALUES(3,'TEC-FICTICIO','COMPUTADORA FICTICIA','general','tecnologia',1);
 INSERT INTO ordenes(id,creado_por,titulo,rubro,activo_id) VALUES(3,1,'ORDEN TI FICTICIA','tecnologia',3);
 INSERT INTO tickets(id,tracking_token,solicitante_nombre,solicitante_email,asunto,descripcion,rubro,activo_id)
 VALUES(3,'ficticio-ti','FICTICIO','f@example.invalid','AYUDA TI','PRUEBA','tecnologia',3);
 INSERT INTO conjuntos(codigo,nombre,rubro,criticidad,ultima_operacion_id,creado_por)
 VALUES('CJ-TI-FICTICIO','ESTACIÓN FICTICIA','tecnologia','media','operacion-ti-ficticia',1);
`);
assert.equal(db.prepare('SELECT rubro FROM activos WHERE id=2').get().rubro, 'equipo_general');
assert.equal(db.prepare('SELECT count(*) n FROM sgo_journal').get().n, journalBefore, 'TI no aparece como General en SGO');
assert.equal(db.prepare("SELECT count(*) n FROM sgo_entities WHERE id='3' AND (payload IS NOT NULL OR site_id IS NOT NULL)").get().n, 0);
assert.equal(db.prepare("SELECT count(*) n FROM sgo_scopes WHERE maintenance_area_id='tecnologia'").get().n, 0);
assert.throws(() => db.exec("UPDATE tickets SET rubro='invalid' WHERE id=3"), /CHECK/);
assert.throws(() => db.exec("UPDATE usuarios SET especialidad='invalid' WHERE id=2"), /CHECK/);
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
db.close();
console.log('PASS tecnología migración: datos, usuarios, FKs, historiales, FTS y objetos preservados; rollback completo; TI excluida del contrato SGO.');
