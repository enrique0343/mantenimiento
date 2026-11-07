// Modo técnico: lo que el celular envía llega una sola vez, con su hora real y
// bajo las mismas reglas de la ficha completa. Rutas reales, migraciones reales.
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

// La siembra de los documentos necesita un administrador, como en producción.
const beforeMigration = (db, nombre) => {
  if (nombre.startsWith('0049_fase49')) db.exec("INSERT OR IGNORE INTO usuarios(id,nombre,email,password_hash,rol) VALUES(1000,'Administración','siembra@example.invalid','x','admin')");
};
const fixture = await setupConjuntos({ beforeMigration, modules: {
  hoy: 'pages/api/campo/hoy', sync: 'pages/api/campo/sync', buscar: 'pages/api/campo/buscar', equipo: 'pages/api/campo/equipo/[id]',
  crear: 'pages/api/campo/ordenes', foto: 'pages/api/campo/foto', campo: 'lib/campo', reporte: 'lib/reporte-mantenimiento', config: 'lib/campo-config', csv: 'pages/api/reportes/[tipo]', database: 'lib/db',
} });
const { app, sqlite, faults, call, close } = fixture;
const one = (q, ...a) => sqlite.prepare(q).get(...a);
const all = (q, ...a) => sqlite.prepare(q).all(...a);
const AHORA = Date.now();
const hace = (min) => new Date(AHORA - min * 60000).toISOString();
let n = 0;
const op = (tipo, at, extra = {}) => ({ opId: `prueba-${++n}-${tipo}`, tipo, at, ...extra });
const enviar = async (ops, rol = 'tecnico', extra = {}) => {
  const r = await call(app.sync.POST, '/api/campo/sync', { method: 'POST', data: { ops, ...extra }, rol });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.resultados;
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
    INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo,activa) VALUES(1,1,'Quirófano 2','area',1),(2,1,'Habitación 307','area',1);
    INSERT INTO activos(id,codigo,nombre,tipo,rubro,ubicacion_id,estado) VALUES(1,'AC-01','Minisplit quirófano','general','aires',1,'operativo'),(2,'AC-02','Minisplit habitación','general','aires',2,'operativo'),(3,'AC-03','Minisplit de baja','general','aires',2,'baja'),(4,'AC-04','Sin lugar','general','aires',NULL,'operativo');
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
  igual(p.ronda.puntos.length, 19);
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
  [r] = await enviar([op('ronda.lectura', hace(44), { ...clave, puntoId: conAop.id, resultado: 'fuera' })]);
  ok(r.ok && r.datos.eventoId, JSON.stringify(r));
  const evento = one('SELECT * FROM aop_eventos WHERE id=?', r.datos.eventoId);
  igual(evento.detectado_en, hace(44), 'El reloj del AOP corre desde que se detectó, no desde que hubo señal');
  [r] = await enviar([op('ronda.cerrar', hace(43), clave)]);
  ok(!r.ok && /cr[ií]tico/i.test(r.error), JSON.stringify(r));
  const opsRonda = p.ronda.puntos.filter((x) => x.id !== conAop.id).map((x, i) => op('ronda.lectura', hace(42 - i * 0.1), { ...clave, puntoId: x.id, resultado: 'ok', valor: x.pideValor ? (x.min ?? x.max ?? 1) : null }));
  for (let i = 0; i < opsRonda.length; i += 10) await enviar(opsRonda.slice(i, i + 10));
  [r] = await enviar([op('ronda.cerrar', hace(30), clave)]);
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
  // Los documentos de aires se escribieron para áreas críticas: en una habitación se dice.
  ok(fichaR.body.falla?.fueraDeAlcance, JSON.stringify(fichaR.body.falla));
  const quirofano = await call(app.equipo.GET, '/api/campo/equipo/1', { method: 'GET', id: 1, rol: 'tecnico' });
  igual(quirofano.body.falla?.fueraDeAlcance, false, 'En el quirófano el documento aplica de lleno');

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
  igual(rep.codigo, 'OT-000001');
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
  ok(textoCsv.includes('Minutos de trabajo') && textoCsv.includes('OT-000001'), textoCsv.slice(0, 200));
  console.log(`PASS test-campo: ${verificaciones} verificaciones; rutas y migraciones reales, sin red.`);
} finally {
  await close();
}
