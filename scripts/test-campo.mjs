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
  [r] = await enviar([op('ronda.iniciar', hace(45), clave)]);
  ok(r.ok, JSON.stringify(r));
  igual(one('SELECT iniciada_en i FROM ronda_ejecuciones').i, hace(45));
  const conAop = p.ronda.puntos.find((x) => x.aop && x.critico);
  [r] = await enviar([op('ronda.lectura', hace(44), { ...clave, puntoId: conAop.id, resultado: 'fuera', nota: 'Alarma en el panel' })]);
  ok(r.ok && r.datos.eventoId, JSON.stringify(r));
  const evento = one('SELECT * FROM aop_eventos WHERE id=?', r.datos.eventoId);
  igual(evento.detectado_en, hace(44), 'El reloj del AOP corre desde que se detectó, no desde que hubo señal');
  [r] = await enviar([op('ronda.cerrar', hace(43), { ...clave, firma: true, notas: 'Queda abierta la alarma.' })]);
  ok(!r.ok && /sin anotar/i.test(r.error), JSON.stringify(r));
  const opsRonda = p.ronda.puntos.filter((x) => x.id !== conAop.id).map((x, i) => op('ronda.lectura', hace(42 - i * 0.1), { ...clave, puntoId: x.id, resultado: 'ok', valor: x.pideValor ? (x.min ?? x.max ?? 1) : null }));
  for (let i = 0; i < opsRonda.length; i += 10) await enviar(opsRonda.slice(i, i + 10));
  [r] = await enviar([op('ronda.cerrar', hace(30), { ...clave, firma: true, notas: 'Queda abierta la alarma.' })]);
  ok(r.ok, JSON.stringify(r));
  const ej = one('SELECT * FROM ronda_ejecuciones');
  igual(ej.estado, 'completada');
  igual(ej.completada_en, hace(30));
  igual(ej.minutos_ronda, 15);
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
  [r] = await enviar([op('correctivo.abrir', hace(14), { sucursalId: 1, rubro: 'infraestructura', nota: 'Fuga en lavamanos, consultorio 4' })]);
  ok(r.ok, JSON.stringify(r));
  const co = one('SELECT * FROM ordenes WHERE id=?', r.datos.ordenId);
  igual(co.tipo, 'correctivo');
  igual(co.asignado_a, null, 'Un correctivo lo asigna la jefatura');
  ok(co.titulo.includes('Fuga en lavamanos'));
  [r] = await enviar([op('correctivo.abrir', hace(13), { activoId: 2, nota: 'No enfría' })]);
  ok(r.ok, JSON.stringify(r));
  igual(one('SELECT ubicacion_id u FROM ordenes WHERE id=?', r.datos.ordenId).u, 2, 'La ubicación sale del equipo');
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
  // Tres emergencias sin EOP vinculado, en tres equipos: el paquete busca el EOP de dos, y primero las que no tienen pasos.
  emergencia(9207, { activo: 1, eop: null });
  emergencia(9208, { activo: 5, eop: null, checklist: CHECKLIST });
  emergencia(9209, { activo: 4, eop: null });
  const antes = fixture.queries.length;
  const pqGrande = await call(app.hoy.GET, '/api/campo/hoy?sede=1', { rol: 'tecnico' });
  const consultas = fixture.queries.length - antes;
  igual(pqGrande.status, 200);
  ok(consultas <= 45, `El paquete hizo ${consultas} consultas`);
  ok(pqGrande.body.ordenes.filter((x) => x.modo === 'emergencia').length >= 4 && pqGrande.body.ordenes.some((x) => x.modo === 'intervencion'));
  ok(pqGrande.body.emergencias.every((x) => typeof x.etiquetaMitigacion === 'string' && x.etiquetaMitigacion.length > 0));
  const enPaquete = (id) => pqGrande.body.ordenes.find((x) => x.id === id);
  igual(enPaquete(9207).eop.codigo, 'EOP-HVAC-01');
  igual(enPaquete(9209).eop.codigo, 'EOP-MSP-01', 'La que no tiene pasos va antes');
  igual(enPaquete(9209).pasos.length, 3);
  igual(enPaquete(9208).eop.codigo, null, 'Pasado el tope, la que ya tiene pasos espera a abrirse sola');
  igual(enPaquete(9208).pasos.length, 3, 'Sus pasos son los de su checklist');
  igual((await call(app.crear.GET, '/api/campo/ordenes?id=9208', { rol: 'tecnico' })).body.orden.eop.codigo, 'EOP-HVAC-01');
  // La orden abierta suelta trae lo mismo que el paquete.
  const suelta = await call(app.crear.GET, '/api/campo/ordenes?id=9301', { rol: 'tecnico' });
  igual(suelta.status, 200);
  igual(suelta.body.orden.modo, 'intervencion');
  igual(suelta.body.orden.liberaciones.length, 2);
  const sueltaEop = await call(app.crear.GET, '/api/campo/ordenes?id=9207', { rol: 'tecnico' });
  igual(sueltaEop.body.orden.eop.codigo, 'EOP-HVAC-01', 'En quirófano manda el EOP de climatización crítica');
  ok(sinHoras(sueltaEop.body.orden));

  console.log(`PASS test-campo: ${verificaciones} verificaciones; rutas y migraciones reales, sin red.`);
} finally {
  await close();
}
