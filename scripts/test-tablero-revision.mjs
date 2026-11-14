// Tablero de preventivos: los casos que encontró la revisión (13/11/2026). Cada caso
// corre aparte y al final se listan los que fallan: así se ve qué arregla cada cambio.
// Rutas reales, migraciones reales, sin red. Personas de prueba @prueba.local.
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';
import { fijarReloj } from './test-support/reloj.mjs';

fijarReloj();
globalThis.__efectosPrueba = [];

const fixture = await setupConjuntos({ modules: {
  tablero: 'pages/api/preventivos/index', asignar: 'pages/api/preventivos/asignar', historial: 'pages/api/preventivos/[id]/historial',
  plan: 'pages/api/planes/[id]', generar: 'pages/api/planes/[id]/generar-ot', crearPlan: 'pages/api/activos/[id]/planes',
  prev: 'lib/preventivos', db: 'lib/db',
} });
const { app, sqlite, call, close } = fixture;
const one = (q, ...a) => sqlite.prepare(q).get(...a);
const all = (q, ...a) => sqlite.prepare(q).all(...a);
const run = (q, ...a) => sqlite.prepare(q).run(...a);

const HOY = new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
const dia = (n) => new Date(Date.parse(`${HOY}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const marca = (n) => new Date(Date.parse(`${HOY}T16:00:00Z`) + n * 86400000).toISOString();
const MOTIVO = 'El área estará cerrada por remodelación esa semana';
const TECNICO = 3; // «Prueba tecnico» del fixture

run(`INSERT INTO usuarios(id,nombre,email,password_hash,rol,activo) VALUES
  (20,'Técnico Uno','tecnico.uno@prueba.local','x','tecnico',1),
  (21,'Técnico Dos','tecnico.dos@prueba.local','x','tecnico',1)`);
run("INSERT INTO sucursales(id,nombre) VALUES(7,'Sede de prueba'),(9,'Sede grande'),(10,'Sede del rango')");
run("INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo,padre_id) VALUES(70,7,'Nivel 2','piso',NULL),(72,7,'Quirófano 1','sala',70),(90,9,'Bodega','area',NULL),(100,10,'Pasillo','area',NULL)");
// Los ids de las OT no coinciden con los de las personas (en producción pasan de mil).
run("INSERT INTO ordenes(id,titulo,tipo,estado,rubro,creado_por) VALUES(1000,'Orden vieja','correctivo','cerrada','aires',1)");

let n = 0;
const equipo = (ubicacionId = 72, codigo = `RV-${String(++n).padStart(4, '0')}`) =>
  Number(run("INSERT INTO activos(codigo,nombre,rubro,tipo,ubicacion_id) VALUES(?,?,'aires','general',?)", codigo, `Equipo ${codigo}`, ubicacionId).lastInsertRowid);
const plan = (activoId, fecha, extra = {}) => Number(run(
  'INSERT INTO planes_mantenimiento(activo_id,titulo,frecuencia,proxima_fecha,asignado_a,activo,ultima_generacion) VALUES(?,?,?,?,?,?,?)',
  activoId, extra.titulo ?? 'Preventivo', extra.frecuencia ?? 'trimestral', fecha, extra.asignadoA ?? null, extra.activo === false ? 0 : 1, extra.ultimaGeneracion ?? null,
).lastInsertRowid);
const orden = (planId, activoId, estado, asignadoA = null, extra = {}) => {
  const id = Number(run(
    "INSERT INTO ordenes(titulo,tipo,estado,activo_id,rubro,plan_id,asignado_a,creado_por,completada_en,cerrado_en,created_at) VALUES(?,?,?,?,'aires',?,?,1,?,?,?)",
    extra.titulo ?? '[Preventivo] prueba', extra.tipo ?? 'preventivo', estado, activoId, planId, asignadoA, extra.completadaEn ?? null, extra.cerradoEn ?? null, extra.creada ?? marca(0),
  ).lastInsertRowid);
  if (planId) run('UPDATE planes_mantenimiento SET ultima_generacion=? WHERE id=?', extra.creada ?? marca(0), planId);
  if (extra.pmAvanzadoEn !== undefined || extra.reprogramar !== undefined) {
    run('INSERT INTO orden_verificacion(orden_id,pm_avanzado_en,reprogramar_preventivos) VALUES(?,?,?)', id, extra.pmAvanzadoEn ?? null, extra.reprogramar === false ? 0 : 1);
  }
  return id;
};
const tablero = (query = '', rol = 'admin') => call(app.tablero.GET, `/api/preventivos${query}`, { rol });
const asignar = (planIds, tecnicoId, rol = 'admin') => call(app.asignar.POST, '/api/preventivos/asignar', { method: 'POST', data: { planIds, tecnicoId }, rol });
const patch = (id, data, rol = 'admin') => call(app.plan.PATCH, `/api/planes/${id}`, { method: 'PATCH', id, data, rol });
const historial = (id) => call(app.historial.GET, `/api/preventivos/${id}/historial`, { id, rol: 'jefe' });
const atrasados = (t) => [...t.atrasados.sinAsignar, ...t.atrasados.asignados];
const efectos = () => globalThis.__efectosPrueba ?? null;
const limpiarEfectos = () => { if (Array.isArray(globalThis.__efectosPrueba)) globalThis.__efectosPrueba.length = 0; };

const fallos = [];
let verificados = 0;
async function caso(nombre, fn) {
  try { await fn(); verificados++; console.log(`  ok  ${nombre}`); }
  catch (e) { fallos.push(nombre); console.log(`  MAL ${nombre}\n      ${String(e.message).split('\n')[0]}`); }
}

try {
  await caso('La carga del técnico cuenta sus OT abiertas y sus preventivos', async () => {
    const e = equipo();
    const p1 = plan(e, dia(40), { asignadoA: 20 }), p2 = plan(equipo(), dia(41), { asignadoA: 20 });
    orden(p1, e, 'abierta', 20); orden(p2, e, 'en_proceso', 20); orden(null, e, 'en_espera', 20, { tipo: 'correctivo' });
    orden(null, e, 'cerrada', 20, { tipo: 'correctivo' });
    const t = (await tablero()).body;
    const uno = t.tecnicos.find((x) => x.id === 20);
    assert.equal(uno.abiertas, 3, `abiertas: ${uno.abiertas}`);
    assert.equal(uno.preventivos, 2, `preventivos: ${uno.preventivos}`);
  });

  await caso('Con la OT del ciclo sin terminar no se mueve la fecha (409) y el atraso sigue a la vista', async () => {
    const e = equipo();
    const p = plan(e, dia(-10), { asignadoA: 20 });
    const ot = orden(p, e, 'abierta', 20);
    const r = await patch(p, { proximaFecha: dia(20), motivo: MOTIVO });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.ok(typeof r.body.error === 'string' && /OT|orden/i.test(r.body.error), r.body.error);
    assert.equal(one('SELECT proxima_fecha f FROM planes_mantenimiento WHERE id=?', p).f, dia(-10));
    assert.equal(all("SELECT 1 FROM audit_log WHERE entidad='plan' AND entidad_id=? AND accion='reprogramacion'", p).length, 0, 'Sin registro de un cambio que no pasó');
    const fila = (await tablero()).body.atrasados.asignados.find((f) => f.planId === p);
    assert.ok(fila && fila.diasAtraso === 10 && fila.ot.id === ot, 'Sigue atrasado 10 días');
    // La frecuencia no toca el ciclo en curso: se puede cambiar con su motivo.
    assert.equal((await patch(p, { frecuencia: 'mensual', motivo: MOTIVO })).status, 200);
    // Enviada a verificación tampoco: al verificarla el sistema pisaría la fecha.
    run("UPDATE ordenes SET estado='completada' WHERE id=?", ot);
    assert.equal((await patch(p, { proximaFecha: dia(20), motivo: MOTIVO })).status, 409);
    // Cancelada, ya se puede reprogramar.
    run("UPDATE ordenes SET estado='cancelada' WHERE id=?", ot);
    const ok = await patch(p, { proximaFecha: dia(20), motivo: MOTIVO });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  await caso('El técnico no asigna, no reprograma, no cambia la frecuencia ni pausa (403 en JSON)', async () => {
    const e = equipo();
    const p = plan(e, dia(5), { asignadoA: 20 });
    const ot = orden(p, e, 'abierta', 20);
    for (const data of [{ asignadoA: 21 }, { asignadoA: null }, { proximaFecha: dia(9), motivo: MOTIVO }, { frecuencia: 'mensual', motivo: MOTIVO }, { activo: false, motivo: MOTIVO }]) {
      const r = await patch(p, data, 'tecnico');
      assert.equal(r.status, 403, `${JSON.stringify(data)} → ${r.status}`);
      assert.ok(typeof r.body.error === 'string');
    }
    assert.equal(one('SELECT asignado_a FROM planes_mantenimiento WHERE id=?', p).asignado_a, 20);
    assert.equal(one('SELECT asignado_a FROM ordenes WHERE id=?', ot).asignado_a, 20);
    // Lo demás del preventivo (título, pasos) lo sigue editando, y mandar los mismos valores no es un cambio.
    const r = await patch(p, { titulo: 'Limpieza de serpentín', proximaFecha: dia(5), frecuencia: 'trimestral', asignadoA: 20 }, 'tecnico');
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  await caso('Una OT de un ciclo anterior en verificación no esconde el atraso del ciclo actual', async () => {
    const e = equipo();
    const p = plan(e, dia(-8), { frecuencia: 'mensual' });
    orden(p, e, 'verificada', null, { creada: marca(-45), completadaEn: marca(-40), pmAvanzadoEn: marca(-39) });
    orden(p, e, 'cancelada', null, { creada: marca(-8) });
    const t = (await tablero()).body;
    assert.ok(atrasados(t).some((f) => f.planId === p), 'El plan sale atrasado');
    // La del ciclo actual enviada a verificación sí lo saca: el técnico ya la terminó.
    const p2 = plan(equipo(), dia(-3));
    orden(p2, e, 'completada', 20, { completadaEn: marca(-1) });
    assert.ok(!atrasados((await tablero()).body).some((f) => f.planId === p2));
  });

  await caso('El historial registra el avance automático de la fecha aunque la OT no quede en «cerrada»', async () => {
    const e = equipo();
    const p = plan(e, dia(20), { frecuencia: 'mensual' });
    const v = orden(p, e, 'verificada', null, { creada: marca(-12), completadaEn: marca(-11), pmAvanzadoEn: marca(-10) });
    const reabierta = orden(p, e, 'en_proceso', null, { creada: marca(-50), completadaEn: null, pmAvanzadoEn: marca(-40) });
    const r = await historial(p);
    const avances = r.body.entradas.filter((x) => x.accion === 'ot_cerrada').map((x) => x.ordenId);
    assert.ok(avances.includes(v), `verificada: ${JSON.stringify(avances)}`);
    assert.ok(avances.includes(reabierta), 'reabierta después de mover la fecha');
  });

  await caso('Las reprogramaciones de personas no salen del historial por las OT del sistema', async () => {
    const e = equipo();
    const diaria = plan(e, dia(1), { frecuencia: 'diaria' });
    const trimestral = plan(e, dia(30), { frecuencia: 'trimestral' });
    assert.equal((await patch(diaria, { proximaFecha: dia(2), motivo: MOTIVO })).status, 200);
    assert.equal((await patch(trimestral, { proximaFecha: dia(31), motivo: MOTIVO })).status, 200);
    run("UPDATE audit_log SET created_at=datetime('now','-90 days') WHERE entidad='plan' AND entidad_id IN (?,?)", diaria, trimestral);
    for (let i = 0; i < 70; i++) orden(diaria, e, 'cerrada', null, { creada: marca(-60 + i), completadaEn: marca(-60 + i), cerradoEn: marca(-60 + i), pmAvanzadoEn: marca(-60 + i) });
    run('UPDATE planes_mantenimiento SET proxima_fecha=? WHERE id=?', dia(2), diaria);
    const r = await historial(diaria);
    assert.ok(r.body.entradas.some((x) => x.accion === 'reprogramacion'), 'La reprogramación del plan diario sigue');
    const db = app.db.getDb(fixture.ctx('/x'));
    const ficha = await app.prev.historialDePlanes(db, { activoId: e });
    assert.ok(ficha.some((x) => x.planId === trimestral && x.accion === 'reprogramacion'), 'En la ficha, la del trimestral también');
    assert.ok(ficha.some((x) => x.planId === diaria && x.accion === 'reprogramacion'), 'Y la del diario');
  });

  await caso('Una fecha que no existe se rechaza con 400 en JSON', async () => {
    const e = equipo();
    const p = plan(e, dia(5));
    for (const f of ['2026-02-31', '2026-13-45', '2026-02-30']) {
      const r = await patch(p, { proximaFecha: f, motivo: MOTIVO });
      assert.equal(r.status, 400, `${f} → ${r.status}`);
      assert.ok(typeof r.body.error === 'string', JSON.stringify(r.body));
    }
    assert.equal(one('SELECT proxima_fecha f FROM planes_mantenimiento WHERE id=?', p).f, dia(5));
    const c = await call(app.crearPlan.POST, `/api/activos/${e}/planes`, { method: 'POST', id: e, data: { titulo: 'Nuevo', frecuencia: 'mensual', proximaFecha: '2026-02-30' } });
    assert.equal(c.status, 400, `Alta con fecha imposible → ${c.status}`);
  });

  await caso('El historial muestra cuando un correctivo verificado movió la fecha', async () => {
    const e = equipo();
    const p = plan(e, dia(80));
    // El preventivo ya existía cuando se verificaron los correctivos.
    run("UPDATE planes_mantenimiento SET created_at=datetime('now','-30 days') WHERE id=?", p);
    const correctivo = orden(null, e, 'cerrada', null, { tipo: 'correctivo', creada: marca(-6), completadaEn: marca(-4), cerradoEn: marca(-3), pmAvanzadoEn: marca(-3), reprogramar: true });
    orden(null, e, 'cerrada', null, { tipo: 'correctivo', creada: marca(-9), completadaEn: marca(-8), cerradoEn: marca(-7), pmAvanzadoEn: marca(-7), reprogramar: false });
    const r = await historial(p);
    const del = r.body.entradas.filter((x) => x.accion === 'correctivo_verificado');
    assert.equal(del.length, 1, JSON.stringify(r.body.entradas.map((x) => x.accion)));
    assert.equal(del[0].ordenId, correctivo);
  });

  await caso('El historial dice quién tenía la OT antes de reasignarla', async () => {
    const e = equipo();
    const p = plan(e, dia(3));
    const ot = orden(p, e, 'en_proceso', 20);
    assert.equal((await asignar([p], 21, 'jefe')).status, 200);
    assert.equal(one('SELECT asignado_a FROM ordenes WHERE id=?', ot).asignado_a, 21);
    const r = await historial(p);
    const ent = r.body.entradas.find((x) => x.accion === 'ot_reasignada' && x.ordenId === ot);
    assert.ok(ent, JSON.stringify(r.body.entradas.map((x) => x.accion)));
    assert.deepEqual(ent.cambios.map((c) => [c.antes, c.despues]), [['Técnico Uno', 'Técnico Dos']]);
    assert.equal(ent.autor, 'Prueba jefe');
  });

  await caso('El registro de una asignación guarda los técnicos como enteros', async () => {
    const e = equipo();
    const p = plan(e, dia(4), { asignadoA: 20 });
    assert.equal((await asignar([p], 21)).status, 200);
    const tipos = one("SELECT json_type(cambios,'$.asignadoA.antes') a, json_type(cambios,'$.asignadoA.despues') d FROM audit_log WHERE entidad='plan' AND entidad_id=? ORDER BY id DESC LIMIT 1", p);
    assert.deepEqual({ ...tipos }, { a: 'integer', d: 'integer' });
  });

  await caso('Avisos: uno por lote para los planes sin OT y uno por OT reasignada', async () => {
    assert.ok(Array.isArray(efectos()), 'La prueba registra los avisos');
    const e = equipo();
    const sinOt = [plan(e, dia(6)), plan(equipo(), dia(7)), plan(equipo(), dia(8))];
    const conOt = plan(equipo(), dia(-1)); const ot = orden(conOt, e, 'abierta');
    limpiarEfectos();
    assert.equal((await asignar([...sinOt, conOt], 21)).status, 200);
    const app_ = efectos().filter((x) => x.canal === 'app');
    assert.equal(app_.filter((x) => x.tipo === 'preventivo_asignado' && x.usuarioId === 21).length, 1, JSON.stringify(app_));
    assert.equal(app_.filter((x) => x.tipo === 'ot_asignada' && x.usuarioId === 21 && x.link === `/ordenes/${ot}`).length, 1);
    assert.equal(app_.length, 2);
    // Asignar al mismo técnico otra vez no avisa de nuevo.
    limpiarEfectos();
    await asignar([...sinOt, conOt], 21);
    assert.equal(efectos().length, 0);
  });

  await caso('«Generar OT» avisa al técnico del preventivo, como el cron', async () => {
    run("UPDATE usuarios SET telegram_chat_id='chat-prueba' WHERE id=20");
    const e = equipo();
    const p = plan(e, dia(-2), { asignadoA: 20 });
    limpiarEfectos();
    const r = await call(app.generar.POST, `/api/planes/${p}/generar-ot`, { method: 'POST', id: p, data: {} });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const avisos = (efectos() ?? []).filter((x) => x.usuarioId === 20 && x.tipo === 'ot_asignada');
    assert.equal(avisos.length, 1, JSON.stringify(efectos()));
    assert.equal(avisos[0].link, `/ordenes/${r.body.orden.id}`);
    assert.ok((efectos() ?? []).some((x) => x.canal === 'telegram' && x.chat === 'chat-prueba'), 'Y por Telegram');
  });

  await caso('Una OT borrada no deja el plan como «cancelada»: el cron la vuelve a generar', async () => {
    const e = equipo();
    const p = plan(e, dia(-2));
    const ot = orden(p, e, 'abierta');
    // Lo que hace DELETE /api/ordenes/[id]: borra y deja que el cron la regenere.
    run('DELETE FROM ordenes WHERE id=?', ot); run('UPDATE planes_mantenimiento SET ultima_generacion=NULL WHERE id=?', p);
    const f = atrasados((await tablero()).body).find((x) => x.planId === p);
    assert.ok(f && f.ot === null && f.otCancelada === false, JSON.stringify(f));
    const p2 = plan(equipo(), dia(-2)); orden(p2, e, 'cancelada');
    assert.equal(atrasados((await tablero()).body).find((x) => x.planId === p2)?.otCancelada, true);
  });

  await caso('La búsqueda se hace antes del límite de 500 filas', async () => {
    for (let i = 0; i < 505; i++) plan(equipo(90, `GR-${String(i).padStart(4, '0')}`), dia(1));
    const buscado = plan(equipo(90, 'ZZ-BUSCADO'), dia(13), { titulo: 'Revisión de compresor' });
    fixture.faults.enforceParameterLimit = true;
    let t = (await tablero('?sede=9&q=zz-buscado')).body;
    assert.deepEqual(t.programados.map((f) => f.planId), [buscado]);
    assert.equal(t.truncado, false);
    t = (await tablero('?sede=9&q=compresor')).body;
    assert.deepEqual(t.programados.map((f) => f.planId), [buscado], 'Por el título');
    t = (await tablero('?sede=9&q=bodega')).body;
    assert.equal(t.truncado, true, 'Por la ubicación entran todos');
    // Sin tildes y por el técnico.
    const pq = plan(equipo(72), dia(2), { asignadoA: 21 });
    t = (await tablero('?q=quirofano')).body;
    assert.ok(t.programados.some((f) => f.planId === pq), 'Por la ruta, sin tildes');
    t = (await tablero('?q=tecnico dos')).body;
    assert.ok(t.programados.some((f) => f.planId === pq), 'Por el técnico');
    fixture.faults.enforceParameterLimit = false;
  });

  await caso('Con «desde» en el pasado, un atrasado no se cuenta también como programado', async () => {
    const p = plan(equipo(100), dia(-3));
    const t = (await tablero(`?sede=10&desde=${dia(-5)}`)).body;
    assert.ok(atrasados(t).some((f) => f.planId === p), 'Está en atrasados');
    assert.ok(!t.programados.some((f) => f.planId === p), 'Y no en programados');
  });
} finally {
  await close();
}

if (fallos.length) {
  console.error(`tablero (revisión): ${fallos.length} caso(s) fallan:\n - ${fallos.join('\n - ')}`);
  process.exit(1);
}
console.log(`tablero (revisión): ${verificados} casos correctos`);
