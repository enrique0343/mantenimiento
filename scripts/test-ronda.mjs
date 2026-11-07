// La ronda de turno: rutas reales, migraciones reales, SQLite en memoria. Sin red.
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';
const beforeMigration = (db, nombre) => { if (nombre.startsWith('0049_fase49')) db.exec("INSERT OR IGNORE INTO usuarios(id,nombre,email,password_hash,rol) VALUES(1000,'Administración','siembra@example.invalid','x','admin')"); };
const f = await setupConjuntos({ beforeMigration, modules: { hoy: 'pages/api/campo/hoy', sync: 'pages/api/campo/sync', rt: 'lib/ronda-turno', ahora: 'lib/ahora', database: 'lib/db', revision: 'pages/api/ronda-turno/revision', puntos: 'pages/api/ronda-turno/puntos' } });
const { app, sqlite, call, queries, faults, ctx } = f;
let casos = 0; const ok = (c, m) => { assert.ok(c, m); casos++; };
const igual = (a, b, m) => { assert.deepEqual(a, b, m); casos++; };
const one = (q, ...a) => sqlite.prepare(q).get(...a); const all = (q, ...a) => sqlite.prepare(q).all(...a);
try {
  faults.enforceColumnLimit = true;
  sqlite.exec("INSERT INTO sucursales(id,nombre,activa) VALUES(1,'Sede 1',1),(2,'Sede 2',1),(3,'Sede 3',1),(4,'Sede 4',1)");
  sqlite.exec("INSERT INTO usuarios(id,nombre,email,password_hash,rol) VALUES(20,'Otro Técnico','otro@example.invalid','x','tecnico')");
  let n = 0; const AHORA = Date.now(); const hace = (m) => new Date(AHORA - m * 60000).toISOString();
  const op = (tipo, at, extra = {}) => ({ opId: `ronda-${++n}-${tipo}`, tipo, at, ...extra });
  const enviar = async (ops, rol = 'tecnico') => { const r = await call(app.sync.POST, '/api/campo/sync', { method: 'POST', data: { ops }, rol }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.resultados; };
  // Como el celular: lo que no cupo en esta vuelta sale en la siguiente.
  const enviarTodas = async (ops) => { let resto = ops; const salida = []; while (resto.length) { const r = await enviar(resto.slice(0, 20)); assert.ok(r.length >= 1); salida.push(...r); resto = resto.slice(r.length); } return salida; };
  const hoy = async (s) => (await call(app.hoy.GET, `/api/campo/hoy?sede=${s}`, { rol: 'tecnico' })).body;
  const db = app.database.getDb(ctx('/x'));
  const p1 = await hoy(1);
  const c1 = { sucursalId: 1, fecha: p1.ronda.fecha, turno: p1.ronda.turno }; const c2 = { ...c1, sucursalId: 2 };
  const pts = p1.ronda.puntos;
  const temp = pts.find((p) => /temperatura/.test(p.texto) && p.pideValor);
  const hum = pts.find((p) => /humedad/.test(p.texto) && p.pideValor);
  const comb = pts.find((p) => /combustible/.test(p.texto));
  const bit = pts.find((p) => /Bitácora/.test(p.texto));
  const cuartos = pts.find((p) => /Cuartos técnicos/.test(p.texto));

  // El recorrido y el paquete
  ok(pts.length === 21 && bit.linea === 1 && temp.min === 20 && temp.max === 22 && hum.min === 50, 'El recorrido sigue el SOP: 21 paradas, línea 1 primero, banda de operación');
  ok(comb.actuarMin === 1440 && bit.pideOrden && cuartos.pideOrden && !temp.pideOrden, 'Reloj propio y líneas que piden orden');
  igual([...new Set(pts.map((p) => p.linea))], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'Las líneas 1 a 10 tienen parada; la 11 es el cierre');
  ok(Array.isArray(p1.ronda.turnos) && p1.ronda.turnos.length === 3, 'El paquete trae los turnos para seguir sin señal');

  // AOP por sede y por parada
  const [a] = await enviar([op('ronda.lectura', hace(50), { ...c1, puntoId: temp.id, resultado: 'ok', valor: 25 })]);
  ok(a.ok && a.datos.eventoId, 'Un número fuera de rango abre el episodio aunque el botón dijera ok');
  const [b] = await enviar([op('ronda.lectura', hace(49), { ...c2, puntoId: temp.id, resultado: 'fuera', valor: 25 })]);
  ok(b.ok && b.datos.eventoId !== a.datos.eventoId, 'La misma parada en otra sede abre su propio episodio');
  const [c] = await enviar([op('ronda.lectura', hace(48), { ...c1, puntoId: hum.id, resultado: 'fuera', valor: 70 })]);
  ok(c.datos.eventoId !== a.datos.eventoId, 'Otra parada del mismo AOP en la misma sede lleva su propio reloj');
  ok((await hoy(2)).desviaciones.length === 1 && (await hoy(1)).desviaciones.length === 2, 'Cada sede ve solo lo suyo en Hoy');
  const ev = one('SELECT * FROM aop_eventos WHERE id=?', a.datos.eventoId);
  ok(ev.detectado_en === hace(50) && ev.sucursal_id === 1 && ev.ronda_punto_id === temp.id, 'El reloj corre desde la hora capturada');
  const [d] = await enviar([op('ronda.lectura', hace(47), { ...c1, puntoId: comb.id, resultado: 'fuera', valor: 10 })]);
  const evC = one('SELECT * FROM aop_eventos WHERE id=?', d.datos.eventoId);
  ok(Date.parse(evC.actuar_antes_de) - Date.parse(evC.detectado_en) === 1440 * 60000, 'Combustible: actuar en 24 h, no en las 4 h del AOP');

  // Hora y libro
  const eid = one('SELECT id FROM ronda_ejecuciones WHERE sucursal_id=1').id;
  const m = one('SELECT * FROM ronda_marcas WHERE ejecucion_id=? AND punto_id=?', eid, temp.id);
  ok(m.ocurrido_en === hace(50) && m.sin_senal === 1 && m.recibido_en > m.ocurrido_en && m.aop_evento_id === a.datos.eventoId, 'La marca guarda hora real, llegada, sin señal y su episodio');
  await enviar([op('ronda.lectura', hace(30), { ...c1, puntoId: hum.id, resultado: 'ok', valor: 55 })]);
  await enviar([op('ronda.lectura', hace(40), { ...c1, puntoId: hum.id, resultado: 'fuera', valor: 99 })]);
  ok(one('SELECT valor v FROM ronda_lecturas WHERE ejecucion_id=? AND punto_id=?', eid, hum.id).v === 55, 'Manda la hora capturada más reciente, no la última en llegar');
  ok(all('SELECT id FROM ronda_marcas WHERE ejecucion_id=? AND punto_id=?', eid, hum.id).length === 3, 'El libro conserva las tres lecturas');
  ok(one('SELECT aop_evento_id x FROM ronda_lecturas WHERE ejecucion_id=? AND punto_id=?', eid, hum.id).x === c.datos.eventoId, 'Corregir a en rango no desliga el episodio');
  ok(one('SELECT estado FROM aop_eventos WHERE id=?', c.datos.eventoId).estado === 'abierto', 'El episodio sigue abierto hasta que alguien lo normalice');
  ok(all('SELECT accion FROM aop_evento_acciones WHERE evento_id=?', c.datos.eventoId).some((x) => /corregida/.test(x.accion)), 'Y queda anotado que la lectura se corrigió');
  const rep = op('ronda.lectura', hace(20), { ...c1, puntoId: bit.id, resultado: 'ok' });
  await enviar([rep]); const [rr] = await enviar([rep]);
  ok(rr.repetida && all('SELECT id FROM ronda_marcas WHERE op_id=?', rep.opId).length === 1, 'Reintentar no duplica la marca');
  assert.throws(() => sqlite.exec('DELETE FROM ronda_marcas')); assert.throws(() => sqlite.exec('UPDATE ronda_marcas SET valor=1')); ok(true, 'El libro no se edita ni se borra');

  // Atomicidad: si el batch falla no queda lectura sin marca, y el reintento la completa
  const alLado = pts.find((p) => !p.pideValor && p.critico && p.id !== bit.id);
  faults.statement = (sql) => /ronda_marcas/.test(sql);
  const opA = op('ronda.lectura', hace(19), { ...c1, puntoId: alLado.id, resultado: 'ok' });
  const fallo = await call(app.sync.POST, '/api/campo/sync', { method: 'POST', data: { ops: [opA] }, rol: 'tecnico' });
  ok(fallo.body.detenido === opA.opId, 'Un fallo pasajero detiene el lote y conserva el orden');
  ok(!one('SELECT 1 u FROM ronda_lecturas WHERE ejecucion_id=? AND punto_id=?', eid, alLado.id), 'Lectura y marca van juntas o no van');
  const [opB] = await enviar([opA]);
  ok(opB.ok && one('SELECT 1 u FROM ronda_lecturas WHERE ejecucion_id=? AND punto_id=?', eid, alLado.id), 'El reintento la completa');

  // El servidor manda
  const pv = pts.find((p) => p.pideValor && ![temp.id, hum.id, comb.id].includes(p.id));
  const noV = pts.find((p) => !p.pideValor && ![bit.id, alLado.id].includes(p.id) && p.critico);
  let [x] = await enviar([op('ronda.lectura', hace(19), { ...c1, puntoId: pv.id, resultado: 'ok' })]);
  ok(!x.ok && /lectura/.test(x.error), 'Una parada numérica no se da por buena sin número');
  [x] = await enviar([op('ronda.lectura', hace(19), { ...c1, puntoId: noV.id, resultado: 'no_verificado' })]);
  ok(!x.ok && /por qué/.test(x.error), '«No pude verificar» exige razón también en el servidor');
  [x] = await enviar([op('ronda.lectura', hace(19), { ...c1, puntoId: noV.id, resultado: 'fuera' })]);
  ok(!x.ok && /qué viste/.test(x.error), '«No conforme» exige decir qué se vio');
  [x] = await enviar([op('ronda.iniciar', hace(5), { sucursalId: 1, fecha: '2020-02-02', turno: '06:00' })]);
  ok(!x.ok, 'Una fecha inventada se rechaza');
  [x] = await enviar([op('ronda.iniciar', hace(5), { sucursalId: 3, fecha: c1.fecha, turno: '03:33' })]);
  ok(!x.ok, 'Un turno inventado se rechaza');
  ok(all("SELECT id FROM ronda_ejecuciones WHERE fecha='2020-02-02' OR turno='03:33'").length === 0, 'Y no deja ejecución');
  [x] = await enviar([op('ronda.cerrar', hace(4), { sucursalId: 1, fecha: '2026-01-01', turno: '06:00', firma: true })]);
  ok(!x.ok && all("SELECT id FROM ronda_ejecuciones WHERE fecha='2026-01-01'").length === 0, 'Cerrar una ronda que no existe no la crea');

  // Un error de datos no bloquea la cola
  const opBloquea = op('ronda.lectura', hace(18), { ...c1, puntoId: pv.id, resultado: 'ok', valor: pv.min ?? pv.max ?? 1 });
  faults.statement = () => { throw new Error('FOREIGN KEY constraint failed'); };
  const [conErr] = await enviar([opBloquea]);
  faults.statement = null;
  ok(!conErr.ok && /jefatura/.test(conErr.error) && one('SELECT payload p FROM campo_operaciones WHERE op_id=?', opBloquea.opId).p, 'Un error que se repetiría queda como rechazo con lo capturado, no detiene el celular');

  // Foto del recorrido
  sqlite.prepare('UPDATE ronda_puntos SET max_esperado=30 WHERE id=?').run(temp.id);
  ok((await hoy(1)).ronda.puntos.find((p) => p.id === temp.id).max === 22, 'Un cambio de rango no toca la ronda abierta');
  sqlite.prepare('UPDATE ronda_puntos SET max_esperado=22 WHERE id=?').run(temp.id);

  // Presupuesto de envío (batch cuenta como una consulta, igual que en D1)
  const hoy3 = await hoy(3);
  const c3 = { sucursalId: 3, fecha: hoy3.ronda.fecha, turno: hoy3.ronda.turno };
  const todas = [op('ronda.iniciar', hace(15), c3), ...hoy3.ronda.puntos.map((p, i) => op('ronda.lectura', hace(14 - i * 0.1), { ...c3, puntoId: p.id, resultado: 'ok', ...(p.pideValor ? { valor: p.min ?? p.max ?? 1 } : {}) }))];
  let pendientes = todas, vueltas = 0, peor = 0;
  while (pendientes.length) {
    const lote = pendientes.slice(0, 20);
    const qAntes = queries.length, bAntes = faults.batchCount;
    const r = await enviar(lote);
    ok(r.length >= 1, 'Cada vuelta avanza');
    pendientes = pendientes.slice(r.length);
    peor = Math.max(peor, queries.length - qAntes);
    vueltas++;
  }
  ok(vueltas > 1 && vueltas <= 4, `Una ronda sin señal sale en pocas vueltas (${vueltas})`);
  // Sentencias por vuelta: el tope de D1 cuenta consultas y un batch es una; aquí se cuentan sentencias.
  ok(peor <= 70, `Sentencias en la peor vuelta: ${peor}`);
  const qAntes = queries.length, bAntes = faults.batchCount;
  const punto3 = hoy3.ronda.puntos[0];
  await enviar([op('ronda.lectura', hace(1), { ...c3, puntoId: punto3.id, resultado: 'ok' })]);
  const sentencias = queries.length - qAntes, batches = faults.batchCount - bAntes;
  console.log(`Lectura normal: ${sentencias} sentencias, ${batches} batch; ${sentencias - 3 * batches + batches} consultas D1 con auth`);

  // Tablero: nunca verde con algo sin verificar
  const hechas = await enviar([op('ronda.cerrar', hace(1), { ...c3, firma: true })]);
  ok(hechas[0].ok, JSON.stringify(hechas[0]));
  let filas = await app.rt.tableroRondas(db);
  const fila = (s) => filas.find((z) => z.sucursalId === s);
  igual(fila(3).estado, 'completa', 'Todo verificado y nada fuera: verde');
  igual(fila(1).estado, 'en_curso'); igual(fila(4).estado, 'sin_iniciar');
  const hoy4 = await hoy(4);
  const c4 = { sucursalId: 4, fecha: hoy4.ronda.fecha, turno: hoy4.ronda.turno };
  await enviarTodas(hoy4.ronda.puntos.map((p, k) => op('ronda.lectura', hace(10 - k * 0.01), { ...c4, puntoId: p.id, resultado: 'no_verificado', nota: 'Quirófano ocupado' })));
  [x] = await enviar([op('ronda.cerrar', hace(1), { ...c4, firma: true })]);
  ok(!x.ok && /quien entra/.test(x.error), 'Con novedades no se firma sin entrega de turno');
  [x] = await enviar([op('ronda.cerrar', hace(1), { ...c4 })]);
  ok(!x.ok && /sin firma/.test(x.error), 'La ronda no se cierra sin firma');
  [x] = await enviar([op('ronda.cerrar', hace(1), { ...c4, firma: true, notas: 'Quirófano ocupado todo el turno.' })]);
  ok(x.ok, JSON.stringify(x));
  filas = await app.rt.tableroRondas(db);
  igual(fila(4).estado, 'con_novedad', 'Todo sin verificar nunca sale verde');
  ok(!app.rt.resumenTablero(filas).todoListo);
  const bloque = await app.ahora.bloqueRonda(db);
  ok(bloque.tono !== 'ok', `La tarjeta del Panorama no dice que está todo en orden (${bloque.tono})`);

  // Cierre, firma y entrega
  const ej = one('SELECT * FROM ronda_ejecuciones WHERE sucursal_id=4');
  ok(ej.completada_por != null && ej.firma_nombre && /ocupado/.test(ej.notas) && ej.recibida_en, 'La firma guarda quién, cuándo, llegada y entrega de turno');
  igual(ej.puntos_no_verificados, 21, 'El contador ya no mezcla no verificado con blanco');
  const siguiente = await hoy(4);
  ok(siguiente.ronda.entregaAnterior === null || siguiente.ronda.estado === 'completada', 'La propia ronda no se entrega a sí misma');
  assert.throws(() => sqlite.prepare("UPDATE ronda_ejecuciones SET notas='cambiada' WHERE id=?").run(ej.id));
  assert.throws(() => sqlite.prepare('UPDATE ronda_lecturas SET valor=1 WHERE ejecucion_id=?').run(ej.id));
  assert.throws(() => sqlite.prepare('DELETE FROM ronda_lecturas WHERE ejecucion_id=?').run(ej.id));
  ok(true, 'La ronda firmada no se edita, ni su firma ni sus lecturas');

  // Lo que llega tras la firma: no toca la ronda, queda en el libro y abre su AOP
  const gases = hoy4.ronda.puntos.find((p) => /presión en la red/.test(p.texto));
  [x] = await enviar([op('ronda.lectura', hace(30), { ...c4, puntoId: gases.id, resultado: 'fuera', valor: 100 })]);
  ok(x.ok && x.datos.tardia && x.datos.eventoId, 'La lectura tardía fuera de rango abre su AOP');
  ok(one('SELECT resultado r FROM ronda_lecturas WHERE ejecucion_id=? AND punto_id=?', ej.id, gases.id).r === 'no_verificado', 'Y no cambia lo firmado');
  ok(all('SELECT id FROM ronda_marcas WHERE ejecucion_id=? AND punto_id=?', ej.id, gases.id).length === 2, 'Pero queda en el libro');

  // Emergencia y correctivo desde la parada
  const [g] = await enviar([op('emergencia.abrir', hace(1), { ...c2, puntoId: temp.id, eop: 'EOP-HVAC-01', titulo: 'x' })]);
  ok(g.ok && g.datos.ordenId, 'La emergencia nace de la parada');
  const lec = one('SELECT l.orden_id o, l.aop_evento_id e FROM ronda_lecturas l JOIN ronda_ejecuciones x ON x.id=l.ejecucion_id WHERE x.sucursal_id=2 AND l.punto_id=?', temp.id);
  const evE = one('SELECT estado, orden_id, escalado_en FROM aop_eventos WHERE id=?', lec.e);
  ok(lec.o === g.datos.ordenId && evE.orden_id === g.datos.ordenId && evE.estado === 'paso_a_eop' && evE.escalado_en === hace(1), 'Lectura, episodio y orden quedan ligados, y el episodio pasa a EOP');
  await enviar([op('ronda.lectura', hace(3), { ...c1, puntoId: cuartos.id, resultado: 'fuera', nota: 'Cajas contra el tablero' })]);
  const [co] = await enviar([op('correctivo.abrir', hace(2), { ...c1, puntoId: cuartos.id, rubro: 'infraestructura', nota: 'Cajas contra el tablero', titulo: 'x' })]);
  ok(co.ok && one('SELECT orden_id o FROM ronda_lecturas WHERE ejecucion_id=? AND punto_id=?', eid, cuartos.id).o === co.datos.ordenId, 'El correctivo de una parada que pide orden queda ligado');
  ok(all('SELECT id FROM aop_eventos WHERE ronda_punto_id=?', cuartos.id).length === 0, 'Bitácora y cuartos técnicos no abren AOP');

  // Por sede
  const sede = async (data, rol = 'admin') => { const c = ctx('/api/ronda-turno/puntos', { method: 'PUT', data, rol }); const r = await app.puntos.PUT(c); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  let s = await sede({ sucursalId: 2 }, 'tecnico');
  ok(s.status === 403, 'Solo jefatura ajusta el recorrido');
  s = await sede({ sucursalId: 2, turnos: ['06:00', '14:00'] });
  ok(s.status === 200 && s.body.ronda.sucursal_id !== null, JSON.stringify(s.body));
  const r2 = one("SELECT id FROM rondas WHERE sucursal_id=2").id;
  ok(one('SELECT count(*) n FROM ronda_puntos WHERE ronda_id=?', r2).n === 23, 'El recorrido propio copia las paradas del modelo');
  const h2 = await hoy(2);
  ok(h2.ronda.turnos.join() === '06:00,14:00', 'Y usa sus propios turnos');
  if (h2.ronda.turno === c2.turno) ok(h2.ronda.puntos[0].id < 1000 && h2.ronda.ejecucionId, 'La ronda ya abierta conserva lo que decía al abrir');
  await sede({ sucursalId: 2, activa: false });
  ok((await hoy(2)).ronda === null, 'Una sede que no hace ronda queda fuera de la obligación');
  filas = await app.rt.tableroRondas(db, { fecha: '2000-01-01', turno: '06:00' });
  igual(fila(2).estado, 'no_aplica');
  await sede({ sucursalId: 2, activa: true });

  // Revisión semanal
  const lunes = (d) => { const t = new Date(`${d}T12:00:00Z`); return new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10); };
  const hoyFecha = new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
  sqlite.prepare('UPDATE rondas SET vigente_desde=?').run('2000-01-01');
  const estaSemana = lunes(hoyFecha);
  const pasada = new Date(Date.parse(`${estaSemana}T12:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
  const firmar = async (data, rol, id) => { const c = ctx('/api/ronda-turno/revision', { method: 'POST', data, rol }); const r = await app.revision.POST(c); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  let v = await firmar({ sucursalId: 1, semana: estaSemana }, 'jefe');
  ok(v.status === 409 && /no termina/.test(v.body.error), 'Una semana que no ha terminado no se firma');
  v = await firmar({ sucursalId: 1, semana: pasada }, 'jefe');
  ok(v.status === 400 && /excepciones/.test(v.body.error), 'Con turnos sin hacer, la observación es obligatoria');
  v = await firmar({ sucursalId: 1, semana: pasada, observaciones: 'Faltó personal' }, 'tecnico');
  ok(v.status === 403, 'El técnico no firma la revisión');
  v = await firmar({ sucursalId: 1, semana: pasada, observaciones: 'Faltó personal' }, 'jefe');
  ok(v.status === 200, JSON.stringify(v.body));
  const rev = one('SELECT * FROM ronda_revisiones WHERE sucursal_id=1');
  igual(rev.esperadas, 21, '7 días por 3 turnos'); igual(rev.no_hechas, 21);
  assert.throws(() => sqlite.exec('UPDATE ronda_revisiones SET no_hechas=0')); assert.throws(() => sqlite.exec('DELETE FROM ronda_revisiones')); ok(true, 'La revisión firmada no se edita');
  v = await firmar({ sucursalId: 1, semana: pasada, observaciones: 'Otra vez' }, 'jefe');
  ok(v.status === 409, 'Una segunda firma se rechaza');
  // Independencia: quien hizo rondas esa semana en esa sede no la revisa.
  sqlite.prepare("INSERT INTO ronda_ejecuciones(ronda_id,sucursal_id,fecha,turno,estado) SELECT id,3,?,'06:00','en_curso' FROM rondas WHERE codigo='RONDA-TURNO'").run(pasada);
  const ejP = one('SELECT id FROM ronda_ejecuciones WHERE sucursal_id=3 AND fecha=?', pasada).id;
  const jefe = one("SELECT id FROM usuarios WHERE rol='jefe' LIMIT 1").id;
  sqlite.prepare("INSERT INTO ronda_marcas(ejecucion_id,punto_id,resultado,ocurrido_en,recibido_en,usuario_id) VALUES(?,?,'ok',?,?,?)").run(ejP, bit.id, pasada, pasada, jefe);
  v = await firmar({ sucursalId: 3, semana: pasada, observaciones: 'Revisada' }, 'jefe');
  ok(v.status === 403 && /otra persona/.test(v.body.error), 'Quien hizo rondas esa semana no la revisa');
  v = await firmar({ sucursalId: 3, semana: pasada, observaciones: 'Revisada' }, 'admin');
  ok(v.status === 200, 'Otra jefatura sí');
  console.log(`PASS test-ronda: ${casos} casos; rutas y migraciones reales, sin red.`);
} finally { await f.close(); }
