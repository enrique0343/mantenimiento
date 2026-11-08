// La ronda de turno: rutas reales, migraciones reales, SQLite en memoria. Sin red.
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';
import { fijarReloj } from './test-support/reloj.mjs';

fijarReloj();
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
  // Lo esperado se calcula aquí, aparte del código, para que valga a cualquier hora de RELOJ_PRUEBA.
  const masDias = (f, k) => new Date(Date.parse(`${f}T12:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
  const inicio = (f, tt) => Date.parse(`${f}T${tt}:00-06:00`);
  const isoDe = (x) => new Date(inicio(x.fecha, x.turno)).toISOString();
  const proximo = (lista) => { const ya = Date.now(), f0 = new Date(ya - 6 * 3600000).toISOString().slice(0, 10); for (const f of [masDias(f0, -1), f0, masDias(f0, 1)]) for (const tt of lista) if (inicio(f, tt) >= ya) return { fecha: f, turno: tt }; };
  const despuesDe = (x) => new Date(inicio(x.fecha, x.turno) + 30 * 60000).toISOString();
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
  igual(p1.ronda.turnosProximos, null, 'Sin cambio de turnos pendiente, no hay turnos próximos');

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

  // Por sede: el recorrido propio copia el modelo y deja de recibir sus cambios
  const pedir = (metodo) => async (data, rol = 'admin') => { const c = ctx('/api/ronda-turno/puntos', { method: metodo, data, rol }); const r = await app.puntos[metodo](c); const t = await r.text(); let body; try { body = JSON.parse(t); } catch { body = t; } return { status: r.status, body }; };
  const put = pedir('PUT'), patch = pedir('PATCH'), post = pedir('POST');
  let s = await put({ accion: 'crear_propio', sucursalId: 2 }, 'tecnico');
  ok(s.status === 403, 'Solo jefatura ajusta el recorrido');
  ok((await put({ accion: 'crear_propio', sucursalId: 2 }, 'visualizador')).status === 403, 'El visualizador tampoco');
  s = await put({ sucursalId: 2, turnos: ['06:00'] });
  igual(s.body.error, 'Acción desconocida: usa «turnos», «crear_propio» o «hace_ronda».', 'Un pedido sin acción se contesta con una frase, no con un objeto');
  const modeloId = one("SELECT id FROM rondas WHERE codigo='RONDA-TURNO'").id;
  const ordenDe = (rid) => all('SELECT id, etiqueta FROM ronda_puntos WHERE ronda_id=? ORDER BY orden, id', rid);
  const modeloAntes = ordenDe(modeloId);
  faults.statement = (q) => /INSERT INTO ronda_vigencias/.test(q);
  await assert.rejects(() => put({ accion: 'crear_propio', sucursalId: 4 }));
  ok(!one('SELECT id FROM rondas WHERE sucursal_id=4') && one('SELECT count(*) n FROM ronda_puntos').n === modeloAntes.length, 'Crear el recorrido propio es todo o nada');
  s = await put({ accion: 'crear_propio', sucursalId: 2 });
  ok(s.status === 200 && s.body.ronda.sucursalId === 2 && s.body.ronda.activa, JSON.stringify(s.body));
  const r2 = s.body.ronda.id;
  igual(ordenDe(r2).map((x) => x.etiqueta), modeloAntes.map((x) => x.etiqueta), 'El recorrido propio copia las paradas del modelo, en su orden');
  ok((await put({ accion: 'crear_propio', sucursalId: 2 })).body.yaExistia && all('SELECT id FROM rondas WHERE sucursal_id=2').length === 1, 'Pedirlo otra vez no lo duplica');
  const entraPropio = proximo(['06:00', '14:00']);
  s = await put({ accion: 'turnos', rondaId: r2, turnos: ['06:00', '14:00'] });
  ok(s.status === 200 && s.body.aplicaDesde, JSON.stringify(s.body));
  igual(s.body.aplicaDesde, entraPropio, 'Entran con el primer turno de la lista nueva');
  const h2 = await hoy(2);
  igual(h2.ronda.turnosProximos, { desde: isoDe(entraPropio), turnos: ['06:00', '14:00'] }, 'Y usa sus propios turnos desde que entran');
  igual(h2.ronda.turnos, ['06:00', '14:00', '22:00'], 'Hasta entonces rigen los de antes');
  const delModelo = new Set(modeloAntes.map((x) => x.id));
  if (h2.ronda.turno === c2.turno) ok(h2.ronda.ejecucionId && h2.ronda.puntos.every((p) => delModelo.has(p.id)), 'La ronda ya abierta conserva lo que decía al abrir');

  // Revisión semanal
  const lunes = (d) => { const t = new Date(`${d}T12:00:00Z`); return new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10); };
  const hoyFecha = new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
  sqlite.prepare('UPDATE rondas SET vigente_desde=?').run('2000-01-01');
  // La semana del turno que corre: el lunes de madrugada todavía es la del domingo.
  const estaSemana = lunes(c1.fecha);
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

  // ── Configurar la ronda: cada parada se edita completa ─────────────────────
  const parada = (id) => one('SELECT * FROM ronda_puntos WHERE id=?', id);
  const tempPropia = one("SELECT id FROM ronda_puntos WHERE ronda_id=? AND etiqueta='Quirófanos · temperatura'", r2).id;
  ok((await patch({ id: tempPropia, maxEsperado: 30 }, 'tecnico')).status === 403, 'El técnico no edita paradas');
  ok((await post({ rondaId: r2, sistema: 'otro', etiqueta: 'Parada de prueba' }, 'visualizador')).status === 403, 'Ni las agrega');
  const sop = one("SELECT id FROM procedimientos WHERE tipo='sop' LIMIT 1").id;
  const otroAop = one("SELECT id FROM procedimientos WHERE tipo='aop' AND id <> ? ORDER BY id LIMIT 1", parada(tempPropia).aop_procedimiento_id).id;
  const nuevo = { etiqueta: 'Quirófanos · temperatura de sala', instruccion: 'Lee el termómetro de pared de cada quirófano.', sistema: 'minisplit', unidad: '°F', minEsperado: 18, maxEsperado: 24, aopProcedimientoId: otroAop, critico: false, fuente: 'SCP-HVAC-01 v2', lineaSop: 6, minutosActuar: 30, minutosEscalar: 90 };
  const columna = { etiqueta: 'etiqueta', instruccion: 'instruccion', sistema: 'sistema', unidad: 'unidad', minEsperado: 'min_esperado', maxEsperado: 'max_esperado', aopProcedimientoId: 'aop_procedimiento_id', critico: 'critico', fuente: 'fuente', lineaSop: 'linea_sop', minutosActuar: 'minutos_actuar', minutosEscalar: 'minutos_escalar' };
  const antesTemp = parada(tempPropia);
  let e = await patch({ id: tempPropia, ...nuevo });
  ok(e.status === 200, JSON.stringify(e.body));
  for (const [k, col] of Object.entries(columna)) {
    igual(parada(tempPropia)[col], typeof nuevo[k] === 'boolean' ? Number(nuevo[k]) : nuevo[k], `Se edita ${k}`);
    igual(e.body.cambios[k], { antes: typeof nuevo[k] === 'boolean' ? !!antesTemp[col] : antesTemp[col], despues: nuevo[k] }, `La auditoría de ${k} lleva lo de antes y lo de después`);
  }
  ok(!('activo' in e.body.cambios) && !('requiereValor' in e.body.cambios), 'Lo que no cambió no se anota');
  e = await patch({ id: tempPropia, requiereValor: false, valorEsperadoTexto: '  Sala entre 18 y 24 °C  ' });
  let t = parada(tempPropia);
  ok(e.status === 200 && t.requiere_valor === 0 && t.min_esperado === null && t.max_esperado === null && t.unidad === null && t.valor_esperado_texto === 'Sala entre 18 y 24 °C', 'Pasar a conforme guarda el texto y no deja rango ni unidad escondidos');
  e = await patch({ id: tempPropia, requiereValor: true, minEsperado: 20, maxEsperado: 22, unidad: '°C' });
  t = parada(tempPropia);
  ok(e.status === 200 && t.requiere_valor === 1 && t.valor_esperado_texto === null && t.min_esperado === 20 && t.unidad === '°C', 'Volver a número no deja el texto esperado');
  e = await patch({ id: tempPropia, instruccion: '', fuente: null });
  ok(e.status === 200 && parada(tempPropia).instruccion === null && parada(tempPropia).fuente === null, 'Un texto vacío queda vacío');
  e = await patch({ id: tempPropia, activo: false });
  ok(e.status === 200 && parada(tempPropia).activo === 0, 'Una parada se desactiva');
  e = await patch({ id: tempPropia, activo: true, critico: true });
  ok(e.status === 200 && parada(tempPropia).activo === 1 && parada(tempPropia).critico === 1, 'Y se vuelve a activar');
  e = await patch({ id: tempPropia, critico: true });
  ok(e.status === 200 && Object.keys(e.body.cambios).length === 0, 'Guardar sin cambios no anota nada');

  // El rango se valida con lo que va a quedar, no con lo que había
  e = await patch({ id: tempPropia, minEsperado: null, maxEsperado: 15 });
  ok(e.status === 200 && parada(tempPropia).min_esperado === null && parada(tempPropia).max_esperado === 15, 'Vaciar el mínimo y bajar el máximo en un solo guardado se acepta');
  e = await patch({ id: tempPropia, minEsperado: 16 });
  ok(e.status === 400 && e.body.error === 'El mínimo no puede ser mayor que el máximo.' && parada(tempPropia).min_esperado === null, 'Un mínimo nuevo contra el máximo que quedó se rechaza y no guarda nada');
  e = await patch({ id: tempPropia, minEsperado: 10, maxEsperado: 5 });
  ok(e.status === 400 && parada(tempPropia).max_esperado === 15, 'Dos límites nuevos al revés se rechazan');
  ok((await patch({ id: tempPropia, minEsperado: 20, maxEsperado: 22 })).status === 200, 'Y un rango correcto se guarda');

  // Los errores llegan como una frase que la pantalla muestra tal cual
  for (const [data, msg] of [
    [{ id: tempPropia, minEsperado: 'veinte' }, 'El mínimo tiene que ser un número.'],
    [{ id: tempPropia, etiqueta: 'ab' }, 'Escribe qué se verifica: al menos 3 caracteres.'],
    [{ id: tempPropia, sistema: 'cocina' }, 'Elige la familia de la parada.'],
    [{ id: tempPropia, lineaSop: 12 }, 'La línea del SOP va de 1 a 11.'],
    [{ id: tempPropia, minutosActuar: 0 }, 'Minutos para actuar: tienen que ser más de cero.'],
    [{ id: tempPropia, minutosActuar: 120 }, 'Los minutos para escalar no pueden ser menos que los minutos para actuar.'],
    [{ id: tempPropia, aopProcedimientoId: sop }, 'Ese documento no es un AOP: elige uno de la lista.'],
    [{ id: tempPropia, aopProcedimientoId: 999999 }, 'Ese AOP no existe.'],
    [{ id: tempPropia, minimo: 3 }, 'Campo desconocido: minimo.'],
    [{ id: 999999, critico: true }, 'La parada no existe.'],
    [null, 'No se entendió lo que se envió.'],
  ]) { e = await patch(data); ok(e.status >= 400 && e.body.error === msg, `Error tal cual: «${msg}» (${JSON.stringify(e.body)})`); }

  // Subir y bajar; borrar no: desactivar
  const ids = () => ordenDe(r2).map((x) => x.id);
  const o0 = ids(), segunda = o0[1];
  ok((await patch({ id: segunda, mover: 'subir' })).status === 200 && ids()[0] === segunda && ids()[1] === o0[0], 'Subir la pone un puesto arriba');
  igual(all('SELECT orden FROM ronda_puntos WHERE ronda_id=? ORDER BY orden, id', r2).map((x) => x.orden), o0.map((_, k) => k + 1), 'El recorrido queda numerado de corrido');
  e = await patch({ id: segunda, mover: 'subir' });
  ok(e.status === 409 && e.body.error === 'Ya es la primera parada del recorrido.', 'La primera no sube');
  ok((await patch({ id: segunda, mover: 'bajar' })).status === 200, 'Bajar');
  igual(ids(), o0, 'Bajar la devuelve a su puesto');
  e = await patch({ id: o0.at(-1), mover: 'bajar' });
  ok(e.status === 409 && e.body.error === 'Ya es la última parada del recorrido.', 'La última no baja');
  igual((await patch({ id: segunda, mover: 'arriba' })).body.error, 'Mover: «subir» o «bajar».');
  igual(ordenDe(modeloId), modeloAntes, 'Mover en el recorrido propio no toca el modelo');
  ok((await patch({ id: segunda, activo: false })).status === 200 && parada(segunda).activo === 0, 'Para quitar una parada se desactiva');

  // Agregar al final, con todos sus campos
  e = await post({ rondaId: r2, sistema: 'agua', etiqueta: 'Cisterna de reserva · nivel', requiereValor: true, unidad: '%', minEsperado: 40, maxEsperado: null, valorEsperadoTexto: 'no aplica a una numérica', aopProcedimientoId: otroAop, critico: true, fuente: 'SCP-AGU-01', lineaSop: 7, minutosActuar: 60, minutosEscalar: 240 });
  ok(e.status === 200 && ids().at(-1) === e.body.punto.id, 'La parada nueva queda al final del recorrido');
  const cisterna = e.body.punto;
  ok(cisterna.valorEsperadoTexto === null && cisterna.unidad === '%' && cisterna.minEsperado === 40 && cisterna.minutosEscalar === 240 && cisterna.lineaSop === 7 && cisterna.activo === true, 'Con todos sus campos');
  igual((await post({ rondaId: r2, etiqueta: 'Sin familia' })).body.error, 'Elige la familia de la parada.');
  igual((await post({ rondaId: r2, sistema: 'agua' })).body.error, 'Escribe qué se verifica.');
  igual((await post({ rondaId: r2, sistema: 'agua', etiqueta: 'Rango al revés', requiereValor: true, minEsperado: 5, maxEsperado: 1 })).body.error, 'El mínimo no puede ser mayor que el máximo.');
  igual((await post({ rondaId: 999999, sistema: 'agua', etiqueta: 'Recorrido que no existe' })).body.error, 'El recorrido no existe.');
  const abierta = await hoy(2);
  if (abierta.ronda.turno === c2.turno) ok(abierta.ronda.puntos.some((p) => p.texto === 'Quirófanos · temperatura') && !abierta.ronda.puntos.some((p) => p.id === cisterna.id), 'La ronda que ya empezó conserva lo que decía al abrir');

  // Turnos del modelo
  for (const [turnos, msg] of [
    [['06:00', '25:00'], 'Hora inválida: «25:00». Usa HH:MM, por ejemplo 06:00.'],
    [['6.00'], 'Hora inválida: «6.00». Usa HH:MM, por ejemplo 06:00.'],
    [[], 'Escribe al menos un turno, por ejemplo 06:00.'],
  ]) { s = await put({ accion: 'turnos', rondaId: modeloId, turnos }); ok(s.status === 400 && s.body.error === msg, `La hora inválida llega a la pantalla: «${msg}»`); }

  // Esta sede no hace ronda: sin copiar el modelo, y entra en el turno que todavía no empezó.
  const sigDe3 = proximo(['06:00', '14:00', '22:00']);
  s = await put({ accion: 'hace_ronda', sucursalId: 3, haceRonda: false });
  ok(s.status === 200 && s.body.sede.haceRonda === false, JSON.stringify(s.body));
  igual(s.body.aplicaDesde, sigDe3, 'Entra en el turno que todavía no empezó');
  igual(s.body.cambios, { haceRonda: { antes: true, despues: false } });
  ok(!one('SELECT id FROM rondas WHERE sucursal_id=3') && one('SELECT hace_ronda h FROM sucursales WHERE id=3').h === 0, 'Sin copiar el modelo');
  const vig = one('SELECT * FROM ronda_vigencias WHERE sucursal_id=3');
  ok(vig.hace_ronda_antes === 1 && vig.usuario_id === 1 && Date.parse(vig.hasta) <= Date.now(), 'Queda escrito lo que regía, cuándo cambió y quién lo cambió');
  assert.throws(() => sqlite.exec('UPDATE ronda_vigencias SET hace_ronda_antes=0')); assert.throws(() => sqlite.exec('DELETE FROM ronda_vigencias')); ok(true, 'Eso no se edita ni se borra');
  ok((await hoy(3)).ronda?.turno === c3.turno, 'La ronda del turno que ya empezó sigue en el celular');
  filas = await app.rt.tableroRondas(db);
  ok(fila(3).haceRonda && fila(3).estado === 'completa', 'Y en el tablero cuenta como siempre');
  filas = await app.rt.tableroRondas(db, sigDe3);
  ok(!fila(3).haceRonda && fila(3).estado === 'no_aplica', 'Desde el turno siguiente el tablero no se la exige');
  let sem = await app.rt.resumenSemana(db, 3, pasada);
  ok(sem.esperadas === 21 && !sem.haceRonda, `La semana pasada se revisa con lo que regía entonces (${sem.esperadas} esperadas)`);

  // Turnos del modelo: entran en el turno que todavía no empezó y no reescriben la semana
  const nuevoTurno = proximo(['06:00', '18:00']);
  s = await put({ accion: 'turnos', rondaId: modeloId, turnos: ['18:00', '6:00', '18:00'] });
  ok(s.status === 200 && s.body.ronda.turnos === '["06:00","18:00"]', '«6:00» es 06:00, sin repetidos y en orden');
  igual(s.body.aplicaDesde, nuevoTurno, 'Los turnos nuevos entran en el turno que todavía no empezó');
  const cambioMs = Date.parse(one('SELECT hasta FROM ronda_vigencias WHERE ronda_id=?', modeloId).hasta);
  igual(s.body.cambios.turnos, { antes: ['06:00', '14:00', '22:00'], despues: ['06:00', '18:00'] }, 'La auditoría lleva los turnos de antes y los de después');
  ok(one('SELECT turnos_antes t FROM ronda_vigencias WHERE ronda_id=?', modeloId).t === '["06:00","14:00","22:00"]', 'Lo que regía queda escrito');
  const entraMs = inicio(nuevoTurno.fecha, nuevoTurno.turno);
  const p4 = (await hoy(4)).ronda;
  igual(p4.turnosProximos, { desde: isoDe(nuevoTurno), turnos: ['06:00', '18:00'] }, 'Las sedes que usan el modelo reciben sus turnos desde que empieza el primero de la lista nueva');
  igual(p4.turnos, ['06:00', '14:00', '22:00'], 'El turno de ahora sigue con los de antes');
  const p2 = (await hoy(2)).ronda;
  igual(p2.turnosProximos?.turnos ?? p2.turnos, ['06:00', '14:00'], 'El recorrido propio no recibe cambios del modelo');
  sem = await app.rt.resumenSemana(db, 1, pasada);
  ok(sem.esperadas === 21 && sem.turnos.join() === '06:00,14:00,22:00', `La semana pasada se revisa con los turnos que regían (${sem.turnos.join()})`);
  const dias = Array.from({ length: 7 }, (_, k) => masDias(estaSemana, k));
  const viejos = ['06:00', '14:00', '22:00'], nuevos = ['06:00', '18:00'];
  // Los de antes rigen hasta que empieza el primer turno de la lista nueva, no hasta el momento del cambio.
  const filasSemana = [...new Set([...viejos, ...nuevos])].sort().filter((tt) => dias.some((f) => (viejos.includes(tt) && inicio(f, tt) < entraMs) || (nuevos.includes(tt) && inicio(f, tt) >= entraMs) || (f === c1.fecha && tt === c1.turno)));
  igual((await app.rt.resumenSemana(db, 1, estaSemana)).turnos, filasSemana, 'Esta semana se ven los turnos que rigieron cada día, ni más ni menos');

  // Ya en el turno nuevo del modelo
  fijarReloj(despuesDe(nuevoTurno));
  ok((await hoy(3)).ronda === null, 'En el turno siguiente el celular no le ofrece ronda a la sede que no hace ronda');
  [x] = await enviar([op('ronda.iniciar', new Date().toISOString(), { sucursalId: 3, ...nuevoTurno })]);
  ok(!x.ok && !one('SELECT id FROM ronda_ejecuciones WHERE sucursal_id=3 AND fecha=? AND turno=?', nuevoTurno.fecha, nuevoTurno.turno), 'Y el servidor no le abre una');
  ok(await app.rt.rondaDeSede(db, 3, { fecha: c3.fecha, turno: c3.turno }), 'Un turno que ya empezó se juzga con lo que regía al empezar');
  filas = await app.rt.tableroRondas(db);
  ok(fila(3).turno === nuevoTurno.turno && fila(3).estado === 'no_aplica' && !fila(3).haceRonda, 'En el tablero no se le exige');
  ok(fila(4).turno === nuevoTurno.turno && fila(4).estado === 'sin_iniciar' && fila(4).haceRonda, 'El turno nuevo del modelo ya se exige');
  const lunesDe = (d) => lunes(d);
  sem = await app.rt.resumenSemana(db, 1, lunesDe(nuevoTurno.fecha));
  const quitadas = sem.celdas.filter((c) => ['14:00', '22:00'].includes(c.turno) && inicio(c.fecha, c.turno) >= entraMs && inicio(c.fecha, c.turno) < Date.now());
  ok(quitadas.every((c) => c.estado === 'no_aplica'), `Los turnos que se quitaron no salen como «no se hizo» desde que entran los nuevos (${quitadas.length})`);
  const siguen = sem.celdas.filter((c) => viejos.includes(c.turno) && inicio(c.fecha, c.turno) > cambioMs && inicio(c.fecha, c.turno) < entraMs && !(c.fecha === c1.fecha && c.turno === c1.turno));
  ok(siguen.every((c) => c.estado === 'no_se_hizo'), `Lo que empezó después del cambio y antes de que entrara se exige con los turnos de antes (${siguen.map((c) => c.turno).join()})`);
  const celda = (r, x) => r.celdas.find((c) => c.fecha === x.fecha && c.turno === x.turno)?.estado ?? 'no_aplica';
  ok(celda(await app.rt.resumenSemana(db, 3, lunesDe(c3.fecha)), c3) === 'completa', 'La sede que no hace ronda: lo que ya hizo se sigue viendo');
  ok(celda(await app.rt.resumenSemana(db, 3, lunesDe(nuevoTurno.fecha)), nuevoTurno) === 'no_aplica', 'Y lo de después no se le exige');
  const h2b = await hoy(2);
  if (h2b.ronda.fecha === c2.fecha && h2b.ronda.turno === c2.turno) {
    // Con RELOJ_PRUEBA de tarde, el recorrido propio sigue en el turno que ya se abrió: conserva lo que decía al abrir.
    ok(h2b.ronda.ejecucionId && h2b.ronda.puntos.every((p) => delModelo.has(p.id)), 'La ronda que ya empezó conserva lo que decía al abrir');
  } else {
    ok(!h2b.ronda.ejecucionId, `El recorrido propio está en un turno que todavía no se abre (${h2b.ronda.fecha} ${h2b.ronda.turno})`);
    ok(h2b.ronda.puntos.some((p) => p.texto === nuevo.etiqueta && p.min === 20 && p.max === 22) && !h2b.ronda.puntos.some((p) => p.id === segunda) && h2b.ronda.puntos.at(-1).id === cisterna.id, 'La ronda que todavía no empezó trae lo editado, sin la desactivada y con la nueva al final');
    igual(h2b.ronda.puntos.map((p) => p.id), all('SELECT id FROM ronda_puntos WHERE ronda_id=? AND activo=1 ORDER BY orden, id', r2).map((x) => x.id), 'Solo las activas, en el orden del recorrido');
  }

  const vuelve = proximo(['06:00', '18:00']);
  s = await put({ accion: 'hace_ronda', sucursalId: 3, haceRonda: true });
  igual(s.body.aplicaDesde, vuelve, 'Volver a hacer ronda también entra en el turno que todavía no empezó');
  ok((await hoy(3)).ronda === null, 'El turno de ahora sigue como estaba');
  ok((await app.rt.resumenSemana(db, 3, pasada)).esperadas === 21, 'Dos cambios seguidos no borran lo que se debía antes');
  fijarReloj(despuesDe(vuelve));
  ok((await hoy(3)).ronda?.turno === vuelve.turno, 'Y en el turno siguiente vuelve la ronda');
  igual(app.rt.vigenteAl([{ hasta: '2026-01-02T00:00:00Z', antes: 'b' }, { hasta: '2026-01-01T00:00:00Z', antes: 'a' }], 'c', Date.parse('2025-12-31T00:00:00Z')), 'a', 'Rige lo de antes del primer cambio posterior');
  igual(app.rt.vigenteAl([{ hasta: '2026-01-01T00:00:00Z', antes: 'a' }], 'c', Date.parse('2026-01-01T00:00:00Z')), 'c', 'Un turno que empieza en el momento del cambio ya entra con lo nuevo');
} finally { await f.close(); }

// ══ La línea de tiempo de los turnos ══════════════════════════════════════════
// Un cambio de turnos entra cuando empieza el primer turno de la lista nueva: el
// turno que corre sigue hasta ahí, con su ronda, en el celular, en el servidor,
// en el tablero y en la semana. Cada caso en una base nueva, con su reloj fijo.
const D = '2026-11-10'; // martes; su semana empieza el lunes 09/11/2026
const dia = (k) => new Date(Date.parse(`${D}T12:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
const en = (hhmm, k = 0) => new Date(Date.parse(`${dia(k)}T${hhmm}:00-06:00`)).toISOString();
const lunesDeD = '2026-11-09';
async function escenario(desde, fn) {
  fijarReloj(en(desde));
  const x = await setupConjuntos({ beforeMigration, modules: { hoy: 'pages/api/campo/hoy', sync: 'pages/api/campo/sync', rt: 'lib/ronda-turno', database: 'lib/db', puntos: 'pages/api/ronda-turno/puntos' } });
  try {
    x.sqlite.exec("INSERT INTO sucursales(id,nombre,activa) VALUES(1,'Sede 1',1)");
    x.sqlite.exec("UPDATE rondas SET vigente_desde='2020-01-01'");
    const db = x.app.database.getDb(x.ctx('/x'));
    let k = 0;
    const e = {
      x, db,
      reloj: (hhmm, d = 0) => fijarReloj(en(hhmm, d)),
      op: (tipo, at, extra = {}) => ({ opId: `linea-${++k}-${tipo}`, tipo, at, ...extra }),
      hoy: async () => (await x.call(x.app.hoy.GET, '/api/campo/hoy?sede=1', { rol: 'tecnico' })).body.ronda,
      sync: async (ops) => (await x.call(x.app.sync.POST, '/api/campo/sync', { method: 'POST', data: { ops }, rol: 'tecnico' })).body.resultados,
      put: async (data) => { const r = await x.app.puntos.PUT(x.ctx('/api/ronda-turno/puntos', { method: 'PUT', data, rol: 'jefe' })); return { status: r.status, body: await r.json() }; },
      fila: async (pedido) => (await x.app.rt.tableroRondas(db, pedido)).find((z) => z.sucursalId === 1),
      semana: async () => { const r = await x.app.rt.resumenSemana(db, 1, lunesDeD); return { r, celda: (fecha, turno) => r.celdas.find((c) => c.fecha === fecha && c.turno === turno)?.estado ?? 'sin fila' }; },
      ejecucion: (fecha, turno) => x.sqlite.prepare('SELECT * FROM ronda_ejecuciones WHERE sucursal_id=1 AND fecha=? AND turno=?').get(fecha, turno),
      modeloId: x.sqlite.prepare('SELECT id FROM rondas WHERE sucursal_id IS NULL').get().id,
      // Lecturas «conforme» de las primeras paradas, como las manda el celular.
      lecturas: (ronda, clave, at, n = 3) => ronda.puntos.slice(0, n).map((pt) => e.op('ronda.lectura', at, { ...clave, puntoId: pt.id, resultado: 'ok', ...(pt.pideValor ? { valor: pt.min ?? pt.max ?? 1 } : {}) })),
    };
    await fn(e);
  } finally { await x.close(); }
}
const NO_CUADRA = /no cuadran/;

// (1) 06:00, 14:00 y 22:00; a las 15:10 se guardan 06:00 y 18:00: entran a las 18:00.
await escenario('15:00', async (e) => {
  let p = await e.hoy();
  igual([p.fecha, p.turno, p.turnosProximos], [D, '14:00', null], '(1) A las 15:00 corre el de las 14:00');
  const clave = { sucursalId: 1, fecha: D, turno: '14:00' };
  const sinSenal = e.lecturas(p, clave, en('15:05'));
  e.reloj('15:10');
  const s = await e.put({ accion: 'turnos', rondaId: e.modeloId, turnos: ['06:00', '18:00'] });
  igual(s.body.aplicaDesde, { fecha: D, turno: '18:00' }, '(1) Entran a las 18:00, con el primer turno de la lista nueva');
  e.reloj('15:15');
  const r = await e.sync(sinSenal);
  ok(r.length === 3 && r.every((y) => y.ok), `(1) Las lecturas sin señal de las 15:05 que llegan a las 15:15 se aceptan: ${JSON.stringify(r)}`);
  ok(e.ejecucion(D, '14:00')?.puntos_ok === 3, '(1) En la ronda de las 14:00');
  p = await e.hoy();
  igual([p.fecha, p.turno, Object.keys(p.lecturas).length], [D, '14:00', 3], '(1) El paquete sigue en el turno de las 14:00, con su ronda empezada');
  ok(p.ejecucionId === e.ejecucion(D, '14:00').id, '(1) La misma ronda, no una nueva');
  igual(p.turnos, ['06:00', '14:00', '22:00'], '(1) Con los turnos que rigen ahora');
  igual(p.turnosProximos, { desde: en('18:00'), turnos: ['06:00', '18:00'] }, '(1) Y los que entran a las 18:00');
  igual(e.x.app.rt.turnoConProximos(p.turnos, p.turnosProximos, new Date(en('17:59'))).turno, '14:00', '(1) El celular sin señal sigue en las 14:00 hasta las 18:00');
  igual(e.x.app.rt.turnoConProximos(p.turnos, p.turnosProximos, new Date(en('18:00'))).turno, '18:00', '(1) Y a las 18:00 pasa al turno nuevo');
  let t = await e.fila();
  igual([t.turno, t.estado], ['14:00', 'en_curso'], '(1) El tablero muestra la de las 14:00 en curso');
  const [mas] = await e.sync([e.op('ronda.lectura', en('15:16'), { ...clave, puntoId: p.puntos[3].id, resultado: 'ok', ...(p.puntos[3].pideValor ? { valor: p.puntos[3].min ?? 1 } : {}) })]);
  ok(mas.ok && e.x.sqlite.prepare('SELECT count(*) n FROM ronda_ejecuciones').get().n === 1, '(1) La lectura siguiente va a la misma ronda: no abre un turno que no se exige');
  e.reloj('18:01');
  p = await e.hoy();
  igual([p.fecha, p.turno, p.turnos, p.turnosProximos, p.ejecucionId], [D, '18:00', ['06:00', '18:00'], null, null], '(1) A las 18:00 corre el de las 18:00');
  t = await e.fila();
  igual([t.turno, t.estado], ['18:00', 'sin_iniciar'], '(1) Y el tablero lo exige');
  igual((await e.fila({ fecha: D, turno: '14:00' })).estado, 'incompleta', '(1) La de las 14:00 terminó a las 18:00 sin cerrarse');
  e.reloj('22:10');
  igual((await e.fila({ fecha: D, turno: '22:00' })).estado, 'no_aplica', '(1) El de las 22:00 ya no se exige');
  const [x22] = await e.sync([e.op('ronda.iniciar', en('22:05'), { sucursalId: 1, fecha: D, turno: '22:00' })]);
  ok(!x22.ok && NO_CUADRA.test(x22.error) && !e.ejecucion(D, '22:00'), '(1) Ni se abre');
  e.reloj('07:00', 1);
  const { r: sem, celda } = await e.semana();
  igual(sem.turnos, ['06:00', '14:00', '18:00', '22:00'], '(1) La semana tiene los turnos de antes y los de ahora');
  igual(['06:00', '14:00', '18:00', '22:00'].map((tt) => celda(D, tt)), ['no_se_hizo', 'incompleta', 'no_se_hizo', 'no_aplica'], '(1) Hoy: la de las 14:00 cuenta, la de las 22:00 no se exige');
  igual(['14:00', '22:00'].map((tt) => celda(dia(-1), tt)), ['no_se_hizo', 'no_se_hizo'], '(1) Ayer se exigía con los turnos de antes');
});

// (2) 06:00, 14:00 y 22:00; a las 10:40 se guardan 07:00 y 19:00: entran a las 19:00.
await escenario('10:30', async (e) => {
  e.reloj('10:40');
  const s = await e.put({ accion: 'turnos', rondaId: e.modeloId, turnos: ['07:00', '19:00'] });
  igual(s.body.aplicaDesde, { fecha: D, turno: '19:00' }, '(2) Entran a las 19:00');
  e.reloj('10:45');
  let p = await e.hoy();
  igual([p.turno, p.turnos, p.turnosProximos], ['06:00', ['06:00', '14:00', '22:00'], { desde: en('19:00'), turnos: ['07:00', '19:00'] }], '(2) El de las 06:00 sigue');
  e.reloj('13:59');
  igual((await e.hoy()).turno, '06:00', '(2) Hasta las 14:00');
  e.reloj('14:30');
  p = await e.hoy();
  igual([p.fecha, p.turno], [D, '14:00'], '(2) El de las 14:00 corre desde las 14:00');
  igual((await e.fila()).estado, 'sin_iniciar', '(2) Y se exige');
  igual((await e.fila({ fecha: D, turno: '06:00' })).estado, 'no_se_hizo', '(2) El de las 06:00 terminó a las 14:00');
  igual((await e.fila({ fecha: D, turno: '07:00' })).estado, 'no_aplica', '(2) El de las 07:00 de hoy no existe');
  const [x07] = await e.sync([e.op('ronda.iniciar', en('14:30'), { sucursalId: 1, fecha: D, turno: '07:00' })]);
  ok(!x07.ok && NO_CUADRA.test(x07.error), '(2) Ni se abre');
  const [x14] = await e.sync([e.op('ronda.iniciar', en('14:35'), { sucursalId: 1, fecha: D, turno: '14:00' })]);
  ok(x14.ok && e.ejecucion(D, '14:00'), '(2) El de las 14:00 se abre');
  e.reloj('18:59');
  igual((await e.hoy()).turno, '14:00', '(2) El de las 14:00 corre hasta las 19:00');
  e.reloj('19:30');
  p = await e.hoy();
  igual([p.turno, p.turnos, p.turnosProximos], ['19:00', ['07:00', '19:00'], null], '(2) A las 19:00 corre el de las 19:00');
  igual((await e.fila()).estado, 'sin_iniciar', '(2) El de las 19:00 sí se exige');
  igual((await e.fila({ fecha: D, turno: '14:00' })).estado, 'incompleta', '(2) El de las 14:00 terminó a las 19:00');
  e.reloj('22:30');
  igual((await e.fila({ fecha: D, turno: '22:00' })).estado, 'no_aplica', '(2) El de las 22:00 de hoy no se exige');
  const [x22] = await e.sync([e.op('ronda.iniciar', en('22:30'), { sucursalId: 1, fecha: D, turno: '22:00' })]);
  ok(!x22.ok && NO_CUADRA.test(x22.error), '(2) Ni se abre');
  e.reloj('06:30', 1);
  igual([(await e.hoy()).fecha, (await e.hoy()).turno], [D, '19:00'], '(2) De madrugada sigue el de las 19:00 de ayer');
  e.reloj('08:00', 1);
  p = await e.hoy();
  igual([p.fecha, p.turno], [dia(1), '07:00'], '(2) Mañana corre el de las 07:00');
  const { r: sem, celda } = await e.semana();
  igual(sem.turnos, ['06:00', '07:00', '14:00', '19:00', '22:00'], '(2) La semana tiene los turnos de antes y los de ahora');
  igual(['06:00', '07:00', '14:00', '19:00', '22:00'].map((tt) => celda(D, tt)), ['no_se_hizo', 'no_aplica', 'incompleta', 'no_se_hizo', 'no_aplica'], '(2) Hoy: ni 22:00 ni 07:00 se exigen; 19:00 sí');
  igual(['06:00', '07:00'].map((tt) => celda(dia(1), tt)), ['no_aplica', 'sin_iniciar'], '(2) Mañana ya es con los turnos nuevos');
});

// (3) Dos cambios seguidos antes de que entre el primero: manda el segundo.
await escenario('15:00', async (e) => {
  e.reloj('15:10');
  igual((await e.put({ accion: 'turnos', rondaId: e.modeloId, turnos: ['06:00', '18:00'] })).body.aplicaDesde, { fecha: D, turno: '18:00' }, '(3) El primero entraría a las 18:00');
  e.reloj('16:00');
  igual((await e.put({ accion: 'turnos', rondaId: e.modeloId, turnos: ['06:00', '20:00'] })).body.aplicaDesde, { fecha: D, turno: '20:00' }, '(3) El segundo entra a las 20:00');
  e.reloj('16:05');
  igual((await e.hoy()).turnosProximos, { desde: en('20:00'), turnos: ['06:00', '20:00'] }, '(3) El celular recibe solo el segundo');
  e.reloj('18:30');
  igual((await e.hoy()).turno, '14:00', '(3) El de las 18:00 nunca entra: sigue el de las 14:00');
  const [x18] = await e.sync([e.op('ronda.iniciar', en('18:30'), { sucursalId: 1, fecha: D, turno: '18:00' })]);
  ok(!x18.ok && NO_CUADRA.test(x18.error), '(3) Y no se abre');
  igual((await e.fila({ fecha: D, turno: '18:00' })).estado, 'no_aplica', '(3) Ni se exige');
  e.reloj('20:30');
  const p = await e.hoy();
  igual([p.turno, p.turnos, p.turnosProximos], ['20:00', ['06:00', '20:00'], null], '(3) A las 20:00 corre el de las 20:00');
  igual(e.x.app.rt.lineaDeTurnos({ id: 1, turnos: '["06:00","20:00"]' }, [
    { id: 2, rondaId: 1, turnosAntes: '["06:00","18:00"]', hasta: en('16:00') },
    { id: 1, rondaId: 1, turnosAntes: '["06:00","14:00","22:00"]', hasta: en('15:10') },
  ]).map((x) => [x.entra?.turno ?? null, x.turnos.join()]), [[null, '06:00,14:00,22:00'], ['20:00', '06:00,20:00']], '(3) La línea de tiempo se arma en orden, aunque las vigencias lleguen desordenadas');
});

// (4) Turnos que cruzan la medianoche.
await escenario('02:00', async (e) => {
  e.x.sqlite.exec(`UPDATE rondas SET turnos='["07:00","19:00"]'`);
  let p = await e.hoy();
  igual([p.fecha, p.turno], [dia(-1), '19:00'], '(4) A las 02:00 corre el de las 19:00 de ayer');
  const clave = { sucursalId: 1, fecha: dia(-1), turno: '19:00' };
  const sinSenal = e.lecturas(p, clave, en('02:30'));
  e.reloj('02:40');
  igual((await e.put({ accion: 'turnos', rondaId: e.modeloId, turnos: ['06:00', '18:00'] })).body.aplicaDesde, { fecha: D, turno: '06:00' }, '(4) Entran a las 06:00 de hoy');
  e.reloj('03:00');
  p = await e.hoy();
  igual([p.fecha, p.turno, p.turnosProximos], [dia(-1), '19:00', { desde: en('06:00'), turnos: ['06:00', '18:00'] }], '(4) Sigue el de las 19:00 de ayer hasta las 06:00');
  e.reloj('06:30');
  const r = await e.sync(sinSenal);
  ok(r.every((y) => y.ok) && e.ejecucion(dia(-1), '19:00')?.puntos_ok === 3, `(4) Lo capturado de madrugada para el turno de ayer se acepta: ${JSON.stringify(r)}`);
  p = await e.hoy();
  igual([p.fecha, p.turno], [D, '06:00'], '(4) A las 06:00 corre el de las 06:00 de hoy');
  const [x07] = await e.sync([e.op('ronda.iniciar', en('07:05'), { sucursalId: 1, fecha: D, turno: '07:00' })]);
  ok(!x07.ok && NO_CUADRA.test(x07.error), '(4) El de las 07:00 de hoy ya no existe');
  igual((await e.fila({ fecha: dia(-1), turno: '19:00' })).estado, 'incompleta', '(4) El de las 19:00 de ayer terminó a las 06:00');
  e.reloj('05:30', 1);
  p = await e.hoy();
  igual([p.fecha, p.turno], [D, '18:00'], '(4) A las 05:30 de mañana sigue el de las 18:00 de hoy');
  const [l18] = await e.sync(e.lecturas(p, { sucursalId: 1, fecha: D, turno: '18:00' }, en('05:30', 1), 1));
  ok(l18.ok, '(4) Y se anota en él');
});

// (4b) Un cambio de noche que entra a medianoche.
await escenario('23:00', async (e) => {
  const clave = { sucursalId: 1, fecha: D, turno: '22:00' };
  const p0 = await e.hoy();
  igual([p0.fecha, p0.turno], [D, '22:00'], '(4b) A las 23:00 corre el de las 22:00');
  igual((await e.put({ accion: 'turnos', rondaId: e.modeloId, turnos: ['00:00', '12:00'] })).body.aplicaDesde, { fecha: dia(1), turno: '00:00' }, '(4b) Entran a la medianoche');
  const sinSenal = e.lecturas(p0, clave, en('23:40'));
  e.reloj('00:40', 1);
  const r = await e.sync(sinSenal);
  ok(r.every((y) => y.ok) && e.ejecucion(D, '22:00'), '(4b) Lo de las 23:40 llega después de medianoche y se acepta en el de las 22:00');
  const p = await e.hoy();
  igual([p.fecha, p.turno, p.turnos], [dia(1), '00:00', ['00:00', '12:00']], '(4b) Desde la medianoche corre el de las 00:00');
  e.reloj('06:10', 1);
  const [x06] = await e.sync([e.op('ronda.iniciar', en('06:10', 1), { sucursalId: 1, fecha: dia(1), turno: '06:00' })]);
  ok(!x06.ok && NO_CUADRA.test(x06.error), '(4b) El de las 06:00 ya no existe');
});

// (5) «No hace ronda» a las 13:40, con efecto a las 14:00: lo de las 13:35 sin señal llega a las 14:10.
await escenario('13:30', async (e) => {
  const p = await e.hoy();
  igual(p.turno, '06:00', '(5) A las 13:30 corre el de las 06:00');
  const sinSenal = e.lecturas(p, { sucursalId: 1, fecha: D, turno: '06:00' }, en('13:35'));
  e.reloj('13:40');
  const s = await e.put({ accion: 'hace_ronda', sucursalId: 1, haceRonda: false });
  igual(s.body.aplicaDesde, { fecha: D, turno: '14:00' }, '(5) Entra a las 14:00');
  e.reloj('14:10');
  const r = await e.sync(sinSenal);
  ok(r.length === 3 && r.every((y) => y.ok), `(5) Las capturas sin señal de las 13:35 se aceptan: ${JSON.stringify(r)}`);
  ok(e.ejecucion(D, '06:00')?.puntos_ok === 3, '(5) En la ronda de las 06:00');
  igual(await e.hoy(), null, '(5) Desde las 14:00 el celular no ofrece ronda');
  const [x14] = await e.sync([e.op('ronda.iniciar', en('14:10'), { sucursalId: 1, fecha: D, turno: '14:00' })]);
  ok(!x14.ok && /no hacía ronda/.test(x14.error), `(5) Ni el servidor abre una: ${x14.error}`);
  e.reloj('15:00');
  const { celda } = await e.semana();
  igual([celda(D, '06:00'), celda(D, '14:00')], ['incompleta', 'no_aplica'], '(5) La semana no marca «no se hizo»: la de las 06:00 se empezó y la de las 14:00 no se exige');
  const t = await e.fila({ fecha: D, turno: '06:00' });
  ok(t.haceRonda && t.estado === 'incompleta', '(5) En el tablero, la de las 06:00 cuenta como de una sede que hacía ronda');
});

// (5b) La marca entra en el siguiente turno de la línea de tiempo, aunque haya un cambio de turnos pendiente.
await escenario('10:30', async (e) => {
  e.reloj('10:40');
  await e.put({ accion: 'turnos', rondaId: e.modeloId, turnos: ['07:00', '19:00'] });
  e.reloj('10:50');
  const s = await e.put({ accion: 'hace_ronda', sucursalId: 1, haceRonda: false });
  igual(s.body.aplicaDesde, { fecha: D, turno: '14:00' }, '(5b) Entra a las 14:00, el siguiente turno que de verdad empieza, no a las 19:00');
  ok((await e.hoy())?.turno === '06:00', '(5b) El turno de ahora sigue como estaba');
  e.reloj('14:30');
  igual(await e.hoy(), null, '(5b) A las 14:00 ya no hace ronda');
  const t = await e.fila();
  ok(t.turno === '14:00' && t.estado === 'no_aplica' && !t.haceRonda, '(5b) Y el tablero no se la exige');
});

// (6) Capturado sin señal antes de un cambio de turnos y sincronizado después de que entró.
await escenario('15:00', async (e) => {
  const p = await e.hoy();
  const clave = { sucursalId: 1, fecha: D, turno: '14:00' };
  const sinSenal = [e.op('ronda.iniciar', en('15:04'), clave), ...e.lecturas(p, clave, en('15:05'))];
  e.reloj('15:10');
  await e.put({ accion: 'turnos', rondaId: e.modeloId, turnos: ['06:00', '18:00'] });
  e.reloj('18:30');
  const r = await e.sync(sinSenal);
  ok(r.length === 4 && r.every((y) => y.ok), `(6) Se acepta: ${JSON.stringify(r)}`);
  ok(e.ejecucion(D, '14:00')?.puntos_ok === 3, '(6) En la ronda de las 14:00');
  const ahora = await e.hoy();
  ok(ahora.turno === '18:00' && !ahora.ejecucionId, '(6) Y el turno de ahora no se toca');
});

console.log(`PASS test-ronda: ${casos} casos; rutas y migraciones reales, sin red.`);
