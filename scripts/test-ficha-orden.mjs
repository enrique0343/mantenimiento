// La ficha web de la orden, construida de verdad, contra migraciones reales: qué ve y qué
// no ve cada rol en una emergencia (EOP) y en una intervención (MOP), y qué manda la
// pantalla al guardar, con las rutas reales detrás. Los cruces son reales: el técnico
// registra por /api/campo/sync y después la jefatura guarda en la ficha que tenía
// abierta. También el reporte de la orden. Correr después de npm run build.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { experimental_AstroContainer } from 'astro/container';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';
import { fijarReloj } from './test-support/reloj.mjs';

fijarReloj();
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');

const beforeMigration = (db, n) => { if (n.startsWith('0049_fase49')) db.exec("INSERT OR IGNORE INTO usuarios(id,nombre,email,password_hash,rol) VALUES(1000,'Administración','siembra@example.invalid','x','admin')"); };
const f = await setupConjuntos({ beforeMigration, modules: { sync: 'pages/api/campo/sync', liberaciones: 'pages/api/ordenes/[id]/liberaciones', ordenes: 'lib/ordenes' } });
const { app, sqlite, call, DB } = f;
const one = (q, ...a) => sqlite.prepare(q).get(...a);
const modulo = async (ruta) => (await import(pathToFileURL(path.join(process.cwd(), 'dist/_worker.js/pages', ruta)).href)).page().default;
const pagina = await modulo('ordenes/_id_.astro.mjs');
const paginaReporte = await modulo('ordenes/_id_/reporte.astro.mjs');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const USUARIO = { admin: 1, jefe: 2, tecnico: 3, visualizador: 4 };
const AREA = 'infraestructura';

try {
  const eop = one("SELECT id FROM procedimientos WHERE codigo_corto='EOP-ELE-01'").id;
  sqlite.exec(`
    INSERT INTO usuarios(id,nombre,email,password_hash,rol) VALUES(8,'Otro Técnico','otro@example.invalid','x','tecnico');
    INSERT INTO sucursales(id,nombre,activa) VALUES(1,'Sede Uno',1);
    INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo) VALUES(1,1,'Cuarto eléctrico','area');
    INSERT INTO activos(id,codigo,nombre,tipo,rubro,ubicacion_id,criticidad_operacional) VALUES(1,'ELE-PLANTA-01','Planta de emergencia','general','${AREA}',1,'alta');
    INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha) VALUES(1,1,'PM mensual','mensual','2026-12-01');
    INSERT INTO items(id,codigo,nombre,unidad) VALUES(1,'REP-01','Fusible 10 A','unidad');
  `);
  const orden = (id, campos) => {
    const base = { rubro: AREA, creado_por: 1, titulo: `Orden ${id}`, prioridad: 'alta', ...campos };
    const k = Object.keys(base);
    sqlite.prepare(`INSERT INTO ordenes(id,${k.join(',')}) VALUES(?,${k.map(() => '?').join(',')})`).run(id, ...k.map((c) => base[c]));
  };
  const enviada = (id) => sqlite.prepare("INSERT INTO orden_verificacion(orden_id,version,ciclo,ejecutado_por,executores_json) VALUES(?,1,1,3,'[3]')").run(id);
  const hace = (h) => new Date(Date.now() - h * 3600000).toISOString();
  const pasos = JSON.stringify([{ texto: 'Ir al cuarto de máquinas y verificar si la planta arrancó', estado: 'ok', minutos: 15 }]);
  const CAUSA = 'Sobrecarga del breaker principal al sumar dos manejadoras nuevas.';
  // EOP en proceso, del técnico, con dos de sus horas, un repuesto y la causa raíz de la jefatura.
  orden(101, { tipo: 'emergencia', estado: 'en_proceso', activo_id: 1, asignado_a: 3, procedimiento_id: eop, clase_prioridad: 'P1', vencimiento: '2026-12-24',
    iniciada_en: hace(2), hora_alarma: hace(2.5), hora_llegada: hace(2.2), causa_raiz_vencimiento: hace(-69.5), checklist_ejecucion: pasos, causa_raiz: CAUSA });
  sqlite.exec('INSERT INTO orden_repuestos(orden_id,item_id,cantidad,precio_unitario,registrado_por) VALUES(101,1,1,2.5,3)');
  // EOP enviada a verificación sin causa raíz: la escribe la jefatura después.
  orden(102, { tipo: 'emergencia', estado: 'completada', activo_id: 1, asignado_a: 3, iniciada_en: hace(5), completada_en: hace(1), horas_trabajadas: 4,
    hora_alarma: hace(5), causa_raiz_vencimiento: hace(-67), trabajos_realizados: 'Planta en manual y transferencia operada con dos técnicos.' });
  enviada(102);
  const reqs = (id) => sqlite.prepare("INSERT INTO orden_prerrequisitos(orden_id,texto,tipo,obligatorio,cumplido,referencia) VALUES(?,'Permiso firmado','permiso_trabajo',1,1,'PT-0099')").run(id);
  const lectura = (id) => sqlite.prepare("INSERT INTO orden_liberaciones(orden_id,etiqueta,unidad,min_aceptable,max_aceptable,obligatoria) VALUES(?,'Corriente de fase','A',8,12,1)").run(id);
  // MOP en proceso con la lectura de liberación sin medir.
  orden(103, { tipo: 'intervencion', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(3), plan_reversa: 'Volver al tablero anterior y avisar.',
    trabajos_realizados: 'Cambio del interruptor del tablero de la rama crítica.' });
  reqs(103); lectura(103);
  // MOP enviado a verificación sin lectura, con el motivo de la jefatura.
  orden(104, { tipo: 'intervencion', estado: 'completada', activo_id: 1, asignado_a: 3, iniciada_en: hace(6), completada_en: hace(1), horas_trabajadas: 5,
    trabajos_realizados: 'Cambio del interruptor del tablero de la rama crítica.', cierre_sin_lectura_por: 1, cierre_sin_lectura_en: hace(1),
    cierre_sin_lectura_motivo: 'La pinza amperimétrica calibrada se dañó en sitio; se mide el lunes con la de respaldo.' });
  reqs(104); lectura(104); enviada(104);
  orden(105, { tipo: 'emergencia', estado: 'abierta', activo_id: 1, hora_alarma: hace(0.2) });
  orden(106, { tipo: 'correctivo', estado: 'abierta', activo_id: 1, asignado_a: 8 });
  orden(107, { tipo: 'correctivo', estado: 'en_proceso', asignado_a: 3, iniciada_en: hace(1), sucursal_id: 1, ubicacion_id: 1, ubicacion_detalle: 'Junto al tablero B' });
  orden(108, { tipo: 'preventivo', estado: 'en_proceso', activo_id: 1, plan_id: 1, asignado_a: 3, iniciada_en: hace(1) });

  // ── Cruces con el celular ──
  const lista = (...textos) => JSON.stringify(textos.map((texto) => ({ texto, estado: 'pendiente' })));
  const PASOS = ['Verificar que la planta arrancó', 'Confirmar la transferencia', 'Avisar a enfermería'];
  // J3: EOP en proceso sin llegada; la jefatura corrige la alarma.
  orden(120, { tipo: 'emergencia', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(1), hora_alarma: hace(1), causa_raiz_vencimiento: hace(-71) });
  // J4: MOP en proceso sin reversa; la jefatura ajusta el plan.
  orden(121, { tipo: 'intervencion', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(1), plan_reversa: 'Volver al tablero anterior.' });
  reqs(121); lectura(121);
  // J5: EOP con tres pasos pendientes, la jefatura marca otro paso.
  orden(122, { tipo: 'emergencia', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(0.5), hora_alarma: hace(0.5), checklist_ejecucion: lista(...PASOS) });
  // J5: EOP que el técnico termina de marcar en el celular y envía desde su ficha vieja.
  orden(123, { tipo: 'emergencia', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(0.5), hora_alarma: hace(0.5), checklist_ejecucion: lista(PASOS[0], PASOS[1]),
    trabajos_realizados: 'Planta en manual; transferencia operada con un segundo técnico.' });
  // Sin señal: el paso marcado en la ficha sale cuando se deja la página.
  orden(136, { tipo: 'emergencia', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(0.5), hora_alarma: hace(0.5), checklist_ejecucion: lista(PASOS[0], PASOS[1]) });
  // K3: el checklist cambia de forma en el servidor mientras la ficha está abierta.
  orden(124, { tipo: 'emergencia', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(0.5), hora_alarma: hace(0.5), checklist_ejecucion: lista(PASOS[0], PASOS[1]) });
  // J7: lectura anotada en texto («14,5 A») fuera del rango de 8 a 12 A.
  const lecturaTexto = (id) => sqlite.prepare("INSERT INTO orden_liberaciones(orden_id,etiqueta,unidad,min_aceptable,max_aceptable,obligatoria,valor_medido_texto,conforme,medido_por,medido_en) VALUES(?,'Corriente de fase','A',8,12,1,'14,5 A',0,3,?)").run(id, hace(0.2));
  orden(125, { tipo: 'intervencion', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(2), trabajos_realizados: 'Cambio del interruptor del tablero de la rama crítica.' });
  reqs(125); lecturaTexto(125);
  orden(126, { tipo: 'intervencion', estado: 'completada', activo_id: 1, asignado_a: 3, iniciada_en: hace(3), completada_en: hace(1), horas_trabajadas: 2,
    trabajos_realizados: 'Cambio del interruptor del tablero de la rama crítica.' });
  reqs(126); lecturaTexto(126); enviada(126);
  // K4: una lectura con rango y otra sin rango.
  orden(127, { tipo: 'intervencion', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(1) });
  reqs(127);
  const libRango = Number(sqlite.prepare("INSERT INTO orden_liberaciones(orden_id,etiqueta,unidad,min_aceptable,max_aceptable,obligatoria) VALUES(127,'Corriente de fase','A',8,12,1)").run().lastInsertRowid);
  const libTexto = Number(sqlite.prepare("INSERT INTO orden_liberaciones(orden_id,etiqueta,obligatoria) VALUES(127,'Estado del tablero',0)").run().lastInsertRowid);
  // K4: una lectura con rango que quedó escrita sin número («arrancó bien») cuenta como no medida.
  orden(135, { tipo: 'intervencion', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(2), trabajos_realizados: 'Cambio del interruptor del tablero de la rama crítica.' });
  reqs(135);
  sqlite.exec("INSERT INTO orden_liberaciones(orden_id,etiqueta,unidad,min_aceptable,max_aceptable,obligatoria,valor_medido_texto,medido_por) VALUES(135,'Corriente de fase','A',8,12,1,'arrancó bien',3)");
  // Quién registra en un MOP: sin asignar, suyo y de otro técnico.
  const reqPendiente = (id) => sqlite.prepare("INSERT INTO orden_prerrequisitos(orden_id,texto,tipo,obligatorio,cumplido) VALUES(?,'Permiso firmado','permiso_trabajo',1,0)").run(id);
  orden(128, { tipo: 'intervencion', estado: 'abierta', activo_id: 1, plan_reversa: 'Volver al tablero anterior.' });
  reqPendiente(128); lectura(128);
  orden(129, { tipo: 'intervencion', estado: 'abierta', activo_id: 1, asignado_a: 3, plan_reversa: 'Volver al tablero anterior.' });
  reqPendiente(129); lectura(129);
  orden(130, { tipo: 'intervencion', estado: 'en_proceso', activo_id: 1, asignado_a: 8, iniciada_en: hace(1), plan_reversa: 'Volver al tablero anterior.' });
  reqs(130); lectura(130);
  // J6: enviada con revisor designado (Otro Técnico) y cerrada, las dos del técnico.
  orden(133, { tipo: 'correctivo', estado: 'completada', activo_id: 1, asignado_a: 3, iniciada_en: hace(4), completada_en: hace(1), horas_trabajadas: 3,
    trabajos_realizados: 'Se cambió el fusible y se probó la carga.' });
  sqlite.prepare("INSERT INTO orden_verificacion(orden_id,version,ciclo,ejecutado_por,executores_json,revisor_id) VALUES(133,1,1,3,'[3]',8)").run();
  orden(134, { tipo: 'correctivo', estado: 'cerrada', activo_id: 1, asignado_a: 3, iniciada_en: hace(30), completada_en: hace(26), verificado_por: 2, verificado_en: hace(25), cerrado_por: 2, cerrado_en: hace(25),
    trabajos_realizados: 'Se cambió el fusible y se probó la carga.', causa_raiz: 'Fusible subdimensionado para la carga actual del tablero.' });
  enviada(134);
  // Reporte: un correctivo con pasos y otro sin pasos.
  orden(131, { tipo: 'correctivo', estado: 'abierta', activo_id: 1, asignado_a: 3,
    checklist_ejecucion: JSON.stringify([{ texto: 'Revisar el breaker', estado: 'pendiente', minutos: 10 }, { texto: 'Medir la corriente', estado: 'pendiente', minutos: 5 }]) });
  orden(132, { tipo: 'correctivo', estado: 'abierta', activo_id: 1, asignado_a: 3 });

  const container = await experimental_AstroContainer.create();
  const html = async (id, rol, uid = USUARIO[rol], componente = pagina, ruta = `/ordenes/${id}`) => {
    const res = await container.renderToResponse(componente, { partial: false, request: new Request(`https://local.test${ruta}?area=${AREA}`), params: { id: String(id) },
      locals: { user: { id: uid, nombre: `Cuenta ${rol}`, rol }, runtime: { env: { DB } } } });
    assert.equal(res.status, 200, `${ruta} como ${rol}`);
    return res.text();
  };
  // Lo que se ve: la página sin sus scripts.
  const ver = async (id, rol, uid) => {
    const doc = new JSDOM(await html(id, rol, uid)).window.document;
    doc.querySelectorAll('script').forEach((s) => s.remove());
    const texto = doc.body.textContent.replace(/\s+/g, ' ');
    return { doc, texto, hay: (sel) => !!doc.querySelector(sel), boton: (s) => doc.querySelector(`[data-transition="${s}"]`) };
  };
  // Lo que el técnico hace en el celular, por la ruta real de sincronización.
  let opSeq = 0;
  const celular = async (...ops) => {
    const r = await call(app.sync.POST, '/api/campo/sync', { method: 'POST', rol: 'tecnico', data: { ops: ops.map((op) => ({ opId: `ficha-celular-${++opSeq}`, at: new Date().toISOString(), ...op })) } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.resultados;
  };
  const patch = (id, rol, data) => call(app.order.PATCH, `/api/ordenes/${id}`, { method: 'PATCH', id, data, rol });
  const estados = (id) => JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=?', id).c).map((p) => p.estado).join(', ');
  const tiemposDeMedicion = /Iniciada|Completada|cronómetro|Duración real|Tiempo de respuesta|Hasta la mitigación|Tiempo de reparación|Horas trabajadas|15 min/;

  // ── Emergencia en proceso ──────────────────────────────────────────────
  for (const rol of ['admin', 'jefe', 'visualizador']) {
    const v = await ver(101, rol);
    ok(/Tiempos/.test(v.texto) && /Iniciada/.test(v.texto) && /el cronómetro corre/.test(v.texto), `${rol} ve cuándo inició y el cronómetro`);
    ok(/Tiempo de respuesta/.test(v.texto) && /Hasta la mitigación/.test(v.texto) && /Tiempo de reparación/.test(v.texto), `${rol} ve las tres duraciones del EOP`);
    ok(/Horas trabajadas/.test(v.texto) && /15 min/.test(v.texto), `${rol} ve horas trabajadas y minutos estimados`);
    ok(v.hay('#horaLlegada') && v.hay('#causaRaiz'), `${rol} ve las horas del EOP y la causa raíz`);
    ok(/Causa raíz · la escribe la jefatura/.test(v.texto) && /Obligatoria para verificar y cerrar/.test(v.texto) && /Plazo: 72 h desde la alarma/.test(v.texto), `${rol}: rótulo, obligación y plazo de la causa raíz`);
    ok(!/OBLIGATORIA PARA CERRAR/.test(v.texto), `${rol}: ya no dice «obligatoria para cerrar»`);
    ok(/Vence 24\/12\/2026/.test(v.texto) && !/23\/12\/2026/.test(v.texto), `${rol}: un vencimiento solo con fecha no se corre al día anterior`);
    const jefatura = rol !== 'visualizador';
    ok(v.doc.querySelector('#causaRaiz').disabled === !jefatura, `${rol}: la causa raíz ${jefatura ? 'se escribe' : 'solo se lee'}`);
    ok(/Cambiar equipo/.test(v.texto) === jefatura && v.hay('#asignarBtn') === jefatura, `${rol}: cambiar equipo y asignación solo la jefatura`);
    ok(v.hay('.rep-del-btn') === jefatura, `${rol}: revertir repuesto solo la jefatura`);
    ok(v.hay('a[href$="/reporte"]'), `${rol} abre el reporte con sus tiempos`);
  }
  {
    const v = await ver(101, 'tecnico');
    ok(!tiemposDeMedicion.test(v.texto), `El técnico no ve tiempos de medición: ${v.texto.match(tiemposDeMedicion)?.[0]}`);
    ok(/Asignación y plazo/.test(v.texto) && /Vence 24\/12\/2026/.test(v.texto), 'El técnico sí ve el plazo');
    ok(/P1 · Emergencia · Atención inmediata/.test(v.texto), 'El técnico sí ve el plazo de la clase P1');
    ok(!v.hay('#horaAlarma') && !v.hay('#horaLlegada') && !v.hay('#horasTrabajadas') && !v.hay('#eopSave'), 'Al técnico no se le muestran las horas del EOP');
    ok(/Emergencia · pasos registrados/.test(v.texto) && /Energía de emergencia en servicio/.test(v.texto), 'El técnico ve los pasos con el rótulo de su EOP');
    const pasosEop = [...v.doc.querySelectorAll('[aria-label="Pasos de la emergencia"] li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim());
    ok(pasosEop.length === 3 && /Llegada al sitio Registrado/.test(pasosEop[0]) && /Pendiente/.test(pasosEop[1]) && /Pendiente/.test(pasosEop[2]), `Pasos sin horas: ${pasosEop.join(' | ')}`);
    ok(!v.hay('#causaRaiz') && /La causa raíz la escribe tu jefatura\./.test(v.texto) && !v.texto.includes(CAUSA), 'Al técnico no se le muestra el campo de causa raíz');
    ok(!/OBLIGATORIA PARA CERRAR|Obligatoria para verificar/.test(v.texto), 'Al técnico no se le exige la causa raíz');
    ok(!/Cambiar equipo/.test(v.texto) && !v.hay('#editActivoBtn') && !v.hay('#asignarBtn') && !/Guardar asignación/.test(v.texto), 'El técnico no ve cambiar equipo ni guardar asignación');
    ok(!v.hay('.rep-del-btn') && !v.hay('.firma-add-btn[data-rol="jefe"]') && v.hay('.firma-add-btn[data-rol="tecnico"]'), 'El técnico no ve lo que el servidor le rechaza: revertir repuesto, firmar como jefe');
    ok(v.hay('#trabajosRealizados') && !v.doc.querySelector('#trabajosRealizados').disabled && v.boton('completada'), 'El técnico escribe qué encontró y qué hizo y envía');
    ok(!v.hay('a[href$="/reporte"]') && !v.hay('#verifModal'), 'Sin enlace al reporte de tiempos ni verificación que no le toca');
  }

  // ── Emergencia enviada a verificación, sin causa raíz ──────────────────
  for (const rol of ['admin', 'jefe']) {
    const v = await ver(102, rol);
    const causa = v.doc.querySelector('#causaRaiz');
    ok(causa && !causa.disabled && /aunque la orden ya esté enviada o cerrada/.test(v.texto), `${rol} escribe la causa raíz con la orden enviada`);
    ok(!v.hay('#asignarBtn') && !/Cambiar equipo/.test(v.texto), `${rol}: enviada, ya no se cambia equipo ni asignación`);
  }
  {
    const v = await ver(102, 'tecnico');
    ok(!v.hay('#causaRaiz') && !tiemposDeMedicion.test(v.texto) && !/4\.00 h|Registradas/.test(v.texto), 'Enviada, el técnico tampoco ve causa raíz ni tiempos');
  }

  // ── Intervención en proceso con la lectura sin medir ───────────────────
  {
    const v = await ver(103, 'jefe');
    ok(v.hay('#sinLecturaBtn') && /Enviar a verificación sin lectura/.test(v.doc.querySelector('#sinLecturaBtn').textContent), 'La jefatura ve «Enviar a verificación sin lectura»');
    ok(!/Cerrar sin lectura|Cerrada sin lectura|Cerrar la OT sin lectura/.test(v.texto), 'Nadie le dice que la cierra');
    ok(/La orden no se cierra: queda pendiente de verificación/.test(v.doc.querySelector('#sinLecturaModal').textContent.replace(/\s+/g, ' ')), 'El aviso dice que queda pendiente de verificación');
    ok(v.boton('completada')?.disabled === true && /faltan lecturas de liberación/.test(v.texto), 'Enviar sin la lectura va bloqueado y dice por qué');
  }
  {
    const v = await ver(103, 'tecnico');
    ok(!v.hay('#sinLecturaBtn') && /pide a tu jefatura que la envíe a verificación sin lectura/.test(v.texto), 'El técnico no ve el escape: se lo pide a la jefatura');
    ok(!v.doc.querySelector('.liber-valor').disabled && !v.doc.querySelector('#reversaEjecutada').disabled, 'El técnico asignado registra la lectura y la reversa');
  }

  // ── Intervención enviada sin lectura ───────────────────────────────────
  {
    const v = await ver(104, 'jefe');
    ok(/Enviada a verificación sin lectura de liberación\.[^.]*· Pendiente de verificación\./.test(v.texto), 'La tarjeta dice la verdad: enviada, no cerrada');
    ok(v.hay('#verifSinLecturaRegistrado') && !v.hay('#verifSinLecturaMotivo'), 'La verificación no vuelve a pedir el motivo');
    ok(v.boton('verificada') && !v.doc.querySelector('#verifConfirm').disabled, 'La jefatura puede verificarla');
    const t = await ver(104, 'tecnico');
    ok(t.hay('.liber-valor') && t.doc.querySelector('.liber-valor').disabled, 'Enviada, el técnico ya no registra lecturas');
  }

  // ── Abierta sin asignar, ajena y sin equipo ────────────────────────────
  {
    const t = await ver(105, 'tecnico');
    ok(/pulsa «Iniciar» para desbloquear/.test(t.texto) && !/cronómetro/.test(t.texto), 'Al técnico no se le habla del cronómetro');
    ok(t.hay('#tomarOrdenBtn') && !t.hay('#asignarBtn'), 'Sin asignar, el técnico puede tomarla, nada más');
    const a = await ver(105, 'admin');
    ok(/para activar el cronómetro/.test(a.texto) && !a.hay('#tomarOrdenBtn'), 'La jefatura sigue viendo el aviso del cronómetro');
    const otra = await ver(106, 'tecnico');
    ok(!otra.hay('[data-transition]') && /Está asignada a Otro Técnico/.test(otra.texto) && !otra.hay('#asignarBtn') && !otra.hay('#tomarOrdenBtn') && !/Cambiar equipo/.test(otra.texto), 'Orden de otro técnico: nada que el servidor le rechace');
    const sinEq = await ver(107, 'tecnico');
    ok(/Lugar a intervenir \(sin equipo\)/.test(sinEq.texto) && /Sede Uno/.test(sinEq.texto) && /Junto al tablero B/.test(sinEq.texto) && !sinEq.hay('#editActivoBtn'), 'Sin equipo, el técnico ve dónde es, sin «Asignar equipo»');
    ok((await ver(107, 'admin')).hay('#editActivoBtn'), 'La jefatura asigna equipo a una orden sin equipo');
    ok(!/Cambiar equipo/.test((await ver(108, 'admin')).texto), 'Una orden de PM no ofrece cambiar el equipo');
  }

  // ── Lo que manda la pantalla, con las rutas reales detrás ──────────────
  const abrir = async (id, rol) => {
    const enviados = [], avisos = [], errores = [], red = { caida: false };
    const consola = new VirtualConsole();
    consola.on('jsdomError', (e) => { if (!/Not implemented/.test(e.message) && !/getContext|fillStyle/.test(String(e.detail?.stack ?? e.stack ?? e.message))) errores.push(e.detail?.message ?? e.message); });
    const dom = new JSDOM(await html(id, rol), {
      url: `https://local.test/ordenes/${id}?area=${AREA}`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: consola,
      beforeParse(w) {
        w.alert = (m) => avisos.push(m); w.confirm = () => true; w.prompt = () => null;
        w.fetch = async (url, init = {}) => {
          const u = new URL(url, 'https://local.test');
          const data = init.body ? JSON.parse(init.body) : undefined;
          enviados.push({ metodo: init.method ?? 'GET', ruta: u.pathname, data, keepalive: !!init.keepalive });
          if (red.caida) throw new TypeError('Failed to fetch');
          const m = u.pathname.match(/^\/api\/ordenes\/(\d+)(\/liberaciones)?$/);
          const r = m && init.method === 'PATCH' ? await call(m[2] ? app.liberaciones.PATCH : app.order.PATCH, u.pathname, { method: 'PATCH', id: Number(m[1]), data, rol }) : { status: 200, body: {} };
          return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
        };
      },
    });
    const w = dom.window;
    const hasta = async (fn, msg) => { for (let i = 0; i < 400; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 10)); } assert.fail(`${msg} · enviados: ${JSON.stringify(enviados)} · avisos: ${avisos.join(' | ')}`); };
    const escribir = (sel, valor) => { const el = w.document.querySelector(sel); el.value = valor; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
    return { w, doc: w.document, enviados, avisos, errores, hasta, escribir, red };
  };

  { // Lo que guarda el técnico nunca borra la causa raíz de la jefatura.
    const p = await abrir(101, 'tecnico');
    p.escribir('#trabajosRealizados', 'Planta en manual; transferencia operada con un segundo técnico.');
    p.doc.querySelector('#ejecSave').click();
    await p.hasta(() => p.enviados.some((e) => e.metodo === 'PATCH'), 'el técnico guarda');
    const envio = p.enviados.find((e) => e.metodo === 'PATCH').data;
    ok(envio.trabajosRealizados && !('causaRaiz' in envio), `El guardado del técnico no lleva causa raíz: ${JSON.stringify(envio)}`);
    await p.hasta(() => /Guardado/.test(p.doc.querySelector('#autosaveIndicador').textContent), 'el servidor acepta lo del técnico');
    ok(one('SELECT causa_raiz FROM ordenes WHERE id=101').causa_raiz === CAUSA, 'La causa raíz de la jefatura sigue intacta');
    ok(p.errores.length === 0, `Sin errores de script: ${p.errores.join(' | ')}`);
    p.w.close();
  }
  { // Lo pendiente sale al servidor aunque el técnico se vaya de la página antes de tiempo.
    const p = await abrir(101, 'tecnico');
    p.escribir('#trabajosRealizados', 'Transferencia en manual; queda pendiente el ajuste del retardo.');
    p.doc.querySelector('.ck-estado-btn[data-estado="na"]').click();
    p.w.dispatchEvent(new p.w.Event('pagehide'));
    await p.hasta(() => p.enviados.some((e) => e.metodo === 'PATCH'), 'sale al servidor al irse');
    const envio = p.enviados.find((e) => e.metodo === 'PATCH');
    ok(envio.keepalive && /retardo/.test(envio.data.trabajosRealizados) && JSON.parse(envio.data.checklistEjecucion)[0].estado === 'na' && !('causaRaiz' in envio.data), `Al irse manda lo escrito y lo marcado: ${JSON.stringify(envio)}`);
    ok(JSON.parse(envio.data.checklistBase ?? 'null')?.[0]?.estado === 'ok', `Al irse, el checklist viaja con la base que recibió del servidor: ${envio.data.checklistBase}`);
    await p.hasta(() => /retardo/.test(one('SELECT trabajos_realizados t FROM ordenes WHERE id=101').t ?? ''), 'el servidor lo guarda');
    ok(JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=101').c)[0].estado === 'na' && one('SELECT causa_raiz FROM ordenes WHERE id=101').causa_raiz === CAUSA, 'Queda guardado y la causa raíz sigue intacta');
    p.w.close();
  }
  { // Verificar exige la causa raíz; la jefatura la escribe con la orden enviada.
    const p = await abrir(102, 'jefe');
    p.doc.querySelector('[data-transition="verificada"]').click();
    await p.hasta(() => /Falta la causa raíz/.test(p.doc.querySelector('#causaMsg').textContent), 'pide la causa antes de verificar');
    ok(p.doc.querySelector('#verifModal').classList.contains('hidden'), 'Sin causa raíz no se abre la verificación');
    p.escribir('#causaRaiz', 'La transferencia automática quedó en manual tras el último mantenimiento.');
    p.doc.querySelector('#causaSave').click();
    await p.hasta(() => /Guardada/.test(p.doc.querySelector('#causaMsg').textContent), 'la causa raíz se guarda');
    const envio = p.enviados.filter((e) => e.metodo === 'PATCH');
    ok(envio.length === 1 && JSON.stringify(Object.keys(envio[0].data)) === '["causaRaiz"]', `La causa raíz viaja sola: ${JSON.stringify(envio)}`);
    const o = one('SELECT estado, causa_raiz FROM ordenes WHERE id=102');
    ok(o.estado === 'completada' && /transferencia automática/.test(o.causa_raiz), 'Queda escrita y la orden sigue pendiente de verificación');
    p.doc.querySelector('[data-transition="verificada"]').click();
    await p.hasta(() => !p.doc.querySelector('#verifModal').classList.contains('hidden'), 'con causa raíz se abre la verificación');
    ok(p.errores.length === 0, `Sin errores de script: ${p.errores.join(' | ')}`);
    p.w.close();
  }
  { // La jefatura envía el MOP sin lectura: queda pendiente de verificación, no cerrado.
    const p = await abrir(103, 'jefe');
    p.doc.querySelector('#sinLecturaBtn').click();
    p.doc.querySelector('#sinLecturaMotivo').value = 'La pinza calibrada no estaba disponible; se mide el lunes.';
    p.doc.querySelector('#sinLecturaConfirm').click();
    await p.hasta(() => p.enviados.some((e) => e.metodo === 'PATCH'), 'envía sin lectura');
    const envio = p.enviados.find((e) => e.metodo === 'PATCH').data;
    ok(envio.estado === 'completada' && /pinza calibrada/.test(envio.cierreSinLecturaMotivo) && 'trabajosRealizados' in envio, `Envío con motivo y lo escrito: ${JSON.stringify(envio)}`);
    await p.hasta(() => one('SELECT estado FROM ordenes WHERE id=103').estado === 'completada', 'el servidor la deja pendiente de verificación');
    ok(one('SELECT cierre_sin_lectura_motivo m FROM ordenes WHERE id=103').m.includes('pinza calibrada') && !p.avisos.length, 'Queda el motivo, sin errores');
    p.w.close();
  }
  { // Verificar un MOP enviado sin lectura no vuelve a pedir ni mandar el motivo.
    const p = await abrir(104, 'jefe');
    p.doc.querySelector('[data-transition="verificada"]').click();
    await p.hasta(() => !p.doc.querySelector('#verifModal').classList.contains('hidden'), 'abre la verificación');
    p.doc.querySelector('#verifNotas').value = 'Revisé el cambio del interruptor y el motivo de la lectura pendiente.';
    p.doc.querySelector('#verifConfirm').click();
    await p.hasta(() => p.enviados.some((e) => e.metodo === 'PATCH'), 'verifica');
    const envio = p.enviados.find((e) => e.metodo === 'PATCH').data;
    ok(envio.estado === 'verificada' && !('cierreSinLecturaMotivo' in envio), `La verificación no reenvía el motivo: ${JSON.stringify(envio)}`);
    await p.hasta(() => one('SELECT estado FROM ordenes WHERE id=104').estado === 'cerrada', `el servidor la cierra (avisos: ${p.avisos.join(' | ')})`);
    ok(one('SELECT cierre_sin_lectura_por p FROM ordenes WHERE id=104').p === 1, 'El motivo sigue firmado por quien lo escribió, no por quien verifica');
    p.w.close();
  }
  { // Cerrada, la jefatura aún escribe la causa raíz; el técnico sigue sin verla.
    const v = await ver(104, 'admin');
    ok(v.hay('#causaRaiz') && !v.doc.querySelector('#causaRaiz').disabled, 'Con la orden cerrada la causa raíz se sigue escribiendo');
    ok(!(await ver(104, 'tecnico')).hay('#causaRaiz'), 'Cerrada, el técnico tampoco ve la causa raíz');
  }
  // ── Cruces reales: el técnico registra en el celular y la jefatura guarda en la ficha ──
  { // J3 · La jefatura corrige la alarma mientras el técnico toca «Llegué»: la llegada no se borra.
    const p = await abrir(120, 'jefe');
    ok(p.doc.querySelector('#horaLlegada').value === '', 'La ficha de la jefatura abre sin hora de llegada');
    const [hito] = await celular({ tipo: 'emergencia.hito', ordenId: 120, hito: 'llegada' });
    const llegada = one('SELECT hora_llegada h FROM ordenes WHERE id=120').h;
    ok(hito.ok && !!llegada, `El técnico registra la llegada desde el celular: ${JSON.stringify(hito)}`);
    p.doc.querySelector('#eopSave').click();
    ok(/Sin cambios/.test(p.doc.querySelector('#eopMsg').textContent) && !p.enviados.some((e) => e.metodo === 'PATCH'), 'Sin tocar ninguna hora, «Guardar horas» no manda nada');
    const alarmaAntes = one('SELECT hora_alarma h FROM ordenes WHERE id=120').h;
    const corregida = app.ordenes.isoALocalInput(new Date(Date.parse(alarmaAntes) - 5 * 60000).toISOString());
    p.doc.querySelector('#horaAlarma').value = corregida;
    p.doc.querySelector('#eopSave').click();
    await p.hasta(() => p.doc.querySelector('#horaLlegada').value !== '', 'pinta lo que respondió el servidor');
    const envios = p.enviados.filter((e) => e.metodo === 'PATCH').map((e) => e.data);
    ok(envios.length === 1 && JSON.stringify(envios[0]) === JSON.stringify({ horaAlarma: `${corregida}:00-06:00` }), `Solo viaja la hora que cambió, sin null para las demás: ${JSON.stringify(envios)}`);
    const o = one('SELECT hora_alarma a, hora_llegada l FROM ordenes WHERE id=120');
    ok(o.l === llegada && Date.parse(o.a) === Date.parse(`${corregida}:00-06:00`), `Queda la alarma corregida y la llegada del técnico: ${JSON.stringify(o)}`);
    ok(p.doc.querySelector('#horaLlegada').value === app.ordenes.isoALocalInput(llegada) && p.doc.querySelector('#horaAlarma').value === corregida, 'La ficha muestra la llegada que puso el técnico');
    const respuesta = app.ordenes.fmtDuracionHoras(app.ordenes.tiemposEmergencia({ horaAlarma: o.a, horaLlegada: o.l }).respuestaHoras);
    ok(p.doc.querySelector('#eopRespuesta').textContent === respuesta && respuesta !== '—', `El tiempo de respuesta se recalcula como en el servidor: ${p.doc.querySelector('#eopRespuesta').textContent} / ${respuesta}`);
    ok(p.errores.length === 0, `Sin errores de script: ${p.errores.join(' | ')}`);
    p.w.close();
  }
  { // J4 · La jefatura ajusta el plan de reversa mientras el técnico marca la reversa en el celular.
    const p = await abrir(121, 'jefe');
    ok(!p.doc.querySelector('#reversaEjecutada').checked, 'La ficha de la jefatura abre con la reversa sin marcar');
    const notas = 'Se volvió al tablero anterior; el interruptor nuevo no cerró.';
    const [rev] = await celular({ tipo: 'mop.reversa', ordenId: 121, notas });
    ok(rev.ok, `El técnico marca la reversa desde el celular: ${JSON.stringify(rev)}`);
    p.doc.querySelector('#reversaSave').click();
    ok(/Sin cambios/.test(p.doc.querySelector('#reversaMsg').textContent) && !p.enviados.some((e) => e.metodo === 'PATCH'), 'Sin cambios, «Guardar plan de reversa» no manda nada');
    const plan = 'Volver al tablero anterior y avisar a la jefatura de turno.';
    p.doc.querySelector('#planReversa').value = plan;
    p.doc.querySelector('#reversaSave').click();
    await p.hasta(() => p.doc.querySelector('#reversaEjecutada').checked, 'pinta la reversa que marcó el técnico');
    const envios = p.enviados.filter((e) => e.metodo === 'PATCH').map((e) => e.data);
    ok(envios.length === 1 && JSON.stringify(envios[0]) === JSON.stringify({ planReversa: plan }), `Solo viaja el plan: ${JSON.stringify(envios)}`);
    const o = one('SELECT plan_reversa p, reversa_ejecutada e, reversa_notas n FROM ordenes WHERE id=121');
    ok(o.e === 1 && o.n === notas && o.p === plan, `La reversa y sus notas siguen en la base: ${JSON.stringify(o)}`);
    ok(p.doc.querySelector('#reversaNotas').value === notas, 'La ficha muestra las notas del técnico');
    // Decisión 6: con la reversa ejecutada se envía a verificación aunque falte la lectura.
    const [fin] = await celular({ tipo: 'orden.terminar', ordenId: 121, nota: 'Se intentó el cambio del interruptor; se revirtió al tablero anterior.' });
    ok(fin.ok && one('SELECT estado FROM ordenes WHERE id=121').estado === 'completada', `Con la reversa, el técnico la envía a verificación sin la lectura: ${JSON.stringify(fin)}`);
    ok(p.errores.length === 0, `Sin errores de script: ${p.errores.join(' | ')}`);
    p.w.close();
  }
  { // J5 · La jefatura marca un paso en la ficha mientras el técnico marca otro en el celular.
    const p = await abrir(122, 'jefe');
    const [paso] = await celular({ tipo: 'orden.paso', ordenId: 122, idx: 0, estado: 'ok', texto: PASOS[0] });
    ok(paso.ok && estados(122) === 'ok, pendiente, pendiente', `El técnico marca el paso 1 en el celular: ${JSON.stringify(paso)}`);
    p.doc.querySelector('.ck-estado-btn[data-idx="2"][data-estado="ok"]').click();
    await p.hasta(() => /Guardado/.test(p.doc.querySelector('#ckAutosave').textContent), 'el checklist se guarda');
    ok(estados(122) === 'ok, pendiente, ok', `Quedan los dos pasos marcados: ${estados(122)}`);
    const [primero] = p.enviados.filter((e) => e.metodo === 'PATCH').map((e) => e.data);
    ok(JSON.parse(primero.checklistBase).every((x) => x.estado === 'pendiente') && JSON.parse(primero.checklistEjecucion)[2].estado === 'ok', `Viaja el checklist con la base que recibió la ficha: ${JSON.stringify(primero)}`);
    ok(p.doc.querySelector('.ck-row[data-idx="0"]').classList.contains('bg-emerald-50') && p.doc.querySelector('.ck-estado-btn[data-idx="0"][data-estado="ok"]').classList.contains('bg-brand-600'), 'La ficha vuelve a pintar el paso que marcó el técnico');
    p.doc.querySelector('.ck-estado-btn[data-idx="1"][data-estado="na"]').click();
    await p.hasta(() => p.enviados.filter((e) => e.metodo === 'PATCH').length === 2 && estados(122) === 'ok, na, ok', 'segundo guardado');
    const segundo = p.enviados.filter((e) => e.metodo === 'PATCH')[1].data;
    ok(JSON.parse(segundo.checklistBase).map((x) => x.estado).join(', ') === 'ok, pendiente, ok', `La base del segundo guardado es lo que respondió el servidor: ${segundo.checklistBase}`);
    const guardado = JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=122').c);
    ok(!!guardado[0].hora && !!guardado[0].iniciales, `El paso del técnico conserva su hora e iniciales: ${JSON.stringify(guardado[0])}`);
    ok(p.errores.length === 0 && p.avisos.length === 0, `Sin errores ni avisos: ${p.errores.join(' | ')} ${p.avisos.join(' | ')}`);
    p.w.close();
  }
  { // J5 · El técnico marcó los pasos en el celular; su ficha abierta desde antes envía sin deshacerlos.
    const p = await abrir(123, 'tecnico');
    const marcas = await celular(...[0, 1].map((idx) => ({ tipo: 'orden.paso', ordenId: 123, idx, estado: 'ok', texto: PASOS[idx] })));
    ok(marcas.every((m) => m.ok) && estados(123) === 'ok, ok', `El técnico marca los dos pasos en el celular: ${JSON.stringify(marcas)}`);
    p.doc.querySelector('[data-transition="completada"]').click();
    await p.hasta(() => one('SELECT estado FROM ordenes WHERE id=123').estado === 'completada', 'la envía a verificación');
    const envio = p.enviados.find((e) => e.metodo === 'PATCH').data;
    ok(envio.estado === 'completada' && !('checklistEjecucion' in envio), `Sin cambios en la ficha, el checklist no viaja: ${JSON.stringify(envio)}`);
    ok(estados(123) === 'ok, ok' && p.avisos.length === 0, `Los pasos del celular siguen marcados: ${estados(123)} ${p.avisos.join(' | ')}`);
    p.w.close();
  }
  { // Decisión 4 · Un paso marcado sin señal sale al servidor, con su base, cuando se deja la página.
    const p = await abrir(136, 'tecnico');
    p.red.caida = true;
    p.doc.querySelector('.ck-estado-btn[data-idx="0"][data-estado="ok"]').click();
    await p.hasta(() => /Sin guardar/.test(p.doc.querySelector('#ckAutosave').textContent), 'sin señal no se guarda');
    ok(estados(136) === 'pendiente, pendiente', 'Sin señal el servidor no lo recibió');
    p.red.caida = false;
    p.w.dispatchEvent(new p.w.Event('pagehide'));
    await p.hasta(() => estados(136) === 'ok, pendiente', 'al irse lo manda');
    const envio = p.enviados.filter((e) => e.metodo === 'PATCH').at(-1);
    ok(envio.keepalive && JSON.parse(envio.data.checklistBase).every((x) => x.estado === 'pendiente'), `Al irse sale con keepalive y su base: ${JSON.stringify(envio)}`);
    p.w.close();
  }
  { // K3 · Si el checklist cambió de largo en el servidor, la ficha lo dice y ofrece volver a cargar.
    const p = await abrir(124, 'jefe');
    const otro = lista(...PASOS);
    sqlite.prepare('UPDATE ordenes SET checklist_ejecucion=? WHERE id=124').run(otro);
    p.doc.querySelector('.ck-estado-btn[data-idx="0"][data-estado="ok"]').click();
    await p.hasta(() => !p.doc.querySelector('#ckConflicto').classList.contains('hidden'), 'muestra el conflicto');
    ok(p.doc.querySelector('#ckConflictoMsg').textContent === 'El checklist cambió mientras lo editabas. Vuelve a cargar la ficha.', `Muestra el mensaje del servidor: ${p.doc.querySelector('#ckConflictoMsg').textContent}`);
    ok(/Volver a cargar la ficha/.test(p.doc.querySelector('#ckRecargar')?.textContent ?? ''), 'Ofrece volver a cargar la ficha');
    ok(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=124').c === otro && p.avisos.length === 0, 'No se pisó nada y no salta ningún aviso');
    p.w.close();
  }

  // ── J6 · Devolver y reabrir no se le ofrecen al técnico asignado ───────
  {
    const botones = (v) => [...v.doc.querySelectorAll('[data-transition]')].map((b) => b.textContent.trim());
    const motivo = 'Faltó revisar el retardo de la transferencia.';
    const enviadaTec = await ver(133, 'tecnico');
    ok(botones(enviadaTec).length === 0, `Su orden enviada no le ofrece devolverla: ${botones(enviadaTec)}`);
    ok((await patch(133, 'tecnico', { estado: 'en_proceso', motivo })).status === 403, 'El servidor le rechaza devolverla');
    const revisor = await ver(133, 'tecnico', 8);
    ok(/Devolver con motivo/.test(revisor.boton('en_proceso')?.textContent ?? ''), `El revisor designado sí ve «Devolver con motivo»: ${botones(revisor)}`);
    const cerradaTec = await ver(134, 'tecnico');
    ok(botones(cerradaTec).length === 0, `Su orden cerrada no le ofrece reabrirla: ${botones(cerradaTec)}`);
    ok((await patch(134, 'tecnico', { estado: 'en_proceso', motivo })).status === 403, 'El servidor le rechaza reabrirla');
    ok(/Reabrir con motivo/.test((await ver(134, 'jefe')).boton('en_proceso')?.textContent ?? ''), 'La jefatura sí la reabre con motivo');
  }

  // ── J7 · Lectura anotada en texto y fuera de rango ─────────────────────
  {
    for (const rol of ['tecnico', 'jefe']) {
      const v = await ver(125, rol);
      ok(v.boton('completada')?.disabled === true, `${rol}: «Enviar a verificación» queda bloqueado con «14,5 A» fuera de rango`);
      ok(/Fuera de rango: Corriente de fase/.test(v.doc.querySelector('#liberBloqueo')?.textContent ?? ''), `${rol}: el aviso dice qué lectura quedó fuera de rango`);
      ok(!v.hay('#sinLecturaBtn'), `${rol}: fuera de rango no hay envío sin lectura`);
    }
    const srv = await patch(125, 'tecnico', { estado: 'completada' });
    ok(srv.status === 400 && /fuera de rango/.test(srv.body.error ?? ''), `El servidor la rechaza igual: ${JSON.stringify(srv.body)}`);
    const v = await ver(126, 'jefe');
    ok(/quedó fuera de rango/.test(v.doc.querySelector('#verifModal')?.textContent ?? '') && v.doc.querySelector('#verifConfirm').disabled, 'La verificación también la juzga fuera de rango');
  }

  // ── K4 · Lectura de liberación con rango: un número con su unidad ──────
  {
    const v = await ver(127, 'tecnico');
    const campo = v.doc.querySelector(`.liber-valor[data-id="${libRango}"]`);
    ok(campo.type === 'text' && campo.getAttribute('inputmode') === 'decimal' && !campo.disabled, `Con rango el campo es numérico y acepta coma: ${campo.outerHTML}`);
    ok(campo.closest('li').querySelector('.liber-unidad')?.textContent === 'A' && !v.hay(`.liber-texto[data-id="${libRango}"]`), 'Con rango la unidad va al lado y no se ofrece texto libre');
    ok(v.doc.querySelector(`.liber-valor[data-id="${libTexto}"]`).type === 'number' && v.hay(`.liber-texto[data-id="${libTexto}"]`), 'Sin rango, número o texto como hoy');
    const p = await abrir(127, 'tecnico');
    const msg = () => p.doc.querySelector(`.liber-msg[data-id="${libRango}"]`);
    const fila = () => one('SELECT valor_medido v, valor_medido_texto t, conforme c FROM orden_liberaciones WHERE id=?', libRango);
    p.escribir(`.liber-valor[data-id="${libRango}"]`, 'aprox 14');
    p.doc.querySelector(`.liber-save[data-id="${libRango}"]`).click();
    await p.hasta(() => !msg().classList.contains('hidden'), 'muestra el error del servidor');
    ok(msg().textContent === 'Esta lectura tiene rango: anota el número que marcó el instrumento (por ejemplo 14,5).', `Muestra tal cual el error del servidor: ${msg().textContent}`);
    ok(fila().v === null && fila().t === null, 'Sin número no queda nada guardado');
    p.escribir(`.liber-valor[data-id="${libRango}"]`, '10,5');
    p.doc.querySelector(`.liber-save[data-id="${libRango}"]`).click();
    await p.hasta(() => fila().v === 10.5, 'guarda el número escrito con coma');
    const envio = p.enviados.filter((e) => e.ruta.endsWith('/liberaciones')).at(-1).data;
    ok(envio.valorMedido === 10.5 && envio.valorMedidoTexto === null && fila().c === 1, `Viaja el número y queda conforme: ${JSON.stringify(envio)}`);
    ok(msg().classList.contains('hidden'), 'El aviso se limpia al guardar bien');
    p.w.close();
    for (const rol of ['tecnico', 'jefe']) {
      const s = await ver(135, rol);
      const bloqueo = s.doc.querySelector('#liberBloqueo')?.textContent.replace(/\s+/g, ' ') ?? '';
      ok(s.boton('completada')?.disabled === true && /Falta medir: Corriente de fase/.test(bloqueo), `${rol}: con rango, «arrancó bien» cuenta como no medida: ${bloqueo}`);
      ok(s.doc.querySelector('.liber-valor').value === 'arrancó bien', `${rol}: el campo muestra lo que quedó escrito para corregirlo`);
    }
    ok(/Enviar a verificación sin lectura/.test((await ver(135, 'jefe')).doc.querySelector('#sinLecturaBtn')?.textContent ?? ''), 'Sin número, la jefatura puede enviarla sin lectura con motivo');
  }

  // ── Quién registra en un MOP: igual que el servidor ────────────────────
  {
    const puede = (v) => JSON.stringify({
      lectura: !v.doc.querySelector('.liber-valor').disabled && v.hay('.liber-save'),
      reversa: !v.doc.querySelector('#planReversa').disabled && v.hay('#reversaSave'),
      prerrequisito: v.hay('.prerreq-toggle'),
    });
    const todo = JSON.stringify({ lectura: true, reversa: true, prerrequisito: true });
    const nada = JSON.stringify({ lectura: false, reversa: false, prerrequisito: false });
    ok(puede(await ver(128, 'tecnico')) === nada, 'MOP abierto sin asignar: el técnico no registra nada');
    const libre = one('SELECT id FROM orden_liberaciones WHERE orden_id=128').id;
    ok((await call(app.liberaciones.PATCH, '/api/ordenes/128/liberaciones', { method: 'PATCH', id: 128, rol: 'tecnico', data: { itemId: libre, valorMedido: 10 } })).status === 403, 'El servidor tampoco se lo deja');
    ok(puede(await ver(129, 'tecnico')) === todo, 'MOP abierto y asignado a él: registra prerrequisitos, lecturas y reversa');
    ok(puede(await ver(130, 'tecnico')) === nada, 'MOP de otro técnico: nada');
    ok(puede(await ver(128, 'jefe')) === todo && puede(await ver(130, 'admin')) === todo, 'La jefatura registra en cualquier MOP sin cerrar');
    ok(puede(await ver(129, 'visualizador')) === nada, 'El visualizador solo lee');
  }

  // ── Reporte de la orden: los tiempos son de la jefatura ────────────────
  {
    ok((await patch(131, 'tecnico', { estado: 'en_proceso' })).status === 200, 'El técnico inicia el correctivo');
    const pasos131 = await celular({ tipo: 'orden.paso', ordenId: 131, idx: 0, estado: 'ok', texto: 'Revisar el breaker' }, { tipo: 'orden.paso', ordenId: 131, idx: 1, estado: 'ok', texto: 'Medir la corriente' });
    ok(pasos131.every((x) => x.ok), `Marca los pasos en el celular: ${JSON.stringify(pasos131)}`);
    ok((await patch(131, 'tecnico', { estado: 'completada', trabajosRealizados: 'Se ajustó el breaker y se midió la corriente de fase.' })).status === 200, 'Lo envía a verificación');
    ok((await patch(132, 'tecnico', { estado: 'en_proceso' })).status === 200 && (await patch(132, 'tecnico', { estado: 'completada', trabajosRealizados: 'Se cambió el fusible y se probó la carga.' })).status === 200, 'Un correctivo sin pasos, también enviado');
    const reporte = async (id, rol) => {
      const hoja = new JSDOM(await html(id, rol, USUARIO[rol], paginaReporte, `/ordenes/${id}/reporte`)).window.document.querySelector('article.print-doc');
      return {
        texto: hoja.textContent.replace(/\s+/g, ' '),
        secciones: [...hoja.querySelectorAll('h2.doc-h')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()),
        columnas: [...hoja.querySelectorAll('th')].map((th) => th.textContent.trim()),
        cuando: [...hoja.querySelectorAll('td.tn')].map((td) => td.textContent.trim()),
      };
    };
    const tiemposReporte = /Tiempo de trabajo|En pausa|Estimado|Sin contar pausas|Sin iniciar|Sin terminar/;
    for (const rol of ['admin', 'jefe']) {
      const j = await reporte(131, rol);
      ok(j.secciones.slice(0, 3).join(' | ') === '1. Tiempos | 2. Pasos | 3. Trabajos realizados' && tiemposReporte.test(j.texto), `${rol} ve los tiempos: ${j.secciones.join(' | ')}`);
      ok(j.columnas.includes('Min') && j.cuando.length > 0 && j.cuando.every((c) => /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(c)), `${rol} ve los minutos por paso y la hora del historial: ${j.cuando.join(' | ')}`);
    }
    const t = await reporte(131, 'tecnico');
    ok(t.secciones.slice(0, 2).join(' | ') === '1. Pasos | 2. Trabajos realizados' && !t.secciones.some((s) => /Tiempos/.test(s)), `El técnico no ve «Tiempos» y la numeración no deja huecos: ${t.secciones.join(' | ')}`);
    ok(!tiemposReporte.test(t.texto) && !t.columnas.includes('Min'), `Ni tiempo de trabajo, pausas, estimado ni minutos por paso: ${t.texto.match(tiemposReporte)?.[0] ?? t.columnas.join(' | ')}`);
    ok(t.cuando.length > 0 && t.cuando.every((c) => /^\d{2}\/\d{2}\/\d{4}$/.test(c)), `El historial le muestra solo el día: ${t.cuando.join(' | ')}`);
    ok((await reporte(132, 'tecnico')).secciones[0] === '1. Trabajos realizados', 'Sin pasos, para el técnico «Trabajos realizados» es la sección 1');
    ok((await reporte(132, 'jefe')).secciones.slice(0, 2).join(' | ') === '1. Tiempos | 2. Trabajos realizados', 'Sin pasos, la jefatura ve 1. Tiempos y 2. Trabajos realizados');
  }
  console.log(`PASS test-ficha-orden: ${checks} verificaciones; ficha y reporte construidos, migraciones reales, cruces con el celular, admin, jefe, técnico y visualizador.`);
} finally { await f.close(); }
