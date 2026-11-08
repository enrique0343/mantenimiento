// Modo técnico: lo que el celular envía llega una sola vez, con su hora real y
// bajo las mismas reglas de la ficha completa. Rutas reales, migraciones reales.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';
import { fijarReloj } from './test-support/reloj.mjs';

fijarReloj();

// La siembra de los documentos necesita un administrador, como en producción.
const beforeMigration = (db, nombre) => {
  if (nombre.startsWith('0049_fase49')) db.exec("INSERT OR IGNORE INTO usuarios(id,nombre,email,password_hash,rol) VALUES(1000,'Administración','siembra@example.invalid','x','admin')");
};
const fixture = await setupConjuntos({ beforeMigration, modules: {
  hoy: 'pages/api/campo/hoy', sync: 'pages/api/campo/sync', buscar: 'pages/api/campo/buscar', equipo: 'pages/api/campo/equipo/[id]',
  resolver: 'lib/resolver', crear: 'pages/api/campo/ordenes', foto: 'pages/api/campo/foto', campo: 'lib/campo', reporte: 'lib/reporte-mantenimiento', config: 'lib/campo-config', csv: 'pages/api/reportes/[tipo]', database: 'lib/db',
  reglas: 'lib/ordenes', eop: 'lib/eop',
} });
const { app, sqlite, faults, call, close } = fixture;
const one = (q, ...a) => sqlite.prepare(q).get(...a);
const all = (q, ...a) => sqlite.prepare(q).all(...a);
const AHORA = Date.now();
const hace = (min) => new Date(AHORA - min * 60000).toISOString();
// La ronda solo acepta horas de su turno: sus capturas «hace N minutos» no pasan del inicio del turno que corre
// (06:00, 14:00 o 22:00). Con el turno recién empezado se aprietan, en el mismo orden. Vale a cualquier hora de RELOJ_PRUEBA.
const diaSV = (ms) => new Date(ms - 6 * 3600000).toISOString().slice(0, 10);
const INICIO_TURNO = Math.max(...[AHORA - 86400000, AHORA].flatMap((ms) => ['06:00', '14:00', '22:00'].map((tt) => Date.parse(`${diaSV(ms)}T${tt}:00-06:00`))).filter((ms) => ms <= AHORA));
const ESCALA_RONDA = Math.min(1, (AHORA - INICIO_TURNO) / (46 * 60000));
const enRonda = (min) => new Date(AHORA - min * 60000 * ESCALA_RONDA).toISOString();
let n = 0;
const op = (tipo, at, extra = {}) => ({ opId: `prueba-${++n}-${tipo}`, tipo, at, ...extra });
// Como el celular: lo que no cupo en el presupuesto de una solicitud sale en la siguiente.
const enviar = async (ops, rol = 'tecnico', extra = {}) => {
  const salida = [];
  let resto = ops;
  while (resto.length) {
    const r = await call(app.sync.POST, '/api/campo/sync', { method: 'POST', data: { ops: resto, ...extra }, rol });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    salida.push(...r.body.resultados);
    if (r.body.detenido) break;
    assert.ok(r.body.resultados.length >= 1, 'Cada vuelta avanza');
    resto = resto.slice(r.body.resultados.length);
  }
  return salida;
};
const CHECKLIST = JSON.stringify([
  { texto: 'Apagar y bloquear', bloqueante: true, minutos: 5, estado: 'pendiente' },
  { texto: 'Limpiar filtros', minutos: 10, estado: 'pendiente' },
  { texto: 'Medir corriente', minutos: 5, requiereValor: true, unidad: 'A', esperadoMin: 8, esperadoMax: 12, estado: 'pendiente' },
]);
const seed = (id, extra = {}) => sqlite.prepare(`INSERT INTO ordenes(creado_por,id,titulo,rubro,tipo,activo_id,plan_id,estado,asignado_a,checklist_ejecucion,sucursal_id,ubicacion_id) VALUES(1,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(id, extra.titulo ?? `[Preventivo] Trimestral - AC-01`, 'aires', extra.tipo ?? 'preventivo', extra.activo === undefined ? 1 : extra.activo, extra.plan ?? null, extra.estado ?? 'abierta', extra.asignado === undefined ? 3 : extra.asignado, extra.checklist === undefined ? CHECKLIST : extra.checklist, 1, 1);
let verificaciones = 0;
const ok = (...args) => { assert.ok(...args); verificaciones++; };
const igual = (...args) => { assert.equal(...args); verificaciones++; };

try {
  faults.enforceColumnLimit = true; // D1 corta a 100 columnas: ninguna consulta de esta pantalla puede pasarse.
  sqlite.exec(`
    INSERT INTO sucursales(id,nombre,activa) VALUES(1,'Sede prueba',1),(2,'Otra sede',1);
    INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo,activa) VALUES(1,1,'Quirófano 2','area',1),(2,1,'Habitación 307','area',1),(3,2,'Azotea','area',1);
    INSERT INTO activos(id,codigo,nombre,tipo,rubro,ubicacion_id,estado) VALUES(1,'AC-01','Minisplit quirófano','general','aires',1,'operativo'),(2,'AC-02','Minisplit habitación','general','aires',2,'operativo'),(3,'AC-03','Minisplit de baja','general','aires',2,'baja'),(4,'AC-04','Sin lugar','general','aires',NULL,'operativo'),(5,'CH-01','Chiller del edificio','general','aires',3,'operativo');
    INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha,checklist) VALUES(1,2,'Trimestral','trimestral','2026-01-15','${CHECKLIST}');
    INSERT INTO usuarios(id,nombre,email,password_hash,rol) VALUES(20,'Otro Técnico','otro@example.invalid','x','tecnico');
  `);
  // La migración 0055 fija vigente_desde con la fecha real de SQLite; aquí, con la del turno que corre en el reloj de prueba.
  sqlite.prepare('UPDATE rondas SET vigente_desde=?').run(diaSV(INICIO_TURNO));

  // ── El escaneo sigue apagado ─────────────────────────────────────────────
  igual(app.config.ESCANEO_ACTIVOS_HABILITADO, false);

  // ── La hora capturada ────────────────────────────────────────────────────
  const { momentoCapturado } = app.campo;
  const t = AHORA;
  const viejo = new Date(t - 30 * 60000).toISOString();
  igual(momentoCapturado(viejo, null, t).iso, viejo, 'Se respeta la hora del celular');
  ok(momentoCapturado(viejo, null, t).sinSenal, 'Media hora de retraso es sin señal');
  ok(!momentoCapturado(new Date(t - 20000).toISOString(), null, t).sinSenal);
  igual(momentoCapturado(new Date(t + 3600000).toISOString(), null, t).iso, new Date(t).toISOString(), 'Un reloj adelantado no mueve el registro');
  ok(momentoCapturado(new Date(t + 3600000).toISOString(), null, t).ajustado);
  igual(momentoCapturado(new Date(t - 20 * 86400000).toISOString(), null, t).iso, new Date(t).toISOString(), 'Demasiado viejo: manda el servidor');
  igual(momentoCapturado('basura', null, t).iso, new Date(t).toISOString());
  const inicio = new Date(t - 600000).toISOString();
  igual(momentoCapturado(new Date(t - 900000).toISOString(), inicio, t).iso, inicio, 'No puede quedar antes de lo que ya pasó');

  // ── Permisos ─────────────────────────────────────────────────────────────
  igual((await call(app.hoy.GET, '/api/campo/hoy', { rol: null })).status, 401);
  for (const rol of ['visualizador', 'solicitante', 'motorista']) igual((await call(app.hoy.GET, '/api/campo/hoy', { rol })).status, 403);
  igual((await call(app.sync.POST, '/api/campo/sync', { method: 'POST', data: { ops: [op('orden.iniciar', hace(1), { ordenId: 1 })] }, rol: 'solicitante' })).status, 403);

  // ── Un preventivo completo: tiempos reales, con pausa y sin señal ────────
  seed(1);
  let [r] = await enviar([op('orden.iniciar', hace(120), { ordenId: 1 })]);
  ok(r.ok, JSON.stringify(r));
  let o = one('SELECT * FROM ordenes WHERE id=1');
  igual(o.estado, 'en_proceso');
  igual(o.iniciada_en, hace(120), 'El inicio es la hora del toque, no la de llegada');
  const paso1 = op('orden.paso', hace(110), { ordenId: 1, idx: 0, texto: 'Apagar y bloquear', estado: 'ok' });
  [r] = await enviar([paso1]);
  ok(r.ok, JSON.stringify(r));
  [r] = await enviar([paso1]);
  ok(r.repetida, 'Reintentar la misma operación no la aplica dos veces');
  igual(one('SELECT count(*) c FROM orden_paso_marcas WHERE orden_id=1').c, 1);
  const marca = one('SELECT * FROM orden_paso_marcas WHERE orden_id=1');
  igual(marca.ocurrido_en, hace(110));
  igual(marca.sin_senal, 1, 'Llegó casi dos horas después');
  const hecho = JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=1').c)[0];
  igual(hecho.estado, 'ok');
  ok(hecho.hora && hecho.iniciales, 'Hora e iniciales se llenan solas');

  // Pausa: no cuenta como trabajo.
  await enviar([op('orden.pausar', hace(100), { ordenId: 1, motivo: 'Falta repuesto' }), op('orden.reanudar', hace(70), { ordenId: 1 })]);
  o = one('SELECT * FROM ordenes WHERE id=1');
  igual(o.tiempo_pausado_min, 30);
  igual(o.estado, 'en_proceso');
  igual(one("SELECT motivo FROM orden_verificacion_eventos WHERE orden_id=1 AND accion='bloqueo'").motivo, 'Falta repuesto');

  // Las reglas del cierre siguen mandando.
  [r] = await enviar([op('orden.terminar', hace(60), { ordenId: 1 })]);
  ok(!r.ok, 'No termina con pasos pendientes');
  ok(/pendiente/i.test(r.error), r.error);
  ok(one('SELECT payload FROM campo_operaciones WHERE op_id=?', r.opId).payload.includes('orden.terminar'), 'Lo rechazado se conserva');
  igual(one('SELECT estado FROM ordenes WHERE id=1').estado, 'en_proceso');
  await enviar([
    op('orden.paso', hace(60), { ordenId: 1, idx: 1, texto: 'Limpiar filtros', estado: 'ok' }),
    op('orden.paso', hace(50), { ordenId: 1, idx: 2, texto: 'Medir corriente', estado: 'desviacion', valor: '14,5', nota: 'Lectura 14.5 A, sobre el rango normal.' }),
  ]);
  [r] = await enviar([op('orden.terminar', hace(40), { ordenId: 1 })]);
  ok(r.ok, JSON.stringify(r));
  o = one('SELECT * FROM ordenes WHERE id=1');
  igual(o.estado, 'completada', 'Queda pendiente de verificación, nunca cerrada');
  igual(o.cerrado_en, null);
  igual(o.completada_en, hace(40));
  igual(o.horas_trabajadas, 0.83, '80 minutos menos 30 de pausa');
  ok(o.trabajos_realizados.includes('3 de 3 puntos realizados, 1 con novedad'), o.trabajos_realizados);
  ok(o.trabajos_realizados.includes('Medir corriente: 14.5 A'), o.trabajos_realizados);
  igual(o.trabajos_realizados.includes('Trimestral - AC-01:'), false, 'El código del equipo no se repite a la mitad');
  ok(o.trabajos_realizados.startsWith('Trimestral:'), o.trabajos_realizados);
  igual(one('SELECT ejecutado_por e FROM orden_verificacion WHERE orden_id=1').e, 3);

  // Un punto crítico con novedad bloquea, igual que en la ficha.
  seed(2);
  await enviar([op('orden.iniciar', hace(30), { ordenId: 2 }),
    op('orden.paso', hace(29), { ordenId: 2, idx: 0, texto: 'Apagar y bloquear', estado: 'desviacion', nota: 'El breaker no bloquea, requiere cambio.' }),
    op('orden.paso', hace(28), { ordenId: 2, idx: 1, texto: 'Limpiar filtros', estado: 'ok' }),
    op('orden.paso', hace(27), { ordenId: 2, idx: 2, texto: 'Medir corriente', estado: 'ok', valor: '10' })]);
  [r] = await enviar([op('orden.terminar', hace(26), { ordenId: 2 })]);
  ok(!r.ok && /cr[ií]tico/i.test(r.error), JSON.stringify(r));

  // Una lectura exigida no se salta.
  seed(3);
  await enviar([op('orden.iniciar', hace(30), { ordenId: 3 }),
    op('orden.paso', hace(29), { ordenId: 3, idx: 0, texto: 'Apagar y bloquear', estado: 'ok' }),
    op('orden.paso', hace(28), { ordenId: 3, idx: 1, texto: 'Limpiar filtros', estado: 'ok' }),
    op('orden.paso', hace(27), { ordenId: 3, idx: 2, texto: 'Medir corriente', estado: 'ok' })]);
  [r] = await enviar([op('orden.terminar', hace(26), { ordenId: 3 })]);
  ok(!r.ok && /valor medido/i.test(r.error), JSON.stringify(r));

  // El checklist cambió en la oficina: no se escribe sobre el paso equivocado.
  [r] = await enviar([op('orden.paso', hace(25), { ordenId: 3, idx: 0, texto: 'Otro texto', estado: 'ok' })]);
  ok(!r.ok && /cambi/i.test(r.error), JSON.stringify(r));

  // La orden de otra persona no se toca.
  seed(4, { asignado: 20 });
  [r] = await enviar([op('orden.iniciar', hace(5), { ordenId: 4 })]);
  ok(!r.ok, 'No puede iniciar la orden de otro');
  igual(one('SELECT estado FROM ordenes WHERE id=4').estado, 'abierta');

  // Una orden sin dueño se toma al empezar.
  seed(5, { asignado: null });
  [r] = await enviar([op('orden.iniciar', hace(5), { ordenId: 5 })]);
  ok(r.ok, JSON.stringify(r));
  igual(one('SELECT asignado_a a FROM ordenes WHERE id=5').a, 3);

  // Sin pasos, hay que contar qué se hizo.
  seed(6, { checklist: null, titulo: '[No programado] Mantenimiento - AC-01' });
  await enviar([op('orden.iniciar', hace(20), { ordenId: 6 })]);
  [r] = await enviar([op('orden.terminar', hace(10), { ordenId: 6 })]);
  ok(!r.ok && /10 caracteres/.test(r.error), JSON.stringify(r));
  [r] = await enviar([op('orden.terminar', hace(10), { ordenId: 6, nota: 'Rodamientos lubricados, sin ruido.' })]);
  ok(r.ok, JSON.stringify(r));

  // Reloj del celular atrasado una hora: se corrige con la diferencia al enviar.
  seed(7);
  [r] = await enviar([op('orden.iniciar', new Date(AHORA - 70 * 60000).toISOString(), { ordenId: 7 })], 'tecnico', { reloj: new Date(Date.now() - 3600000).toISOString() });
  const corregido = Date.parse(one('SELECT iniciada_en i FROM ordenes WHERE id=7').i);
  ok(Math.abs(corregido - (AHORA - 10 * 60000)) < 5000, 'Debe quedar hace unos 10 minutos');

  // ── La ronda ─────────────────────────────────────────────────────────────
  let hoy = await call(app.hoy.GET, '/api/campo/hoy?sede=1', { rol: 'tecnico' });
  igual(hoy.status, 200, JSON.stringify(hoy.body));
  const p = hoy.body;
  ok(p.ronda, 'La sede tiene su ronda');
  igual(p.ronda.puntos.length, 21);
  ok(p.emergencias.length >= 6, 'Los EOP viajan con el paquete, para usarlos sin señal');
  ok(p.emergencias.every((e) => e.acciones.length > 0));
  ok(p.ordenes.some((x) => x.id === 3 && x.pasos.length === 3));
  igual(p.ordenes.some((x) => x.id === 4), false, 'No ve la orden de otro');
  ok(hoy.body.ronda.puntos.filter((x) => x.critico).length > 0);
  const docsConAcciones = Object.values(p.ronda.docs).filter((d) => d.acciones.length > 0);
  ok(docsConAcciones.length > 0, 'Las acciones del AOP viajan con la ronda');
  const clave = { rondaId: p.ronda.rondaId, sucursalId: 1, fecha: p.ronda.fecha, turno: p.ronda.turno };
  [r] = await enviar([op('ronda.iniciar', enRonda(45), clave)]);
  ok(r.ok, JSON.stringify(r));
  igual(one('SELECT iniciada_en i FROM ronda_ejecuciones').i, enRonda(45));
  const conAop = p.ronda.puntos.find((x) => x.aop && x.critico);
  [r] = await enviar([op('ronda.lectura', enRonda(44), { ...clave, puntoId: conAop.id, resultado: 'fuera', nota: 'Alarma en el panel' })]);
  ok(r.ok && r.datos.eventoId, JSON.stringify(r));
  const evento = one('SELECT * FROM aop_eventos WHERE id=?', r.datos.eventoId);
  igual(evento.detectado_en, enRonda(44), 'El reloj del AOP corre desde que se detectó, no desde que hubo señal');
  [r] = await enviar([op('ronda.cerrar', enRonda(43), { ...clave, firma: true, notas: 'Queda abierta la alarma.' })]);
  ok(!r.ok && /sin anotar/i.test(r.error), JSON.stringify(r));
  const opsRonda = p.ronda.puntos.filter((x) => x.id !== conAop.id).map((x, i) => op('ronda.lectura', enRonda(42 - i * 0.1), { ...clave, puntoId: x.id, resultado: 'ok', valor: x.pideValor ? (x.min ?? x.max ?? 1) : null }));
  for (let i = 0; i < opsRonda.length; i += 10) await enviar(opsRonda.slice(i, i + 10));
  [r] = await enviar([op('ronda.cerrar', enRonda(30), { ...clave, firma: true, notas: 'Queda abierta la alarma.' })]);
  ok(r.ok, JSON.stringify(r));
  const ej = one('SELECT * FROM ronda_ejecuciones');
  igual(ej.estado, 'completada');
  igual(ej.completada_en, enRonda(30));
  // De la primera captura a la firma: 15 minutos, o menos si el turno recién empezó.
  igual(ej.minutos_ronda, Math.round((Date.parse(enRonda(30)) - Date.parse(enRonda(45))) / 60000));
  hoy = await call(app.hoy.GET, '/api/campo/hoy?sede=1', { rol: 'tecnico' });
  igual(hoy.body.ronda.estado, 'completada');

  // ── Buscar: sede → ubicación → equipo ────────────────────────────────────
  let b = await call(app.buscar.GET, '/api/campo/buscar?sede=1', { rol: 'tecnico' });
  igual(b.status, 200, JSON.stringify(b.body));
  igual(b.body.ubicaciones.length, 2);
  igual(b.body.ubicaciones.find((u) => u.id === 2).equipos, 1, 'Un equipo dado de baja no cuenta');
  igual(b.body.sinUbicacion, 1);
  b = await call(app.buscar.GET, '/api/campo/buscar?ubicacion=2', { rol: 'tecnico' });
  igual(b.body.equipos.map((e) => e.codigo).join(), 'AC-02');
  ok(b.body.equipos[0].vencido, 'Plan vencido a la vista');
  b = await call(app.buscar.GET, '/api/campo/buscar?ubicacion=sin', { rol: 'tecnico' });
  igual(b.body.equipos.map((e) => e.codigo).join(), 'AC-04');
  igual((await call(app.buscar.GET, '/api/campo/buscar', { rol: 'tecnico' })).status, 400);
  const fichaR = await call(app.equipo.GET, '/api/campo/equipo/2', { method: 'GET', id: 2, rol: 'tecnico' });
  igual(fichaR.status, 200, JSON.stringify(fichaR.body));
  igual(fichaR.body.planes[0].pasos, 3);
  igual(fichaR.body.planes[0].estimadoMin, 20);
  // Cada aire con su familia: el minisplit de una habitación tiene sus propios cinco documentos.
  igual(fichaR.body.falla?.codigo, 'EOP-MSP-01', JSON.stringify(fichaR.body.falla));
  igual(fichaR.body.falla?.fueraDeAlcance, false);
  igual(fichaR.body.desviacion?.codigo, 'AOP-MSP-01');
  igual(fichaR.body.desviacion?.actuarMin, 240);
  const plantillaMsp = one("SELECT t.id FROM checklist_plantillas t JOIN procedimientos p ON p.id=t.procedimiento_id WHERE p.codigo_corto='SOP-MG-06'");
  igual(fichaR.body.plantillaSugerida, plantillaMsp.id, 'La rutina de su familia ya viene elegida');
  igual(all('SELECT id FROM checklist_plantilla_items WHERE plantilla_id=?', plantillaMsp.id).length, 12);
  igual(all("SELECT codigo_corto FROM procedimientos WHERE sistema='minisplit' ORDER BY codigo_corto").map((d) => d.codigo_corto).join(), 'AOP-MSP-01,EOP-MSP-01,MOP-MSP-01,SCP-MSP-01,SOP-MG-06');
  igual(all("SELECT procedimiento_id FROM procedimiento_sistemas WHERE sistema='minisplit'").length, 5);
  // En quirófano o UCI el aire es de climatización crítica, aunque el equipo se llame minisplit.
  const quirofano = await call(app.equipo.GET, '/api/campo/equipo/1', { method: 'GET', id: 1, rol: 'tecnico' });
  igual(quirofano.body.falla?.codigo, 'EOP-HVAC-01');
  igual(quirofano.body.falla?.fueraDeAlcance, false, 'En el quirófano el documento aplica de lleno');
  ok(quirofano.body.plantillaSugerida !== plantillaMsp.id, 'En quirófano no se sugiere la rutina de minisplit');
  // Un chiller sigue en climatización crítica; el documento avisa que se escribió para otra área.
  const chiller = await call(app.equipo.GET, '/api/campo/equipo/5', { method: 'GET', id: 5, rol: 'tecnico' });
  igual(chiller.body.falla?.codigo, 'EOP-HVAC-01');
  ok(chiller.body.falla?.fueraDeAlcance, JSON.stringify(chiller.body.falla));
  // Lo declarado en la ficha manda sobre lo que se infiere.
  sqlite.prepare("UPDATE activos SET sistema='hvac' WHERE id=4").run();
  igual((await call(app.equipo.GET, '/api/campo/equipo/4', { method: 'GET', id: 4, rol: 'tecnico' })).body.falla?.codigo, 'EOP-HVAC-01');
  sqlite.prepare("UPDATE activos SET sistema=NULL WHERE id=4").run();
  igual((await call(app.equipo.GET, '/api/campo/equipo/4', { method: 'GET', id: 4, rol: 'tecnico' })).body.falla?.codigo, 'EOP-MSP-01');
  const { inferirSistema } = app.resolver;
  for (const [nombre, categoria, rubro, lugar, esperado] of [
    ['AC-20', 'Mini split', 'aires', 'Bloque Quirúrgico', 'hvac'],
    ['AC-21', 'Mini split', 'aires', 'Sala de Operaciones 2', 'hvac'],
    ['AC-22', 'Mini split', 'aires', 'U.C.I. Adultos', 'hvac'],
    ['AC-23', 'Mini split', 'aires', 'UCIP', 'hvac'],
    ['AC-24', 'Mini split', 'aires', 'Cuidados Críticos', 'hvac'],
    ['AC-25', 'Mini split', 'aires', 'Consultorio de ducto', 'minisplit'],
    ['AC-26', 'Mini split', 'aires', 'CENTRO DE ESTERILIZACIÓN', 'hvac'],
    ['Minisplit habitación', null, 'aires', 'Habitación 307', 'minisplit'],
    ['Minisplit quirófano', null, 'aires', 'QUIROFANO SUNSHINE', 'hvac'],
    ['AC-12', 'Cassette', 'aires', 'UCI Adultos', 'hvac'],
    ['AC-12', 'Cassette', 'aires', 'Consultorio 4', 'minisplit'],
    ['AC-13', 'Piso techo', 'aires', null, 'minisplit'],
    ['AC-14', 'Ventana', 'aires', 'Oficina', 'minisplit'],
    ['AC-15', 'Otros aires acondicionados', 'aires', 'RECUPERACION', 'hvac'],
    ['Chiller 1', 'Chiller', 'aires', 'Azotea', 'hvac'],
    ['UMA-2', 'Manejadora de aire', 'aires', 'Cuarto técnico', 'hvac'],
    ['Unidad', 'VRF / VRV', 'aires', 'Oficina', 'hvac'],
    ['Aire acondicionado central', null, null, null, 'hvac'],
    ['Aire acondicionado de oficina', null, null, null, 'minisplit'],
    ['Central de aire medicinal', null, null, null, 'gases'],
    ['Puerta de vidrio', 'Puertas y ventanas', 'infraestructura', null, 'otro'],
  ]) igual(inferirSistema(nombre, categoria, rubro, lugar), esperado, `${nombre} / ${categoria} / ${lugar}`);

  // Una orden sin equipo también puede abrir su correctivo: el celular manda el área de la orden.
  const hoyAreas = await call(app.hoy.GET, '/api/campo/hoy?sede=1', { rol: 'tecnico' });
  igual(hoyAreas.status, 200);
  ok(hoyAreas.body.ordenes.concat(hoyAreas.body.libres).every((o) => 'rubro' in o), 'Cada orden del paquete trae su área');
  // ── Mantenimiento fuera de la lista ──────────────────────────────────────
  const crear = (data, rol = 'tecnico') => call(app.crear.POST, '/api/campo/ordenes', { method: 'POST', data, rol });
  let c = await crear({ activoId: 2, planId: 1 });
  igual(c.status, 201, JSON.stringify(c.body));
  const desdePlan = one('SELECT * FROM ordenes WHERE id=?', c.body.ordenId);
  igual(desdePlan.plan_id, 1);
  igual(desdePlan.asignado_a, 3);
  igual(desdePlan.tipo, 'preventivo');
  igual(JSON.parse(desdePlan.checklist_ejecucion).length, 3);
  ok(desdePlan.vencimiento, 'Hereda el vencimiento del plan');
  ok(one('SELECT ultima_generacion u FROM planes_mantenimiento WHERE id=1').u, 'El cron no la vuelve a generar');
  c = await crear({ activoId: 2, planId: 1 });
  igual(c.status, 200);
  ok(c.body.yaExistia, 'No se duplica la orden del plan');
  igual(c.body.ordenId, desdePlan.id);
  c = await crear({ activoId: 2, tipo: 'preventivo', descripcion: 'Ruido en ventilador' });
  igual(c.status, 201, JSON.stringify(c.body));
  ok(one('SELECT titulo t FROM ordenes WHERE id=?', c.body.ordenId).t.startsWith('[No programado]'));
  igual((await crear({ activoId: 3 })).status, 409, 'Un equipo de baja no recibe mantenimiento');
  igual((await crear({ activoId: 999 })).status, 404);
  igual((await crear({ activoId: 2 }, 'solicitante')).status, 403);

  // ── Fallas: se abren con la hora en que se reportaron ────────────────────
  const eop = hoy.body.emergencias[0];
  [r] = await enviar([op('emergencia.abrir', hace(15), { eop: eop.codigo, sucursalId: 1, nota: 'Sin agua en piso 3' })]);
  ok(r.ok, JSON.stringify(r));
  const em = one('SELECT * FROM ordenes WHERE id=?', r.datos.ordenId);
  igual(em.tipo, 'emergencia');
  igual(em.clase_prioridad, 'P1');
  igual(em.hora_alarma, hace(15));
  igual(em.asignado_a, 3);
  ok(em.causa_raiz_vencimiento, 'Arranca el plazo de la causa raíz');
  igual(em.procedimiento_id, eop.id);
  // El vencimiento se calcula como en la ficha: equipo y prioridad, desde la hora en que se reportó.
  const masHoras = (iso, h) => new Date(Date.parse(iso) + h * 3600000).toISOString();
  igual(em.vencimiento, masHoras(hace(15), 4), 'Sin equipo, la emergencia vence en el plazo urgente por defecto (4 h) desde que se reportó');
  [r] = await enviar([op('correctivo.abrir', hace(14), { sucursalId: 1, rubro: 'infraestructura', nota: 'Fuga en lavamanos, consultorio 4' })]);
  ok(r.ok, JSON.stringify(r));
  const co = one('SELECT * FROM ordenes WHERE id=?', r.datos.ordenId);
  igual(co.tipo, 'correctivo');
  igual(co.asignado_a, null, 'Un correctivo lo asigna la jefatura');
  ok(co.titulo.includes('Fuga en lavamanos'));
  igual(co.vencimiento, masHoras(hace(14), 24), 'Sin equipo, el correctivo vence en el plazo de prioridad alta por defecto (24 h)');
  [r] = await enviar([op('correctivo.abrir', hace(13), { activoId: 2, nota: 'No enfría' })]);
  ok(r.ok, JSON.stringify(r));
  igual(one('SELECT ubicacion_id u FROM ordenes WHERE id=?', r.datos.ordenId).u, 2, 'La ubicación sale del equipo');
  igual(one('SELECT vencimiento v FROM ordenes WHERE id=?', r.datos.ordenId).v, masHoras(hace(13), 24));
  // Un equipo con sus propios plazos manda sobre los de por defecto.
  sqlite.exec("INSERT INTO activos(id,codigo,nombre,tipo,rubro,ubicacion_id,estado,sla_urgente_horas,sla_alta_horas) VALUES(50,'BOM-50','Bomba de la cisterna','general','infraestructura',2,'operativo',2,10)");
  [r] = await enviar([op('emergencia.abrir', hace(12.5), { activoId: 50, sucursalId: 1, nota: 'La bomba no arranca' })]);
  ok(r.ok, JSON.stringify(r));
  igual(one('SELECT vencimiento v FROM ordenes WHERE id=?', r.datos.ordenId).v, masHoras(hace(12.5), 2), 'La emergencia del equipo vence en su plazo urgente');
  [r] = await enviar([op('correctivo.abrir', hace(12.4), { activoId: 50, nota: 'Ruido en el sello' })]);
  ok(r.ok, JSON.stringify(r));
  igual(one('SELECT vencimiento v FROM ordenes WHERE id=?', r.datos.ordenId).v, masHoras(hace(12.4), 10), 'Y el correctivo, en su plazo de prioridad alta');
  const aop = one("SELECT id FROM procedimientos WHERE tipo='aop' AND codigo_corto='AOP-GAS-01'");
  [r] = await enviar([op('aop.abrir', hace(12), { procedimientoId: aop.id, activoId: 1, valor: '31,5', nota: 'Alta' })]);
  ok(r.ok, JSON.stringify(r));
  const desv = one('SELECT * FROM aop_eventos WHERE id=?', r.datos.eventoId);
  igual(desv.detectado_en, hace(12));
  igual(desv.valor_detectado, 31.5);
  igual(desv.origen, 'manual');
  [r] = await enviar([op('operacion.rara', hace(1))]);
  ok(!r.ok && /desconocida/.test(r.error));

  // ── La foto: una sola vez y antes de enviar a verificación ───────────────
  const subir = async (opId, ordenId) => {
    const fd = new FormData();
    fd.set('opId', opId); fd.set('ordenId', String(ordenId)); fd.set('categoria', 'despues'); fd.set('at', hace(1));
    fd.set('file', new File([new Uint8Array(32)], 'foto.jpg', { type: 'image/jpeg' }));
    const contexto = fixture.ctx('/api/campo/foto', { method: 'POST', rol: 'tecnico' });
    const cookie = contexto.request.headers.get('cookie');
    contexto.request = new Request(contexto.url, { method: 'POST', headers: { cookie }, body: fd });
    contexto.locals.runtime.env.R2 = { async put() {} };
    const res = await app.foto.POST(contexto);
    return { status: res.status, body: await res.json() };
  };
  let f = await subir('foto-prueba-1', 3);
  igual(f.status, 201, JSON.stringify(f.body));
  f = await subir('foto-prueba-1', 3);
  ok(f.body.repetida, 'El reintento no duplica la foto');
  igual(one('SELECT count(*) c FROM adjuntos WHERE orden_id=3').c, 1);
  f = await subir('foto-prueba-2', 1);
  igual(f.status, 409, 'Ya enviada a verificación, el técnico no agrega evidencia');

  // ── El reporte sale de lo capturado ──────────────────────────────────────
  const db = app.database.getDb(fixture.ctx('/x'));
  const rep = await app.reporte.reporteDeOrden(db, 1);
  igual(rep.codigo, 'OT-MG0001');
  igual(rep.version, 1);
  igual(rep.tiempos.inicio, hace(120));
  igual(rep.tiempos.fin, hace(40));
  igual(Math.round(rep.tiempos.efectivoMin), 50, '80 minutos menos 30 de pausa');
  igual(rep.tiempos.pausaMin, 30);
  igual(rep.tiempos.estimadoMin, 20);
  igual(rep.tiempos.diferenciaMin, 30);
  ok(rep.tiempos.marcasSinSenal >= 1);
  igual(rep.pasos.length, 3);
  igual(Math.round(rep.pasos[0].minutos), 10, 'De iniciar al primer paso');
  igual(Math.round(rep.pasos[1].minutos), 20, 'Los 30 minutos en pausa no se le cargan al paso');
  igual(rep.pasos[2].dentro, false, 'La lectura queda fuera de rango');
  igual(rep.lecturas.length, 1);
  igual(rep.novedades.length, 1);
  igual(rep.ubicacion, 'Quirófano 2');
  igual(rep.sede, 'Sede prueba');
  igual(rep.tecnico, 'Prueba tecnico');
  ok(rep.historial.some((h) => h.titulo === 'Pausa' && h.motivo === 'Falta repuesto'));
  ok(rep.historial.some((h) => h.titulo === 'Inició'));
  ok(rep.historial.some((h) => h.titulo === 'Reanudó'));
  ok(rep.historial.some((h) => h.titulo === 'Enviada a verificación'));
  igual(await app.reporte.reporteDeOrden(db, 99999), null);

  const hoyTxt = new Date(AHORA - 6 * 3600000).toISOString().slice(0, 10);
  const cons = await app.reporte.consolidadoMantenimiento(db, { desde: '2026-01-01', hasta: hoyTxt, sede: 1 });
  ok(cons.filas.some((x) => x.id === 1 && x.efectivoMin === 50 && x.novedades === 1 && x.tecnico === 'Prueba tecnico'), JSON.stringify(cons.filas[0]));
  igual((await app.reporte.consolidadoMantenimiento(db, { desde: '2020-01-01', hasta: '2020-01-02' })).filas.length, 0);
  igual((await app.reporte.consolidadoMantenimiento(db, { sede: 2 })).filas.length, 0);
  igual((await app.reporte.consolidadoMantenimiento(db, { tipo: 'emergencia' })).filas.length, 0);
  ok(cons.resumen.minutosEfectivos >= 50);
  igual(app.reporte.inicioDiaSV('2026-11-07'), '2026-11-07T06:00:00.000Z', 'El día empieza a las 06:00 UTC en El Salvador');
  const csv = await app.csv.GET(fixture.ctx('/api/reportes/mantenimiento?desde=2026-01-01', { rol: 'admin' }).request ? Object.assign(fixture.ctx('/api/reportes/mantenimiento?desde=2026-01-01', { rol: 'admin' }), { params: { tipo: 'mantenimiento' } }) : null);
  igual(csv.status, 200);
  const textoCsv = await csv.text();
  ok(textoCsv.includes('Minutos de trabajo') && textoCsv.includes('OT-MG0001'), textoCsv.slice(0, 200));

  // ── El código de la orden viaja al celular ───────────────────────────────
  const codigoDe = (id) => one('SELECT codigo c FROM ordenes WHERE id=?', id).c;
  const enLista = (lista, id) => lista.find((x) => x.id === id)?.codigo;
  seed(9001);
  seed(9002, { asignado: null });
  seed(9003, { estado: 'completada' });
  seed(9004, { estado: 'completada', asignado: 20 });
  sqlite.prepare('UPDATE ordenes SET completada_en=? WHERE id IN (9003,9004)').run(new Date().toISOString());
  sqlite.prepare('INSERT INTO orden_verificacion(orden_id, revisor_id) VALUES(9004, 3)').run();
  const paquete = (await call(app.hoy.GET, '/api/campo/hoy?sede=1', { rol: 'tecnico' })).body;
  ok(/^OT-MG\d{4}$/.test(codigoDe(9001)), codigoDe(9001));
  igual(enLista(paquete.ordenes, 9001), codigoDe(9001), 'Lista de trabajo');
  igual(enLista(paquete.libres, 9002), codigoDe(9002), 'Sin asignar');
  igual(enLista(paquete.hechasHoy, 9003), codigoDe(9003), 'Terminadas hoy');
  igual(enLista(paquete.porVerificar, 9004), codigoDe(9004), 'Por verificar');
  igual(paquete.ordenes.find((x) => x.id === 9001).activo.codigo, 'AC-01', 'El código del equipo sigue siendo del equipo');
  const fichaConOrden = (await call(app.equipo.GET, '/api/campo/equipo/1', { method: 'GET', id: 1, rol: 'tecnico' })).body;
  igual(enLista(fichaConOrden.abiertas, 9001), codigoDe(9001), 'Ficha del equipo');
  c = await crear({ activoId: 1, tipo: 'preventivo', descripcion: 'Revisión de ruido' });
  igual(c.status, 201, JSON.stringify(c.body));
  igual(c.body.orden.codigo, codigoDe(c.body.ordenId), 'La orden recién creada ya trae su código');
  sqlite.prepare("INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha) VALUES(90,2,'Semestral','semestral','2026-01-15')").run();
  seed(9100, { plan: 90, activo: 2, estado: 'completada' });
  c = await crear({ activoId: 2, planId: 90 });
  igual(c.status, 409);
  igual(c.body.error, `Este plan ya tiene la ${codigoDe(9100)} esperando verificación.`);

  // ══ La emergencia (EOP) y la intervención (MOP) también se trabajan en el celular ══
  // El paquete trae cómo se trabaja cada orden; nunca las horas de los hitos ni duraciones.
  const vistaDe = async (id) => { const pq = (await call(app.hoy.GET, '/api/campo/hoy?sede=1', { rol: 'tecnico' })).body; return pq.ordenes.concat(pq.libres).find((x) => x.id === id); };
  const sinHoras = (x) => !/hora_?(llegada|mitigacion|restablecimiento|alarma)|horasTrabajadas|duracion|tiempos/i.test(JSON.stringify(x));
  const llaves = (x) => Object.keys(x).sort().join();
  const eopEle = one("SELECT p.id, p.titulo, f.accion_1 a1, f.accion_2 a2, f.accion_3 a3, f.etiqueta_hora_mitigacion e FROM procedimientos p JOIN eop_ficha f ON f.procedimiento_id=p.id WHERE p.codigo_corto='EOP-ELE-01'");
  const emergencia = (id, extra = {}) => {
    seed(id, { tipo: 'emergencia', titulo: '[Emergencia] Falla de energía - AC-01', checklist: null, ...extra });
    sqlite.prepare("UPDATE ordenes SET procedimiento_id=?, hora_alarma=?, clase_prioridad='P1' WHERE id=?").run(extra.eop === undefined ? eopEle.id : extra.eop, hace(40), id);
  };

  // ── Emergencia: el EOP vinculado, tres pasos y tres toques ───────────────
  emergencia(9201);
  let v = await vistaDe(9201);
  igual(v.modo, 'emergencia');
  igual(llaves(v.eop), 'codigo,etiquetaMitigacion,titulo', 'El EOP viaja con lo justo');
  igual(v.eop.codigo, 'EOP-ELE-01');
  igual(v.eop.titulo, eopEle.titulo);
  igual(v.eop.etiquetaMitigacion, eopEle.e, 'El rótulo del toque intermedio sale de la ficha del EOP');
  igual(JSON.stringify(v.hitos), JSON.stringify({ llegada: false, mitigacion: false, restablecimiento: false }));
  igual(v.pasos.map((x) => x.texto).join('|'), [eopEle.a1, eopEle.a2, eopEle.a3].join('|'), 'Las tres primeras acciones del EOP, como pasos');
  ok(v.pasos.every((x, i) => x.idx === i && x.estado === 'pendiente' && x.critico === false && x.nota === null && x.pideValor === false));
  ok(sinHoras(v), JSON.stringify(v));
  ok(!('pideCausaRaiz' in v) && !('causaRaiz' in v), 'El celular ni pide ni muestra la causa raíz');
  igual(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=9201').c, null, 'Ver el paquete no escribe nada');

  // Sin vínculo, el EOP sale del equipo; sin equipo ni vínculo, no hay EOP.
  emergencia(9202, { activo: 2, eop: null });
  const eopMsp = one("SELECT p.titulo, f.accion_1 a1, f.etiqueta_hora_mitigacion e FROM procedimientos p JOIN eop_ficha f ON f.procedimiento_id=p.id WHERE p.codigo_corto='EOP-MSP-01'");
  v = await vistaDe(9202);
  igual(v.eop.codigo, 'EOP-MSP-01', JSON.stringify(v.eop));
  igual(v.eop.etiquetaMitigacion, eopMsp.e);
  igual(v.pasos[0].texto, eopMsp.a1);
  emergencia(9203, { activo: null, eop: null });
  v = await vistaDe(9203);
  igual(JSON.stringify(v.eop), JSON.stringify({ codigo: null, titulo: null, etiquetaMitigacion: 'Situación controlada' }));
  igual(v.pasos.length, 0);

  // «Llegué»: la hora del toque, sin iniciar la orden. El primer toque manda.
  const llegue = op('emergencia.hito', hace(20), { ordenId: 9201, hito: 'llegada' });
  [r] = await enviar([llegue]);
  ok(r.ok, JSON.stringify(r));
  let e = one('SELECT * FROM ordenes WHERE id=9201');
  igual(e.hora_llegada, hace(20), 'La hora es la del toque');
  igual(e.estado, 'abierta', '«Llegué» no inicia la orden');
  [r] = await enviar([llegue]);
  ok(r.ok && r.repetida, 'El reintento no se aplica dos veces');
  [r] = await enviar([op('emergencia.hito', hace(5), { ordenId: 9201, hito: 'llegada' })]);
  ok(r.ok && r.datos?.yaRegistrada, JSON.stringify(r));
  igual(one('SELECT hora_llegada h FROM ordenes WHERE id=9201').h, hace(20), 'Un segundo toque no mueve la hora');
  [r] = await enviar([op('emergencia.hito', hace(1), { ordenId: 9201, hito: 'otro' })]);
  ok(!r.ok, 'Solo existen los tres toques');
  [r] = await enviar([op('emergencia.hito', hace(1), { ordenId: 3, hito: 'llegada' })]);
  ok(!r.ok && /no es una emergencia/.test(r.error), JSON.stringify(r));

  // Iniciar guarda las acciones del EOP como checklist, una sola vez.
  [r] = await enviar([op('orden.iniciar', hace(19), { ordenId: 9201 })]);
  ok(r.ok, JSON.stringify(r));
  e = one('SELECT * FROM ordenes WHERE id=9201');
  igual(e.estado, 'en_proceso');
  const sembrado = JSON.parse(e.checklist_ejecucion);
  igual(sembrado.map((x) => x.texto).join('|'), [eopEle.a1, eopEle.a2, eopEle.a3].join('|'), 'Los mismos textos que mandó el paquete');
  ok(sembrado.every((x) => x.estado === 'pendiente'));
  [r] = await enviar([op('orden.paso', hace(18), { ordenId: 9201, idx: 0, texto: eopEle.a1, estado: 'ok' })]);
  ok(r.ok, JSON.stringify(r));
  [r] = await enviar([op('orden.iniciar', hace(17), { ordenId: 9201 })]);
  ok(r.ok, JSON.stringify(r));
  const despues = JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=9201').c);
  igual(despues.length, 3, 'No se vuelve a sembrar');
  igual(despues[0].estado, 'ok', 'Lo marcado se conserva');
  // Sembrar es una sola vez, también si dos operaciones llegan a la vez con la orden vieja en la mano.
  const dbPrueba = app.database.getDb(fixture.ctx('/x'));
  const fila9201 = await dbPrueba.query.ordenes.findFirst({ where: (t, { eq }) => eq(t.id, 9201) });
  const antesDeSembrar = fixture.queries.length;
  igual(await app.eop.sembrarAccionesEop(fixture.ctx('/x'), dbPrueba, fila9201), fila9201, 'Con pasos no se siembra');
  igual(fixture.queries.length, antesDeSembrar, 'Ni se consulta nada');
  const tarde = await app.eop.sembrarAccionesEop(fixture.ctx('/x'), dbPrueba, { ...fila9201, checklistEjecucion: null });
  igual(JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=9201').c)[0].estado, 'ok', 'La que llega tarde no pisa lo marcado');
  igual(tarde.checklistEjecucion, one('SELECT checklist_ejecucion c FROM ordenes WHERE id=9201').c, 'Y sigue con lo que quedó guardado');
  // Situación controlada antes de la llegada no puede ser: queda en la hora de llegada.
  [r] = await enviar([op('emergencia.hito', hace(25), { ordenId: 9201, hito: 'mitigacion' })]);
  ok(r.ok, JSON.stringify(r));
  igual(one('SELECT hora_mitigacion h FROM ordenes WHERE id=9201').h, hace(20), 'Un hito no queda antes del anterior');
  v = await vistaDe(9201);
  igual(JSON.stringify(v.hitos), JSON.stringify({ llegada: true, mitigacion: true, restablecimiento: false }));
  igual(v.pasos[0].estado, 'ok');
  ok(sinHoras(v), 'Con horas registradas, el paquete tampoco las trae');
  // Terminar sin causa raíz: la escribe la jefatura dentro de las 72 h.
  await enviar([
    op('orden.paso', hace(12), { ordenId: 9201, idx: 1, texto: eopEle.a2, estado: 'na', nota: 'La transferencia pasó la carga sola.' }),
    op('orden.paso', hace(11), { ordenId: 9201, idx: 2, texto: eopEle.a3, estado: 'ok' }),
    op('emergencia.hito', hace(10), { ordenId: 9201, hito: 'restablecimiento' }),
  ]);
  igual(one('SELECT hora_restablecimiento h FROM ordenes WHERE id=9201').h, hace(10));
  [r] = await enviar([op('orden.terminar', hace(9), { ordenId: 9201, nota: 'Encontré la planta sin arrancar; la arranqué en manual y se restableció la red.' })]);
  ok(r.ok, JSON.stringify(r));
  e = one('SELECT * FROM ordenes WHERE id=9201');
  igual(e.estado, 'completada', 'Se envía a verificación sin causa raíz');
  igual(e.causa_raiz, null);
  ok(e.trabajos_realizados.includes('Encontré la planta sin arrancar'), e.trabajos_realizados);
  // Ya enviada, la hora la corrige la jefatura en la ficha.
  emergencia(9206, { estado: 'completada' });
  [r] = await enviar([op('emergencia.hito', hace(3), { ordenId: 9206, hito: 'llegada' })]);
  ok(!r.ok && /verificación/.test(r.error), JSON.stringify(r));
  const tardias = await enviar([op('orden.iniciar', hace(3), { ordenId: 9206 }), op('orden.paso', hace(3), { ordenId: 9206, idx: 0, texto: eopEle.a1, estado: 'ok' })]);
  ok(tardias.every((x) => !x.ok), JSON.stringify(tardias));
  igual(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=9206').c, null, 'Enviada a verificación, ya no se le siembran pasos');
  const fila9206 = await dbPrueba.query.ordenes.findFirst({ where: (t, { eq }) => eq(t.id, 9206) });
  const antes9206 = fixture.queries.length;
  igual(await app.eop.sembrarAccionesEop(fixture.ctx('/x'), dbPrueba, fila9206), fila9206);
  igual(fixture.queries.length, antes9206, 'Ni lo intenta');
  await app.eop.sembrarAccionesEop(fixture.ctx('/x'), dbPrueba, { ...fila9206, estado: 'en_proceso' });
  igual(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=9206').c, null, 'Con la orden vieja en la mano, tampoco');

  // Una emergencia que se empezó en la ficha recibe sus pasos con el primer paso marcado.
  sqlite.prepare("UPDATE ordenes SET estado='en_proceso', iniciada_en=? WHERE id=9202").run(hace(30));
  const pasosMsp = (await vistaDe(9202)).pasos;
  [r] = await enviar([op('orden.paso', hace(8), { ordenId: 9202, idx: 1, texto: 'Otro texto', estado: 'ok' })]);
  ok(!r.ok && /cambi/i.test(r.error), 'Si el EOP cambió, no se marca el paso equivocado');
  [r] = await enviar([op('orden.paso', hace(7), { ordenId: 9202, idx: 1, texto: pasosMsp[1].texto, estado: 'ok' })]);
  ok(r.ok, JSON.stringify(r));
  const msp = JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=9202').c);
  igual(msp.map((x) => x.texto).join('|'), pasosMsp.map((x) => x.texto).join('|'));
  igual(msp.map((x) => x.estado).join(), 'pendiente,ok,pendiente');
  igual(one('SELECT count(*) c FROM orden_paso_marcas WHERE orden_id=9202').c, 1);
  // Un celular viejo que todavía manda causa raíz: lo que vio el técnico queda en los trabajos.
  await enviar([0, 2].map((i) => op('orden.paso', hace(6), { ordenId: 9202, idx: i, texto: pasosMsp[i].texto, estado: 'ok' })));
  [r] = await enviar([op('orden.terminar', hace(5), { ordenId: 9202, nota: 'Unidad sin energía, área segura.', causaRaiz: 'Capacitor del compresor inflado' })]);
  ok(r.ok, JSON.stringify(r));
  e = one('SELECT * FROM ordenes WHERE id=9202');
  igual(e.causa_raiz, null, 'La causa raíz no la escribe el técnico');
  ok(e.trabajos_realizados.includes('Causa probable según el técnico: Capacitor del compresor inflado'), e.trabajos_realizados);

  // Permisos: solo el técnico asignado o la jefatura. Una emergencia libre la toma quien llega.
  emergencia(9204, { asignado: 20 });
  [r] = await enviar([op('emergencia.hito', hace(4), { ordenId: 9204, hito: 'llegada' })]);
  ok(!r.ok && /otra persona/.test(r.error), JSON.stringify(r));
  igual(one('SELECT hora_llegada h FROM ordenes WHERE id=9204').h, null);
  [r] = await enviar([op('orden.iniciar', hace(4), { ordenId: 9204 })]);
  ok(!r.ok);
  igual(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=9204').c, null, 'Una operación rechazada no siembra nada');
  [r] = await enviar([op('emergencia.hito', hace(4), { ordenId: 9204, hito: 'llegada' })], 'jefe');
  ok(r.ok, 'La jefatura sí puede');
  igual(one('SELECT hora_llegada h FROM ordenes WHERE id=9204').h, hace(4));
  emergencia(9205, { asignado: null });
  ok((await call(app.hoy.GET, '/api/campo/hoy?sede=1', { rol: 'tecnico' })).body.libres.some((x) => x.id === 9205 && x.modo === 'emergencia'));
  [r] = await enviar([op('emergencia.hito', hace(3), { ordenId: 9205, hito: 'llegada' })]);
  ok(r.ok, JSON.stringify(r));
  e = one('SELECT * FROM ordenes WHERE id=9205');
  igual(e.asignado_a, 3, 'Quien llega la toma');
  igual(e.estado, 'abierta');

  // ── Intervención: prerrequisitos, liberaciones y reversa ─────────────────
  const intervencion = (id, extra = {}) => {
    seed(id, { tipo: 'intervencion', titulo: '[Intervención] Cambio de compresor - AC-01', checklist: null, ...extra });
    sqlite.prepare("UPDATE ordenes SET plan_reversa='Si el equipo nuevo no arranca, reinstalar el compresor original.' WHERE id=?").run(id);
    sqlite.prepare("INSERT INTO orden_prerrequisitos(orden_id,texto,tipo,obligatorio,orden) VALUES(?,?,?,?,1),(?,?,?,?,2)").run(id, 'Permiso de trabajo firmado', 'permiso_trabajo', 1, id, 'Aviso a enfermería', 'notificacion', 0);
    sqlite.prepare("INSERT INTO orden_liberaciones(orden_id,etiqueta,unidad,valor_esperado,min_aceptable,max_aceptable,obligatoria,orden) VALUES(?,?,?,?,?,?,?,1),(?,?,?,?,?,?,?,2)")
      .run(id, 'Corriente de arranque', 'A', '8 a 12 A', 8, 12, 1, id, 'Fugas en uniones', null, 'Sin fugas', null, null, 1);
    const ids = all('SELECT id FROM orden_prerrequisitos WHERE orden_id=? ORDER BY orden', id).map((x) => x.id);
    const libs = all('SELECT id FROM orden_liberaciones WHERE orden_id=? ORDER BY orden', id).map((x) => x.id);
    return { permiso: ids[0], aviso: ids[1], corriente: libs[0], fugas: libs[1] };
  };
  const mop = intervencion(9301);
  v = await vistaDe(9301);
  igual(v.modo, 'intervencion');
  igual(v.prerrequisitos.length, 2);
  igual(llaves(v.prerrequisitos[0]), 'cumplido,id,obligatorio,pista,referencia,texto,tipo');
  igual(JSON.stringify(v.prerrequisitos[0]), JSON.stringify({ id: mop.permiso, texto: 'Permiso de trabajo firmado', tipo: 'permiso_trabajo', obligatorio: true, cumplido: false, referencia: null, pista: app.reglas.PRERREQ_REFERENCIA_HINT.permiso_trabajo }));
  igual(v.prerrequisitos[1].obligatorio, false);
  igual(llaves(v.liberaciones[0]), 'conforme,esperado,etiqueta,id,max,medida,min,obligatoria,unidad,valor');
  igual(JSON.stringify(v.liberaciones[0]), JSON.stringify({ id: mop.corriente, etiqueta: 'Corriente de arranque', unidad: 'A', esperado: '8 a 12 A', min: 8, max: 12, obligatoria: true, medida: false, valor: null, conforme: null }));
  igual(JSON.stringify(v.reversa), JSON.stringify({ plan: 'Si el equipo nuevo no arranca, reinstalar el compresor original.', ejecutada: false }));
  igual(v.pasos.length, 0);
  ok(sinHoras(v));

  // No arranca sin el permiso; el permiso se marca con su referencia y su hora.
  [r] = await enviar([op('orden.iniciar', hace(16), { ordenId: 9301 })]);
  ok(!r.ok && /prerrequisito/.test(r.error), JSON.stringify(r));
  [r] = await enviar([op('mop.prerrequisito', hace(16), { ordenId: 9301, prerrequisitoId: mop.permiso, referencia: 'x' })]);
  ok(!r.ok && /referencia/.test(r.error), JSON.stringify(r));
  const permiso = op('mop.prerrequisito', hace(15), { ordenId: 9301, prerrequisitoId: mop.permiso, referencia: 'PT-0457, lo emitió J. Pérez' });
  [r] = await enviar([permiso]);
  ok(r.ok, JSON.stringify(r));
  let pre = one('SELECT * FROM orden_prerrequisitos WHERE id=?', mop.permiso);
  igual(pre.cumplido, 1);
  igual(pre.cumplido_por, 3);
  igual(pre.cumplido_en, hace(15), 'La hora es la del toque, no la de la señal');
  igual(pre.referencia, 'PT-0457, lo emitió J. Pérez');
  [r] = await enviar([permiso]);
  ok(r.repetida);
  [r] = await enviar([op('mop.prerrequisito', hace(15), { ordenId: 9301, prerrequisitoId: 999999, referencia: 'PT-1' })]);
  ok(!r.ok && /no encontrado/.test(r.error), JSON.stringify(r));
  [r] = await enviar([op('orden.iniciar', hace(14), { ordenId: 9301 })]);
  ok(r.ok, JSON.stringify(r));
  igual(one('SELECT estado FROM ordenes WHERE id=9301').estado, 'en_proceso');

  // La lectura: número con coma o texto, con su hora y si quedó en rango.
  [r] = await enviar([op('mop.liberacion', hace(10), { ordenId: 9301, liberacionId: mop.corriente, valor: '14,5' })]);
  ok(r.ok && r.datos?.conforme === false, JSON.stringify(r));
  let lib = one('SELECT * FROM orden_liberaciones WHERE id=?', mop.corriente);
  igual(lib.valor_medido, 14.5);
  igual(lib.conforme, 0);
  igual(lib.medido_en, hace(10));
  igual(lib.medido_por, 3);
  [r] = await enviar([op('mop.liberacion', hace(9), { ordenId: 9301, liberacionId: mop.fugas, valor: 'Sin fugas con espuma' })]);
  ok(r.ok, JSON.stringify(r));
  lib = one('SELECT * FROM orden_liberaciones WHERE id=?', mop.fugas);
  igual(lib.valor_medido_texto, 'Sin fugas con espuma');
  igual(lib.valor_medido, null);
  igual(lib.conforme, null, 'Sin rango no se juzga');
  [r] = await enviar([op('mop.liberacion', hace(9), { ordenId: 9301, liberacionId: mop.fugas, valor: '  ' })]);
  ok(!r.ok, 'Una lectura vacía no borra la anterior');
  igual(one('SELECT valor_medido_texto t FROM orden_liberaciones WHERE id=?', mop.fugas).t, 'Sin fugas con espuma');
  v = await vistaDe(9301);
  igual(JSON.stringify(v.liberaciones.map((x) => [x.medida, x.valor, x.conforme])), JSON.stringify([[true, 14.5, false], [true, 'Sin fugas con espuma', null]]));

  // Fuera de rango no se envía a verificación; con la reversa ejecutada, sí.
  [r] = await enviar([op('orden.terminar', hace(8), { ordenId: 9301, nota: 'Compresor nuevo instalado.' })]);
  ok(!r.ok && /fuera de rango/.test(r.error) && /reversa/.test(r.error), JSON.stringify(r));
  igual(one('SELECT estado FROM ordenes WHERE id=9301').estado, 'en_proceso');
  [r] = await enviar([op('mop.reversa', hace(7), { ordenId: 9301, notas: 'corto' })]);
  ok(!r.ok && /10/.test(r.error), JSON.stringify(r));
  const reversa = op('mop.reversa', hace(6), { ordenId: 9301, notas: 'Se reinstaló el compresor original; el equipo quedó como estaba.' });
  [r] = await enviar([reversa]);
  ok(r.ok, JSON.stringify(r));
  [r] = await enviar([reversa]);
  ok(r.repetida);
  e = one('SELECT * FROM ordenes WHERE id=9301');
  igual(e.reversa_ejecutada, 1);
  igual(e.reversa_notas, 'Se reinstaló el compresor original; el equipo quedó como estaba.');
  igual((await vistaDe(9301)).reversa.ejecutada, true);
  [r] = await enviar([op('orden.terminar', hace(4), { ordenId: 9301, nota: 'Se revirtió: arranque fuera de rango.' })]);
  ok(r.ok, JSON.stringify(r));
  e = one('SELECT * FROM ordenes WHERE id=9301');
  igual(e.estado, 'completada');
  ok(e.trabajos_realizados.includes('Lecturas de liberación: Corriente de arranque: 14.5 A; Fugas en uniones: Sin fugas con espuma.'), e.trabajos_realizados);
  ok(e.trabajos_realizados.includes('Reversa ejecutada: Se reinstaló el compresor original; el equipo quedó como estaba.'), e.trabajos_realizados);
  [r] = await enviar([op('mop.liberacion', hace(3), { ordenId: 9301, liberacionId: mop.corriente, valor: '10' })]);
  ok(!r.ok && /verificación/.test(r.error), 'Enviada a verificación, el técnico ya no cambia lecturas');

  // Dentro de rango se envía; sin la lectura obligatoria, no.
  const enRango = intervencion(9304);
  await enviar([
    op('mop.prerrequisito', hace(30), { ordenId: 9304, prerrequisitoId: enRango.permiso, referencia: 'PT-0458' }),
    op('orden.iniciar', hace(29), { ordenId: 9304 }),
    op('mop.liberacion', hace(20), { ordenId: 9304, liberacionId: enRango.fugas, valor: 'Sin fugas' }),
  ]);
  [r] = await enviar([op('orden.terminar', hace(19), { ordenId: 9304, nota: 'Compresor cambiado.' })]);
  ok(!r.ok && /lectura/.test(r.error), JSON.stringify(r));
  // Escrita con su unidad, la lectura se juzga igual por su número.
  [r] = await enviar([op('mop.liberacion', hace(18.5), { ordenId: 9304, liberacionId: enRango.corriente, valor: '13 A' })]);
  ok(r.ok && r.datos?.conforme === false, JSON.stringify(r));
  [r] = await enviar([op('orden.terminar', hace(18.4), { ordenId: 9304, nota: 'Compresor cambiado.' })]);
  ok(!r.ok && /fuera de rango/.test(r.error) && /13 A/.test(r.error), JSON.stringify(r));
  await enviar([op('mop.liberacion', hace(18), { ordenId: 9304, liberacionId: enRango.corriente, valor: 10.2 })]);
  lib = one('SELECT * FROM orden_liberaciones WHERE id=?', enRango.corriente);
  ok(lib.valor_medido === 10.2 && lib.valor_medido_texto === null && lib.conforme === 1, 'Una lectura nueva reemplaza la anterior');
  [r] = await enviar([op('orden.terminar', hace(17), { ordenId: 9304, nota: 'Compresor cambiado.' })]);
  ok(r.ok, JSON.stringify(r));
  igual(one('SELECT estado FROM ordenes WHERE id=9304').estado, 'completada');
  // K4 por el celular: con rango, la lectura trae su número; sin número se rechaza con la frase de la ficha y no se guarda.
  const conRango = intervencion(9305);
  await enviar([op('mop.prerrequisito', hace(16), { ordenId: 9305, prerrequisitoId: conRango.permiso, referencia: 'PT-0461' }), op('orden.iniciar', hace(15), { ordenId: 9305 })]);
  [r] = await enviar([op('mop.liberacion', hace(14), { ordenId: 9305, liberacionId: conRango.corriente, valor: 'Normal' })]);
  igual(r.error, 'Esta lectura tiene rango: anota el número que marcó el instrumento (por ejemplo 14,5).', JSON.stringify(r));
  lib = one('SELECT * FROM orden_liberaciones WHERE id=?', conRango.corriente);
  ok(lib.valor_medido === null && lib.valor_medido_texto === null && lib.medido_en === null, 'Y no queda como medida');
  [r] = await enviar([op('mop.liberacion', hace(13), { ordenId: 9305, liberacionId: conRango.corriente, valor: '9,8 A' })]);
  ok(r.ok && r.datos?.conforme === true, JSON.stringify(r));

  // Permisos: la intervención de otro no se toca; una libre la toma quien empieza.
  const ajena = intervencion(9302, { asignado: 20 });
  [r] = await enviar([op('mop.prerrequisito', hace(2), { ordenId: 9302, prerrequisitoId: ajena.permiso, referencia: 'PT-0459' })]);
  ok(!r.ok && /otra persona/.test(r.error), JSON.stringify(r));
  igual(one('SELECT cumplido FROM orden_prerrequisitos WHERE id=?', ajena.permiso).cumplido, 0);
  [r] = await enviar([op('mop.liberacion', hace(2), { ordenId: 9302, liberacionId: ajena.corriente, valor: '10' })]);
  ok(!r.ok && /asignada a ti/.test(r.error), JSON.stringify(r));
  igual(one('SELECT valor_medido v FROM orden_liberaciones WHERE id=?', ajena.corriente).v, null);
  [r] = await enviar([op('mop.reversa', hace(2), { ordenId: 9302, notas: 'Intento revertir una orden ajena.' })]);
  ok(!r.ok);
  igual(one('SELECT reversa_ejecutada x FROM ordenes WHERE id=9302').x, 0);
  [r] = await enviar([op('mop.prerrequisito', hace(2), { ordenId: 9302, prerrequisitoId: ajena.permiso, referencia: 'PT-0459' })], 'jefe');
  ok(r.ok, 'La jefatura sí puede');
  const libre = intervencion(9303, { asignado: null });
  [r] = await enviar([op('mop.prerrequisito', hace(1), { ordenId: 9303, prerrequisitoId: libre.permiso, referencia: 'PT-0460' })]);
  ok(r.ok, JSON.stringify(r));
  igual(one('SELECT asignado_a a FROM ordenes WHERE id=9303').a, 3, 'Una intervención libre la toma quien empieza por sus prerrequisitos');
  igual(one('SELECT cumplido_por p FROM orden_prerrequisitos WHERE id=?', libre.permiso).p, 3);

  // ── La reversa ya marcada (J4-B1): la marca no se toca y lo que escribió el técnico se agrega debajo ──
  intervencion(9310);
  const NOTAS_JEFATURA = 'Jefatura: se volvió al tablero B y se avisó a quirófano.';
  const NOTAS_TECNICO = 'Técnico: el interruptor nuevo no cerró; quedó el anterior.';
  const juntas = `${NOTAS_JEFATURA}\n\nTécnico (celular): ${NOTAS_TECNICO}`;
  sqlite.prepare("UPDATE ordenes SET estado='en_proceso', iniciada_en=?, reversa_ejecutada=1, reversa_notas=? WHERE id=9310").run(hace(30), NOTAS_JEFATURA);
  const reversaTarde = op('mop.reversa', hace(5), { ordenId: 9310, notas: NOTAS_TECNICO });
  [r] = await enviar([reversaTarde]);
  ok(r.ok && r.datos?.yaRegistrada === true, `La reversa que la jefatura ya marcó se acepta: ${JSON.stringify(r)}`);
  e = one('SELECT * FROM ordenes WHERE id=9310');
  igual(e.reversa_ejecutada, 1, 'La marca no se toca');
  igual(e.reversa_notas, juntas, 'Quedan las notas de la jefatura y debajo las del técnico');
  [r] = await enviar([reversaTarde]);
  ok(r.repetida, 'El reintento no las agrega dos veces');
  for (const notas of [NOTAS_TECNICO, NOTAS_JEFATURA]) {
    [r] = await enviar([op('mop.reversa', hace(4), { ordenId: 9310, notas })]);
    ok(r.ok && r.datos?.yaRegistrada && one('SELECT reversa_notas n FROM ordenes WHERE id=9310').n === juntas, `Lo que ya está escrito no se repite: ${notas}`);
  }
  // Ya enviada a verificación, la evidencia no cambia: las notas le llegan a la jefatura y quedan en el registro.
  sqlite.prepare("UPDATE ordenes SET estado='completada', completada_en=? WHERE id=9310").run(hace(3));
  [r] = await enviar([op('mop.reversa', hace(2), { ordenId: 9310, notas: 'Técnico: dejé etiquetado el interruptor que falló.' })]);
  ok(r.ok && r.datos?.yaRegistrada && r.datos?.notasTardias === 'Técnico: dejé etiquetado el interruptor que falló.', JSON.stringify(r));
  igual(one('SELECT reversa_notas n FROM ordenes WHERE id=9310').n, juntas, 'Enviada a verificación, las notas de la orden no cambian');
  ok(JSON.parse(one('SELECT detalle d FROM campo_operaciones WHERE op_id=?', r.opId).d).notasTardias, 'Lo escrito queda en el registro de la operación');

  // ── K6: un número escrito a mano se lee con la misma regla en todas partes ──
  // Coma o punto decimal. El separador de miles no se adivina: «1,200» vuelve con su frase y no se guarda.
  const AMBIGUO = '¿1200 o 1,2? Escribe el número sin separador de miles.';
  seed(9501);
  await enviar([op('orden.iniciar', hace(9), { ordenId: 9501 })]);
  const pasoMedir = () => JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=9501').c)[2];
  [r] = await enviar([op('orden.paso', hace(8), { ordenId: 9501, idx: 2, texto: 'Medir corriente', estado: 'ok', valor: '1,200' })]);
  igual(r.error, AMBIGUO, 'El valor de un paso que se puede leer de dos formas se rechaza con su frase');
  ok(pasoMedir().estado === 'pendiente' && pasoMedir().valorMedido === undefined && !one('SELECT id FROM orden_paso_marcas WHERE orden_id=9501'), 'Y no se guarda nada');
  [r] = await enviar([op('orden.paso', hace(7), { ordenId: 9501, idx: 2, texto: 'Medir corriente', estado: 'ok', valor: '9,8' })]);
  ok(r.ok && pasoMedir().valorMedido === 9.8, `Con coma decimal se lee 9,8 y se guarda como número: ${JSON.stringify(pasoMedir())}`);
  [r] = await enviar([op('orden.paso', hace(6), { ordenId: 9501, idx: 2, texto: 'Medir corriente', estado: 'ok', valor: 1200 })]);
  ok(r.ok && pasoMedir().valorMedido === 1200, 'Un valor que ya llega como número se acepta tal cual');
  igual(one('SELECT valor v FROM orden_paso_marcas WHERE orden_id=9501 ORDER BY id DESC LIMIT 1').v, '1200', 'También en el libro');
  // 12.345 llega como número: guardado como número, no vuelve a leerse como «12.345», que sería ambiguo.
  [r] = await enviar([op('orden.paso', hace(5.5), { ordenId: 9501, idx: 2, texto: 'Medir corriente', estado: 'desviacion', valor: 12.345, nota: 'Corriente alta en el compresor' })]);
  ok(r.ok && pasoMedir().valorMedido === 12.345, `Un número con tres decimales también se acepta: ${JSON.stringify(r)}`);
  // K7: en el libro va escrito con textoDeNumero, para que se vuelva a leer igual: «12.345» sería ambiguo.
  igual(one('SELECT valor v FROM orden_paso_marcas WHERE orden_id=9501 ORDER BY id DESC LIMIT 1').v, '12.3450', 'Y queda en el libro como «12.3450»');
  const ronda2 = (await call(app.hoy.GET, '/api/campo/hoy?sede=2', { rol: 'tecnico' })).body.ronda;
  const temp2 = ronda2.puntos.find((x) => x.pideValor && x.min != null && x.max != null);
  const clave2 = { rondaId: ronda2.rondaId, sucursalId: 2, fecha: ronda2.fecha, turno: ronda2.turno };
  [r] = await enviar([op('ronda.lectura', enRonda(5), { ...clave2, puntoId: temp2.id, resultado: 'ok', valor: '1,200' })]);
  igual(r.error, AMBIGUO, 'En una parada de ronda, también');
  ok(!one('SELECT id FROM ronda_ejecuciones WHERE sucursal_id=2'), 'Y no abre la ronda');
  const lecturaSede2 = () => one('SELECT l.valor v, l.resultado r FROM ronda_lecturas l JOIN ronda_ejecuciones x ON x.id = l.ejecucion_id WHERE x.sucursal_id = 2 AND l.punto_id = ?', temp2.id);
  [r] = await enviar([op('ronda.lectura', enRonda(4), { ...clave2, puntoId: temp2.id, resultado: 'ok', valor: `${temp2.min},5` })]);
  ok(r.ok && lecturaSede2().v === temp2.min + 0.5 && lecturaSede2().r === 'ok', `Con coma decimal se lee el número: ${JSON.stringify(lecturaSede2())}`);
  [r] = await enviar([op('ronda.lectura', enRonda(3), { ...clave2, puntoId: temp2.id, resultado: 'ok', valor: temp2.max + 3 })]);
  ok(r.ok && r.datos.eventoId && lecturaSede2().v === temp2.max + 3 && lecturaSede2().r === 'fuera', 'Un número que ya llega como número se acepta tal cual; fuera de rango abre su AOP');
  const eventosAntes = one('SELECT count(*) n FROM aop_eventos').n;
  [r] = await enviar([op('aop.abrir', hace(2), { procedimientoId: aop.id, activoId: 2, valor: '1.200', nota: 'CO₂ alto' })]);
  ok(r.error === AMBIGUO && one('SELECT count(*) n FROM aop_eventos').n === eventosAntes, `En una desviación, también: ${r.error}`);

  // ── K8: en un paso con rango, lo escrito es el número que marcó el instrumento ──
  // «Medir corriente» va de 8 a 12 A. Un texto que no es número se rechaza con su frase y no se guarda nada.
  seed(9502, { checklist: JSON.stringify([...JSON.parse(CHECKLIST), { texto: 'Anotar la placa del motor', requiereValor: true, estado: 'pendiente' }]) });
  await enviar([op('orden.iniciar', hace(9), { ordenId: 9502 })]);
  const paso9502 = (i) => JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=9502').c)[i];
  for (const escrito of ['14,5 A', 'ok']) {
    const consultasAntes = fixture.queries.length;
    [r] = await enviar([op('orden.paso', hace(8), { ordenId: 9502, idx: 2, texto: 'Medir corriente', estado: 'ok', valor: escrito })]);
    igual(r.error, app.reglas.MENSAJE_PASO_SIN_NUMERO, `«${escrito}» en un paso de 8 a 12 A se rechaza con su frase: ${JSON.stringify(r)}`);
    ok(!fixture.queries.slice(consultasAntes).some((q) => /orden_verificacion/.test(q.sql)), `«${escrito}» se rechaza en la ruta del celular, antes de llegar a las reglas de la ficha`);
  }
  ok(paso9502(2).estado === 'pendiente' && paso9502(2).valorMedido === undefined && !one('SELECT id FROM orden_paso_marcas WHERE orden_id=9502'), `Y no se guarda nada: ${JSON.stringify(paso9502(2))}`);
  [r] = await enviar([op('orden.paso', hace(7), { ordenId: 9502, idx: 2, texto: 'Medir corriente', estado: 'desviacion', valor: '14,5', nota: 'Sobre el rango' })]);
  ok(r.ok && paso9502(2).valorMedido === 14.5 && paso9502(2).estado === 'desviacion', `«14,5» se guarda como número: ${JSON.stringify(paso9502(2))}`);
  igual(one('SELECT valor v FROM orden_paso_marcas WHERE orden_id=9502 ORDER BY id DESC LIMIT 1').v, '14.5', 'Y en el libro');
  // En un paso sin rango, lo escrito se guarda tal cual, como hoy.
  [r] = await enviar([op('orden.paso', hace(6), { ordenId: 9502, idx: 3, texto: 'Anotar la placa del motor', estado: 'ok', valor: ' 14,5 A ' })]);
  ok(r.ok && paso9502(3).valorMedido === '14,5 A', `En un paso sin rango, el texto sigue como hoy: ${JSON.stringify(paso9502(3))}`);
  // El mismo texto que ya estaba guardado (de antes de esta versión) no es un cambio: el paso se marca y el texto queda.
  sqlite.prepare('UPDATE ordenes SET checklist_ejecucion=? WHERE id=9502').run(JSON.stringify(JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=9502').c).map((x, i) => (i === 2 ? { ...x, valorMedido: 'ok', estado: 'pendiente' } : x))));
  [r] = await enviar([op('orden.paso', hace(5), { ordenId: 9502, idx: 2, texto: 'Medir corriente', estado: 'ok', valor: 'ok' })]);
  ok(r.ok && paso9502(2).estado === 'ok' && paso9502(2).valorMedido === 'ok', `El texto que ya estaba no se rechaza: ${JSON.stringify(r)}`);
  [r] = await enviar([op('orden.paso', hace(4), { ordenId: 9502, idx: 2, texto: 'Medir corriente', estado: 'ok', valor: 'aprox 10' })]);
  igual(r.error, app.reglas.MENSAJE_PASO_SIN_NUMERO, 'Otro texto, sí');
  igual(paso9502(2).valorMedido, 'ok', 'Y lo guardado no cambia');
  // K6: un número que se lee de dos formas y que ya estaba guardado así (de antes de esta versión) no es un cambio:
  // comparado recortado, no se rechaza y queda como estaba, con rango o sin él. Uno distinto, sí, con su frase.
  sqlite.prepare('UPDATE ordenes SET checklist_ejecucion=? WHERE id=9502').run(JSON.stringify(JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=9502').c).map((x, i) => (i === 2 || i === 3 ? { ...x, valorMedido: '1,200', estado: 'pendiente' } : x))));
  [r] = await enviar([op('orden.paso', hace(3.5), { ordenId: 9502, idx: 3, texto: 'Anotar la placa del motor', estado: 'ok', valor: ' 1,200 ' })]);
  ok(r.ok && paso9502(3).estado === 'ok' && paso9502(3).valorMedido === '1,200', `El mismo «1,200» que ya estaba no se rechaza: ${JSON.stringify(r)}`);
  igual(one('SELECT valor v FROM orden_paso_marcas WHERE orden_id=9502 AND paso_idx=3 ORDER BY id DESC LIMIT 1').v, '1,200', 'Y en el libro queda como estaba');
  // Lo guardado también se compara recortado: con «1,200 » guardado, «1,200» no es un cambio.
  sqlite.prepare('UPDATE ordenes SET checklist_ejecucion=? WHERE id=9502').run(JSON.stringify(JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=9502').c).map((x, i) => (i === 3 ? { ...x, valorMedido: '1,200 ', estado: 'pendiente' } : x))));
  [r] = await enviar([op('orden.paso', hace(3.45), { ordenId: 9502, idx: 3, texto: 'Anotar la placa del motor', estado: 'ok', valor: '1,200' })]);
  ok(r.ok && paso9502(3).estado === 'ok' && paso9502(3).valorMedido === '1,200', `Con «1,200 » guardado, «1,200» tampoco se rechaza: ${JSON.stringify(r)}`);
  [r] = await enviar([op('orden.paso', hace(3.4), { ordenId: 9502, idx: 2, texto: 'Medir corriente', estado: 'ok', valor: '1,200' })]);
  ok(r.ok && paso9502(2).estado === 'ok' && paso9502(2).valorMedido === '1,200', `En un paso con rango, tampoco: ${JSON.stringify(r)}`);
  [r] = await enviar([op('orden.paso', hace(3.3), { ordenId: 9502, idx: 3, texto: 'Anotar la placa del motor', estado: 'ok', valor: '1,250' })]);
  igual(r.error, '¿1250 o 1,25? Escribe el número sin separador de miles.', 'Otro que se lee de dos formas, sí se rechaza');
  igual(paso9502(3).valorMedido, '1,200', 'Y lo guardado no cambia');
  // K7: una lectura de liberación pasa a los trabajos escrita con textoDeNumero.
  igual(app.campo.textoDeTrabajos(null, '[Intervención] Cambio de compresor - AC-01', null, { liberaciones: [
    { etiqueta: 'Corriente de arranque', unidad: 'A', valorMedido: 12.345, valorMedidoTexto: null },
    { etiqueta: 'Presión de succión', unidad: 'psi', valorMedido: 9.8, valorMedidoTexto: null },
  ] }), 'Lecturas de liberación: Corriente de arranque: 12.3450 A; Presión de succión: 9.8 psi.', 'En los trabajos, 12.345 va como «12.3450» y 9.8 como siempre');

  // ── El aviso o el correo lleva al técnico al celular, con cualquier tipo de orden ──
  const middleware = await (async () => {
    const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mantenimiento-middleware-'));
    const salida = path.join(dir, 'middleware.mjs');
    try {
      await build({ entryPoints: [path.join(raiz, 'src/middleware.ts')], outfile: salida, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
        plugins: [{ name: 'astro-virtual', setup(b) {
          b.onResolve({ filter: /^astro:middleware$/ }, () => ({ path: 'astro:middleware', namespace: 'virtual' }));
          b.onLoad({ filter: /.*/, namespace: 'virtual' }, () => ({ contents: 'export const defineMiddleware = (fn) => fn;', loader: 'js' }));
        } }] });
      return (await import(pathToFileURL(salida).href)).onRequest;
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  })();
  const abrir = async (url, rol = 'tecnico') => {
    const contexto = fixture.ctx(url, { rol });
    contexto.redirect = (destino) => new Response(null, { status: 302, headers: { location: destino } });
    const res = await middleware(contexto, async () => new Response('ficha', { status: 200 }));
    return res.status === 302 ? res.headers.get('location') : 'ficha';
  };
  sqlite.prepare("UPDATE ordenes SET estado='en_proceso' WHERE id=9205").run();
  igual(await abrir('/ordenes/9205'), '/campo#orden-9205', 'Emergencia en curso');
  igual(await abrir('/ordenes/9303'), '/campo#orden-9303', 'Intervención abierta');
  igual(await abrir('/ordenes/9302'), 'ficha', 'La de otra persona no');
  igual(await abrir('/ordenes/9205?completa=1'), 'ficha', '?completa=1 abre la ficha');
  igual(await abrir('/ordenes/9205', 'jefe'), 'ficha', 'La jefatura trabaja en la ficha');
  igual(await abrir('/ordenes/9201'), 'ficha', 'Enviada a verificación, la ficha');
  igual(await abrir('/ordenes/9001'), '/campo#orden-9001', 'Preventivo, como antes');

  // ── D1 corta a 50 consultas por solicitud: el paquete, con todo esto, cabe ──
  // Como D1: cada sentencia suelta es una consulta y un batch entero es una más, con la sesión incluida.
  const consultasD1 = async (fn) => {
    const antes = fixture.queries.length, batches = faults.batchCount, batch = fixture.DB.batch;
    let enBatch = 0;
    fixture.DB.batch = (sentencias) => { enBatch += sentencias.length; return batch.call(fixture.DB, sentencias); };
    try { const r = await fn(); return { r, consultas: fixture.queries.length - antes - enBatch + (faults.batchCount - batches) }; }
    finally { fixture.DB.batch = batch; }
  };
  // Tres emergencias sin EOP vinculado, en tres equipos: las tres llegan con su EOP, sin tope.
  emergencia(9207, { activo: 1, eop: null });
  emergencia(9208, { activo: 5, eop: null, checklist: CHECKLIST });
  emergencia(9209, { activo: 4, eop: null });
  let { r: pqGrande, consultas } = await consultasD1(() => call(app.hoy.GET, '/api/campo/hoy?sede=1', { rol: 'tecnico' }));
  igual(pqGrande.status, 200);
  ok(consultas <= 50, `El paquete hizo ${consultas} consultas D1`);
  const consultasTres = consultas;
  ok(pqGrande.body.ordenes.filter((x) => x.modo === 'emergencia').length >= 4 && pqGrande.body.ordenes.some((x) => x.modo === 'intervencion'));
  ok(pqGrande.body.emergencias.every((x) => typeof x.etiquetaMitigacion === 'string' && x.etiquetaMitigacion.length > 0));
  const enPaquete = (id) => pqGrande.body.ordenes.find((x) => x.id === id);
  igual(enPaquete(9207).eop.codigo, 'EOP-HVAC-01');
  igual(enPaquete(9209).eop.codigo, 'EOP-MSP-01');
  igual(enPaquete(9209).pasos.length, 3);
  igual(enPaquete(9208).eop.codigo, 'EOP-HVAC-01', 'La tercera también llega con su EOP');
  igual(enPaquete(9208).pasos.map((x) => x.texto).join('|'), 'Apagar y bloquear|Limpiar filtros|Medir corriente', 'Sus pasos son los de su checklist');
  igual((await call(app.crear.GET, '/api/campo/ordenes?id=9208', { rol: 'tecnico' })).body.orden.eop.codigo, 'EOP-HVAC-01');
  ok(pqGrande.body.ronda && pqGrande.body.ronda.turnosProximos === null && pqGrande.body.ronda.turnos.length === 3, 'Sin cambio de turnos pendiente, el paquete no trae turnos próximos');

  // Diez emergencias sin EOP vinculado, cada una en su equipo y de familias distintas, más tres libres de la
  // sede: todas con su EOP y sus acciones, las mismas que resuelve queSigue, y el paquete sigue dentro de D1.
  sqlite.exec(`
    INSERT INTO activos(id,codigo,nombre,tipo,rubro,ubicacion_id,estado,sistema,padre_id) VALUES
      (31,'PE-31','Planta eléctrica de emergencia','general','infraestructura',2,'operativo',NULL,NULL),
      (32,'UPS-32','UPS de la sala de cómputo','general','infraestructura',2,'operativo',NULL,NULL),
      (33,'BA-33','Bomba de agua de la cisterna','general','infraestructura',2,'operativo',NULL,NULL),
      (34,'OX-34','Manifold de oxígeno','general','infraestructura',2,'operativo',NULL,NULL),
      (35,'AS-35','Ascensor de camillas','general','infraestructura',2,'operativo',NULL,NULL),
      (36,'BI-36','Bomba contra incendio','general','infraestructura',2,'operativo',NULL,NULL),
      (38,'TB-38','Gabinete principal','general','infraestructura',2,'operativo','electrico',NULL),
      (37,'TC-37','Tarjeta de control','general','infraestructura',2,'operativo',NULL,38),
      (39,'SN-39','Sensor de la tarjeta','general','infraestructura',2,'operativo',NULL,37),
      (40,'AC-40','Minisplit de la habitación','general','aires',2,'operativo',NULL,NULL),
      (41,'AC-41','Minisplit del quirófano','general','aires',1,'operativo',NULL,NULL),
      (42,'AC-42','Aire de la azotea','general','aires',3,'operativo','minisplit',NULL),
      (43,'GE-43','Generador del edificio B','general','infraestructura',2,'operativo',NULL,NULL);
  `);
  const diez = [[9401, 31], [9402, 32], [9403, 33], [9404, 34], [9405, 35], [9406, 36], [9407, 37], [9408, 39], [9409, 40], [9410, 41]];
  for (const [id, activo] of diez) emergencia(id, { activo, eop: null });
  // Una de otra sede, con su propio EOP vigente: manda el de su sede.
  sqlite.prepare("UPDATE ordenes SET ubicacion_id=3, sucursal_id=2 WHERE id=9410").run();
  sqlite.prepare("UPDATE activos SET ubicacion_id=3 WHERE id=41").run();
  const mspModelo = one("SELECT id FROM procedimientos WHERE codigo_corto='EOP-MSP-01'");
  sqlite.prepare("INSERT INTO procedimientos(codigo_corto,tipo,sistema,titulo,version,estado,sucursal_id,activo,responsable_id) VALUES('EOP-MSP-S2','eop','minisplit','Minisplit de la otra sede','1','vigente',2,1,1)").run();
  const mspS2 = one("SELECT id FROM procedimientos WHERE codigo_corto='EOP-MSP-S2'").id;
  sqlite.prepare("INSERT INTO eop_ficha(procedimiento_id,accion_1,accion_2,etiqueta_hora_mitigacion) VALUES(?,?,?,?)").run(mspS2, 'Apagar la unidad', 'Abrir la ventila', 'Unidad apagada');
  sqlite.prepare("UPDATE activos SET nombre='Minisplit de la azotea' WHERE id=41").run();
  ok(mspModelo, 'El EOP de minisplit modelo existe');
  for (const [id, activo] of [[9411, 42], [9412, 43], [9413, 33]]) emergencia(id, { activo, eop: null, asignado: null });
  ({ r: pqGrande, consultas } = await consultasD1(() => call(app.hoy.GET, '/api/campo/hoy?sede=1', { rol: 'tecnico' })));
  igual(pqGrande.status, 200);
  ok(consultas <= 50, `El paquete con diez emergencias sin EOP vinculado hizo ${consultas} consultas D1`);
  console.log(`Paquete con tres emergencias sin EOP vinculado: ${consultasTres} consultas D1; con diez propias y tres libres: ${consultas}`);
  const dbQ = app.database.getDb(fixture.ctx('/x'));
  const todas = pqGrande.body.ordenes.concat(pqGrande.body.libres);
  for (const id of [...diez.map(([x]) => x), 9412, 9413]) {
    const o = todas.find((x) => x.id === id);
    ok(o, `La emergencia ${id} viaja en el paquete`);
    const fila = one('SELECT activo_id a, sucursal_id s FROM ordenes WHERE id=?', id);
    const sigue = await app.resolver.queSigue(dbQ, fila.a, 'falla', fila.s);
    igual(o.eop.codigo, sigue.documento?.codigoCorto ?? null, `La emergencia ${id} trae el EOP que resuelve queSigue`);
    igual(o.pasos.map((x) => x.texto).join('|'), sigue.primerasAcciones.map((x) => x.trim()).join('|'), `La emergencia ${id} trae sus acciones como pasos`);
    ok(o.pasos.length > 0, `La emergencia ${id} tiene pasos`);
  }
  const vistaDiez = (id) => todas.find((x) => x.id === id);
  igual(vistaDiez(9407).eop.codigo, 'EOP-ELE-01', 'El componente hereda la familia del equipo padre');
  igual(vistaDiez(9408).eop.codigo, 'EOP-ELE-01', 'Y el nieto también');
  igual(vistaDiez(9409).eop.codigo, 'EOP-MSP-01');
  igual(JSON.stringify([vistaDiez(9410).eop.codigo, vistaDiez(9410).eop.etiquetaMitigacion, vistaDiez(9410).pasos.length]), JSON.stringify(['EOP-MSP-S2', 'Unidad apagada', 2]), 'En otra sede manda su EOP vigente, con su rótulo');
  ok(pqGrande.body.libres.some((x) => x.id === 9413 && x.eop.codigo === 'EOP-AGU-01'), 'Las libres de la sede también llegan con su EOP');
  ok(!pqGrande.body.libres.some((x) => x.id === 9411), 'Una libre de otra sede no se ofrece');
  // Lo mismo al abrir una sola.
  igual((await call(app.crear.GET, '/api/campo/ordenes?id=9405', { rol: 'tecnico' })).body.orden.eop.codigo, 'EOP-ASC-01');
  // Más equipos que los 100 parámetros que D1 acepta por consulta: van en tandas, en un solo batch.
  // La mitad son minisplits de quirófano: la sala decide la familia también dentro del batch.
  sqlite.exec(`INSERT INTO activos(id,codigo,nombre,tipo,rubro,ubicacion_id,estado) VALUES ${Array.from({ length: 95 }, (_, i) => i % 2 ? `(${600 + i},'AC-${600 + i}','Minisplit ${i + 1}','general','aires',1,'operativo')` : `(${600 + i},'AS-${600 + i}','Ascensor ${i + 1}','general','infraestructura',2,'operativo')`).join(',')}`);
  const muchas = Array.from({ length: 95 }, (_, i) => ({ id: 70000 + i, procedimientoId: null, activoId: 600 + i, sedeId: 1 }));
  const { r: resueltas, consultas: enTandas } = await consultasD1(() => app.eop.eopsDeOrdenes(dbQ, muchas));
  ok(muchas.every((o, i) => resueltas.get(o.id)?.codigo === (i % 2 ? 'EOP-HVAC-01' : 'EOP-ASC-01') && resueltas.get(o.id).acciones.length === 3), 'Los 95 equipos con su EOP y sus acciones');
  ok(enTandas <= 4, `En ${enTandas} consultas D1`);

  // ── K2: el celular dice qué acciones del EOP mostró ──
  // «acciones: []»: el celular no mostró ninguna. No se siembra nada y se envía con lo que cuenta el técnico.
  emergencia(9420, { activo: 2, eop: null });
  [r] = await enviar([
    op('emergencia.hito', hace(9), { ordenId: 9420, hito: 'llegada' }), op('orden.iniciar', hace(9), { ordenId: 9420, acciones: [] }),
    op('emergencia.hito', hace(8), { ordenId: 9420, hito: 'mitigacion' }), op('emergencia.hito', hace(7), { ordenId: 9420, hito: 'restablecimiento' }),
    op('orden.terminar', hace(6), { ordenId: 9420, nota: 'Rearmé el equipo y quedó enfriando.' }),
  ]).then((x) => [x.find((y) => !y.ok) ?? x.at(-1)]);
  ok(r.ok, `Sin acciones que mostrar, la emergencia se envía: ${JSON.stringify(r)}`);
  e = one('SELECT * FROM ordenes WHERE id=9420');
  igual(e.checklist_ejecucion, null, '«acciones: []» no siembra nada');
  igual(e.estado, 'completada');
  ok(e.trabajos_realizados.includes('Rearmé el equipo'), e.trabajos_realizados);
  // Con textos: se siembran esos, recortados, aunque el servidor resolvería otros.
  emergencia(9421, { activo: 2, eop: null });
  const mostradas = ['  Verificar la transferencia  ', 'Encender la planta', 'Avisar a la jefatura'];
  [r] = await enviar([op('orden.iniciar', hace(9), { ordenId: 9421, acciones: mostradas })]);
  ok(r.ok, JSON.stringify(r));
  igual(JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=9421').c).map((x) => `${x.texto}:${x.estado}`).join('|'), 'Verificar la transferencia:pendiente|Encender la planta:pendiente|Avisar a la jefatura:pendiente', 'Se siembran exactamente las que mostró el celular');
  // C7: lo que no se pudo se cuenta aparte, con su motivo.
  await enviar([
    op('orden.paso', hace(8), { ordenId: 9421, idx: 0, texto: 'Verificar la transferencia', estado: 'ok' }),
    op('orden.paso', hace(7), { ordenId: 9421, idx: 1, texto: 'Encender la planta', estado: 'desviacion', nota: 'No se pudo: sin combustible' }),
    op('orden.paso', hace(6), { ordenId: 9421, idx: 2, texto: 'Avisar a la jefatura', estado: 'ok' }),
  ]);
  [r] = await enviar([op('orden.terminar', hace(5), { ordenId: 9421, nota: 'Se pidió combustible; la carga quedó en la red.' })]);
  ok(r.ok, JSON.stringify(r));
  e = one('SELECT * FROM ordenes WHERE id=9421');
  ok(e.trabajos_realizados.startsWith('Falla de energía: 2 de 3 acciones hechas; 1 no se pudo: «Encender la planta»: sin combustible.'), e.trabajos_realizados);
  ok(!/puntos realizados|con novedad/.test(e.trabajos_realizados), 'Lo que no se pudo no se cuenta como realizado');
  igual(app.campo.textoDeTrabajos(JSON.stringify([
    { texto: 'Cortar la energía.', estado: 'desviacion', notas: 'No se pudo: el tablero está bloqueado.' },
    { texto: 'Aislar el área', estado: 'na' },
    { texto: 'Avisar', estado: 'desviacion', notas: 'No se pudo: sin señal' },
  ]), '[Emergencia] Corto circuito - TB-01', null, { emergencia: true }), 'Corto circuito: 0 de 3 acciones hechas, 1 no aplica; 2 no se pudieron: «Cortar la energía»: el tablero está bloqueado; «Avisar»: sin señal.', 'Varias que no se pudieron');
  // Sin «acciones» (celular viejo), como hoy: las del EOP que resuelve el servidor.
  emergencia(9422, { activo: 2, eop: null });
  [r] = await enviar([op('orden.iniciar', hace(4), { ordenId: 9422 })]);
  ok(r.ok, JSON.stringify(r));
  igual(JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=9422').c).map((x) => x.texto).join('|'), (await vistaDe(9409) ?? vistaDiez(9409)).pasos.map((x) => x.texto).join('|'), 'Sin acciones, las de su EOP');
  // Con pasos ya guardados, las acciones se ignoran.
  [r] = await enviar([op('orden.iniciar', hace(4), { ordenId: 9208, acciones: ['Otra cosa'] })]);
  ok(r.ok, JSON.stringify(r));
  igual(JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=9208').c).map((x) => x.texto).join('|'), 'Apagar y bloquear|Limpiar filtros|Medir corriente', 'Una orden con checklist no cambia');
  // El primer paso de una emergencia empezada en la ficha también siembra lo que mostró el celular.
  emergencia(9423, { activo: null, eop: null });
  sqlite.prepare("UPDATE ordenes SET estado='en_proceso', iniciada_en=? WHERE id=9423").run(hace(20));
  [r] = await enviar([op('orden.paso', hace(3), { ordenId: 9423, idx: 0, texto: 'Cerrar la llave de paso', estado: 'ok', acciones: ['Cerrar la llave de paso', 'Secar el piso'] })]);
  ok(r.ok, JSON.stringify(r));
  igual(JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=9423').c).map((x) => `${x.texto}:${x.estado}`).join('|'), 'Cerrar la llave de paso:ok|Secar el piso:pendiente');
  // Lo que no es una lista de hasta diez textos de 1 a 300 letras se rechaza con una frase, sin tocar la orden.
  emergencia(9424, { activo: 2, eop: null });
  for (const mal of [Array.from({ length: 11 }, (_, i) => `Acción ${i + 1}`), ['Bien', '   '], 'Encender la planta', ['x'.repeat(301)], [42]]) {
    [r] = await enviar([op('orden.iniciar', hace(2), { ordenId: 9424, acciones: mal })]);
    ok(!r.ok && /acciones de la emergencia/.test(r.error), `Se rechaza ${JSON.stringify(mal).slice(0, 40)}: ${r.error}`);
  }
  e = one('SELECT estado, checklist_ejecucion c FROM ordenes WHERE id=9424');
  ok(e.estado === 'abierta' && e.c === null, 'Y la orden queda como estaba');
  [r] = await enviar([op('orden.iniciar', hace(2), { ordenId: 9424, acciones: Array.from({ length: 10 }, (_, i) => `${'y'.repeat(299)}${i}`) })]);
  ok(r.ok && JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=9424').c).length === 10, 'Diez de 300 letras sí');
  // Una acción del EOP más larga que eso viaja ya recortada: lo que el celular devuelve se acepta y sus pasos cuadran.
  sqlite.prepare('UPDATE eop_ficha SET accion_2=? WHERE procedimiento_id=?').run(`Abrir la ventila ${'y deja que circule el aire '.repeat(12)}`, mspS2);
  const larga = await vistaDe(9410);
  igual(larga.pasos[1].texto.length, 300, 'El paquete trae la acción con el tope que acepta el servidor');
  [r] = await enviar([op('orden.iniciar', hace(2), { ordenId: 9410, acciones: larga.pasos.map((x) => x.texto) })]);
  ok(r.ok, JSON.stringify(r));
  [r] = await enviar([op('orden.paso', hace(1), { ordenId: 9410, idx: 1, texto: larga.pasos[1].texto, estado: 'ok' })]);
  ok(r.ok, `El paso se marca con el mismo texto: ${JSON.stringify(r)}`);
  // La orden abierta suelta trae lo mismo que el paquete.
  const suelta = await call(app.crear.GET, '/api/campo/ordenes?id=9301', { rol: 'tecnico' });
  igual(suelta.status, 200);
  igual(suelta.body.orden.modo, 'intervencion');
  igual(suelta.body.orden.liberaciones.length, 2);
  const sueltaEop = await call(app.crear.GET, '/api/campo/ordenes?id=9207', { rol: 'tecnico' });
  igual(sueltaEop.body.orden.eop.codigo, 'EOP-HVAC-01', 'En quirófano manda el EOP de climatización crítica');
  ok(sinHoras(sueltaEop.body.orden));

  // ── K1: un cambio de turnos que todavía no entró viaja aparte; el turno de ahora sigue como estaba ──
  const antesK1 = (await call(app.hoy.GET, '/api/campo/hoy?sede=1', { rol: 'tecnico' })).body.ronda;
  const modeloK1 = one('SELECT id, turnos FROM rondas WHERE sucursal_id IS NULL');
  const cambioK1 = Date.now();
  sqlite.prepare('INSERT INTO ronda_vigencias(ronda_id,turnos_antes,hasta,usuario_id) VALUES(?,?,?,1)').run(modeloK1.id, modeloK1.turnos, new Date(cambioK1).toISOString());
  sqlite.prepare(`UPDATE rondas SET turnos='["06:00","18:00"]' WHERE id=?`).run(modeloK1.id);
  // Lo esperado, aparte del código: el primer turno de la lista nueva que empieza desde el cambio.
  const hoyK1 = new Date(cambioK1 - 6 * 3600000).toISOString().slice(0, 10);
  const entraK1 = [0, 1].flatMap((k) => ['06:00', '18:00'].map((tt) => Date.parse(`${new Date(Date.parse(`${hoyK1}T12:00:00Z`) + k * 86400000).toISOString().slice(0, 10)}T${tt}:00-06:00`))).find((ms) => ms >= cambioK1);
  const k1 = (await call(app.hoy.GET, '/api/campo/hoy?sede=1', { rol: 'tecnico' })).body.ronda;
  igual(JSON.stringify([k1.fecha, k1.turno, k1.turnos]), JSON.stringify([antesK1.fecha, antesK1.turno, antesK1.turnos]), 'El turno de ahora sigue con los turnos que rigen');
  igual(JSON.stringify(k1.turnosProximos), JSON.stringify({ desde: new Date(entraK1).toISOString(), turnos: ['06:00', '18:00'] }), 'Y los nuevos llegan con la hora en que entran');

  // ── K17: cada marca del celular lleva el paso como lo mostraba justo antes («antes»). Si la ficha cambió ese paso
  // mientras tanto, la marca no lo pisa: se rechaza con su frase y no se escribe nada ──
  const PASOS_K17 = JSON.stringify([
    { texto: 'Revisar la unión de la línea de oxígeno', bloqueante: true, criterio: 'Sin fugas', estado: 'pendiente' },
    { texto: 'Avisar a enfermería', estado: 'pendiente' },
    { texto: 'Medir la presión de la línea', requiereValor: true, unidad: 'psi', esperadoMin: 50, esperadoMax: 55, estado: 'pendiente' },
  ]);
  const SIN_MARCA = { estado: 'pendiente', valor: null, nota: null };
  const ckDe = (id) => one('SELECT checklist_ejecucion c FROM ordenes WHERE id=?', id).c;
  const pasoDe = (id, i) => JSON.parse(ckDe(id))[i];
  const marcasDe = (id, i) => one('SELECT count(*) n FROM orden_paso_marcas WHERE orden_id=? AND paso_idx=?', id, i).n;
  const eventosDe = (id) => one('SELECT count(*) n FROM orden_verificacion_eventos WHERE orden_id=?', id).n;
  // La jefatura cambia un paso en la ficha nueva: manda el checklist con su base y solo lo que cambió.
  const enLaFicha = async (id, i, cambios) => {
    const base = ckDe(id);
    const nuevo = JSON.stringify(JSON.parse(base).map((x, k) => (k === i ? { ...x, ...cambios } : x)));
    const res = await call(app.order.PATCH, `/api/ordenes/${id}`, { method: 'PATCH', id, data: { checklistEjecucion: nuevo, checklistBase: base, soloCambios: true }, rol: 'jefe' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  };
  seed(9601, { checklist: PASOS_K17 });
  await enviar([op('orden.iniciar', hace(30), { ordenId: 9601 })]);
  // 10:00 el técnico marca «ok» sin señal; 10:05 la jefatura marca la desviación en la ficha; 10:20 vuelve la señal.
  await enLaFicha(9601, 0, { estado: 'desviacion', notas: 'Fuga confirmada por el jefe de turno.' });
  const guardadoK17 = ckDe(9601), eventosK17 = eventosDe(9601);
  [r] = await enviar([op('orden.paso', hace(20), { ordenId: 9601, idx: 0, texto: 'Revisar la unión de la línea de oxígeno', estado: 'ok', antes: SIN_MARCA })]);
  igual(r.error, 'El paso 1 cambió en la ficha mientras tanto: revísalo y márcalo otra vez.', `La marca de antes no pisa la desviación de la ficha: ${JSON.stringify(r)}`);
  ok(pasoDe(9601, 0).estado === 'desviacion' && pasoDe(9601, 0).notas === 'Fuga confirmada por el jefe de turno.', `El paso queda con la desviación y su nota: ${JSON.stringify(pasoDe(9601, 0))}`);
  ok(ckDe(9601) === guardadoK17 && eventosDe(9601) === eventosK17, 'No se escribe nada en la orden ni en su historial');
  igual(marcasDe(9601, 0), 0, 'Ni queda en el libro de marcas');
  igual(one('SELECT resultado r FROM campo_operaciones WHERE op_id=?', r.opId).r, 'rechazada', 'Es un rechazo más del celular');
  igual(app.campo.pasoCambioEnLaFicha(false, 0), r.error, 'La frase sale de un solo lugar');
  // «antes» igual a lo guardado: la marca se aplica.
  await enviar([op('orden.paso', hace(19), { ordenId: 9601, idx: 1, texto: 'Avisar a enfermería', estado: 'ok', antes: SIN_MARCA })]);
  ok(pasoDe(9601, 1).estado === 'ok' && pasoDe(9601, 1).hora && pasoDe(9601, 1).iniciales && marcasDe(9601, 1) === 1, `Con «antes» igual a lo guardado, se aplica: ${JSON.stringify(pasoDe(9601, 1))}`);
  // La jefatura solo agregó una nota: el «ok» del celular se aplica y la nota queda.
  await enLaFicha(9601, 2, { notas: 'Usar el manómetro calibrado.' });
  [r] = await enviar([op('orden.paso', hace(18), { ordenId: 9601, idx: 2, texto: 'Medir la presión de la línea', estado: 'ok', valor: '52,5', antes: SIN_MARCA })]);
  ok(r.ok && pasoDe(9601, 2).estado === 'ok' && pasoDe(9601, 2).valorMedido === 52.5 && pasoDe(9601, 2).notas === 'Usar el manómetro calibrado.', `La nota de la jefatura queda con la marca: ${JSON.stringify(r)} ${JSON.stringify(pasoDe(9601, 2))}`);
  // Con la desviación en pie, la orden no se envía como si el paso estuviera bien.
  [r] = await enviar([op('orden.terminar', hace(17), { ordenId: 9601 })]);
  ok(!r.ok && one('SELECT estado FROM ordenes WHERE id=9601').estado === 'en_proceso', `Con el punto crítico en desviación no se envía: ${r.error}`);
  // Dos marcas seguidas sin señal en el mismo paso, sin cambios en la ficha: se aplican las dos.
  seed(9602, { checklist: PASOS_K17 });
  await enviar([op('orden.iniciar', hace(16), { ordenId: 9602 })]);
  const dos = await enviar([
    op('orden.paso', hace(15), { ordenId: 9602, idx: 1, texto: 'Avisar a enfermería', estado: 'desviacion', nota: 'Enfermería no contesta', antes: SIN_MARCA }),
    op('orden.paso', hace(14), { ordenId: 9602, idx: 1, texto: 'Avisar a enfermería', estado: 'ok', antes: { estado: 'desviacion', valor: null, nota: 'Enfermería no contesta' } }),
  ]);
  ok(dos.every((y) => y.ok) && pasoDe(9602, 1).estado === 'ok' && marcasDe(9602, 1) === 2, `Las dos marcas seguidas se aplican: ${JSON.stringify(dos)} ${JSON.stringify(pasoDe(9602, 1))}`);
  // Los dos escribieron en la misma clave: la nota de la jefatura no se pisa con la del técnico, ni su lectura con la de él.
  await enLaFicha(9602, 2, { notas: 'Usar el manómetro calibrado.' });
  [r] = await enviar([op('orden.paso', hace(13.8), { ordenId: 9602, idx: 2, texto: 'Medir la presión de la línea', estado: 'desviacion', valor: 40, nota: 'Presión baja en la toma', antes: SIN_MARCA })]);
  ok(r.error === 'El paso 3 cambió en la ficha mientras tanto: revísalo y márcalo otra vez.' && pasoDe(9602, 2).notas === 'Usar el manómetro calibrado.' && pasoDe(9602, 2).estado === 'pendiente', `La nota de la ficha no se pisa: ${JSON.stringify(r)} ${JSON.stringify(pasoDe(9602, 2))}`);
  await enLaFicha(9602, 2, { valorMedido: 53, notas: '' });
  [r] = await enviar([op('orden.paso', hace(13.6), { ordenId: 9602, idx: 2, texto: 'Medir la presión de la línea', estado: 'ok', valor: 51, antes: SIN_MARCA })]);
  ok(r.error === 'El paso 3 cambió en la ficha mientras tanto: revísalo y márcalo otra vez.' && pasoDe(9602, 2).valorMedido === 53 && marcasDe(9602, 2) === 0, `La lectura de la ficha no se pisa: ${JSON.stringify(r)} ${JSON.stringify(pasoDe(9602, 2))}`);
  // Sin «antes» (un registro que ya esperaba en un celular con la versión anterior), como siempre: la marca se aplica.
  await enLaFicha(9602, 0, { estado: 'desviacion', notas: 'Fuga en la unión.' });
  [r] = await enviar([op('orden.paso', hace(13), { ordenId: 9602, idx: 0, texto: 'Revisar la unión de la línea de oxígeno', estado: 'ok' })]);
  ok(r.ok && pasoDe(9602, 0).estado === 'ok' && marcasDe(9602, 0) === 1, `Sin «antes», como siempre: ${JSON.stringify(r)} ${JSON.stringify(pasoDe(9602, 0))}`);
  // En una emergencia, «La acción N…».
  emergencia(9603);
  await enviar([op('emergencia.hito', hace(12), { ordenId: 9603, hito: 'llegada' }), op('orden.iniciar', hace(12), { ordenId: 9603, acciones: [eopEle.a1, eopEle.a2, eopEle.a3] })]);
  await enLaFicha(9603, 1, { estado: 'desviacion', notas: 'No se pudo: la planta no tiene combustible.' });
  [r] = await enviar([op('orden.paso', hace(11), { ordenId: 9603, idx: 1, texto: pasoDe(9603, 1).texto, estado: 'ok', antes: SIN_MARCA })]);
  igual(r.error, 'La acción 2 cambió en la ficha mientras tanto: revísala y márcala otra vez.', `En una emergencia, la acción: ${JSON.stringify(r)}`);
  ok(pasoDe(9603, 1).estado === 'desviacion' && marcasDe(9603, 1) === 0, 'Y la acción queda como la dejó la ficha');

} finally {
  await close();
}

// ── K5: el paquete dice desde qué turno la sede ya no hace ronda ──
// Base nueva y reloj fijo: martes 10/11/2026. A las 13:40 la jefatura marca que la sede no hace ronda; entra a las 14:00.
{
  const D = '2026-11-10';
  const en = (hhmm) => new Date(Date.parse(`${D}T${hhmm}:00-06:00`)).toISOString();
  fijarReloj(en('13:30'));
  const g = await setupConjuntos({ beforeMigration, modules: { hoy: 'pages/api/campo/hoy', puntos: 'pages/api/ronda-turno/puntos' } });
  try {
    g.sqlite.exec("INSERT INTO sucursales(id,nombre,activa) VALUES(1,'Sede prueba',1)");
    g.sqlite.exec("UPDATE rondas SET vigente_desde='2020-01-01'");
    const ronda = async () => (await g.call(g.app.hoy.GET, '/api/campo/hoy?sede=1', { rol: 'tecnico' })).body.ronda;
    const marcar = async (haceRonda) => (await g.app.puntos.PUT(g.ctx('/api/ronda-turno/puntos', { method: 'PUT', data: { accion: 'hace_ronda', sucursalId: 1, haceRonda }, rol: 'jefe' }))).json();
    let r = await ronda();
    igual(JSON.stringify([r.turno, r.noHaceRondaDesde, r.omite]), JSON.stringify(['06:00', null, []]), 'Sin marca pendiente, el paquete no anuncia nada');
    fijarReloj(en('13:40'));
    igual((await marcar(false)).aplicaDesde.turno, '14:00', 'La marca entra a las 14:00');
    fijarReloj(en('13:45'));
    r = await ronda();
    igual(JSON.stringify([r.turno, r.noHaceRondaDesde]), JSON.stringify(['06:00', en('14:00')]), 'El paquete de las 13:45 dice que desde las 14:00 la sede no hace ronda');
    fijarReloj(en('13:50'));
    await marcar(true);
    fijarReloj(en('13:52'));
    igual((await ronda()).noHaceRondaDesde, null, 'Si la jefatura lo deshace antes de las 14:00, ya no hay marca pendiente');
    fijarReloj(en('13:55'));
    await marcar(false);
    fijarReloj(en('14:05'));
    igual(await ronda(), null, 'Desde las 14:00 el paquete no trae ronda');
  } finally { await g.close(); }
}

// ── K7: la lectura de la ronda que vuelve como texto se escribe con textoDeNumero ──
// Base nueva y reloj fijo: martes 10/11/2026. A las 10:29 la temperatura se anota 12.345 en la ronda de las 06:00.
{
  const D = '2026-11-10';
  const en = (hhmm) => new Date(Date.parse(`${D}T${hhmm}:00-06:00`)).toISOString();
  fijarReloj(en('10:30'));
  const g = await setupConjuntos({ beforeMigration, modules: { hoy: 'pages/api/campo/hoy', sync: 'pages/api/campo/sync' } });
  try {
    g.sqlite.exec("INSERT INTO sucursales(id,nombre,activa) VALUES(1,'Sede prueba',1)");
    g.sqlite.exec("UPDATE rondas SET vigente_desde='2020-01-01'");
    const ronda = async () => (await g.call(g.app.hoy.GET, '/api/campo/hoy?sede=1', { rol: 'tecnico' })).body.ronda;
    let r = await ronda();
    const temp = r.puntos.find((p) => /temperatura/.test(p.texto) && p.pideValor && p.min === 20 && p.max === 22);
    const lectura = { opId: 'k7-temperatura-1', tipo: 'ronda.lectura', at: en('10:29'), rondaId: r.rondaId, sucursalId: 1, fecha: D, turno: '06:00', puntoId: temp.id, resultado: 'ok', valor: 12.345 };
    const [x] = (await g.call(g.app.sync.POST, '/api/campo/sync', { method: 'POST', data: { ops: [lectura] }, rol: 'tecnico' })).body.resultados;
    ok(x.ok && g.sqlite.prepare('SELECT valor v FROM ronda_lecturas WHERE punto_id=?').get(temp.id).v === 12.345, `La lectura se guarda como número: ${JSON.stringify(x)}`);
    fijarReloj(en('14:10'));
    r = await ronda();
    igual(r.turno, '14:00', 'A las 14:10 corre la ronda de las 14:00');
    igual(r.puntos.find((p) => p.id === temp.id).ultima, '12.3450', 'La última lectura viaja como «12.3450», que se vuelve a leer igual');
  } finally { await g.close(); }
}

console.log(`PASS test-campo: ${verificaciones} verificaciones; rutas y migraciones reales, sin red.`);
