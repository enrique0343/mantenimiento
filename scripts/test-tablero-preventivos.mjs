// Tablero de preventivos: asignar y reasignar desde la jefatura, los atrasados de
// 1 día o más, y la regla de responsabilidad: la fecha programada y la frecuencia
// no cambian sin motivo ni sin registro. Rutas reales, migraciones reales, sin red.
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';
import { fijarReloj } from './test-support/reloj.mjs';

fijarReloj();

const fixture = await setupConjuntos({ modules: {
  tablero: 'pages/api/preventivos/index', asignar: 'pages/api/preventivos/asignar', historial: 'pages/api/preventivos/[id]/historial',
  plan: 'pages/api/planes/[id]', bulk: 'pages/api/planes/bulk', prev: 'lib/preventivos',
} });
const { app, sqlite, faults, queries, call, close } = fixture;
const one = (q, ...a) => sqlite.prepare(q).get(...a);
const all = (q, ...a) => sqlite.prepare(q).all(...a);
const run = (q, ...a) => sqlite.prepare(q).run(...a);
let verificaciones = 0;
const igual = (...args) => { assert.equal(...args); verificaciones++; };
const ok = (...args) => { assert.ok(...args); verificaciones++; };
const iguales = (...args) => { assert.deepEqual(...args); verificaciones++; };

// «Hoy» es el día de El Salvador (UTC-6), como en la app.
const HOY = new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
const dia = (n) => new Date(Date.parse(`${HOY}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const ddmm = (f) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
const ADMIN = 1, JEFE = 2;

// Personas de prueba (sin datos reales).
run(`INSERT INTO usuarios(id,nombre,email,password_hash,rol,activo) VALUES
  (20,'Técnico Uno','tecnico.uno@prueba.local','x','tecnico',1),
  (21,'Técnico Dos','tecnico.dos@prueba.local','x','tecnico',1),
  (22,'Técnico Inactivo','tecnico.inactivo@prueba.local','x','tecnico',0)`);
// Sede con su árbol: nivel → área → sala.
run("INSERT INTO sucursales(id,nombre) VALUES(7,'Sede de prueba'),(8,'Otra sede')");
run(`INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo,padre_id) VALUES
  (70,7,'Nivel 2','piso',NULL),(71,7,'Bloque quirúrgico','area',70),(72,7,'Quirófano 1','sala',71),(80,8,'Bodega','area',NULL)`);

let activoN = 0;
const equipo = (codigo, ubicacionId = 72, rubro = 'aires') => Number(run("INSERT INTO activos(codigo,nombre,rubro,tipo,ubicacion_id) VALUES(?,?,?,'general',?)", codigo, `Equipo ${codigo}`, rubro, ubicacionId).lastInsertRowid) + (activoN++ * 0);
const plan = (activoId, fecha, extra = {}) => Number(run(
  'INSERT INTO planes_mantenimiento(activo_id,titulo,frecuencia,proxima_fecha,asignado_a,activo,ultima_generacion) VALUES(?,?,?,?,?,?,?)',
  activoId, extra.titulo ?? 'Preventivo trimestral', extra.frecuencia ?? 'trimestral', fecha, extra.asignadoA ?? null, extra.activo === false ? 0 : 1, extra.ultimaGeneracion ?? null,
).lastInsertRowid);
const orden = (planId, activoId, estado, asignadoA = null) => {
  const id = Number(run("INSERT INTO ordenes(titulo,tipo,estado,activo_id,rubro,plan_id,asignado_a,creado_por) VALUES('[Preventivo] prueba','preventivo',?,?,'aires',?,?,1)", estado, activoId, planId, asignadoA).lastInsertRowid);
  run('UPDATE planes_mantenimiento SET ultima_generacion=? WHERE id=?', new Date().toISOString(), planId);
  return id;
};
const auditoria = (entidad, id) => all("SELECT * FROM audit_log WHERE entidad=? AND entidad_id=? ORDER BY id", entidad, id).map((r) => ({ ...r, cambios: r.cambios ? JSON.parse(r.cambios) : null }));
const tablero = (query = '', rol = 'admin') => call(app.tablero.GET, `/api/preventivos${query}`, { rol });
const asignar = (planIds, tecnicoId, rol = 'admin', extra = {}) => call(app.asignar.POST, '/api/preventivos/asignar', { method: 'POST', data: { planIds, tecnicoId, ...extra }, rol });
const patch = (id, data, rol = 'admin') => call(app.plan.PATCH, `/api/planes/${id}`, { method: 'PATCH', id, data, rol });
const borrar = (id, data, rol = 'admin') => call(app.plan.DELETE, `/api/planes/${id}`, { method: 'DELETE', id, data, rol });
const bulk = (data, rol = 'admin') => call(app.bulk.POST, '/api/planes/bulk', { method: 'POST', data, rol });
const MOTIVO = 'El área estará cerrada por remodelación esa semana';

try {
  const eA = equipo('AA-001'), eB = equipo('AA-002'), eC = equipo('AA-003'), eD = equipo('AA-004', 80, 'biomedico');
  const pA = plan(eA, dia(2));                  // viene en 2 días, sin OT
  const pB = plan(eB, HOY);                      // hoy, con OT abierta
  const otB = orden(pB, eB, 'abierta');
  const pC = plan(eC, dia(30));                  // fuera de los 14 días
  const pD = plan(eD, dia(5));                   // otra sede, biomédico
  const pInactivo = plan(eA, dia(3), { activo: false, titulo: 'Plan pausado' });

  // ── Roles ──────────────────────────────────────────────────────────────────
  for (const rol of ['tecnico', 'visualizador']) {
    const r = await tablero('', rol);
    igual(r.status, 403, rol); ok(typeof r.body.error === 'string', `${rol}: error en JSON`);
    const a = await asignar([pA], 20, rol);
    igual(a.status, 403); ok(typeof a.body.error === 'string');
    const h = await call(app.historial.GET, `/api/preventivos/${pA}/historial`, { id: pA, rol });
    igual(h.status, 403);
  }
  const sinSesion = await tablero('', null);
  igual(sinSesion.status, 401); ok(typeof sinSesion.body.error === 'string', '401 en JSON');
  igual((await patch(pA, { titulo: 'x' }, 'visualizador')).status, 403);
  igual((await bulk({ accion: 'activar', ids: [pA] }, 'tecnico')).status, 403);
  igual((await tablero('', 'jefe')).status, 200, 'El jefe usa el tablero');

  // ── Programados ────────────────────────────────────────────────────────────
  let t = (await tablero()).body;
  igual(t.hoy, HOY);
  iguales(t.programados.map((f) => f.planId), [pB, pA, pD], 'Próximos 14 días, activos, por fecha');
  const filaA = t.programados.find((f) => f.planId === pA);
  igual(filaA.ubicacion, 'Nivel 2 · Bloque quirúrgico · Quirófano 1', 'Ruta con sus padres');
  igual(filaA.sede, 'Sede de prueba');
  igual(filaA.fechaTexto, ddmm(dia(2)), 'DD/MM/AAAA sin correr el día');
  igual(filaA.frecuenciaTexto, 'Trimestral (3 meses)');
  igual(filaA.ot, null);
  const filaB = t.programados.find((f) => f.planId === pB);
  igual(filaB.ot.id, otB, 'Con su OT abierta');
  ok(t.tecnicos.some((x) => x.id === 20) && !t.tecnicos.some((x) => x.id === 22), 'Solo técnicos activos');
  t = (await tablero(`?hasta=${dia(40)}`)).body;
  ok(t.programados.some((f) => f.planId === pC), 'El rango se amplía');
  t = (await tablero('?sede=7')).body;
  ok(!t.programados.some((f) => f.planId === pD), 'Filtro de sede');
  t = (await tablero('?area=biomedico')).body;
  iguales(t.programados.map((f) => f.planId), [pD], 'Filtro de área');
  t = (await tablero('?q=quirofano')).body;
  ok(t.programados.some((f) => f.planId === pA) && !t.programados.some((f) => f.planId === pD), 'Busca en la ruta, sin tildes');
  igual((await tablero('?desde=2026-13-01')).status, 400);
  igual((await tablero(`?desde=${dia(5)}&hasta=${dia(1)}`)).status, 400);

  // ── Asignar y quitar: plan y OT abierta ───────────────────────────────────
  let r = await asignar([pA], 20);
  igual(r.status, 200, JSON.stringify(r.body)); igual(r.body.planes, 1); igual(r.body.ordenes, 0);
  igual(one('SELECT asignado_a FROM planes_mantenimiento WHERE id=?', pA).asignado_a, 20);
  let reg = auditoria('plan', pA).at(-1);
  igual(reg.accion, 'asignacion'); igual(reg.usuario_id, ADMIN);
  iguales(reg.cambios.asignadoA, { antes: null, despues: 20 });
  ok(auditoria('activo', eA).some((x) => x.accion === 'asignacion'), 'También en el historial del equipo');

  r = await asignar([pB], 20, 'jefe');
  igual(r.status, 200, JSON.stringify(r.body)); igual(r.body.ordenes, 1);
  igual(one('SELECT asignado_a FROM planes_mantenimiento WHERE id=?', pB).asignado_a, 20, 'Queda en el plan');
  const otAsignada = one('SELECT asignado_a, asignado_en FROM ordenes WHERE id=?', otB);
  igual(otAsignada.asignado_a, 20, 'Y en su OT abierta'); ok(otAsignada.asignado_en);
  igual(auditoria('plan', pB).at(-1).usuario_id, JEFE);
  ok(one("SELECT count(*) n FROM orden_verificacion_eventos WHERE orden_id=?", otB).n >= 1, 'La OT deja su rastro por el camino de siempre');

  r = await asignar([pB], null);
  igual(r.status, 200); igual(r.body.ordenes, 1);
  igual(one('SELECT asignado_a FROM planes_mantenimiento WHERE id=?', pB).asignado_a, null, 'Quitar del plan');
  igual(one('SELECT asignado_a FROM ordenes WHERE id=?', otB).asignado_a, null, 'Y de la OT');
  iguales(auditoria('plan', pB).at(-1).cambios.asignadoA, { antes: 20, despues: null });

  const antes = auditoria('plan', pA).length;
  r = await asignar([pA], 20);
  igual(r.body.planes, 0, 'Asignar al mismo no cambia nada');
  igual(auditoria('plan', pA).length, antes, 'Ni deja registro vacío');

  igual((await asignar([pA], 22)).status, 400, 'Técnico inactivo');
  igual((await asignar([pA], JEFE)).status, 400, 'Solo técnicos');
  igual((await asignar([pA, 99999], 20)).status, 404, 'Preventivo que no existe');
  igual((await asignar([], 20)).status, 400);

  // ── Asignación en lote ────────────────────────────────────────────────────
  r = await asignar([pA, pC, pD, pB], 21, 'admin', { motivo: 'Reparto de la semana' });
  igual(r.status, 200); igual(r.body.planes, 4); igual(r.body.ordenes, 1);
  iguales(all(`SELECT asignado_a FROM planes_mantenimiento WHERE id IN (${[pA, pC, pD, pB].join(',')})`).map((x) => x.asignado_a), [21, 21, 21, 21]);
  igual(auditoria('plan', pC).at(-1).cambios.motivo, 'Reparto de la semana');
  igual(one('SELECT asignado_a FROM ordenes WHERE id=?', otB).asignado_a, 21);

  // ── Atrasados (1 día o más) ───────────────────────────────────────────────
  const eE = equipo('AT-001'), eF = equipo('AT-002'), eG = equipo('AT-003'), eH = equipo('AT-004'), eI = equipo('AT-005'), eJ = equipo('AT-006'), eK = equipo('AT-007');
  const pE = plan(eE, dia(-1));                                   // 1 día exacto, sin OT, sin asignar
  const pF = plan(eF, dia(-5)); const otF = orden(pF, eF, 'en_proceso', 20); // OT en proceso asignada
  const pG = plan(eG, dia(-3)); orden(pG, eG, 'completada', 20);  // enviada a verificación: no cuenta
  const pH = plan(eH, HOY);                                       // hoy: 0 días, no cuenta
  const pI = plan(eI, dia(-2)); orden(pI, eI, 'cancelada');       // OT del ciclo cancelada
  const pJ = plan(eJ, dia(-4), { activo: false });                // desactivado sin OT: no cuenta
  const pK = plan(eK, dia(-4), { activo: false, asignadoA: 21 }); const otK = orden(pK, eK, 'abierta', 21); // desactivado con OT abierta

  t = (await tablero()).body;
  const sin = t.atrasados.sinAsignar, con = t.atrasados.asignados;
  const ids = (l) => l.map((f) => f.planId).sort((a, b) => a - b);
  iguales(ids(sin), [pE, pI].sort((a, b) => a - b), 'Sin asignar');
  iguales(ids(con), [pF, pK].sort((a, b) => a - b), 'Asignados');
  const fE = sin.find((f) => f.planId === pE);
  igual(fE.diasAtraso, 1, '1 día exacto'); igual(fE.ot, null, 'Plan sin OT generada');
  const fF = con.find((f) => f.planId === pF);
  igual(fF.diasAtraso, 5); igual(fF.ot.id, otF); igual(fF.tecnico.id, 20, 'El técnico de la OT');
  ok(sin.find((f) => f.planId === pI).otCancelada, 'Ciclo con la OT cancelada');
  ok(!t.programados.some((f) => f.planId === pE), 'Un atrasado no es programado');
  ok(t.programados.some((f) => f.planId === pH), 'Hoy es programado');
  igual(con.find((f) => f.planId === pK).planActivo, false);

  // Reasignar un atrasado: la OT pasa al técnico nuevo.
  r = await asignar([pF], 21);
  igual(r.status, 200); igual(one('SELECT asignado_a FROM ordenes WHERE id=?', otF).asignado_a, 21);
  r = await asignar([pE, pK], 20);
  igual(r.body.planes, 2); igual(one('SELECT asignado_a FROM ordenes WHERE id=?', otK).asignado_a, 20);
  t = (await tablero()).body;
  igual(t.atrasados.sinAsignar.length, 1, 'Solo queda la del ciclo cancelado');

  // ── Motivo obligatorio: fecha y frecuencia ───────────────────────────────
  const fechaAntes = one('SELECT proxima_fecha f FROM planes_mantenimiento WHERE id=?', pA).f;
  r = await patch(pA, { proximaFecha: dia(9) });
  igual(r.status, 400, 'Fecha sin motivo'); ok(typeof r.body.error === 'string' && /motivo/i.test(r.body.error));
  r = await patch(pA, { proximaFecha: dia(9), motivo: 'corto' });
  igual(r.status, 400, 'Motivo corto');
  igual(one('SELECT proxima_fecha f FROM planes_mantenimiento WHERE id=?', pA).f, fechaAntes, 'No cambió');
  r = await patch(pA, { proximaFecha: dia(9), motivo: MOTIVO });
  igual(r.status, 200, JSON.stringify(r.body)); igual(r.body.plan.proximaFecha, dia(9));
  reg = auditoria('plan', pA).at(-1);
  igual(reg.accion, 'reprogramacion'); igual(reg.usuario_id, ADMIN); igual(reg.cambios.motivo, MOTIVO);
  iguales(reg.cambios.proximaFecha, { antes: fechaAntes, despues: dia(9) });
  ok(reg.created_at, 'Con su hora');
  const espejo = auditoria('activo', eA).at(-1);
  igual(espejo.accion, 'reprogramacion'); igual(espejo.cambios.motivo, MOTIVO);

  r = await patch(pA, { frecuencia: 'mensual' }, 'jefe');
  igual(r.status, 400, 'Frecuencia sin motivo');
  r = await patch(pA, { frecuencia: 'cuatrimestral', motivo: MOTIVO }, 'jefe');
  igual(r.status, 200, JSON.stringify(r.body));
  reg = auditoria('plan', pA).at(-1);
  iguales(reg.cambios.frecuencia, { antes: 'trimestral', despues: 'cuatrimestral' }); igual(reg.usuario_id, JEFE);

  // La ficha manda todos los campos: lo que no cambia no pide motivo.
  r = await patch(pA, { titulo: 'Limpieza de filtros', proximaFecha: dia(9), frecuencia: 'cuatrimestral', alertaDiasAntes: 7 });
  igual(r.status, 200, 'Mismos valores, sin motivo');
  reg = auditoria('plan', pA).at(-1);
  igual(reg.accion, 'update'); iguales(Object.keys(reg.cambios), ['titulo']);
  // La fecha, la frecuencia, el técnico y la pausa son de la jefatura, aun con motivo.
  r = await patch(pA, { proximaFecha: dia(10), motivo: MOTIVO }, 'tecnico');
  igual(r.status, 403, 'El técnico no reprograma'); ok(typeof r.body.error === 'string');
  igual(one('SELECT proxima_fecha f FROM planes_mantenimiento WHERE id=?', pA).f, dia(9));

  // Desde la ficha, cambiar el técnico también mueve la OT abierta.
  r = await patch(pB, { asignadoA: 20 }, 'jefe');
  igual(r.status, 200); igual(r.body.ordenes, 1);
  igual(one('SELECT asignado_a FROM ordenes WHERE id=?', otB).asignado_a, 20);

  // ── Desactivar y eliminar con motivo ─────────────────────────────────────
  igual((await patch(pC, { activo: false })).status, 400, 'Desactivar sin motivo');
  r = await patch(pC, { activo: false, motivo: MOTIVO });
  igual(r.status, 200); igual(one('SELECT activo FROM planes_mantenimiento WHERE id=?', pC).activo, 0);
  reg = auditoria('plan', pC).at(-1);
  igual(reg.accion, 'desactivacion'); iguales(reg.cambios.activo, { antes: true, despues: false }); igual(reg.cambios.motivo, MOTIVO);
  r = await patch(pC, { activo: true });
  igual(r.status, 200, 'Activar no pide motivo'); igual(auditoria('plan', pC).at(-1).accion, 'activacion');

  const eL = equipo('EL-001'); const pL = plan(eL, dia(20), { asignadoA: 20 });
  igual((await borrar(pL, {})).status, 400, 'Eliminar sin motivo');
  igual((await borrar(pL, { motivo: MOTIVO }, 'tecnico')).status, 403);
  r = await borrar(pL, { motivo: MOTIVO });
  igual(r.status, 200, JSON.stringify(r.body));
  igual(one('SELECT count(*) n FROM planes_mantenimiento WHERE id=?', pL).n, 0);
  reg = auditoria('plan', pL).at(-1);
  igual(reg.accion, 'delete'); igual(reg.cambios.motivo, MOTIVO); igual(reg.usuario_id, ADMIN);
  iguales(reg.cambios.proximaFecha, { antes: dia(20), despues: null });
  igual(reg.cambios.asignadoA.antes, 20);
  // Con órdenes ligadas la base no lo deja: no queda ni el borrado ni el registro.
  const antesF = auditoria('plan', pF).length;
  r = await borrar(pF, { motivo: MOTIVO });
  igual(r.status, 409); ok(typeof r.body.error === 'string');
  igual(one('SELECT count(*) n FROM planes_mantenimiento WHERE id=?', pF).n, 1);
  igual(auditoria('plan', pF).length, antesF, 'Sin registro de un borrado que no pasó');

  // Lote de /planes
  const eM = equipo('LT-001'), eN = equipo('LT-002');
  const pM = plan(eM, dia(6)), pN = plan(eN, dia(7));
  igual((await bulk({ accion: 'desactivar', ids: [pM, pN] })).status, 400, 'Lote sin motivo');
  r = await bulk({ accion: 'desactivar', ids: [pM, pN], motivo: MOTIVO });
  igual(r.status, 200); igual(r.body.afectados, 2);
  for (const p of [pM, pN]) {
    const x = auditoria('plan', p).at(-1);
    igual(x.accion, 'desactivacion'); igual(x.cambios.motivo, MOTIVO); igual(x.usuario_id, ADMIN);
  }
  r = await bulk({ accion: 'activar', ids: [pM, pN] });
  igual(r.status, 200, 'Activar en lote sin motivo'); igual(r.body.afectados, 2);
  igual((await bulk({ accion: 'eliminar', ids: [pM] })).status, 400);
  r = await bulk({ accion: 'eliminar', ids: [pM, pN], motivo: MOTIVO });
  igual(r.status, 200); igual(one(`SELECT count(*) n FROM planes_mantenimiento WHERE id IN (${pM},${pN})`).n, 0);
  igual(auditoria('plan', pN).at(-1).accion, 'delete');
  r = await bulk({ accion: 'eliminar', ids: [pF, pH], motivo: MOTIVO });
  igual(r.status, 409, 'Si uno tiene órdenes, no se borra ninguno');
  igual(one(`SELECT count(*) n FROM planes_mantenimiento WHERE id IN (${pF},${pH})`).n, 2);

  // ── Historial: persona, hora de El Salvador, antes → después y motivo ─────
  r = await call(app.historial.GET, `/api/preventivos/${pA}/historial`, { id: pA, rol: 'jefe' });
  igual(r.status, 200);
  const rep = r.body.entradas.find((e) => e.accion === 'reprogramacion' && e.cambios.some((c) => c.campo === 'proximaFecha') && e.autor === 'Prueba admin');
  ok(rep, 'La reprogramación está');
  iguales(rep.cambios.find((c) => c.campo === 'proximaFecha'), { campo: 'proximaFecha', label: 'Próxima fecha', antes: ddmm(fechaAntes), despues: ddmm(dia(9)) });
  igual(rep.motivo, MOTIVO);
  ok(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(rep.cuandoTexto), rep.cuandoTexto);
  const sqliteAhora = one("SELECT strftime('%Y-%m-%dT%H:%M:%SZ','now') t").t;
  igual(rep.cuandoTexto.slice(0, 10), ddmm(new Date(Date.parse(sqliteAhora) - 6 * 3600000).toISOString().slice(0, 10)), 'Fecha de El Salvador');
  const asig = r.body.entradas.find((e) => e.accion === 'asignacion' && e.cambios[0]?.despues === 'Técnico Uno');
  ok(asig, 'La asignación con el nombre del técnico'); igual(asig.cambios[0].antes, 'Sin asignar');
  r = await call(app.historial.GET, `/api/preventivos/${pB}/historial`, { id: pB, rol: 'admin' });
  ok(r.body.entradas.some((e) => e.accion === 'ot_generada' && e.ordenId === otB), 'La OT generada por el sistema');
  igual((await call(app.historial.GET, '/api/preventivos/99999/historial', { id: 99999 })).status, 404);

  // ── Ninguna consulta pasa de 100 parámetros con una sede de 150 equipos ───
  run("INSERT INTO sucursales(id,nombre) VALUES(9,'Sede grande')");
  const muchos = [];
  for (let i = 0; i < 150; i++) {
    const ub = Number(run("INSERT INTO ubicaciones(sucursal_id,nombre,tipo,padre_id) VALUES(9,?,'sala',NULL)", `Sala ${i}`).lastInsertRowid);
    muchos.push(plan(equipo(`GR-${String(i).padStart(3, '0')}`, ub), i % 2 ? dia(1 + (i % 10)) : dia(-1 - (i % 5))));
  }
  faults.enforceParameterLimit = true;
  faults.enforceColumnLimit = true;
  const desde = queries.length;
  t = (await tablero('?sede=9')).body;
  igual(t.programados.length + t.atrasados.sinAsignar.length, 150, 'Los 150 en el tablero');
  r = await asignar(muchos, 20);
  igual(r.status, 200, JSON.stringify(r.body)); igual(r.body.planes, 150);
  igual(one('SELECT count(*) n FROM audit_log WHERE entidad=? AND accion=? AND cambios LIKE ?', 'plan', 'asignacion', '%"despues":20%').n >= 150, true);
  r = await bulk({ accion: 'desactivar', ids: muchos, motivo: MOTIVO });
  igual(r.status, 200); igual(r.body.afectados, 150);
  r = await bulk({ accion: 'activar', ids: muchos });
  igual(r.body.afectados, 150);
  r = await call(app.historial.GET, `/api/preventivos/${muchos[0]}/historial`, { id: muchos[0] });
  igual(r.status, 200);
  const maximo = Math.max(...queries.slice(desde).map((q) => q.parameters));
  ok(maximo <= 100, `Máximo de parámetros: ${maximo}`);
  ok(maximo < 20, `Las listas viajan en un solo parámetro (máximo ${maximo})`);
  faults.enforceParameterLimit = false;
  faults.enforceColumnLimit = false;

  console.log(`tablero de preventivos: ${verificaciones} verificaciones correctas`);
} finally {
  await close();
}
