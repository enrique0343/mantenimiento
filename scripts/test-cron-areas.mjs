// Runs the scheduled handler only against memory; both mail modules are replaced.
import assert from 'node:assert/strict';
import { setup } from './test-support/sqlite-app.mjs';
const { api, sqlite, call, close } = await setup({ modules: { cron: 'api/cron/generar-preventivos.ts' } });
const originalFetch = globalThis.fetch;
let externalCalls = 0;
globalThis.fetch = async () => { externalCalls++; throw new Error('Network forbidden in the cron test'); };
try {
  sqlite.exec(`
    INSERT INTO usuarios(id,nombre,email,password_hash,rol,activo) VALUES
      (2,'Técnico activo','technician@example.invalid','test','tecnico',1),
      (3,'Técnico inactivo','inactive@example.invalid','test','tecnico',0),
      (4,'Administrador inactivo','inactive-admin@example.invalid','test','admin',0),
      (5,'Segundo administrador','second-admin@example.invalid','test','admin',1);
    INSERT INTO activos(id,codigo,nombre,rubro,tipo) VALUES
      (1,'TEST-AIR','Unidad test','aires','general'),
      (2,'TEST-BIO','Equipo test','biomedico','biomedico');
    INSERT INTO actividad_categorias(id,nombre,rubro) VALUES(1,'Categoría antigua','aires');
    INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha,asignado_a,prioridad) VALUES
      (1,1,'Plan técnico','mensual','2000-01-01',2,'alta'),
      (2,2,'Plan sin asignar','mensual','2000-01-01',NULL,'baja'),
      (3,1,'Plan inactivo','mensual','2000-01-01',3,'media');
    INSERT INTO actividades(id,codigo,titulo,rubro,frecuencia,proxima_fecha,asignado_a,categoria_id) VALUES
      (1,'TEST-1','Rutina infraestructura','infraestructura','mensual','2000-01-01',2,NULL),
      (2,'TEST-2','Rutina general','equipo_general','mensual','2000-01-01',NULL,NULL),
      (3,'TEST-3','Rutina responsable inactivo','aires','mensual','2000-01-01',3,NULL),
      (4,'TEST-4','Rutina categoría antigua',NULL,'mensual','2000-01-01',NULL,1),
      (5,'TEST-5','Rutina sin área',NULL,'mensual','2000-01-01',NULL,NULL);
  `);
  // Explicit checks show the test enforces the deployed creator constraints.
  assert.throws(() => sqlite.exec("INSERT INTO ordenes(titulo,creado_por) VALUES('Inválida',NULL)"), /NOT NULL/);
  assert.throws(() => sqlite.exec("INSERT INTO ordenes(titulo,creado_por) VALUES('Inválida',9999)"), /FOREIGN KEY/);
  const options = { method: 'POST', headers: { 'x-cron-secret': 'isolated-test-only' }, env: { CRON_SECRET: 'isolated-test-only' } };
  let result = await call(api.cron.POST, '/api/cron/generar-preventivos', { method: 'POST', env: options.env });
  assert.equal(result.status, 401);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM ordenes').get().n, 0);
  const snapshotUsers = () => JSON.stringify(sqlite.prepare('SELECT * FROM usuarios ORDER BY id').all());
  let beforeUsers = snapshotUsers();
  result = await call(api.cron.POST, '/api/cron/generar-preventivos', options);
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.body.creadas, 7);
  assert.deepEqual(result.body.omitidas, [{ origen: 'actividad', refId: 5, motivo: 'Sin área de mantenimiento' }]);
  assert.equal(snapshotUsers(), beforeUsers, 'The cron must not change users');
  const rows = sqlite.prepare('SELECT plan_id,actividad_id,rubro,creado_por,prioridad FROM ordenes ORDER BY id').all();
  assert.deepEqual(rows.map((row) => [row.plan_id, row.actividad_id, row.rubro, row.creado_por]), [
    [1,null,'aires',2], [2,null,'biomedico',1], [3,null,'aires',1],
    [null,1,'infraestructura',2], [null,2,'equipo_general',1], [null,3,'aires',1], [null,4,'aires',1],
  ]);
  assert.equal(rows[0].prioridad, 'alta');
  assert.equal(rows[1].prioridad, 'baja');
  assert.equal(sqlite.prepare('SELECT ultima_generacion FROM actividades WHERE id=5').get().ultima_generacion, null);
  result = await call(api.cron.POST, '/api/cron/generar-preventivos', options);
  assert.equal(result.body.creadas, 0, 'The same cycle must not duplicate orders');
  sqlite.exec(`
    UPDATE usuarios SET activo=0 WHERE rol='admin';
    INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha) VALUES(4,1,'Sin creador','mensual','2000-01-01');
    INSERT INTO actividades(id,codigo,titulo,rubro,frecuencia,proxima_fecha,asignado_a) VALUES
      (6,'TEST-6','Técnico sin administrador','infraestructura','mensual','2000-01-01',2),
      (7,'TEST-7','Sin responsable activo','infraestructura','mensual','2000-01-01',3);
  `);
  beforeUsers = snapshotUsers();
  result = await call(api.cron.POST, '/api/cron/generar-preventivos', options);
  assert.equal(result.body.creadas, 1);
  assert.equal(snapshotUsers(), beforeUsers);
  assert(result.body.omitidas.some((row) => row.origen === 'equipo' && row.refId === 4));
  assert(result.body.omitidas.some((row) => row.origen === 'actividad' && row.refId === 7));
  assert.equal(sqlite.prepare('SELECT ultima_generacion FROM planes_mantenimiento WHERE id=4').get().ultima_generacion, null);
  assert.equal(sqlite.prepare('SELECT creado_por FROM ordenes WHERE actividad_id=6').get().creado_por, 2);
  assert.equal(result.body.recordatoriosEnviados, 0);
  assert.equal(result.body.digestEnviados, 0);
  assert.equal(externalCalls, 0);
  console.log('PASS: scheduled handler preserves area and priority, uses active assignee/admin, respects creator NOT NULL and FK, skips missing owners without advancing cycles, leaves users unchanged, avoids duplicate cycles. No network or email.');
} finally {
  globalThis.fetch = originalFetch;
  await close();
}
process.exit(0);
