// El código de la orden: OT-MG0001 para Mantenimiento General y OT-MB0001 para
// Biomédico. Migraciones reales, sin red.
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

// Órdenes que ya existían antes de la migración: deben numerarse en el orden en que se crearon.
const beforeMigration = (db, nombre) => {
  if (!nombre.startsWith('0057_fase57')) return;
  db.exec(`
    INSERT OR IGNORE INTO usuarios(id,nombre,email,password_hash,rol) VALUES(1000,'Administración','siembra@example.invalid','x','admin');
    INSERT INTO activos(id,codigo,nombre,tipo,estado) VALUES(900,'BM-900','Monitor','biomedico','operativo');
    INSERT INTO ordenes(id,creado_por,titulo,rubro,tipo,estado) VALUES
      (500,1000,'Vieja aire','aires','correctivo','abierta'),
      (501,1000,'Vieja biomédica','biomedico','correctivo','abierta'),
      (502,1000,'Vieja infraestructura','infraestructura','correctivo','cerrada');
    INSERT INTO ordenes(id,creado_por,titulo,rubro,tipo,estado,activo_id) VALUES(503,1000,'Vieja sin rubro de equipo biomédico',NULL,'correctivo','abierta',900);
  `);
};
const fixture = await setupConjuntos({ beforeMigration, modules: {
  database: 'lib/db', codigo: 'lib/orden-codigo', reporte: 'lib/reporte-mantenimiento', ordenes: 'lib/ordenes', buscar: 'pages/api/search',
} });
const { app, sqlite, call, close } = fixture;
const one = (q, ...a) => sqlite.prepare(q).get(...a);
let verificaciones = 0;
const igual = (...args) => { assert.equal(...args); verificaciones++; };
const ok = (...args) => { assert.ok(...args); verificaciones++; };
const codigo = (id) => one('SELECT codigo FROM ordenes WHERE id=?', id)?.codigo;
const insertar = (titulo, rubro, activo = null) => sqlite.prepare("INSERT INTO ordenes(creado_por,titulo,rubro,tipo,estado,activo_id) VALUES(1000,?,?,'correctivo','abierta',?)").run(titulo, rubro, activo).lastInsertRowid;

try {
  // ── Las órdenes que ya existían ──────────────────────────────────────────
  igual(codigo(500), 'OT-MG0001');
  igual(codigo(501), 'OT-MB0001');
  igual(codigo(502), 'OT-MG0002');
  igual(codigo(503), 'OT-MB0002', 'Sin rubro, manda el equipo');
  igual(one("SELECT ultimo FROM orden_series WHERE serie='MG'").ultimo, 2);
  igual(one("SELECT ultimo FROM orden_series WHERE serie='MB'").ultimo, 2);

  // ── Cada orden nueva recibe el siguiente de su serie ─────────────────────
  for (const [rubro, esperado] of [['aires', 'OT-MG0003'], ['infraestructura', 'OT-MG0004'], ['equipo_general', 'OT-MG0005'], ['biomedico', 'OT-MB0003'], [null, 'OT-MG0006']]) {
    igual(codigo(insertar(`Nueva ${rubro}`, rubro)), esperado, String(rubro));
  }
  igual(codigo(insertar('Sin rubro, equipo biomédico', null, 900)), 'OT-MB0004');

  // ── Un número no se reutiliza ni se cambia ───────────────────────────────
  const borrable = insertar('Se borra', 'aires');
  igual(codigo(borrable), 'OT-MG0007');
  sqlite.prepare('DELETE FROM ordenes WHERE id=?').run(borrable);
  igual(codigo(insertar('Después de borrar', 'aires')), 'OT-MG0008', 'El número borrado no vuelve');
  assert.throws(() => sqlite.prepare("UPDATE ordenes SET codigo='OT-MG9999' WHERE id=500").run(), /ORDEN_CODIGO_INMUTABLE/);
  verificaciones++;
  // Cambiar otras columnas no toca el código, ni cambiar el rubro cambia la serie.
  sqlite.prepare("UPDATE ordenes SET estado='en_proceso', rubro='biomedico' WHERE id=500").run();
  igual(codigo(500), 'OT-MG0001');

  // ── Pasa de cuatro cifras sin romperse ───────────────────────────────────
  sqlite.prepare("UPDATE orden_series SET ultimo=9999 WHERE serie='MB'").run();
  igual(codigo(insertar('La número diez mil', 'biomedico')), 'OT-MB10000');
  sqlite.prepare("UPDATE orden_series SET ultimo=4 WHERE serie='MB'").run();

  // ── La etiqueta y la búsqueda ────────────────────────────────────────────
  const { etiquetaOT, codigoDeBusqueda } = app.codigo;
  igual(etiquetaOT({ id: 7, codigo: 'OT-MB0007' }), 'OT-MB0007');
  igual(etiquetaOT({ id: 7, codigo: null }), 'OT #7');
  igual(etiquetaOT({ id: 7 }), 'OT #7');
  for (const [texto, esperado] of [['OT-MG0001', 'OT-MG0001'], ['ot-mg0001', 'OT-MG0001'], ['ot mg 1', 'OT-MG0001'], ['MG1', 'OT-MG0001'], ['mb0012', 'OT-MB0012'], ['OT-MB10000', 'OT-MB10000'], ['1234', null], ['Mg', null], ['MG plan', null], ['OT', null]]) {
    igual(codigoDeBusqueda(texto), esperado, texto);
  }

  // ── conCodigo lee lo que RETURNING no ve ─────────────────────────────────
  const db = app.database.getDb(fixture.ctx('/x'));
  const fila = { id: 500, titulo: 'x' };
  const leida = await app.ordenes.conCodigo(db, fila);
  igual(leida.codigo, 'OT-MG0001');
  igual(leida.titulo, 'x', 'Conserva lo que ya traía');

  // ── El reporte lleva el código ───────────────────────────────────────────
  const rep = await app.reporte.reporteDeOrden(db, 501);
  igual(rep.codigo, 'OT-MB0001');

  // ── Crear por la ruta real devuelve el código ────────────────────────────
  sqlite.exec("INSERT OR IGNORE INTO sucursales(id,nombre,activa) VALUES(1,'Sede prueba',1); INSERT OR IGNORE INTO ubicaciones(id,sucursal_id,nombre,tipo,activa) VALUES(1,1,'Sala','area',1);");
  const c = await call(app.orders.POST, '/api/ordenes', { method: 'POST', rol: 'admin', data: { titulo: 'Desde la ruta', tipo: 'correctivo', rubro: 'infraestructura', sucursalId: 1, ubicacionId: 1 } });
  igual(c.status, 201, JSON.stringify(c.body));
  ok(/^OT-MG\d{4}$/.test(c.body.codigo ?? c.body.orden?.codigo ?? ''), JSON.stringify(c.body));

  // ── Buscar por código ────────────────────────────────────────────────────
  const b = await call(app.buscar.GET, '/api/search?q=OT-MB0001', { method: 'GET', rol: 'admin' });
  igual(b.status, 200, JSON.stringify(b.body));
  igual(b.body.resultados.ordenes[0]?.id, 501, JSON.stringify(b.body.resultados.ordenes));
  igual(b.body.resultados.ordenes[0]?.codigo, 'OT-MB0001');

  // ── El índice de búsqueda no se rompe al crear una orden ─────────────────
  // El UPDATE que pone el código no puede tocar FTS: en ese momento la fila aún no está indexada.
  const fts = (q) => sqlite.prepare('SELECT rowid FROM ordenes_fts WHERE ordenes_fts MATCH ? ORDER BY rowid').all(q).map((f) => f.rowid).join();
  const integridad = () => { sqlite.exec("INSERT INTO ordenes_fts(ordenes_fts, rank) VALUES('integrity-check', 1)"); verificaciones++; };
  integridad();
  igual(fts('Vieja'), '500,501,502,503', 'Numerar las órdenes viejas no altera el índice');
  // Más palabras por columna que todo lo indexado: así fallaba cuando el trigger tocaba FTS.
  const larga = sqlite.prepare("INSERT INTO ordenes(creado_por,titulo,descripcion,causa_raiz,rubro,tipo,estado) VALUES(1000,?,?,?,'aires','correctivo','abierta')")
    .run('Fuga '.repeat(300), 'Goteo '.repeat(300), 'Sello '.repeat(300)).lastInsertRowid;
  ok(/^OT-MG\d{4}$/.test(codigo(larga)), codigo(larga));
  igual(fts('Sello'), String(larga));
  integridad();
  sqlite.prepare("UPDATE ordenes SET estado='en_proceso' WHERE id=?").run(larga);
  igual(fts('Goteo'), String(larga), 'Cambiar el estado no saca la orden del índice');
  sqlite.prepare("UPDATE ordenes SET titulo='Compresor cambiado' WHERE id=?").run(larga);
  igual(fts('Compresor'), String(larga), 'Cambiar un texto sí actualiza el índice');
  igual(fts('Fuga'), '');
  integridad();
  sqlite.prepare('DELETE FROM ordenes WHERE id=?').run(larga);
  igual(fts('Sello'), '');
  integridad();

  // Un número solo encuentra la orden de ese número en las dos series, y también por id.
  const porNumero = await call(app.buscar.GET, '/api/search?q=1', { method: 'GET', rol: 'admin' });
  igual(porNumero.body.resultados.ordenes.map((o) => o.codigo).sort().join(), 'OT-MB0001,OT-MG0001', JSON.stringify(porNumero.body.resultados.ordenes));
  const porId = await call(app.buscar.GET, '/api/search?q=503', { method: 'GET', rol: 'admin' });
  igual(porId.body.resultados.ordenes[0]?.codigo, 'OT-MB0002', 'El id de los papeles viejos sigue sirviendo');

  console.log(`PASS test-codigo-ot: ${verificaciones} verificaciones; migraciones reales, sin red.`);
} finally {
  await close();
}
