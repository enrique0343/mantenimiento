// Fase 59 · WP-A, ronda 2 · Requisito 13: a un equipo dado de baja no se le abren órdenes de
// trabajo desde la oficina. Migraciones reales (incluida la 0059), sesión real y SQLite local.
//  · A mano (Nueva orden, convertir una solicitud, generar desde un proyecto) → 409 con el
//    mismo texto y nada cambia.
//  · Automático (medición fuera de rango, solicitud que se asigna) → la orden no se crea y la
//    operación principal sigue.
//  · Con un equipo en servicio y sin equipo, todo sigue igual. «Prioridad baja» no es una baja.
//  · /ordenes/nueva: el equipo que trae la URL, si está de baja (equipoDadoDeBaja).
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Sin red en las pruebas de órdenes y bajas'); };
let fixture;
let n = 0;
try {
  fixture = await setupConjuntos({ modules: {
    convertir: 'pages/api/tickets/[id]/convertir', ticket: 'pages/api/tickets/[id]/index',
    proyectoOt: 'pages/api/proyectos/[id]/generar-ot', mediciones: 'pages/api/mediciones/index',
    equipoBaja: 'lib/equipo-baja', db: 'lib/db',
  } });
  const { app, sqlite, call, ctx } = fixture;
  const one = (q, ...a) => { const r = sqlite.prepare(q).get(...a); return r ? { ...r } : r; };
  const run = (q, ...a) => sqlite.prepare(q).run(...a);
  const es = (r, esperado, nota) => { n++; assert.deepEqual(r, esperado, nota); };
  const status = (r, esperado, nota) => { n++; assert.equal(r.status, esperado, `${nota}: ${JSON.stringify(r.body)}`); return r.body; };
  const MSG = 'El equipo está dado de baja: no se le abren órdenes de trabajo.';
  const ordenes = () => one('SELECT count(*) n FROM ordenes').n;

  sqlite.exec(`
    INSERT INTO sucursales(id,nombre,codigo) VALUES(1,'Sede Central','SC');
    INSERT INTO ubicaciones(id,nombre,sucursal_id) VALUES(1,'UCI',1);
    INSERT INTO activos(id,codigo,nombre,qr_code,rubro,tipo,estado,clase_riesgo,ubicacion_id) VALUES
      (1,'BIO-VIVO','MONITOR','QR-BIO-VIVO','biomedico','biomedico','operativo','IIa',1),
      (2,'BIO-BAJA','MONITOR VIEJO','QR-BIO-BAJA','biomedico','biomedico','baja','IIa',1),
      (3,'BIO-AVERIADO','BOMBA','QR-BIO-AVERIADO','biomedico','biomedico','averiado','I',1);
  `);
  es(app.equipoBaja.MENSAJE_ORDEN_EQUIPO_BAJA, MSG, 'un solo texto');

  // ── Nueva orden (POST /api/ordenes) ──
  const crear = (data, rol = 'jefe') => call(app.orders.POST, '/api/ordenes', { method: 'POST', data: { titulo: 'Revisión', rubro: 'biomedico', sucursalId: 1, ...data }, rol });
  const antes = ordenes();
  es(status(await crear({ activoId: 2 }), 409, 'orden a un equipo de baja'), { error: MSG }, '409 con el texto en JSON');
  es(status(await crear({ activoId: 2, tipo: 'emergencia', prioridad: 'urgente' }, 'admin'), 409, 'ni siquiera una emergencia').error, MSG, 'emergencia: el mismo texto');
  es(status(await crear({ activoId: 2 }, 'tecnico'), 409, 'tampoco el técnico desde la oficina').error, MSG, 'técnico: el mismo texto');
  es(ordenes(), antes, 'no se creó ninguna orden');
  const viva = status(await crear({ activoId: 1, prioridad: 'baja' }), 201, 'equipo operativo con prioridad baja').orden;
  es([viva.activoId, viva.prioridad, viva.estado], [1, 'baja', 'abierta'], '«prioridad baja» no es un equipo de baja');
  status(await crear({ activoId: 3 }), 201, 'un equipo averiado sí recibe órdenes');
  const sinEquipo = status(await crear({ ubicacionId: 1, titulo: 'Pintar la sala' }), 201, 'orden sin equipo').orden;
  es([sinEquipo.activoId, sinEquipo.ubicacionId], [null, 1], 'sin equipo, sin cambios');
  status(await crear({ activoId: 404 }), 400, 'un equipo que no existe sigue siendo 400');

  // ── Convertir una solicitud en orden (POST /api/tickets/{id}/convertir) ──
  const ticket = (id, activoId) => run(`INSERT INTO tickets(id,tracking_token,solicitante_nombre,solicitante_email,asunto,descripcion,rubro,sucursal_id,ubicacion_id,activo_id)
    VALUES(?,?,'Enfermería','uci@example.invalid','No enciende','Pantalla negra','biomedico',1,1,?)`, id, `T-${id}`, activoId);
  const convertir = (id, rol = 'jefe') => call(app.convertir.POST, `/api/tickets/${id}/convertir`, { method: 'POST', id, data: {}, rol });
  ticket(10, 2); ticket(11, 1); ticket(12, null);
  const antesConv = ordenes();
  es(status(await convertir(10), 409, 'convertir con equipo de baja'), { error: MSG }, 'convertir: 409 con el texto');
  es([ordenes(), one('SELECT ot_id o, estado e FROM tickets WHERE id=10')], [antesConv, { o: null, e: 'nuevo' }], 'la solicitud queda como estaba');
  const conv = status(await convertir(11), 201, 'convertir con equipo operativo').orden;
  es([conv.activoId, one('SELECT ot_id o FROM tickets WHERE id=11').o], [1, conv.id], 'la solicitud queda ligada a su orden');
  es(status(await convertir(12), 201, 'convertir sin equipo').orden.activoId, null, 'sin equipo, sin cambios');

  // ── Asignar una solicitud crea la orden sola (PATCH /api/tickets/{id}): automático ──
  ticket(20, 2); ticket(21, 1);
  const asignar = (id) => call(app.ticket.PATCH, `/api/tickets/${id}`, { method: 'PATCH', id, data: { asignadoA: 3 }, rol: 'jefe' });
  const antesAsig = ordenes();
  const omitida = status(await asignar(20), 200, 'asignar una solicitud de un equipo de baja');
  es([omitida.otCreada, omitida.otOmitida, omitida.ticket.asignadoA, omitida.ticket.estado], [null, MSG, 3, 'asignado'], 'se asigna, sin orden, y la respuesta dice por qué');
  es([ordenes(), one('SELECT ot_id o FROM tickets WHERE id=20').o], [antesAsig, null], 'ninguna orden nueva');
  const creada = status(await asignar(21), 200, 'asignar una solicitud de un equipo operativo');
  n++; assert.ok(creada.otCreada > 0 && !('otOmitida' in creada), JSON.stringify(creada));
  es(one('SELECT activo_id a, asignado_a t FROM ordenes WHERE id=?', creada.otCreada), { a: 1, t: 3 }, 'la orden automática de siempre');

  // ── Generar una orden desde un proyecto (POST /api/proyectos/{id}/generar-ot) ──
  run(`INSERT INTO proyectos(id,codigo,titulo,estado,sucursal_id,ubicacion_id,activo_id,creado_por) VALUES
    (1,'PRY-1','Cambio de monitor','aprobado',1,1,2,1),(2,'PRY-2','Bomba nueva','aprobado',1,1,1,1)`);
  const generar = (id, data = {}) => call(app.proyectoOt.POST, `/api/proyectos/${id}/generar-ot`, { method: 'POST', id, data: { titulo: 'Retiro e instalación', ...data }, rol: 'jefe' });
  const antesPry = ordenes();
  es(status(await generar(1), 409, 'proyecto con equipo de baja'), { error: MSG }, 'proyecto: 409 con el texto');
  es([ordenes(), one('SELECT estado FROM proyectos WHERE id=1').estado], [antesPry, 'aprobado'], 'el proyecto no pasa a «en ejecución»');
  es(status(await generar(1, { activoId: 1 }), 201, 'el mismo proyecto con otro equipo').orden.activoId, 1, 'con un equipo en servicio sí');
  es(status(await generar(1, { activoId: null }), 201, 'el mismo proyecto sin equipo').orden.activoId, null, 'sin equipo sí');
  es(status(await generar(2), 201, 'proyecto con equipo operativo').orden.activoId, 1, 'sin cambios con un equipo en servicio');

  // ── Medición fuera de rango (POST /api/mediciones): orden automática ──
  run(`INSERT INTO variables_predictivas(id,activo_id,nombre,unidad,max_critico,max_warning) VALUES(1,2,'Temperatura','°C',40,35),(2,1,'Temperatura','°C',40,35)`);
  const medir = (variableId, valor) => call(app.mediciones.POST, '/api/mediciones', { method: 'POST', data: { variableId, valor }, rol: 'tecnico' });
  const antesMed = ordenes();
  const medBaja = status(await medir(1, 45), 201, 'medición crítica de un equipo de baja');
  es([medBaja.medicion.estadoAlerta, medBaja.ordenAutomatica, medBaja.ordenOmitida], ['critico', null, MSG], 'la medición se guarda y la orden no');
  es([ordenes(), one('SELECT count(*) n FROM mediciones WHERE variable_id=1').n], [antesMed, 1], 'ninguna orden nueva');
  const medViva = status(await medir(2, 45), 201, 'medición crítica de un equipo operativo');
  es([medViva.ordenAutomatica?.activoId, medViva.ordenAutomatica?.prioridad, 'ordenOmitida' in medViva], [1, 'alta', false], 'la orden predictiva de siempre');
  es(status(await medir(1, 20), 201, 'medición normal de un equipo de baja').ordenOmitida, undefined, 'sin orden que omitir, sin aviso');

  // ── /ordenes/nueva: qué equipo de la URL está de baja ──
  const db = app.db.getDb(ctx('/ordenes/nueva'));
  es(await app.equipoBaja.equipoDadoDeBaja(db, 2), { id: 2, codigo: 'BIO-BAJA', nombre: 'MONITOR VIEJO', area: 'biomedico' }, 'el equipo de baja, con su área');
  es([await app.equipoBaja.equipoDadoDeBaja(db, 1), await app.equipoBaja.equipoDadoDeBaja(db, 3), await app.equipoBaja.equipoDadoDeBaja(db, 404),
    await app.equipoBaja.equipoDadoDeBaja(db, null), await app.equipoBaja.equipoDadoDeBaja(db, Number('x'))], [null, null, null, null, null], 'los demás: null');
  es([await app.equipoBaja.equipoDeBaja(db, 2), await app.equipoBaja.equipoDeBaja(db, 1)], [true, false], 'equipoDeBaja');

  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  console.log(`PASS test-bio-ordenes-baja: ${n} casos`);
} finally {
  await fixture?.close();
  globalThis.fetch = originalFetch;
}
