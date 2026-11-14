// Fase 59 · seguridad eléctrica: la 0059 vuelve a sembrar la plantilla «Seguridad
// eléctrica IEC 62353» en una base como producción (donde se borró), no duplica si
// se repite, y la tabla de pruebas protege su evidencia. Migraciones reales en
// SQLite en memoria; la 0059 se aplica como la recibe D1: dividida por Wrangler.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { unstable_splitSqlQuery } from 'wrangler';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const carpeta = path.join(raiz, 'migrations');
const migraciones = fs.readdirSync(carpeta).filter((n) => /^\d{4}.*\.sql$/.test(n)).sort();
const NOMBRE_0059 = migraciones.find((n) => n.startsWith('0059_'));
assert(NOMBRE_0059, 'existe la migración 0059');
const fuente0059 = fs.readFileSync(path.join(carpeta, NOMBRE_0059), 'utf8');
const PLANTILLA = 'Seguridad eléctrica IEC 62353';

let n = 0;
const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
const falla = (fn, patron, nota) => { n++; assert.throws(fn, patron, nota); };

/** Una sentencia a la vez, como D1. */
function aplicar(db, sql) {
  for (const sentencia of unstable_splitSqlQuery(sql)) db.exec(sentencia);
}

/** Base nueva con las migraciones hasta `antesDe` (sin incluirla). */
function baseHasta(antesDe) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const nombre of migraciones) {
    if (nombre >= antesDe) break;
    // Como en producción: la siembra de documentos (0049, 0051, 0056) necesita un administrador.
    if (nombre.startsWith('0049_fase49')) db.exec("INSERT OR IGNORE INTO usuarios(id,nombre,email,password_hash,rol) VALUES(1000,'Administración','siembra@example.invalid','x','admin')");
    db.exec(fs.readFileSync(path.join(carpeta, nombre), 'utf8'));
  }
  return db;
}

const uno = (db, q, ...a) => { const fila = db.prepare(q).get(...a); return fila ? { ...fila } : fila; };
const conteos = (db) => ({
  plantillas: uno(db, 'SELECT COUNT(*) AS c FROM checklist_plantillas').c,
  pasos: uno(db, 'SELECT COUNT(*) AS c FROM checklist_plantilla_items').c,
  iec: uno(db, 'SELECT COUNT(*) AS c FROM checklist_plantillas WHERE nombre = ?', PLANTILLA).c,
  pasosIec: uno(db, 'SELECT COUNT(*) AS c FROM checklist_plantilla_items WHERE plantilla_id IN (SELECT id FROM checklist_plantillas WHERE nombre = ?)', PLANTILLA).c,
  config: uno(db, "SELECT COUNT(*) AS c FROM app_config WHERE clave = 'bio.seguridad_electrica.meses'").c,
});

/** Lo que deja la siembra: 8 pasos, lectura en 3–6 (Ω, MΩ, µA, µA), máximo 0.3 solo en la 3, críticos 1 y 7. */
function revisarPlantilla(db, nota) {
  const ids = db.prepare('SELECT id, activa, tipo_documento FROM checklist_plantillas WHERE nombre = ?').all(PLANTILLA);
  es(ids.length, 1, `${nota}: una sola plantilla IEC 62353`);
  es([ids[0].activa, ids[0].tipo_documento], [1, 'sop'], `${nota}: activa y SOP`);
  const pasos = db.prepare('SELECT orden, bloqueante, requiere_valor, unidad, valor_esperado_min, valor_esperado_max FROM checklist_plantilla_items WHERE plantilla_id = ? ORDER BY orden').all(ids[0].id);
  es(pasos.map((p) => [p.orden, p.bloqueante, p.requiere_valor, p.unidad, p.valor_esperado_min, p.valor_esperado_max]), [
    [1, 1, 0, null, null, null], [2, 0, 0, null, null, null], [3, 0, 1, 'Ω', null, 0.3], [4, 0, 1, 'MΩ', null, null],
    [5, 0, 1, 'µA', null, null], [6, 0, 1, 'µA', null, null], [7, 1, 0, null, null, null], [8, 0, 0, null, null, null],
  ], `${nota}: pasos con lectura, rango y críticos`);
  // Los textos son los de la 0046: la orden los copia y el registro los usa para traer lecturas.
  const textos = db.prepare('SELECT texto FROM checklist_plantilla_items WHERE plantilla_id = ? ORDER BY orden').all(ids[0].id).map((p) => p.texto);
  es(textos[2], 'Medir resistencia de tierra de protección', `${nota}: texto del paso 3`);
  es(textos[5], 'Medir corriente de fuga de partes aplicadas (si aplica)', `${nota}: texto del paso 6`);
  es(uno(db, "SELECT valor FROM app_config WHERE clave = 'bio.seguridad_electrica.meses'").valor, '12', `${nota}: periodicidad 12 meses`);
  // Ω (U+03A9) y µ (U+00B5), como en la 0046 y en las etiquetas de la app.
  es([...pasos[2].unidad].map((c) => c.codePointAt(0)), [0x03a9], `${nota}: Ω es U+03A9`);
  es([...pasos[4].unidad].map((c) => c.codePointAt(0)), [0x00b5, 0x41], `${nota}: µA empieza con U+00B5`);
}

// ── Caso 2 · Base como producción: la plantilla se borró después de la 0046 ──
const prod = baseHasta(NOMBRE_0059);
prod.exec(`DELETE FROM checklist_plantillas WHERE id IN (1, 2, 3) OR nombre = '${PLANTILLA}'`);
es([conteos(prod).plantillas, conteos(prod).pasos], [3, 12], 'como producción: 3 plantillas y 12 pasos');
es(uno(prod, "SELECT seq FROM sqlite_sequence WHERE name = 'checklist_plantillas'").seq, 7, 'secuencia de plantillas en 7, como producción');
aplicar(prod, fuente0059);
revisarPlantilla(prod, 'producción tras la 0059');
es([conteos(prod).plantillas, conteos(prod).pasos], [4, 20], 'producción: 4 plantillas y 20 pasos');
es(uno(prod, 'SELECT id FROM checklist_plantillas WHERE nombre = ?', PLANTILLA).id, 8, 'la plantilla vuelve con un id nuevo');
es(prod.prepare('PRAGMA foreign_key_check').all(), [], 'sin llaves rotas');

// ── Caso 3 · Repetir la siembra no duplica (base como producción y base nueva) ──
const ini = fuente0059.indexOf('-- WP-F siembra: inicio');
const fin = fuente0059.indexOf('-- WP-F siembra: fin');
assert(ini > 0 && fin > ini, 'la 0059 conserva las marcas de la siembra');
const bloque = fuente0059.slice(ini, fin);
const antes = conteos(prod);
aplicar(prod, bloque);
aplicar(prod, bloque);
es(conteos(prod), antes, 'producción: el bloque repetido dos veces no cambia los conteos');
revisarPlantilla(prod, 'producción tras repetir');

const nueva = baseHasta('9999');
revisarPlantilla(nueva, 'base nueva');
const antesNueva = conteos(nueva);
aplicar(nueva, bloque);
aplicar(nueva, bloque);
es(conteos(nueva), antesNueva, 'base nueva: el bloque repetido no cambia los conteos');
nueva.close();

// Una periodicidad cambiada por la jefatura no se pisa al repetir el bloque.
prod.exec("UPDATE app_config SET valor = '6' WHERE clave = 'bio.seguridad_electrica.meses'");
aplicar(prod, bloque);
es(uno(prod, "SELECT valor FROM app_config WHERE clave = 'bio.seguridad_electrica.meses'").valor, '6', 'la periodicidad cambiada se conserva');

// ── Caso 4 · La tabla de pruebas protege la evidencia ──
prod.exec("INSERT INTO activos (id, codigo, nombre, tipo, rubro, clase_riesgo) VALUES (500, 'BIO-500', 'MONITOR DE SIGNOS VITALES', 'biomedico', 'biomedico', 'III')");
prod.exec("INSERT INTO ordenes (id, titulo, tipo, estado, activo_id, rubro, creado_por) VALUES (700, 'Seguridad eléctrica anual', 'preventivo', 'completada', 500, 'biomedico', 1000)");
const prueba = (tipo, ordenId = 700) => prod.prepare(`INSERT INTO pruebas_seguridad_electrica
  (activo_id, fecha, tipo, orden_id, clase_proteccion, parte_aplicada, metodo_fuga, inspeccion_visual, prueba_funcional,
   tierra_ohm, limite_tierra_ohm, fuga_equipo_ua, limite_fuga_equipo_ua, fuga_parte_ua, limite_fuga_parte_ua,
   resultado_calculado, resultado, analizador_descripcion, analizador_serie, analizador_cal_vence, realizado_por, proxima_fecha, registrado_por)
  VALUES (500, '2026-11-12', ?, ?, 'I', 'BF', 'directo', 'conforme', 'conforme', 0.12, 0.3, 120, 500, 15, 5000,
   'pasa', 'pasa', 'Fluke ESA615', 'SN-1', '2027-03-01', 'Técnico', '2027-11-12', 1000)`).run(tipo, ordenId);
const { lastInsertRowid: idPrueba } = prueba('periodica');
falla(() => prueba('anual'), /CHECK/, 'un tipo fuera de la lista no entra');
falla(() => prod.prepare("UPDATE pruebas_seguridad_electrica SET resultado = 'quizas' WHERE id = ?").run(idPrueba), /CHECK/, 'un resultado fuera de la lista no entra');
falla(() => prod.prepare("UPDATE pruebas_seguridad_electrica SET clase_proteccion = 'III' WHERE id = ?").run(idPrueba), /CHECK/, 'clase de protección fuera de la lista');
es(uno(prod, 'SELECT estado FROM pruebas_seguridad_electrica WHERE id = ?', idPrueba).estado, 'valida', 'nace válida');
prod.exec('DELETE FROM ordenes WHERE id = 700');
es(uno(prod, 'SELECT orden_id FROM pruebas_seguridad_electrica WHERE id = ?', idPrueba).orden_id, null, 'borrar la orden deja la prueba sin orden');
falla(() => prod.exec('DELETE FROM activos WHERE id = 500'), /FOREIGN KEY/, 'un equipo con pruebas no se borra');
// El analizador sí puede borrarse: la prueba conserva su copia (descripción y serie).
prod.exec("INSERT INTO activos (id, codigo, nombre, tipo, rubro, es_patron) VALUES (501, 'PAT-001', 'ANALIZADOR', 'biomedico', 'biomedico', 1)");
prod.prepare('UPDATE pruebas_seguridad_electrica SET analizador_activo_id = 501 WHERE id = ?').run(idPrueba);
prod.exec('DELETE FROM activos WHERE id = 501');
es(uno(prod, 'SELECT analizador_activo_id, analizador_descripcion, analizador_serie FROM pruebas_seguridad_electrica WHERE id = ?', idPrueba),
  { analizador_activo_id: null, analizador_descripcion: 'Fluke ESA615', analizador_serie: 'SN-1' }, 'sin analizador queda la copia');
es(prod.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'pruebas_seguridad_electrica' ORDER BY name").all().map((r) => r.name),
  ['idx_pruebas_seg_elec_activo', 'idx_pruebas_seg_elec_orden'], 'índices de la tabla');
prod.close();

console.log(`PASS test-bio-seguridad-electrica-siembra: ${n} casos; la plantilla IEC 62353 vuelve sin duplicarse y las pruebas no se pierden.`);
