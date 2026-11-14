// Fase 59 · WP-A: baja de equipos con las migraciones reales (incluida la 0059):
// quién la da, qué exige, órdenes sin cerrar, planes desactivados en el mismo lote,
// una sola baja vigente, reversión sin reactivar planes y eliminar con baja.
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Sin red en las pruebas de baja'); };
let fixture;
let n = 0;
try {
  fixture = await setupConjuntos({ modules: { baja: 'pages/api/activos/[id]/baja', revertir: 'pages/api/activos/[id]/baja-revertir' } });
  const { app, sqlite, call, faults } = fixture;
  const one = (q, ...a) => { const r = sqlite.prepare(q).get(...a); return r ? { ...r } : r; };
  const all = (q, ...a) => sqlite.prepare(q).all(...a).map((r) => ({ ...r }));
  const run = (q, ...a) => sqlite.prepare(q).run(...a);
  const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
  const status = (r, esperado, nota) => { n++; assert.equal(r.status, esperado, `${nota}: ${JSON.stringify(r.body)}`); return r.body; };
  const darBaja = (id, data, rol = 'admin') => call(app.baja.POST, `/api/activos/${id}/baja`, { method: 'POST', id, data, rol });
  const revertir = (id, motivo, rol = 'jefe') => call(app.revertir.POST, `/api/activos/${id}/baja-revertir`, { method: 'POST', id, data: { motivo }, rol });

  sqlite.exec(`
    INSERT INTO activos(id,codigo,nombre,qr_code,rubro,tipo,estado,clase_riesgo) VALUES
      (1,'BIO-1','MONITOR','QR-BIO-1','biomedico','biomedico','averiado','IIa'),
      (2,'BIO-2','BOMBA','QR-BIO-2','biomedico','biomedico','operativo','I'),
      (3,'BIO-3','VIEJO','QR-BIO-3','biomedico','biomedico','baja','I');
    INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha,activo) VALUES
      (1,1,'PREVENTIVO MENSUAL','mensual','2030-01-01',1),
      (2,1,'PREVENTIVO ANUAL','anual','2030-06-01',1),
      (3,1,'PLAN VIEJO','anual','2020-01-01',0);
  `);
  const base = {
    fecha: '2026-11-10', motivo: 'falla_irreparable', motivoDetalle: 'La tarjeta principal no enciende.',
    evaluacionTecnica: 'Se revisó la fuente y la tarjeta: el repuesto ya no se fabrica.', evaluadoPor: 'Ing. Pérez, biomédica',
    autorizaNombre: 'Dra. Gómez', autorizaCargo: 'Dirección médica', destinoFinal: 'descarte', residuosBaterias: 'Baterías a gestor autorizado.',
  };

  // ── Quién y qué exige ──
  status(await darBaja(1, base, 'tecnico'), 403, 'el técnico no da de baja');
  status(await darBaja(1, base, 'visualizador'), 403, 'el visualizador no da de baja');
  es(status(await darBaja(1, { ...base, evaluacionTecnica: '' }), 400, 'falta la evaluación').error, 'Escribe la evaluación técnica (mínimo 20 caracteres).', 'mensaje de evaluación');
  es(status(await darBaja(1, { ...base, evaluacionTecnica: 'Muy corta' }), 400, 'evaluación corta').error, 'Escribe la evaluación técnica (mínimo 20 caracteres).', 'evaluación de menos de 20');
  es(status(await darBaja(1, { ...base, destinoFinal: 'donacion' }), 400, 'donación sin detalle').error, 'Indica a quién se dona o se vende, o qué destino es.', 'mensaje de destino');
  status(await darBaja(1, { ...base, motivo: 'capricho' }), 400, 'motivo desconocido');
  status(await darBaja(1, { ...base, fecha: '2999-01-01' }), 400, 'fecha futura');
  status(await darBaja(1, { ...base, fecha: '31/02/2026' }), 400, 'fecha no válida');
  status(await darBaja(404, base), 404, 'equipo inexistente');
  es(one('SELECT estado FROM activos WHERE id=1').estado, 'averiado', 'nada cambia con un error');

  // ── Órdenes sin cerrar ──
  run("INSERT INTO ordenes(id,titulo,activo_id,creado_por,rubro,estado) VALUES(500,'Correctivo pendiente',1,1,'biomedico','en_proceso')");
  run("INSERT INTO ordenes(id,titulo,activo_id,creado_por,rubro,estado) VALUES(501,'Correctivo cerrado',1,1,'biomedico','cerrada')");
  const codigoOt = one('SELECT codigo FROM ordenes WHERE id=500').codigo;
  const conOrden = status(await darBaja(1, base), 409, 'una orden abierta');
  es(conOrden.error, `Tiene 1 orden sin cerrar: ${codigoOt}. Ciérrala o cancélala antes de dar de baja.`, 'mensaje con el código de la orden');
  es(conOrden.ordenes, [{ id: 500, codigo: codigoOt }], 'la orden en la respuesta');
  run("UPDATE ordenes SET estado='cancelada' WHERE id=500");

  // ── Sale bien ──
  const hecha = status(await darBaja(1, { ...base, destinoFinal: 'donacion', destinoDetalle: 'hospital rural', fechaRetiro: '2026-11-11' }, 'jefe'), 201, 'baja');
  es(hecha.planesDesactivados, 2, 'dos planes activos desactivados');
  n++; assert.match(hecha.baja.folio, /^BAJA-\d{4}$/);
  es(one('SELECT estado FROM activos WHERE id=1').estado, 'baja', 'el equipo queda de baja');
  es(all('SELECT id, activo FROM planes_mantenimiento WHERE activo_id=1 ORDER BY id'), [{ id: 1, activo: 0 }, { id: 2, activo: 0 }, { id: 3, activo: 0 }], 'planes en 0');
  const fila = one('SELECT * FROM activo_bajas WHERE id=?', hecha.baja.id);
  es([fila.estado, fila.estado_anterior, JSON.parse(fila.planes_desactivados), fila.registrado_por, fila.registrado_por_nombre, fila.destino_detalle, fila.motivo_detalle],
    ['vigente', 'averiado', [1, 2], 2, 'Prueba jefe', 'HOSPITAL RURAL', 'LA TARJETA PRINCIPAL NO ENCIENDE.'], 'constancia completa en mayúsculas');
  es(status(await darBaja(1, base), 409, 'segunda baja').error, 'El equipo ya está dado de baja.', 'una sola baja vigente');
  n++; assert.throws(() => run("INSERT INTO activo_bajas(activo_id,fecha_baja,motivo,motivo_detalle,evaluacion_tecnica,evaluado_por,autoriza_nombre,autoriza_cargo,destino_final,residuos_baterias,estado_anterior,registrado_por,registrado_por_nombre) VALUES(1,'2026-11-10','otro','x','x','x','x','x','descarte','x','operativo',1,'x')"), /UNIQUE/);

  // ── Con la baja, el PATCH no cambia el estado ni elimina ──
  es(status(await call(app.assets.PATCH, '/api/activos/1', { method: 'PATCH', id: 1, data: { estado: 'operativo' } }), 409, 'PATCH a operativo').error,
    'El equipo está dado de baja. Para devolverlo al servicio usa «Revertir baja».', 'mensaje de revertir');
  status(await call(app.assets.PATCH, '/api/activos/1', { method: 'PATCH', id: 1, data: { estado: 'baja', nombre: 'monitor viejo' } }), 200, '«baja» sobre una baja se ignora');
  n++; assert.match(status(await call(app.assets.DELETE, '/api/activos/1', { method: 'DELETE', id: 1 }), 409, 'eliminar con baja').error, /registros de baja/);

  // ── Reversión ──
  status(await revertir(1, 'Se consiguió el repuesto', 'tecnico'), 403, 'el técnico no revierte');
  es(status(await revertir(1, 'corto'), 400, 'motivo corto').error, 'Escribe el motivo de la reversión (mínimo 10 caracteres).', 'mensaje del motivo');
  es(status(await revertir(1, 'Se consiguió el repuesto con otro proveedor'), 200, 'revertir').mensaje,
    'Baja revertida. Los planes preventivos siguen desactivados: reactívalos en «Planes» si corresponde.', 'mensaje de reversión');
  es(one('SELECT estado FROM activos WHERE id=1').estado, 'averiado', 'vuelve al estado anterior');
  const revertida = one('SELECT estado, revertida_por, revertida_por_nombre, reversion_motivo, revertida_en FROM activo_bajas WHERE id=?', hecha.baja.id);
  es([revertida.estado, revertida.revertida_por, revertida.revertida_por_nombre, revertida.reversion_motivo], ['revertida', 2, 'Prueba jefe', 'SE CONSIGUIÓ EL REPUESTO CON OTRO PROVEEDOR'], 'fila revertida');
  n++; assert.match(revertida.revertida_en, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  es(all('SELECT activo FROM planes_mantenimiento WHERE activo_id=1').map((p) => p.activo), [0, 0, 0], 'los planes siguen desactivados');
  es(status(await revertir(1, 'Otra vez la reversión'), 409, 'revertir un equipo vivo').error, 'El equipo no está dado de baja.', 'no está de baja');

  // ── Una baja nueva después de revertir (el índice es parcial) ──
  const otra = status(await darBaja(1, { ...base, motivo: 'obsolescencia' }), 201, 'baja nueva tras revertir');
  es(otra.planesDesactivados, 0, 'ya no tenía planes activos');
  es(all('SELECT estado FROM activo_bajas WHERE activo_id=1 ORDER BY id').map((b) => b.estado), ['revertida', 'vigente'], 'historia de bajas');

  // ── Equipo puesto en «baja» antes de esta fase (sin fila) ──
  status(await revertir(3, 'Estaba marcado de baja por error'), 200, 'revertir sin fila');
  es(one('SELECT estado FROM activos WHERE id=3').estado, 'operativo', 'sin fila vuelve a operativo');

  // ── Un equipo vivo sin planes también se da de baja ──
  es(status(await darBaja(2, { ...base, destinoFinal: 'venta', destinoDetalle: 'Subasta' }), 201, 'baja por venta').planesDesactivados, 0, 'sin planes');

  // ── Revisión: un plan creado mientras se llenaba la baja queda en el acta ──
  // Antes, la lista de planes y el estado anterior se leían antes del lote: el plan
  // nuevo quedaba desactivado pero fuera de planes_desactivados y del conteo.
  run("INSERT INTO activos(id,codigo,nombre,qr_code,rubro,tipo,estado,clase_riesgo) VALUES(5,'BIO-5','VENTILADOR','QR-BIO-5','biomedico','biomedico','mantenimiento','III')");
  run("INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha,activo) VALUES(10,5,'PLAN A','mensual','2030-01-01',1)");
  faults.beforeBatch = async () => {
    run("INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha,activo) VALUES(11,5,'PLAN NUEVO','anual','2030-02-01',1)");
  };
  const carrera = status(await darBaja(5, base), 201, 'baja con un plan agregado a última hora');
  es(carrera.planesDesactivados, 2, 'cuenta también el plan nuevo');
  const filaCarrera = one('SELECT estado_anterior, planes_desactivados FROM activo_bajas WHERE id=?', carrera.baja.id);
  es([filaCarrera.estado_anterior, JSON.parse(filaCarrera.planes_desactivados)], ['mantenimiento', [10, 11]], 'el acta lista los dos planes');
  es(all('SELECT activo FROM planes_mantenimiento WHERE activo_id=5 ORDER BY id').map((p) => p.activo), [0, 0], 'los dos quedan desactivados');

  // ── Revisión: un equipo que figura de baja sin registro completa aquí sus datos ──
  // La ficha («Completar datos de baja») y Cumplimiento («Falta registro de baja»)
  // enlazan a /activos/{id}/baja; antes la API respondía 409 y no había cómo hacerlo.
  run("INSERT INTO activos(id,codigo,nombre,qr_code,rubro,tipo,estado,clase_riesgo) VALUES(6,'BIO-6','RAYOS X VIEJO','QR-BIO-6','biomedico','biomedico','baja','III')");
  run("INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha,activo) VALUES(12,6,'PLAN OLVIDADO','anual','2030-01-01',1)");
  run("INSERT INTO ordenes(id,titulo,activo_id,creado_por,rubro,estado) VALUES(600,'Pendiente del equipo viejo',6,1,'biomedico','abierta')");
  n++; assert.match(status(await darBaja(6, base), 409, 'completar también exige cerrar las órdenes').error, /^Tiene 1 orden sin cerrar: /);
  run("UPDATE ordenes SET estado='cancelada' WHERE id=600");
  status(await darBaja(6, base, 'tecnico'), 403, 'el técnico no completa una baja');
  const completada = status(await darBaja(6, base, 'jefe'), 201, 'completar el registro de una baja sin acta');
  es(completada.planesDesactivados, 1, 'desactiva el plan que seguía activo');
  const filaCompletada = one('SELECT estado, estado_anterior, planes_desactivados FROM activo_bajas WHERE id=?', completada.baja.id);
  es([filaCompletada.estado, filaCompletada.estado_anterior, JSON.parse(filaCompletada.planes_desactivados), one('SELECT estado FROM activos WHERE id=6').estado],
    ['vigente', 'baja', [12], 'baja'], 'fila vigente; el equipo sigue de baja');
  es(status(await darBaja(6, base), 409, 'con el registro hecho').error, 'El equipo ya está dado de baja.', 'una sola vez');
  status(await revertir(6, 'No debía estar de baja: se usa en emergencia'), 200, 'revertir la baja completada');
  es(one('SELECT estado FROM activos WHERE id=6').estado, 'operativo', 'sin un estado anterior real, vuelve a operativo');

  es(all('PRAGMA foreign_key_check'), [], 'llaves foráneas en orden');
  console.log(`PASS test-bio-baja: ${n} casos`);
} finally {
  await fixture?.close();
  globalThis.fetch = originalFetch;
}
