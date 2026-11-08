// La ficha web de la orden, construida de verdad, contra migraciones reales: qué ve y qué
// no ve cada rol en una emergencia (EOP) y en una intervención (MOP), y qué manda la
// pantalla al guardar, con las rutas reales detrás. Los cruces son reales: el técnico
// registra por /api/campo/sync y después la jefatura guarda en la ficha que tenía
// abierta. También los números escritos a mano (la copia de src/lib/numero.ts),
// lo marcado sin señal o mientras viaja un guardado, el paso que cambió en el servidor
// mientras tanto (K11), las copias del equipo por cuenta (K14), los borradores que saben
// si después se guardó otro texto, la causa con soloCambios (K16) y el reporte de la orden.
// Correr después de npm run build.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { experimental_AstroContainer } from 'astro/container';
import * as esbuild from 'esbuild';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';
import { fijarReloj } from './test-support/reloj.mjs';

fijarReloj();
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');

const beforeMigration = (db, n) => { if (n.startsWith('0049_fase49')) db.exec("INSERT OR IGNORE INTO usuarios(id,nombre,email,password_hash,rol) VALUES(1000,'Administración','siembra@example.invalid','x','admin')"); };
const f = await setupConjuntos({ beforeMigration, modules: { sync: 'pages/api/campo/sync', liberaciones: 'pages/api/ordenes/[id]/liberaciones', ordenes: 'lib/ordenes' } });
const { app, sqlite, call, DB, faults } = f;
const one = (q, ...a) => sqlite.prepare(q).get(...a);
const modulo = async (ruta) => (await import(pathToFileURL(path.join(process.cwd(), 'dist/_worker.js/pages', ruta)).href)).page().default;
const pagina = await modulo('ordenes/_id_.astro.mjs');
const paginaReporte = await modulo('ordenes/_id_/reporte.astro.mjs');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const USUARIO = { admin: 1, jefe: 2, tecnico: 3, visualizador: 4 };
const AREA = 'infraestructura';
// La copia del checklist en el equipo lleva la cuenta en la clave (K14).
const CK = (id, rol) => `ot-${id}-ck-${USUARIO[rol]}`;

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

  // ── Números escritos a mano, guardado sin señal y en vuelo, causa raíz y reversa ──
  const emergencia = (id, campos = {}) => orden(id, { tipo: 'emergencia', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(0.5), hora_alarma: hace(0.5), causa_raiz_vencimiento: hace(-71.5), checklist_ejecucion: lista(...PASOS), ...campos });
  // Decisión 4: el paso marcado sin señal sale al volver a abrir la ficha.
  emergencia(137); emergencia(153); emergencia(154);
  // El 409 de la guarda de concurrencia: el celular escribe entre la lectura y la escritura.
  emergencia(138); emergencia(139); emergencia(152);
  // Un error del servidor al guardar el checklist.
  emergencia(155);
  // Guardado en vuelo: 300 ms, 2,5 s y al salir.
  emergencia(140); emergencia(141); emergencia(142);
  // Decisión 8 en el paso: la lectura obligatoria y el valor medido.
  orden(143, { tipo: 'preventivo', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(1), checklist_ejecucion: JSON.stringify([
    { texto: 'Medir el CO2 de la sala', estado: 'pendiente', requiereValor: true, unidad: 'ppm', esperadoMax: 1000 },
    { texto: 'Revisar la presión de la red', estado: 'pendiente', criterio: 'Entre 100 y 130 psi' },
    { texto: 'Anotar cómo quedó el tablero', estado: 'pendiente', requiereValor: true }]) });
  // Un valor guardado antes de la regla que se lee de dos formas.
  orden(151, { tipo: 'preventivo', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(1), checklist_ejecucion: JSON.stringify([
    { texto: 'Medir la presión diferencial del filtro', estado: 'ok', requiereValor: true, unidad: 'Pa', esperadoMin: 2.5, esperadoMax: 15, valorMedido: '2.500' }]) });
  // Decisión 8 en la liberación: CO2 con máximo de 1000 ppm.
  orden(144, { tipo: 'intervencion', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(1) });
  reqs(144);
  const libCo2 = Number(sqlite.prepare("INSERT INTO orden_liberaciones(orden_id,etiqueta,unidad,max_aceptable,obligatoria) VALUES(144,'CO2 en el quirófano','ppm',1000,1)").run().lastInsertRowid);
  // Lo escrito mientras viaja el guardado de las horas y de la reversa.
  emergencia(145, { iniciada_en: hace(1), hora_alarma: hace(1), checklist_ejecucion: null });
  orden(146, { tipo: 'intervencion', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(1), plan_reversa: 'Volver al tablero anterior.' });
  reqs(146); lectura(146);
  // La causa raíz con la orden enviada y en proceso.
  orden(147, { tipo: 'emergencia', estado: 'completada', activo_id: 1, asignado_a: 3, iniciada_en: hace(5), completada_en: hace(1), horas_trabajadas: 4,
    hora_alarma: hace(5), causa_raiz_vencimiento: hace(-67), trabajos_realizados: 'Planta en manual y transferencia operada con dos técnicos.' });
  enviada(147);
  emergencia(148, { checklist_ejecucion: null });
  // La reversa en una intervención cerrada y en una cancelada.
  orden(149, { tipo: 'intervencion', estado: 'cerrada', activo_id: 1, asignado_a: 3, iniciada_en: hace(30), completada_en: hace(26), horas_trabajadas: 3, verificado_por: 2, verificado_en: hace(25),
    cerrado_por: 2, cerrado_en: hace(25), plan_reversa: 'Volver al tablero anterior.', trabajos_realizados: 'Cambio del interruptor del tablero de la rama crítica.' });
  reqs(149); enviada(149);
  orden(150, { tipo: 'intervencion', estado: 'cancelada', activo_id: 1, asignado_a: 3, plan_reversa: 'Volver al tablero anterior.' });
  reqs(150);
  // Al volver a abrir con lo marcado sin señal: el paso cambió mientras tanto, dos pestañas y lo que ya llegó.
  emergencia(156); emergencia(157); emergencia(158); emergencia(159); emergencia(160); emergencia(161); emergencia(163); emergencia(176); emergencia(177);
  emergencia(162, { trabajos_realizados: 'Planta en manual; transferencia operada con un segundo técnico.', checklist_ejecucion: lista(PASOS[0], PASOS[1]) });
  orden(164, { tipo: 'intervencion', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(2), trabajos_realizados: 'Cambio del interruptor del tablero de la rama crítica.',
    checklist_ejecucion: lista('Desenergizar el tablero', 'Cambiar el interruptor') });
  reqs(164); lectura(164);
  // Lo escrito mientras viaja el guardado que mueve el plazo o la reversa, y el 409 de concurrencia al salir.
  emergencia(165, { iniciada_en: hace(1), hora_alarma: hace(1), checklist_ejecucion: null });
  orden(166, { tipo: 'intervencion', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(1), plan_reversa: 'Volver al tablero anterior.' });
  reqs(166); lectura(166);
  emergencia(167);
  // Un valor que el celular guardó como número, en un paso y en una lectura de liberación.
  const medida = { texto: 'Medir la corriente de fase', estado: 'pendiente', requiereValor: true, unidad: 'A', esperadoMin: 8, esperadoMax: 12 };
  const conMedida = (id, ...otros) => orden(id, { tipo: 'preventivo', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(1), trabajos_realizados: 'Se midió la corriente y se limpió el tablero.',
    checklist_ejecucion: JSON.stringify([medida, ...otros.map((texto) => ({ texto, estado: 'pendiente' }))]) });
  conMedida(168, 'Limpiar el tablero'); conMedida(169); conMedida(172, 'Limpiar el tablero');
  orden(170, { tipo: 'intervencion', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(1) });
  reqs(170);
  const guardadaConRango = Number(sqlite.prepare("INSERT INTO orden_liberaciones(orden_id,etiqueta,unidad,min_aceptable,max_aceptable,obligatoria,valor_medido,conforme,medido_por,medido_en) VALUES(170,'Corriente de fase','A',8,15,1,12.345,1,3,?)").run(hace(0.5)).lastInsertRowid);
  const guardadaSinRango = Number(sqlite.prepare("INSERT INTO orden_liberaciones(orden_id,etiqueta,unidad,obligatoria,valor_medido,medido_por,medido_en) VALUES(170,'Presión de la red','psi',0,12.345,3,?)").run(hace(0.5)).lastInsertRowid);
  // K8: un paso con criterio y rango, sin lectura obligatoria.
  orden(171, { tipo: 'preventivo', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(1), checklist_ejecucion: JSON.stringify([
    { texto: 'Revisar la corriente del motor', estado: 'pendiente', criterio: 'Entre 8 y 12 A', esperadoMin: 8, esperadoMax: 12 }]) });
  // K10: el 409 de la guarda de concurrencia, por su motivo y por su frase.
  emergencia(173); emergencia(174);
  // El error del servidor al guardar el plan de reversa.
  orden(175, { tipo: 'intervencion', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(1), plan_reversa: 'Volver al tablero anterior.' });
  reqs(175); lectura(175);
  // K11: un paso que cambió en el servidor mientras tanto (M1, M2, M3 y T6).
  emergencia(180); emergencia(181); emergencia(182); emergencia(184); emergencia(200); emergencia(201); emergencia(203);
  emergencia(202, { checklist_ejecucion: JSON.stringify(PASOS.map((texto) => ({ texto, hecho: false }))) });
  emergencia(183, { trabajos_realizados: 'Planta en manual; transferencia operada con un segundo técnico.', checklist_ejecucion: lista(PASOS[0], PASOS[1]) });
  emergencia(205, { trabajos_realizados: 'Planta en manual; transferencia operada con un segundo técnico.', checklist_ejecucion: lista(PASOS[0], PASOS[1]) });
  orden(198, { tipo: 'intervencion', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(2), trabajos_realizados: 'Cambio del interruptor del tablero de la rama crítica.',
    checklist_ejecucion: lista('Desenergizar el tablero', 'Cambiar el interruptor') });
  reqs(198); lectura(198);
  // K14: la copia y los borradores son de cada cuenta.
  emergencia(185); emergencia(186, { checklist_ejecucion: null }); emergencia(187, { checklist_ejecucion: null });
  // F18 y F19: lo que no cambió o ya llegó, comparado como el servidor.
  emergencia(188); conMedida(189, 'Limpiar el tablero'); conMedida(204);
  // F20: lecturas con rango que quedaron sin número, y una sin rango en texto.
  orden(190, { tipo: 'preventivo', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(1), checklist_ejecucion: JSON.stringify([
    { texto: 'Medir la corriente de fase', estado: 'ok', requiereValor: true, unidad: 'A', esperadoMin: 8, esperadoMax: 12, valorMedido: 'ok', hora: '10:00', iniciales: 'P.T.' },
    { texto: 'Medir el CO2 de la sala', estado: 'ok', requiereValor: true, unidad: 'ppm', esperadoMax: 1000, valorMedido: '1,200', hora: '10:05', iniciales: 'P.T.' },
    { texto: 'Anotar cómo quedó el tablero', estado: 'ok', requiereValor: true, valorMedido: 'sin alarmas' }]) });
  // F21: el envío a verificación que falla.
  emergencia(191, { checklist_ejecucion: lista(PASOS[0], PASOS[1]) }); emergencia(192, { checklist_ejecucion: lista(PASOS[0], PASOS[1]) }); emergencia(199);
  // F22 y F23: «Guardar horas», la clasificación, «Vincular» y la reversa. El
  // equipo del sistema eléctrico hace que el sistema resuelva el EOP que rige.
  sqlite.exec(`INSERT INTO activos(id,codigo,nombre,tipo,rubro,ubicacion_id,criticidad_operacional,sistema) VALUES(2,'ELE-ATS-02','Transferencia automática','general','${AREA}',1,'alta','electrico')`);
  emergencia(193, { activo_id: 2, checklist_ejecucion: null });
  emergencia(194, { iniciada_en: hace(2), hora_alarma: hace(2), hora_llegada: hace(1.8), hora_mitigacion: hace(1.5), hora_restablecimiento: hace(1), causa_raiz_vencimiento: hace(-70), checklist_ejecucion: null });
  orden(195, { tipo: 'intervencion', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(1), plan_reversa: 'Volver al tablero anterior.' });
  reqs(195); lectura(195);
  // F24: un punto sin texto al inicio no cuenta en la numeración.
  emergencia(196, { checklist_ejecucion: JSON.stringify([{ texto: '', estado: 'pendiente' }, { texto: PASOS[0], estado: 'pendiente' }, { texto: PASOS[1], estado: 'pendiente' }]) });
  // F25: una orden que nació en dos rondas, la de la 01:00 y la de las 14:00.
  orden(197, { tipo: 'correctivo', estado: 'abierta', activo_id: 1 });
  sqlite.exec(`
    INSERT INTO rondas(id,codigo,nombre) VALUES(9001,'RONDA-FICHA','Ronda de la ficha');
    INSERT INTO ronda_puntos(id,ronda_id,sistema,etiqueta) VALUES(9001,9001,'electrico','Planta de emergencia · nivel de combustible');
    INSERT INTO ronda_ejecuciones(id,ronda_id,sucursal_id,fecha,turno,recorrido_json) VALUES(9001,9001,1,'2026-11-08','01:00','[]'),(9002,9001,1,'2026-11-08','14:00','[]');
    INSERT INTO ronda_lecturas(ejecucion_id,punto_id,resultado,orden_id,registrado_por) VALUES(9001,9001,'fuera',197,3),(9002,9001,'fuera',197,3);
  `);
  // F26: los borradores de lo escrito y de la causa llevan lo que tenía el servidor al escribirlos.
  for (const id of [210, 211, 212, 213, 214, 215, 223, 228]) emergencia(id, { checklist_ejecucion: null });
  // F35: la jefatura vuelve a una causa anterior que escribió otra cuenta.
  emergencia(216, { checklist_ejecucion: null }); emergencia(217, { checklist_ejecucion: null });
  // F27: el aviso de un paso que cambió sigue hasta volver a marcarlo.
  emergencia(218); emergencia(219);
  // F28: las iniciales y la hora escritas a mano cuentan para saber si una marca ya llegó.
  conMedida(221, 'Limpiar el tablero');
  orden(222, { tipo: 'preventivo', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(1), checklist_ejecucion: JSON.stringify([
    { texto: 'Anotar la corriente de fase', estado: 'pendiente', requiereValor: true, unidad: 'A' }, { texto: 'Limpiar el tablero', estado: 'pendiente' }]) });
  // F30 y F34: pasos N/A con lectura obligatoria, un límite ilegible y la hora de la constancia.
  orden(224, { tipo: 'preventivo', estado: 'en_proceso', activo_id: 1, asignado_a: 3, iniciada_en: hace(1), checklist_ejecucion: JSON.stringify([
    { texto: 'Medir la corriente de la fase A', estado: 'na', requiereValor: true, unidad: 'A', esperadoMin: 8, esperadoMax: 12, valorMedido: 'no se midió' },
    { texto: 'Medir la corriente de la fase B', estado: 'na', requiereValor: true, unidad: 'A', esperadoMin: 8, esperadoMax: 12 },
    { texto: 'Medir la corriente de la fase C', estado: 'pendiente', requiereValor: true, unidad: 'A', esperadoMin: 8, esperadoMax: 12 },
    { texto: 'Anotar la presión del tablero', estado: 'ok', requiereValor: true, esperadoMin: 'abc', valorMedido: 'normal' }]) });
  conMedida(225);
  // F31 y F33: el envío rechazado por permiso y el 409 de un paso sin nada más por guardar.
  emergencia(226, { trabajos_realizados: 'Planta en manual; transferencia operada con un segundo técnico.', checklist_ejecucion: lista(PASOS[0], PASOS[1]) });
  emergencia(229, { trabajos_realizados: 'Planta en manual; transferencia operada con un segundo técnico.', checklist_ejecucion: lista(PASOS[0], PASOS[1]) });

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
  // almacen: lo que ya hay en el localStorage de este equipo al abrir.
  // compartido: un localStorage que comparten las pestañas del mismo equipo, como en un navegador.
  // red.demora: cuánto tarda cada envío en llegar al servidor.
  // red.falsas: lo que responde el servidor, en orden, a los PATCH siguientes de la orden.
  // red.sinRespuesta: el envío llega al servidor, pero la página no lee la respuesta (se cerró al salir).
  // recargas: las veces que la ficha se volvió a cargar.
  // confirmaciones: lo que la ficha preguntó con confirm, y confirmar lo que se responde. desplazados: a qué se llevó la vista.
  const abrir = async (id, rol, { almacen = {}, compartido = null, confirmar = true } = {}) => {
    const enviados = [], avisos = [], errores = [], recargas = [], confirmaciones = [], desplazados = [], red = { caida: false, demora: 0, falsas: [], sinRespuesta: false };
    const consola = new VirtualConsole();
    consola.on('jsdomError', (e) => {
      const m = e.detail?.message ?? e.message;
      if (/navigation/.test(m)) recargas.push(m);
      else if (!/Not implemented/.test(e.message) && !/getContext|fillStyle/.test(String(e.detail?.stack ?? e.stack ?? e.message))) errores.push(m);
    });
    const dom = new JSDOM(await html(id, rol), {
      url: `https://local.test/ordenes/${id}?area=${AREA}`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: consola,
      beforeParse(w) {
        if (compartido) Object.defineProperty(w, 'localStorage', { value: compartido, configurable: true });
        for (const [k, v] of Object.entries(almacen)) w.localStorage.setItem(k, v);
        w.alert = (m) => avisos.push(m); w.confirm = (m) => { confirmaciones.push(m); return confirmar; }; w.prompt = () => null;
        w.Element.prototype.scrollIntoView = function () { desplazados.push(this.id); };
        w.fetch = async (url, init = {}) => {
          const u = new URL(url, 'https://local.test');
          const data = init.body ? JSON.parse(init.body) : undefined;
          const envio = { metodo: init.method ?? 'GET', ruta: u.pathname, data, keepalive: !!init.keepalive };
          enviados.push(envio);
          if (red.caida) throw new TypeError('Failed to fetch');
          if (red.demora) await pausa(red.demora);
          const m = u.pathname.match(/^\/api\/ordenes\/(\d+)(\/liberaciones)?$/);
          const falsa = m && !m[2] && init.method === 'PATCH' ? red.falsas.shift() : undefined;
          const r = falsa ?? (m && init.method === 'PATCH' ? await call(m[2] ? app.liberaciones.PATCH : app.order.PATCH, u.pathname, { method: 'PATCH', id: Number(m[1]), data, rol }) : { status: 200, body: {} });
          envio.respuesta = r.body; envio.status = r.status;
          if (red.sinRespuesta) throw new TypeError('Failed to fetch');
          return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
        };
      },
    });
    const w = dom.window;
    const hasta = async (fn, msg, ms = 4000) => { for (let i = 0; i < ms / 10; i++) { if (fn()) return; await pausa(10); } assert.fail(`${msg} · enviados: ${JSON.stringify(enviados)} · avisos: ${avisos.join(' | ')}`); };
    const escribir = (sel, valor) => { const el = w.document.querySelector(sel); el.value = valor; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
    const patches = () => enviados.filter((e) => e.metodo === 'PATCH').map((e) => e.data);
    const marcar = (idx, estado) => w.document.querySelector(`.ck-estado-btn[data-idx="${idx}"][data-estado="${estado}"]`).click();
    const indicador = () => w.document.querySelector('#ckAutosave')?.textContent ?? '';
    const caja = () => (w.document.querySelector('#ckConflicto').classList.contains('hidden') ? '' : w.document.querySelector('#ckConflictoMsg').textContent);
    return { w, doc: w.document, enviados, avisos, errores, recargas, confirmaciones, desplazados, hasta, escribir, red, patches, marcar, indicador, caja };
  };
  // Un localStorage que comparten las pestañas del mismo equipo.
  class Almacen {
    constructor() { this.m = new Map(); }
    get length() { return this.m.size; }
    key(i) { return [...this.m.keys()][i] ?? null; }
    getItem(k) { return this.m.has(String(k)) ? this.m.get(String(k)) : null; }
    setItem(k, v) { this.m.set(String(k), String(v)); }
    removeItem(k) { this.m.delete(String(k)); }
    clear() { this.m.clear(); }
  }
  // Lo que guarda el localStorage de una ventana.
  const almacenDe = (w) => Object.fromEntries(Array.from({ length: w.localStorage.length }, (_, i) => [w.localStorage.key(i), w.localStorage.getItem(w.localStorage.key(i))]));
  // El estado que la pantalla tiene marcado en cada punto del checklist.
  const enPantalla = (p, n) => Array.from({ length: n }, (_, i) => [...p.doc.querySelectorAll(`.ck-estado-btn[data-idx="${i}"]`)]
    .find((b) => /bg-slate-700|bg-brand-600|bg-slate-500|border-amber-500/.test(b.className))?.dataset.estado).join(', ');

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
    ok(envio.length === 1 && JSON.stringify(Object.keys(envio[0].data)) === '["causaRaiz","soloCambios"]' && envio[0].data.soloCambios === true, `La causa raíz viaja sola, con soloCambios: ${JSON.stringify(envio)}`);
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
    ok(envios.length === 1 && JSON.stringify(envios[0]) === JSON.stringify({ horaAlarma: `${corregida}:00-06:00`, soloCambios: true }), `Solo viaja la hora que cambió, sin null para las demás, con soloCambios: ${JSON.stringify(envios)}`);
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
    ok(envios.length === 1 && JSON.stringify(envios[0]) === JSON.stringify({ planReversa: plan, soloCambios: true }), `Solo viaja el plan, con soloCambios: ${JSON.stringify(envios)}`);
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
    ok(p.w.localStorage.getItem(CK(124, 'jefe')) === null, 'Lo que no se puede fusionar no queda en el equipo para mandarlo al volver');
    p.w.dispatchEvent(new p.w.Event('pagehide'));
    await pausa(50);
    ok(p.patches().length === 1 && !p.enviados.some((e) => e.keepalive), `El 409 por largo no se reintenta ni sale al irse: ${p.patches().length} envíos`);
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

  // ── Decisión 8 · La ficha lee los números con la regla de src/lib/numero.ts ──
  {
    const salida = await esbuild.build({ entryPoints: ['src/lib/numero.ts'], bundle: true, format: 'esm', platform: 'neutral', write: false });
    const original = await import(`data:text/javascript;base64,${Buffer.from(salida.outputFiles[0].text).toString('base64')}`);
    const p = await abrir(143, 'tecnico');
    const copia = p.w.otNumero;
    ok(copia && ['leerNumero', 'numeroAlInicio', 'mensajeAmbiguo', 'valorDe', 'textoDeNumero'].every((fn) => typeof copia[fn] === 'function'), 'La ficha trae su copia de la regla de los números');
    // Los mismos casos de scripts/test-numero.mjs, tal como están escritos ahí.
    const fuente = await fs.readFile('scripts/test-numero.mjs', 'utf8');
    const deLaPrueba = [...fuente.matchAll(/\b(?:leerNumero|numeroAlInicio)\(((?:'[^']*'|[^()'])*)\)/g)].map((m) => Function(`return (${m[1]});`)());
    ok(deLaPrueba.length >= 40, `Se toman los casos de test-numero.mjs: ${deLaPrueba.length}`);
    const extra = ['1,200 ppm', '0,5', '00,500', '1,2000', '12,345', '123,456', '1234,567', '-0,250', '+1.250', '1,000,000', '1.000.000,5', '1 234 567,8', '1\u00a0234',
      '1 2', '12 345', '9 999 ppm', '14.5A', ',5', '.5', '5,', '1,,2', '1.2.3', '1e3', '0x10', 'NaN', 'Infinity', '١٢', '１２', '\t3,5\n', '- 5', '−5', '1_000', '1,234.567',
      true, false, {}, [], ['1,200'], 0, -0, 1e21, -7.25, Number.POSITIVE_INFINITY, undefined, null];
    // Todas las combinaciones cortas de cifras, separadores, signo y unidad.
    const letras = ['1', '0', '2', ',', '.', ' ', '\u00a0', '-', 'A'];
    const cortas = [];
    for (let largo = 1, nivel = ['']; largo <= 5; largo++) { nivel = nivel.flatMap((s) => letras.map((l) => s + l)); cortas.push(...nivel); }
    // Números con grupos de miles y decimales, con y sin unidad.
    const armados = [];
    for (const signo of ['', '-', '+']) for (const entero of ['0', '1', '12', '123', '1234', '01']) for (const grupos of ['', ',200', '.200', ' 200', ',200,000', '.200.000', ' 200 000', ',20', '.2005'])
      for (const decimal of ['', ',5', '.5', ',500', '.25']) for (const unidad of ['', ' A', 'ppm', ' 5 A']) armados.push(`${signo}${entero}${grupos}${decimal}${unidad}`);
    const casos = [...deLaPrueba, ...extra, ...cortas, ...armados];
    const distintos = [];
    for (const v of casos) for (const fn of ['leerNumero', 'numeroAlInicio']) {
      const a = JSON.stringify(copia[fn](v)), b = JSON.stringify(original[fn](v));
      if (a !== b) distintos.push(`${fn}(${JSON.stringify(v)}): ficha ${a} · numero.ts ${b}`);
    }
    ok(distintos.length === 0, `La copia de la ficha lee igual que numero.ts en ${casos.length} casos: ${distintos.slice(0, 5).join(' | ')}`);
    ok(copia.mensajeAmbiguo('1200', '1,2') === original.mensajeAmbiguo('1200', '1,2') && copia.mensajeAmbiguo('1234567', null) === original.mensajeAmbiguo('1234567', null)
      && copia.valorDe(copia.leerNumero('14,5')) === 14.5 && copia.valorDe(copia.leerNumero('1,200')) === null, 'La frase y valorDe también son iguales');
    // K7 · textoDeNumero: los números de test-numero.mjs y muchos más, y cada uno se vuelve a leer igual.
    const deLaPruebaTexto = [...fuente.matchAll(/\btextoDeNumero\(([^()]*)\)/g)].flatMap((m) => { try { return [Function(`return (${m[1]});`)()]; } catch { return []; } });
    ok(deLaPruebaTexto.filter((v) => typeof v === 'number').length >= 8, `Se toman los números de test-numero.mjs: ${deLaPruebaTexto.length}`);
    const numeros = [...deLaPruebaTexto, 12.345, -12.345, 123.456, 999.999, 100.001, 0.001, 1.0001, 5, -0, 0.1 + 0.2, 1e21, 1.5e-10, -2.5e-7, 123456789.123, Number.MAX_VALUE,
      Number.NaN, Number.POSITIVE_INFINITY, '12.345', null, undefined];
    for (const entero of [0, 1, 9, 12, 99, 123, 999, 1000, 12345]) for (const decimal of ['', '.1', '.12', '.123', '.1234', '.5', '.05', '.005', '.001', '.999', '.25', '.125'])
      for (const signo of [1, -1]) numeros.push(signo * Number(`${entero}${decimal}`));
    const escritosDistinto = numeros.filter((v) => copia.textoDeNumero(v) !== original.textoDeNumero(v));
    ok(escritosDistinto.length === 0, `textoDeNumero de la ficha escribe igual que numero.ts en ${numeros.length} casos: ${escritosDistinto.slice(0, 5).map(String).join(' | ')}`);
    const noVuelven = numeros.filter((v) => typeof v === 'number' && Number.isFinite(v) && copia.leerNumero(copia.textoDeNumero(v)).valor !== v);
    ok(noVuelven.length === 0 && copia.textoDeNumero(12.345) === '12.3450', `Cada número escrito así se vuelve a leer igual: ${noVuelven.slice(0, 5).join(' | ')}`);
    p.w.close();
  }
  { // Decisión 8 · En el paso, «1,200» no se guarda como 1,2: el aviso pide escribirlo sin separador de miles.
    const p = await abrir(143, 'tecnico');
    const num = p.doc.querySelector('.ck-num[data-idx="0"]');
    const aviso = (idx) => p.doc.querySelector(`.ck-aviso[data-idx="${idx}"]`);
    const AMBIGUO = '¿1200 o 1,2? Escribe el número sin separador de miles.';
    ok(num.type === 'text' && num.getAttribute('inputmode') === 'decimal', `La lectura obligatoria es texto con teclado numérico, para leer lo escrito: ${num.outerHTML}`);
    p.escribir('.ck-num[data-idx="0"]', '1,200');
    ok(!aviso(0).classList.contains('hidden') && aviso(0).textContent === AMBIGUO, `«1,200» muestra su frase junto al campo: ${aviso(0).textContent}`);
    p.escribir('.ck-valor[data-idx="1"]', '1.200');
    ok(!aviso(1).classList.contains('hidden') && aviso(1).textContent === AMBIGUO, `En el valor medido, también: ${aviso(1).textContent}`);
    await pausa(1400);
    ok(p.patches().length === 0, `Lo que se lee de dos formas no se manda: ${JSON.stringify(p.patches())}`);
    ok(num.value === '1,200' && p.doc.querySelector('.ck-valor[data-idx="1"]').value === '1.200', 'Lo escrito queda en el campo para corregirlo');
    p.escribir('.ck-num[data-idx="0"]', 'alto');
    ok(aviso(0).textContent === app.ordenes.MENSAJE_PASO_SIN_NUMERO, `Con rango, la lectura obligatoria pide el número con la frase del servidor: ${aviso(0).textContent}`);
    p.escribir('.ck-num[data-idx="2"]', 'sin alarmas');
    ok(aviso(2).classList.contains('hidden'), 'Sin rango, como en el celular, también vale un texto');
    p.escribir('.ck-num[data-idx="0"]', '1200');
    p.escribir('.ck-valor[data-idx="1"]', '125 psi');
    ok(aviso(0).classList.contains('hidden') && aviso(1).classList.contains('hidden'), 'Escrito sin separador de miles, el aviso se va');
    const guardado = () => JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=143').c);
    await p.hasta(() => guardado()[0].valorMedido === '1200' && guardado()[1].valorMedido === '125 psi' && guardado()[2].valorMedido === 'sin alarmas', 'guarda la lectura sin separador');
    const [co2] = guardado();
    ok(co2.estado === 'desviacion' && /^Lectura fuera de rango: 1200 ppm \(rango normal ≤ 1000 ppm\)/.test(co2.notas ?? '') && !!co2.hora, `1200 ppm se juzga fuera de rango, con su hora: ${JSON.stringify(co2)}`);
    ok(/FUERA DE RANGO/.test(p.doc.querySelector('.ck-rango[data-idx="0"]').textContent), 'La pantalla la marca fuera de rango');
    const valores = p.patches().flatMap((e) => JSON.parse(e.checklistEjecucion).map((x) => String(x.valorMedido ?? '')));
    ok(!valores.some((v) => /^1[.,]200$|^alto$/.test(v)), `Ningún guardado llevó «1,200», «1.200» ni «alto»: ${JSON.stringify(valores)}`);
    ok(p.errores.length === 0 && p.avisos.length === 0, `Sin errores ni avisos: ${p.errores.join(' | ')} ${p.avisos.join(' | ')}`);
    p.w.close();
    const actual = one('SELECT checklist_ejecucion c FROM ordenes WHERE id=143').c;
    const conMiles = JSON.parse(actual);
    conMiles[0].valorMedido = '1,200';
    const srv = await patch(143, 'tecnico', { checklistEjecucion: JSON.stringify(conMiles), checklistBase: actual });
    ok(srv.status === 400 && srv.body.error === AMBIGUO && one('SELECT checklist_ejecucion c FROM ordenes WHERE id=143').c === actual, `Si llega igual, el servidor también lo rechaza con la misma frase: ${JSON.stringify(srv.body)}`);
    const viejo = await abrir(151, 'tecnico');
    const marca = viejo.doc.querySelector('.ck-aviso[data-idx="0"]');
    ok(!marca.classList.contains('hidden') && marca.textContent === '¿2500 o 2,5? Escribe el número sin separador de miles.', `Un valor guardado que se lee de dos formas se marca al abrir: ${marca.textContent}`);
    viejo.escribir('.ck-num[data-idx="0"]', '2.500');
    ok(/Sin lectura — bloquea el cierre/.test(viejo.doc.querySelector('.ck-rango[data-idx="0"]').textContent) && !/Dentro del rango/.test(viejo.doc.querySelector('.ck-rango[data-idx="0"]').textContent), `«2.500» no se juzga como 2,5 dentro del rango: con rango, sin número es sin lectura: ${viejo.doc.querySelector('.ck-rango[data-idx="0"]').textContent}`);
    await pausa(1200);
    ok(viejo.patches().length === 0, 'Escribirlo otra vez igual no manda nada');
    viejo.w.close();
    const lector = await abrir(151, 'visualizador');
    ok(lector.doc.querySelector('.ck-aviso[data-idx="0"]').classList.contains('hidden'), 'A quien no puede corregirlo no se le pide');
    lector.w.close();
  }
  { // Decisión 8 · En la liberación con máximo, «1,200 ppm» no se manda como 1,2.
    const p = await abrir(144, 'tecnico');
    const msg = () => p.doc.querySelector(`.liber-msg[data-id="${libCo2}"]`);
    const fila = () => one('SELECT valor_medido v, valor_medido_texto t, conforme c FROM orden_liberaciones WHERE id=?', libCo2);
    const aLiberaciones = () => p.enviados.filter((e) => e.ruta.endsWith('/liberaciones'));
    p.escribir(`.liber-valor[data-id="${libCo2}"]`, '1,200');
    ok(!msg().classList.contains('hidden') && msg().textContent === '¿1200 o 1,2? Escribe el número sin separador de miles.', `Al escribir, el aviso dice cómo: ${msg().textContent}`);
    p.doc.querySelector(`.liber-save[data-id="${libCo2}"]`).click();
    await pausa(50);
    ok(aLiberaciones().length === 0 && fila().v === null && fila().t === null && !msg().classList.contains('hidden'), `«1,200» no se manda y el aviso sigue junto al campo: ${JSON.stringify(aLiberaciones())}`);
    p.escribir(`.liber-valor[data-id="${libCo2}"]`, '1 200 ppm');
    p.doc.querySelector(`.liber-save[data-id="${libCo2}"]`).click();
    await pausa(50);
    ok(aLiberaciones().length === 0 && msg().textContent === 'Escribe el número sin separador de miles: 1200.', `Con espacio de miles y la unidad, tampoco: ${msg().textContent}`);
    const srv = await call(app.liberaciones.PATCH, '/api/ordenes/144/liberaciones', { method: 'PATCH', id: 144, rol: 'tecnico', data: { itemId: libCo2, valorMedido: null, valorMedidoTexto: '1,200' } });
    ok(srv.status === 400 && srv.body.error === '¿1200 o 1,2? Escribe el número sin separador de miles.' && fila().t === null, `Si llega igual, el servidor también lo rechaza con la misma frase: ${JSON.stringify(srv.body)}`);
    p.escribir(`.liber-valor[data-id="${libCo2}"]`, '1200');
    ok(msg().classList.contains('hidden'), 'Sin separador de miles, el aviso se va');
    p.doc.querySelector(`.liber-save[data-id="${libCo2}"]`).click();
    await p.hasta(() => fila().v === 1200, 'guarda 1200');
    ok(JSON.stringify(aLiberaciones().map((e) => e.data)) === JSON.stringify([{ itemId: libCo2, valorMedido: 1200, valorMedidoTexto: null }]) && fila().c === 0, `Viaja solo 1200 y queda fuera de rango: ${JSON.stringify(aLiberaciones())} → ${JSON.stringify(fila())}`);
    ok(p.errores.length === 0, `Sin errores de script: ${p.errores.join(' | ')}`);
    p.w.close();
  }
  { // K7 · Un valor que el celular guardó como número («12.3450» → 12.345) se lee como número en la ficha.
    for (const [id, valor, etiqueta, insignia] of [[168, '12.3450', 'FUERA DE RANGO — no libera el sistema', '1 fuera de rango'], [169, '9.1250', '✓ Dentro del rango', null]]) {
      const [paso] = await celular({ tipo: 'orden.paso', ordenId: id, idx: 0, estado: 'ok', valor, texto: medida.texto });
      const guardado = JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=?', id).c)[0];
      ok(paso.ok && typeof guardado.valorMedido === 'number', `El celular lo guarda como número: ${JSON.stringify(guardado)}`);
      const p = await abrir(id, 'jefe');
      const campo = p.doc.querySelector('.ck-num[data-idx="0"]');
      const rango = p.doc.querySelector('.ck-rango[data-idx="0"]').textContent.trim();
      const insignias = [...p.doc.querySelectorAll('span')].map((s) => s.textContent.trim()).filter((s) => /^\d+ fuera de rango$/.test(s));
      ok(campo.value === valor && rango === etiqueta && p.doc.querySelector('.ck-aviso[data-idx="0"]').classList.contains('hidden'), `«${campo.value}» · ${rango} · sin aviso de miles`);
      ok(JSON.stringify(insignias) === JSON.stringify(insignia ? [insignia] : []), `El progreso del checklist lo cuenta: ${insignias.join(' | ') || 'sin insignia'}`);
      p.w.close();
    }
    // Al guardar otro paso, la ficha vuelve a pintar el valor del celular sin volverlo ambiguo.
    const p = await abrir(168, 'jefe');
    p.marcar(1, 'ok');
    await p.hasta(() => /Guardado/.test(p.indicador()), 'guarda el otro paso');
    ok(p.doc.querySelector('.ck-num[data-idx="0"]').value === '12.3450' && p.doc.querySelector('.ck-aviso[data-idx="0"]').classList.contains('hidden'), `Después de guardar sigue «12.3450», sin aviso: «${p.doc.querySelector('.ck-num[data-idx="0"]').value}»`);
    ok(/FUERA DE RANGO/.test(p.doc.querySelector('.ck-rango[data-idx="0"]').textContent) && JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=168').c)[0].valorMedido === 12.345, 'Sigue fuera de rango y el número del celular queda como estaba');
    ok(p.errores.length === 0 && p.avisos.length === 0, `Sin errores ni avisos: ${p.errores.join(' | ')} ${p.avisos.join(' | ')}`);
    p.w.close();
  }
  { // K7 · Una lectura de liberación guardada como número vuelve a su campo sin volverse ambigua.
    const p = await abrir(170, 'tecnico');
    const valor = (lib) => p.doc.querySelector(`.liber-valor[data-id="${lib}"]`).value;
    ok(valor(guardadaConRango) === '12.3450' && valor(guardadaSinRango) === '12.3450', `Con rango y sin rango vuelve «12.3450»: ${valor(guardadaConRango)} · ${valor(guardadaSinRango)}`);
    for (const [n, lib] of [guardadaConRango, guardadaSinRango].entries()) {
      p.doc.querySelector(`.liber-save[data-id="${lib}"]`).click();
      await p.hasta(() => p.recargas.length === n + 1, 'se vuelve a registrar');
    }
    const envios = p.enviados.filter((e) => e.ruta.endsWith('/liberaciones')).map((e) => e.data);
    ok(envios.length === 2 && envios.every((e) => e.valorMedido === 12.345 && e.valorMedidoTexto === null) && [...p.doc.querySelectorAll('.liber-msg')].every((m) => m.classList.contains('hidden')),
      `Viaja el mismo número, sin aviso de miles: ${JSON.stringify(envios)}`);
    p.w.close();
  }
  { // K8 · En «Valor medido / resultado» de un paso con rango, un texto tampoco se manda.
    const p = await abrir(171, 'tecnico');
    const aviso = () => p.doc.querySelector('.ck-aviso[data-idx="0"]');
    p.escribir('.ck-valor[data-idx="0"]', 'normal');
    ok(!aviso().classList.contains('hidden') && aviso().textContent === app.ordenes.MENSAJE_PASO_SIN_NUMERO, `Con rango pide el número, con la frase del servidor: ${aviso().textContent}`);
    await pausa(1400);
    ok(p.patches().length === 0, `El texto no se manda: ${JSON.stringify(p.patches())}`);
    p.escribir('.ck-valor[data-idx="0"]', '10,5');
    await p.hasta(() => JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=171').c)[0].valorMedido === '10,5', 'guarda el número');
    ok(aviso().classList.contains('hidden') && p.avisos.length === 0, 'Con el número, el aviso se va');
    p.w.close();
  }
  { // K8 · El rechazo del servidor por el valor de un paso va junto a ese campo, no en una ventana, y lo demás se guarda.
    const MENSAJE = app.ordenes.MENSAJE_PASO_SIN_NUMERO;
    const p = await abrir(172, 'tecnico');
    const aviso = p.doc.querySelector('.ck-aviso[data-idx="0"]');
    p.red.falsas.push({ status: 400, body: { error: MENSAJE } });
    p.escribir('.ck-num[data-idx="0"]', '10');
    p.marcar(1, 'ok');
    await p.hasta(() => estados(172) === 'pendiente, ok', 'lo demás sale enseguida');
    ok(!aviso.classList.contains('hidden') && aviso.textContent === MENSAJE && p.avisos.length === 0, `El rechazo va junto al campo, sin ventana: ${aviso.textContent} · ${p.avisos.join(' | ')}`);
    const [paso] = JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=172').c);
    ok(!('valorMedido' in paso) && p.doc.querySelector('.ck-num[data-idx="0"]').value === '10', `El valor rechazado no se guarda y queda escrito para corregirlo: ${JSON.stringify(paso)}`);
    // También cuando el valor viaja con el envío a verificación.
    p.red.falsas.push({ status: 400, body: { error: MENSAJE } });
    p.escribir('.ck-num[data-idx="0"]', '11');
    ok(aviso.classList.contains('hidden'), 'Escrito otra vez, el aviso se va');
    p.doc.querySelector('[data-transition="completada"]').click();
    await p.hasta(() => p.patches().some((e) => e.estado === 'completada'), 'la envía a verificación');
    await p.hasta(() => aviso.textContent === MENSAJE && !aviso.classList.contains('hidden'), 'el rechazo vuelve junto al campo');
    ok(p.avisos.length === 0 && p.recargas.length === 0 && one('SELECT estado FROM ordenes WHERE id=172').estado === 'en_proceso', `Sin ventana ni recarga: ${p.avisos.join(' | ')}`);
    p.w.close();
  }

  // ── Decisión 4 · Lo marcado sin señal no se pierde ─────────────────────
  { // Marca sin señal, sale sin señal; al volver a abrir, el paso llega y lo del celular se conserva.
    const p = await abrir(137, 'tecnico');
    p.red.caida = true;
    p.doc.querySelector('.ck-estado-btn[data-idx="0"][data-estado="ok"]').click();
    await p.hasta(() => /Sin guardar/.test(p.doc.querySelector('#ckAutosave').textContent), 'sin señal no se guarda');
    const cerrar = new p.w.Event('beforeunload', { cancelable: true });
    p.w.dispatchEvent(cerrar);
    ok(cerrar.defaultPrevented, 'Al cerrar la pestaña con el paso sin guardar, el navegador avisa');
    p.w.dispatchEvent(new p.w.Event('pagehide'));
    await pausa(50);
    const almacen = almacenDe(p.w);
    const local = JSON.parse(almacen[CK(137, 'tecnico')] ?? 'null');
    ok(local?.usuarioId === 3 && JSON.parse(local.checklist)[0].estado === 'ok' && JSON.parse(local.base).every((x) => x.estado === 'pendiente'), `El paso queda en el equipo con su base: ${almacen[CK(137, 'tecnico')]}`);
    ok(estados(137) === 'pendiente, pendiente, pendiente', 'El servidor no recibió nada');
    p.w.close();
    const [paso] = await celular({ tipo: 'orden.paso', ordenId: 137, idx: 1, estado: 'ok', texto: PASOS[1] });
    ok(paso.ok && estados(137) === 'pendiente, ok, pendiente', `Mientras tanto, el técnico marca el paso 2 en el celular: ${JSON.stringify(paso)}`);
    const delCelular = JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=137').c)[1];
    const otra = await abrir(137, 'jefe', { almacen });
    await pausa(300);
    ok(otra.patches().length === 0 && !!otra.w.localStorage.getItem(CK(137, 'tecnico')), 'Otra cuenta en el mismo equipo no lo manda en su nombre ni lo borra');
    otra.w.close();
    const q = await abrir(137, 'tecnico', { almacen });
    await q.hasta(() => estados(137) === 'ok, ok, pendiente', 'al volver a abrir, el paso llega al servidor');
    const [envio] = q.patches();
    ok(JSON.stringify(JSON.parse(envio.checklistBase)[0]) === JSON.stringify(JSON.parse(local.base)[0]) && JSON.parse(envio.checklistEjecucion)[0].estado === 'ok', `Sale con la base con que se marcó: ${JSON.stringify(envio)}`);
    const guardado = JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=137').c);
    ok(JSON.stringify(guardado[1]) === JSON.stringify(delCelular) && !!guardado[1].hora && !!guardado[1].iniciales, `El paso del celular se conserva con su hora e iniciales: ${JSON.stringify(guardado[1])}`);
    await q.hasta(() => /Guardado/.test(q.doc.querySelector('#ckAutosave').textContent), 'la ficha lo da por guardado');
    ok(enPantalla(q, 3) === 'ok, ok, pendiente' && q.w.localStorage.getItem(CK(137, 'tecnico')) === null, `La ficha muestra los dos pasos y ya no guarda copia: ${enPantalla(q, 3)}`);
    ok(q.errores.length === 0 && q.avisos.length === 0, `Sin errores ni avisos: ${q.errores.join(' | ')} ${q.avisos.join(' | ')}`);
    q.w.close();
  }
  { // Lo marcado sin señal que ya no se puede aplicar: la ficha lo dice y no lo manda.
    const marcarSinSenal = async (id) => {
      const p = await abrir(id, 'tecnico');
      p.red.caida = true;
      p.doc.querySelector('.ck-estado-btn[data-idx="0"][data-estado="ok"]').click();
      await p.hasta(() => /Sin guardar/.test(p.doc.querySelector('#ckAutosave').textContent), 'sin señal no se guarda');
      const almacen = almacenDe(p.w);
      p.w.close();
      return almacen;
    };
    const conflicto = (v) => (v.doc.querySelector('#ckConflicto').classList.contains('hidden') ? '' : v.doc.querySelector('#ckConflictoMsg').textContent);
    const enviadaAntes = await marcarSinSenal(153);
    sqlite.prepare("UPDATE ordenes SET estado='completada', completada_en=? WHERE id=153").run(hace(0.1));
    const a = await abrir(153, 'tecnico', { almacen: enviadaAntes });
    await pausa(300);
    ok(a.patches().length === 0 && conflicto(a) === 'Lo que marcaste sin señal no se guardó: ya no puedes marcar pasos en esta orden.', `Enviada mientras tanto: lo dice y no lo manda: ${conflicto(a)}`);
    ok(a.w.localStorage.getItem(CK(153, 'tecnico')) === null, 'Y no lo vuelve a intentar');
    a.w.close();
    const otraForma = await marcarSinSenal(154);
    sqlite.prepare('UPDATE ordenes SET checklist_ejecucion=? WHERE id=154').run(lista(PASOS[0], PASOS[1]));
    const b = await abrir(154, 'tecnico', { almacen: otraForma });
    await pausa(300);
    ok(b.patches().length === 0 && conflicto(b) === 'Lo que marcaste sin señal no se guardó: el checklist cambió mientras tanto. Márcalo otra vez.' && b.w.localStorage.getItem(CK(154, 'tecnico')) === null, `El checklist cambió de forma: lo dice y no lo manda: ${conflicto(b)}`);
    b.w.close();
  }

  // ── Al volver a abrir: lo marcado sin señal no pisa lo que cambió después ──
  // Marca sin señal y deja la página: lo marcado queda solo en el equipo.
  const sinSenal = async (id, rol, marcas) => {
    const p = await abrir(id, rol);
    p.red.caida = true;
    for (const [idx, estado] of marcas) p.marcar(idx, estado);
    await p.hasta(() => /Sin guardar/.test(p.indicador()), 'sin señal no se guarda');
    p.w.dispatchEvent(new p.w.Event('pagehide'));
    await pausa(50);
    const almacen = almacenDe(p.w);
    p.w.close();
    return almacen;
  };
  const punto = (id, i) => JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=?', id).c)[i];
  { // A3c · La jefatura marca OK sin señal y cierra; después el técnico registra una desviación en el celular; la jefatura vuelve a abrir.
    const almacen = await sinSenal(156, 'jefe', [[1, 'ok']]);
    const nota = 'La transferencia no retornó a normal; quedó en manual.';
    const [paso] = await celular({ tipo: 'orden.paso', ordenId: 156, idx: 1, estado: 'desviacion', nota, texto: PASOS[1] });
    const delCelular = punto(156, 1);
    ok(paso.ok && delCelular.estado === 'desviacion' && delCelular.notas === nota, `El técnico registra la desviación con su nota: ${JSON.stringify(delCelular)}`);
    const q = await abrir(156, 'jefe', { almacen });
    await pausa(300);
    ok(q.patches().length === 0 && JSON.stringify(punto(156, 1)) === JSON.stringify(delCelular), `La marca vieja no se manda: la desviación del celular queda con su nota: ${JSON.stringify(punto(156, 1))}`);
    ok(q.caja() === 'El paso 2 cambió mientras tanto: revísalo y márcalo otra vez.', `La ficha dice qué paso revisar: ${q.caja()}`);
    ok(enPantalla(q, 3) === 'pendiente, desviacion, pendiente' && q.w.localStorage.getItem(CK(156, 'jefe')) === null, `Muestra la desviación y la marca vieja ya no espera en el equipo: ${enPantalla(q, 3)}`);
    ok(q.errores.length === 0 && q.avisos.length === 0, `Sin errores ni ventanas: ${q.errores.join(' | ')} ${q.avisos.join(' | ')}`);
    q.w.close();
  }
  { // A3b · El técnico marca OK sin señal; en el celular registra una desviación con nota en el mismo paso; vuelve a abrir la ficha.
    const almacen = await sinSenal(157, 'tecnico', [[0, 'ok']]);
    const nota = 'Contacto quemado en la transferencia.';
    await celular({ tipo: 'orden.paso', ordenId: 157, idx: 0, estado: 'desviacion', nota, texto: PASOS[0] });
    const q = await abrir(157, 'tecnico', { almacen });
    await pausa(300);
    ok(q.patches().length === 0 && punto(157, 0).estado === 'desviacion' && punto(157, 0).notas === nota, `Queda la desviación del celular con su nota: ${JSON.stringify(punto(157, 0))}`);
    ok(q.caja() === 'El paso 1 cambió mientras tanto: revísalo y márcalo otra vez.', `Y el aviso: ${q.caja()}`);
    q.w.close();
  }
  { // Varios pasos: sale el que nadie tocó y se avisan los que cambiaron; el aviso sigue después de guardar.
    const almacen = await sinSenal(158, 'jefe', [[0, 'ok'], [1, 'na'], [2, 'ok']]);
    await celular({ tipo: 'orden.paso', ordenId: 158, idx: 1, estado: 'desviacion', nota: 'No hubo transferencia automática.', texto: PASOS[1] },
      { tipo: 'orden.paso', ordenId: 158, idx: 2, estado: 'na', texto: PASOS[2] });
    const q = await abrir(158, 'jefe', { almacen });
    await q.hasta(() => /Guardado/.test(q.indicador()), 'manda el paso que nadie tocó');
    ok(estados(158) === 'ok, desviacion, na' && q.patches().length === 1, `Llega el paso 1 y quedan los del celular: ${estados(158)}`);
    ok(q.caja() === 'Los pasos 2 y 3 cambiaron mientras tanto: revísalos y márcalos otra vez.', `El aviso nombra los dos y sigue después de guardar: ${q.caja()}`);
    q.marcar(1, 'ok');
    await q.hasta(() => estados(158) === 'ok, ok, na' && /Guardado/.test(q.indicador()), 'marcado otra vez, se guarda');
    ok(q.caja() === 'El paso 3 cambió mientras tanto: revísalo y márcalo otra vez.', `F27 · Se va el aviso del paso que se volvió a marcar; el del otro sigue después de guardar: ${q.caja()}`);
    q.marcar(2, 'na');
    ok(q.caja() === '', `Marcado también el otro, el aviso se va: ${q.caja()}`);
    q.w.close();
  }
  { // Lo marcado que ya llegó por otra vía cuenta como guardado: no se manda ni se avisa.
    const almacen = await sinSenal(159, 'tecnico', [[0, 'ok']]);
    await celular({ tipo: 'orden.paso', ordenId: 159, idx: 0, estado: 'ok', texto: PASOS[0] });
    const q = await abrir(159, 'tecnico', { almacen });
    await pausa(300);
    ok(q.patches().length === 0 && q.caja() === '' && q.w.localStorage.getItem(CK(159, 'tecnico')) === null, `Ni envío ni aviso, y la copia se va: ${q.caja()}`);
    q.w.close();
  }
  { // Lo que se desmarca antes de salir ya no espera en el equipo: al volver no se manda.
    const p = await abrir(176, 'tecnico');
    p.red.caida = true;
    p.marcar(0, 'ok');
    await p.hasta(() => /Sin guardar/.test(p.indicador()), 'sin señal no se guarda');
    ok(!!p.w.localStorage.getItem(CK(176, 'tecnico')), 'La marca espera en el equipo');
    p.marcar(0, 'pendiente');
    await pausa(50);
    ok(p.w.localStorage.getItem(CK(176, 'tecnico')) === null, `Desmarcada, ya no espera: ${p.w.localStorage.getItem(CK(176, 'tecnico'))}`);
    const almacen = almacenDe(p.w);
    p.w.close();
    const q = await abrir(176, 'tecnico', { almacen });
    await pausa(300);
    ok(q.patches().length === 0 && estados(176) === 'pendiente, pendiente, pendiente' && q.caja() === '', `Al volver no se manda nada: ${JSON.stringify(q.patches())}`);
    q.w.close();
  }
  { // F10 · El celular la envía con el mismo paso marcado: quien ya no puede marcar no ve un aviso falso de lo que ya llegó.
    const almacen = await sinSenal(177, 'tecnico', [[0, 'ok']]);
    for (const [idx, texto] of PASOS.entries()) await celular({ tipo: 'orden.paso', ordenId: 177, idx, estado: 'ok', texto });
    const [fin] = await celular({ tipo: 'orden.terminar', ordenId: 177, trabajosRealizados: 'Planta en manual; transferencia operada con un segundo técnico.' });
    ok(fin.ok && one('SELECT estado FROM ordenes WHERE id=177').estado === 'completada', `El celular la envía a verificación: ${JSON.stringify(fin)}`);
    const q = await abrir(177, 'tecnico', { almacen });
    await pausa(300);
    ok(q.caja() === '' && q.patches().length === 0 && q.w.localStorage.getItem(CK(177, 'tecnico')) === null, `Sin aviso falso y sin copia: ${q.caja()}`);
    q.w.close();
  }
  { // F9 · Dos pestañas de la misma orden en el mismo equipo, las dos sin señal: cada una marca un paso.
    const equipo = new Almacen();
    const a = await abrir(160, 'jefe', { compartido: equipo });
    const b = await abrir(160, 'jefe', { compartido: equipo });
    a.red.caida = true; b.red.caida = true;
    a.marcar(0, 'ok');
    await a.hasta(() => /Sin guardar/.test(a.indicador()), 'A sin señal');
    b.marcar(1, 'na');
    await b.hasta(() => /Sin guardar/.test(b.indicador()), 'B sin señal');
    const enEquipo = () => JSON.parse(JSON.parse(equipo.getItem(CK(160, 'jefe'))).checklist).map((x) => x.estado).join(', ');
    ok(enEquipo() === 'ok, na, pendiente', `La copia del equipo lleva los dos pasos: ${enEquipo()}`);
    a.w.dispatchEvent(new a.w.Event('pagehide')); b.w.dispatchEvent(new b.w.Event('pagehide'));
    await pausa(50);
    a.w.close(); b.w.close();
    const c = await abrir(160, 'jefe', { compartido: equipo });
    await c.hasta(() => estados(160) === 'ok, na, pendiente', 'al volver a abrir con señal llegan los dos');
    await c.hasta(() => equipo.getItem(CK(160, 'jefe')) === null, 'guardados, ya no queda copia');
    ok(c.patches().length === 1 && c.caja() === '', `En un solo envío y sin aviso: ${JSON.stringify(c.patches())}`);
    c.w.close();
  }
  { // F9 · A, sin señal, marca el 1 y se cierra; B, con señal, marca el 3: lo de A sigue en el equipo hasta llegar.
    const equipo = new Almacen();
    const a = await abrir(161, 'jefe', { compartido: equipo });
    const b = await abrir(161, 'jefe', { compartido: equipo });
    a.red.caida = true;
    a.marcar(0, 'ok');
    await a.hasta(() => /Sin guardar/.test(a.indicador()), 'A sin señal');
    a.w.dispatchEvent(new a.w.Event('pagehide'));
    await pausa(50);
    a.w.close();
    b.marcar(2, 'ok');
    await b.hasta(() => /Guardado/.test(b.indicador()), 'B guarda');
    const copia = JSON.parse(equipo.getItem(CK(161, 'jefe')) ?? 'null');
    const lista = (t) => JSON.parse(t).map((x) => x.estado).join(', ');
    ok(estados(161) === 'pendiente, pendiente, ok' && copia && lista(copia.checklist) === 'ok, pendiente, ok' && lista(copia.base) === 'pendiente, pendiente, ok',
      `B quita de la copia solo lo suyo: ${equipo.getItem(CK(161, 'jefe'))}`);
    b.w.close();
    const c = await abrir(161, 'jefe', { compartido: equipo });
    await c.hasta(() => estados(161) === 'ok, pendiente, ok', 'al volver a abrir llega el paso de A');
    await c.hasta(() => equipo.getItem(CK(161, 'jefe')) === null, 'ya no queda copia');
    c.w.close();
  }
  { // F10 · Marca sin señal, vuelve la señal y la envía a verificación: lo marcado viajó con el envío y no se avisa al volver.
    const equipo = new Almacen();
    const a = await abrir(162, 'tecnico', { compartido: equipo });
    a.red.caida = true;
    a.marcar(0, 'ok');
    await a.hasta(() => /Sin guardar/.test(a.indicador()), 'sin señal no se guarda');
    await celular(...[0, 1].map((idx) => ({ tipo: 'orden.paso', ordenId: 162, idx, estado: 'ok', texto: PASOS[idx] })));
    a.red.caida = false;
    a.doc.querySelector('[data-transition="completada"]').click();
    await a.hasta(() => one('SELECT estado FROM ordenes WHERE id=162').estado === 'completada' && a.recargas.length > 0, 'la envía a verificación y vuelve a cargar');
    ok(equipo.getItem(CK(162, 'tecnico')) === null && punto(162, 0).estado === 'ok' && !!punto(162, 0).hora, `Lo que viajó con el envío ya no espera en el equipo: ${JSON.stringify(punto(162, 0))}`);
    a.w.close();
    const c = await abrir(162, 'tecnico', { compartido: equipo });
    await pausa(300);
    ok(c.caja() === '' && c.patches().length === 0, `Al volver a abrir no hay aviso falso: ${c.caja()}`);
    c.w.close();
  }
  { // F10 · La orden se reasigna mientras la marca espera en el equipo: quien ya no puede marcar lo sabe.
    const almacen = await sinSenal(163, 'tecnico', [[0, 'ok']]);
    sqlite.prepare('UPDATE ordenes SET asignado_a=8 WHERE id=163').run();
    const q = await abrir(163, 'tecnico', { almacen });
    await pausa(300);
    ok(q.patches().length === 0 && q.caja() === 'Lo que marcaste sin señal no se guardó: ya no puedes marcar pasos en esta orden.' && q.w.localStorage.getItem(CK(163, 'tecnico')) === null,
      `Reasignada: lo dice, no lo manda y no lo vuelve a intentar: ${q.caja()}`);
    q.w.close();
  }
  { // F10 · «Enviar a verificación sin lectura» también se lleva lo marcado sin señal.
    const equipo = new Almacen();
    const p = await abrir(164, 'jefe', { compartido: equipo });
    p.red.caida = true;
    p.marcar(0, 'ok'); p.marcar(1, 'ok');
    await p.hasta(() => /Sin guardar/.test(p.indicador()), 'sin señal no se guarda');
    ok(!!equipo.getItem(CK(164, 'jefe')), 'Sin señal, lo marcado espera en el equipo');
    p.red.caida = false;
    p.doc.querySelector('#sinLecturaBtn').click();
    p.doc.querySelector('#sinLecturaMotivo').value = 'La pinza calibrada no estaba disponible; se mide el lunes.';
    p.doc.querySelector('#sinLecturaConfirm').click();
    await p.hasta(() => one('SELECT estado FROM ordenes WHERE id=164').estado === 'completada' && p.recargas.length > 0, 'la envía sin lectura y vuelve a cargar');
    ok(estados(164) === 'ok, ok' && equipo.getItem(CK(164, 'jefe')) === null, `Lo marcado llegó con el envío y ya no espera en el equipo: ${estados(164)}`);
    p.w.close();
  }

  // ── K11 · Un paso que cambió en el servidor mientras tanto no se pisa ──
  const NOTA_CELULAR = 'La transferencia no retornó a normal; quedó en manual.';
  // El técnico registra en el celular una desviación con su nota en ese paso.
  const desviacionDelCelular = async (id, idx, texto = PASOS[idx]) => {
    const [paso] = await celular({ tipo: 'orden.paso', ordenId: id, idx, estado: 'desviacion', nota: NOTA_CELULAR, texto });
    const guardado = punto(id, idx);
    assert.ok(paso.ok && guardado.estado === 'desviacion' && guardado.notas === NOTA_CELULAR, `El celular registra la desviación: ${JSON.stringify(paso)} · ${JSON.stringify(guardado)}`);
    return JSON.stringify(guardado);
  };
  { // M1 · Con la ficha abierta, el paso marcado sin señal sale al marcar otro; el celular registró una desviación en ese paso mientras tanto.
    const p = await abrir(180, 'jefe');
    p.red.caida = true;
    p.marcar(1, 'ok');
    await p.hasta(() => /Sin guardar/.test(p.indicador()), 'sin señal no se guarda');
    const delCelular = await desviacionDelCelular(180, 1);
    p.red.caida = false;
    p.marcar(2, 'ok');
    await p.hasta(() => /Guardado/.test(p.indicador()), 'guarda el otro paso');
    ok(JSON.stringify(punto(180, 1)) === delCelular && punto(180, 2).estado === 'ok', `La desviación del celular queda con su nota y el otro paso se guarda: ${one('SELECT checklist_ejecucion c FROM ordenes WHERE id=180').c}`);
    ok(p.caja() === 'El paso 2 cambió mientras tanto: revísalo y márcalo otra vez.', `La ficha dice qué paso revisar: ${p.caja()}`);
    ok(enPantalla(p, 3) === 'pendiente, desviacion, ok' && p.doc.querySelector('.ck-nota[data-idx="1"]').value === NOTA_CELULAR, `Pinta el paso como lo tiene el servidor, con la nota del celular: ${enPantalla(p, 3)}`);
    ok(p.w.localStorage.getItem(CK(180, 'jefe')) === null && p.avisos.length === 0 && p.errores.length === 0, `La marca vieja ya no espera en el equipo, sin ventanas ni errores: ${p.avisos.join(' | ')} ${p.errores.join(' | ')}`);
    p.w.close();
  }
  { // M1 · El paso que el servidor no tomó se pinta como lo tiene él aunque se haya tocado mientras viajaba el guardado.
    const p = await abrir(201, 'jefe');
    p.red.caida = true;
    p.marcar(1, 'ok');
    await p.hasta(() => /Sin guardar/.test(p.indicador()), 'sin señal no se guarda');
    const delCelular = await desviacionDelCelular(201, 1);
    p.red.caida = false; p.red.demora = 300;
    p.marcar(2, 'ok');
    await p.hasta(() => p.patches().length === 2, 'sale el guardado');
    p.marcar(1, 'na');
    await p.hasta(() => p.caja() !== '', 'responde el servidor');
    await pausa(1500);
    ok(JSON.stringify(punto(201, 1)) === delCelular && punto(201, 2).estado === 'ok' && p.patches().length === 2, `La desviación del celular queda con su nota: ${JSON.stringify(punto(201, 1))} · ${p.patches().length} envíos`);
    ok(p.caja() === 'El paso 2 cambió mientras tanto: revísalo y márcalo otra vez.' && enPantalla(p, 3) === 'pendiente, desviacion, ok', `Pinta el paso como lo tiene el servidor y avisa: ${enPantalla(p, 3)}`);
    p.w.close();
  }
  { // M2 · La marca sin señal sale al dejar la página; el celular registró una desviación en ese paso. La respuesta se lee: la ficha avisa.
    const equipo = new Almacen();
    const p = await abrir(181, 'jefe', { compartido: equipo });
    p.red.caida = true;
    p.marcar(1, 'ok');
    await p.hasta(() => /Sin guardar/.test(p.indicador()), 'sin señal no se guarda');
    const delCelular = await desviacionDelCelular(181, 1);
    p.red.caida = false;
    p.w.dispatchEvent(new p.w.Event('pagehide'));
    await p.hasta(() => p.caja() !== '', 'responde el envío al salir');
    const alSalir = p.enviados.find((e) => e.keepalive);
    ok(alSalir?.status === 200 && JSON.stringify(alSalir.respuesta?.pasosSinAplicar) === '[1]' && JSON.stringify(punto(181, 1)) === delCelular, `El servidor no pisa la desviación y dice qué paso no tomó: ${JSON.stringify(alSalir?.respuesta?.pasosSinAplicar)}`);
    ok(p.caja() === 'El paso 2 cambió mientras tanto: revísalo y márcalo otra vez.' && enPantalla(p, 3) === 'pendiente, desviacion, pendiente' && equipo.getItem(CK(181, 'jefe')) === null,
      `Avisa, pinta la desviación y la marca vieja deja de esperar en el equipo: ${p.caja()}`);
    p.w.close();
  }
  { // M2 · Lo mismo, pero la página ya no lee la respuesta: la marca queda en el equipo y la ficha avisa al volver a abrir.
    const equipo = new Almacen();
    const p = await abrir(182, 'jefe', { compartido: equipo });
    p.red.caida = true;
    p.marcar(1, 'ok');
    await p.hasta(() => /Sin guardar/.test(p.indicador()), 'sin señal no se guarda');
    const delCelular = await desviacionDelCelular(182, 1);
    p.red.caida = false; p.red.sinRespuesta = true;
    p.w.dispatchEvent(new p.w.Event('pagehide'));
    await p.hasta(() => p.enviados.some((e) => e.keepalive && e.respuesta), 'el envío al salir llega al servidor');
    await pausa(50);
    ok(JSON.stringify(punto(182, 1)) === delCelular && !!equipo.getItem(CK(182, 'jefe')), `El servidor no pisa la desviación; sin la respuesta, la marca sigue en el equipo: ${JSON.stringify(punto(182, 1))}`);
    p.w.close();
    const q = await abrir(182, 'jefe', { compartido: equipo });
    await pausa(300);
    ok(q.patches().length === 0 && JSON.stringify(punto(182, 1)) === delCelular, `Al volver a abrir no se manda la marca vieja: ${JSON.stringify(q.patches())}`);
    ok(q.caja() === 'El paso 2 cambió mientras tanto: revísalo y márcalo otra vez.' && enPantalla(q, 3) === 'pendiente, desviacion, pendiente' && equipo.getItem(CK(182, 'jefe')) === null,
      `La ficha avisa y la marca vieja ya no espera: ${q.caja()}`);
    q.w.close();
  }
  { // M3 · El técnico marca sin señal; el celular registra una desviación en uno de esos pasos; con señal, la envía a verificación.
    const p = await abrir(183, 'tecnico');
    p.red.caida = true;
    p.marcar(0, 'ok'); p.marcar(1, 'ok');
    await p.hasta(() => /Sin guardar/.test(p.indicador()), 'sin señal no se guarda');
    const delCelular = await desviacionDelCelular(183, 1);
    p.red.caida = false;
    p.doc.querySelector('[data-transition="completada"]').click();
    await p.hasta(() => p.caja() !== '', 'el envío vuelve con el paso que cambió');
    const envio = p.enviados.find((e) => e.data?.estado === 'completada');
    ok(envio?.status === 409 && envio.respuesta?.motivo === 'paso-cambio' && JSON.stringify(envio.respuesta?.pasos) === '[1]', `El servidor no aplica nada y dice qué paso cambió: ${JSON.stringify(envio?.respuesta)}`);
    ok(p.caja() === 'El paso 2 cambió mientras tanto: revísalo y vuelve a enviar.', `La ficha lo dice junto al checklist: ${p.caja()}`);
    ok(one('SELECT estado FROM ordenes WHERE id=183').estado === 'en_proceso' && JSON.stringify(punto(183, 1)) === delCelular, 'No se envía y la desviación del celular queda con su nota');
    ok(p.recargas.length === 0 && p.avisos.length === 0 && p.desplazados.includes('ckConflicto'), `Sin volver a cargar ni ventana; la vista queda en el checklist: ${p.recargas.length} · ${p.avisos.join(' | ')} · ${p.desplazados.join(', ')}`);
    ok(enPantalla(p, 2) === 'ok, desviacion' && p.doc.querySelector('.ck-nota[data-idx="1"]').value === NOTA_CELULAR, `Pinta la desviación del celular y conserva lo demás marcado: ${enPantalla(p, 2)}`);
    const enEquipo = JSON.parse(JSON.parse(p.w.localStorage.getItem(CK(183, 'tecnico')) ?? '{"checklist":"[]"}').checklist).map((x) => x.estado).join(', ');
    ok(enEquipo === 'ok, desviacion', `En el equipo espera solo lo demás; el paso que cambió ya no: ${enEquipo}`);
    await p.hasta(() => punto(183, 0).estado === 'ok' && /Guardado/.test(p.indicador()), 'lo demás que marcó se guarda solo');
    ok(JSON.stringify(punto(183, 1)) === delCelular && p.caja() === 'El paso 2 cambió mientras tanto: revísalo y vuelve a enviar.' && p.w.localStorage.getItem(CK(183, 'tecnico')) === null,
      `Guardado lo demás, el aviso sigue y ya no queda copia: ${p.caja()}`);
    p.w.close();
  }
  { // M3 · Si lo único marcado era ese paso, nada queda esperando en el equipo: al volver a abrir no se repite el aviso.
    const equipo = new Almacen();
    const p = await abrir(205, 'tecnico', { compartido: equipo });
    p.red.caida = true;
    p.marcar(1, 'ok');
    await p.hasta(() => /Sin guardar/.test(p.indicador()), 'sin señal no se guarda');
    const delCelular = await desviacionDelCelular(205, 1);
    p.red.caida = false;
    p.doc.querySelector('[data-transition="completada"]').click();
    await p.hasta(() => p.caja() !== '', 'el envío vuelve con el paso que cambió');
    ok(p.caja() === 'El paso 2 cambió mientras tanto: revísalo y vuelve a enviar.' && equipo.getItem(CK(205, 'tecnico')) === null, `El paso que cambió sale de la copia del equipo: ${equipo.getItem(CK(205, 'tecnico'))}`);
    p.w.close();
    const q = await abrir(205, 'tecnico', { compartido: equipo });
    await pausa(300);
    ok(q.patches().length === 0 && q.caja() === '' && JSON.stringify(punto(205, 1)) === delCelular, `Al volver a abrir no se repite el aviso ni se manda la marca vieja: ${q.caja()}`);
    q.w.close();
  }
  { // M3 · Con «Enviar a verificación sin lectura» también: no se envía, la ventana se cierra y el aviso va junto al checklist.
    const p = await abrir(198, 'jefe');
    p.red.caida = true;
    p.marcar(0, 'ok'); p.marcar(1, 'ok');
    await p.hasta(() => /Sin guardar/.test(p.indicador()), 'sin señal no se guarda');
    const delCelular = await desviacionDelCelular(198, 1, 'Cambiar el interruptor');
    p.red.caida = false;
    p.doc.querySelector('#sinLecturaBtn').click();
    p.doc.querySelector('#sinLecturaMotivo').value = 'La pinza calibrada no estaba disponible; se mide el lunes.';
    p.doc.querySelector('#sinLecturaConfirm').click();
    await p.hasta(() => p.caja() !== '', 'el envío vuelve con el paso que cambió');
    ok(p.caja() === 'El paso 2 cambió mientras tanto: revísalo y vuelve a enviar.' && p.doc.querySelector('#sinLecturaModal').classList.contains('hidden'), `Se cierra la ventana y el aviso va junto al checklist: ${p.caja()}`);
    ok(one('SELECT estado FROM ordenes WHERE id=198').estado === 'en_proceso' && JSON.stringify(punto(198, 1)) === delCelular && p.recargas.length === 0, 'No se envía, la desviación queda y la ficha no se vuelve a cargar');
    await p.hasta(() => punto(198, 0).estado === 'ok', 'lo demás que marcó se guarda solo');
    p.doc.querySelector('#sinLecturaBtn').click();
    ok(p.doc.querySelector('#sinLecturaMotivo').value === 'La pinza calibrada no estaba disponible; se mide el lunes.', 'Al volver a abrir la ventana, el motivo escrito sigue ahí');
    p.w.close();
  }
  { // T6 · Dos pestañas de la misma cuenta: A, sin señal, marca OK; B, con señal, marca N/A el mismo paso; A recupera la señal y sale.
    const equipo = new Almacen();
    const a = await abrir(184, 'jefe', { compartido: equipo });
    const b = await abrir(184, 'jefe', { compartido: equipo });
    a.red.caida = true;
    a.marcar(0, 'ok');
    await a.hasta(() => /Sin guardar/.test(a.indicador()), 'A sin señal');
    b.marcar(0, 'na');
    await b.hasta(() => /Guardado/.test(b.indicador()), 'B guarda');
    const deB = JSON.stringify(punto(184, 0));
    a.red.caida = false;
    a.w.dispatchEvent(new a.w.Event('pagehide'));
    await a.hasta(() => a.caja() !== '', 'responde el envío de A al salir');
    ok(JSON.stringify(punto(184, 0)) === deB && punto(184, 0).estado === 'na', `Lo que guardó B no se pisa: ${JSON.stringify(punto(184, 0))}`);
    ok(a.caja() === 'El paso 1 cambió mientras tanto: revísalo y márcalo otra vez.' && enPantalla(a, 3) === 'na, pendiente, pendiente' && equipo.getItem(CK(184, 'jefe')) === null,
      `A avisa, pinta lo de B y no deja copia: ${a.caja()} · ${enPantalla(a, 3)}`);
    a.w.close(); b.w.close();
  }

  { // T6 · A y C, de la misma cuenta, marcan el mismo paso sin señal; el celular registra una desviación; A sale con señal y avisa. La marca vieja de C sale de la copia: el aviso no se repite al volver a abrir.
    const equipo = new Almacen();
    const a = await abrir(200, 'jefe', { compartido: equipo });
    const c = await abrir(200, 'jefe', { compartido: equipo });
    a.red.caida = true; c.red.caida = true;
    a.marcar(0, 'ok');
    await a.hasta(() => /Sin guardar/.test(a.indicador()), 'A sin señal');
    c.marcar(0, 'na');
    await c.hasta(() => /Sin guardar/.test(c.indicador()), 'C sin señal');
    const delCelular = await desviacionDelCelular(200, 0);
    a.red.caida = false;
    a.w.dispatchEvent(new a.w.Event('pagehide'));
    await a.hasta(() => a.caja() !== '', 'responde el envío de A al salir');
    ok(a.caja() === 'El paso 1 cambió mientras tanto: revísalo y márcalo otra vez.' && JSON.stringify(punto(200, 0)) === delCelular && equipo.getItem(CK(200, 'jefe')) === null,
      `A avisa y ninguna marca vieja del paso 1 queda en el equipo: ${equipo.getItem(CK(200, 'jefe'))}`);
    c.w.dispatchEvent(new c.w.Event('pagehide'));
    await pausa(50);
    a.w.close(); c.w.close();
    const d = await abrir(200, 'jefe', { compartido: equipo });
    await pausa(300);
    ok(d.patches().length === 0 && d.caja() === '' && JSON.stringify(punto(200, 0)) === delCelular, `Al volver a abrir no se repite el aviso ni se manda la marca vieja: ${d.caja()}`);
    d.w.close();
  }
  { // T6 · Si C marcó el paso ya sobre la desviación del celular, su marca no es vieja: queda en la copia y sale al volver a abrir.
    const equipo = new Almacen();
    const a = await abrir(203, 'jefe', { compartido: equipo });
    a.red.caida = true;
    a.marcar(0, 'ok');
    await a.hasta(() => /Sin guardar/.test(a.indicador()), 'A sin señal');
    await desviacionDelCelular(203, 0);
    // C abre después: avisa la marca vieja de A y marca N/A sobre la desviación, sin señal.
    const c = await abrir(203, 'jefe', { compartido: equipo });
    ok(c.caja() === 'El paso 1 cambió mientras tanto: revísalo y márcalo otra vez.', `C avisa la marca vieja de A: ${c.caja()}`);
    c.red.caida = true;
    c.marcar(0, 'na');
    await c.hasta(() => /Sin guardar/.test(c.indicador()), 'C sin señal');
    a.red.caida = false;
    a.w.dispatchEvent(new a.w.Event('pagehide'));
    await a.hasta(() => a.caja() !== '', 'responde el envío de A al salir');
    const copia = JSON.parse(equipo.getItem(CK(203, 'jefe')) ?? 'null');
    ok(a.caja() === 'El paso 1 cambió mientras tanto: revísalo y márcalo otra vez.' && JSON.parse(copia?.checklist ?? '[]')[0]?.estado === 'na', `La marca de C sigue en el equipo: ${equipo.getItem(CK(203, 'jefe'))}`);
    c.w.dispatchEvent(new c.w.Event('pagehide'));
    await pausa(50);
    a.w.close(); c.w.close();
    const d = await abrir(203, 'jefe', { compartido: equipo });
    await d.hasta(() => punto(203, 0).estado === 'na', 'al volver a abrir sale la marca de C');
    ok(d.caja() === '' && estados(203) === 'na, pendiente, pendiente', `Sin aviso: ${d.caja()} · ${estados(203)}`);
    d.w.close();
  }

  // ── K14 · La copia y los borradores en el equipo son de cada cuenta ──
  { // T5 · Otra cuenta en el mismo navegador: la jefatura marca sin señal y sale; el técnico marca otro paso con señal; la jefatura vuelve.
    const equipo = new Almacen();
    const j = await abrir(185, 'jefe', { compartido: equipo });
    j.red.caida = true;
    j.marcar(0, 'ok');
    await j.hasta(() => /Sin guardar/.test(j.indicador()), 'sin señal no se guarda');
    j.w.dispatchEvent(new j.w.Event('pagehide'));
    await pausa(50);
    j.w.close();
    ok(!!equipo.getItem(CK(185, 'jefe')) && equipo.getItem('ot-185-ck') === null, 'La marca de la jefatura espera en el equipo, con su cuenta en la clave');
    const t = await abrir(185, 'tecnico', { compartido: equipo });
    await pausa(300);
    ok(t.patches().length === 0 && t.caja() === '', 'El técnico no manda ni ve lo que marcó la jefatura');
    t.marcar(2, 'ok');
    await t.hasta(() => /Guardado/.test(t.indicador()), 'el técnico guarda su paso');
    ok(estados(185) === 'pendiente, pendiente, ok' && !!equipo.getItem(CK(185, 'jefe')) && equipo.getItem(CK(185, 'tecnico')) === null, `Lo que guarda el técnico no borra la copia de la jefatura: ${[...equipo.m.keys()].join(', ')}`);
    t.w.close();
    const q = await abrir(185, 'jefe', { compartido: equipo });
    await q.hasta(() => estados(185) === 'ok, pendiente, ok', 'al volver a abrir sale lo de la jefatura');
    await q.hasta(() => equipo.getItem(CK(185, 'jefe')) === null, 'guardado, ya no queda copia');
    ok(q.patches().length === 1 && q.caja() === '', `En un envío y sin aviso: ${JSON.stringify(q.patches())}`);
    q.w.close();
  }
  { // El borrador de antes de esta versión, sin la cuenta en la clave, se ofrece una sola vez y se borra.
    const texto = 'Planta en manual; se reemplazó el fusible de control.';
    const equipo = new Almacen();
    equipo.setItem('ot-186-draft', JSON.stringify({ payload: { trabajosRealizados: texto }, savedAt: Date.now() - 60000 }));
    const p = await abrir(186, 'tecnico', { compartido: equipo });
    ok(p.confirmaciones.length === 1 && /cambios sin guardar/.test(p.confirmaciones[0]) && equipo.getItem('ot-186-draft') === null, `Se ofrece y la clave vieja se borra: ${p.confirmaciones.join(' | ')}`);
    await p.hasta(() => one('SELECT trabajos_realizados t FROM ordenes WHERE id=186').t === texto, 'lo recuperado se guarda');
    await p.hasta(() => equipo.getItem('ot-186-draft-3') === null, 'guardado, no queda borrador');
    p.w.close();
    const q = await abrir(186, 'tecnico', { compartido: equipo });
    ok(q.confirmaciones.length === 0, 'Una sola vez: al volver a abrir ya no se ofrece');
    q.escribir('#trabajosRealizados', `${texto} Se probó la transferencia.`);
    ok(!!equipo.getItem('ot-186-draft-3') && equipo.getItem('ot-186-draft') === null, 'Lo que se escribe ahora queda con la cuenta en la clave');
    q.w.close();
    // Sin un campo que se pueda escribir no se ofrece, como hoy: queda para cuando se pueda.
    const enviadaYa = await abrir(102, 'tecnico', { almacen: { 'ot-102-draft': JSON.stringify({ payload: { trabajosRealizados: 'Texto de antes.' }, savedAt: Date.now() }) } });
    ok(enviadaYa.confirmaciones.length === 0 && enviadaYa.w.localStorage.getItem('ot-102-draft') !== null, 'Sin campos que se puedan escribir, no se ofrece y queda');
    enviadaYa.w.close();
  }
  { // El borrador de otra cuenta, con la clave nueva, no se ofrece ni se borra.
    const ajeno = JSON.stringify({ payload: { trabajosRealizados: 'Borrador de otra cuenta en este equipo.' }, savedAt: Date.now() });
    const p = await abrir(187, 'tecnico', { almacen: { 'ot-187-draft-8': ajeno } });
    ok(p.confirmaciones.length === 0 && p.doc.querySelector('#trabajosRealizados').value === '' && p.w.localStorage.getItem('ot-187-draft-8') === ajeno, `No se ofrece y queda como estaba: ${p.confirmaciones.join(' | ')}`);
    p.w.close();
  }

  // ── F18 y F19 · Al volver a abrir, la marca se compara como la compara el servidor ──
  { // R11 · Una pestaña de producción (sin base) guarda el checklist con sus claves vacías: la marca sin señal sale, sin aviso falso.
    const almacen = await sinSenal(188, 'jefe', [[0, 'ok']]);
    const relleno = (texto, estado) => ({ texto, estado, notas: '', criterio: null, bloqueante: false, minutos: null, materiales: null, valorMedido: '', requiereValor: false, unidad: null, esperadoMin: null, esperadoMax: null });
    const r = await patch(188, 'tecnico', { checklistEjecucion: JSON.stringify([relleno(PASOS[0], 'pendiente'), relleno(PASOS[1], 'pendiente'), relleno(PASOS[2], 'ok')]) });
    ok(r.status === 200 && punto(188, 0).notas === '' && punto(188, 2).estado === 'ok', `La pestaña de producción guarda con sus claves vacías: ${JSON.stringify(r.body?.error ?? punto(188, 0))}`);
    const q = await abrir(188, 'jefe', { almacen });
    await q.hasta(() => estados(188) === 'ok, pendiente, ok', 'la marca sale');
    ok(q.caja() === '' && q.patches().length === 1, `Sin aviso falso: ${q.caja()}`);
    await q.hasta(() => q.w.localStorage.getItem(CK(188, 'jefe')) === null, 'guardada, ya no queda copia');
    q.w.close();
  }
  { // R10 · Formato viejo {hecho}: la marca sin señal ya llegó por otra vía como {hecho: true}; no se manda ni se avisa.
    const almacen = await sinSenal(202, 'jefe', [[0, 'ok']]);
    const l = JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=202').c);
    l[0] = { texto: PASOS[0], hecho: true };
    sqlite.prepare('UPDATE ordenes SET checklist_ejecucion=? WHERE id=202').run(JSON.stringify(l));
    const q = await abrir(202, 'jefe', { almacen });
    await pausa(300);
    ok(q.patches().length === 0 && q.caja() === '' && q.w.localStorage.getItem(CK(202, 'jefe')) === null, `Ni envío ni aviso, y la copia se va: «${q.caja()}» · ${JSON.stringify(q.patches())}`);
    q.w.close();
  }
  { // R8 · Lectura «10,5» y OK sin señal; el celular anota 10,5 y OK en el mismo paso: ya llegó, no se manda ni se avisa.
    const p = await abrir(189, 'tecnico');
    p.red.caida = true;
    p.escribir('.ck-num[data-idx="0"]', '10,5');
    p.marcar(0, 'ok');
    await p.hasta(() => /Sin guardar/.test(p.indicador()), 'sin señal no se guarda');
    p.w.dispatchEvent(new p.w.Event('pagehide'));
    await pausa(50);
    const almacen = almacenDe(p.w);
    p.w.close();
    const marca = JSON.parse(JSON.parse(almacen[CK(189, 'tecnico')]).checklist)[0];
    ok(marca.valorMedido === '10,5' && marca.estado === 'ok' && !!marca.hora, `La marca espera con su lectura y la hora que selló la ficha: ${JSON.stringify(marca)}`);
    const [paso] = await celular({ tipo: 'orden.paso', ordenId: 189, idx: 0, estado: 'ok', valor: '10,5', texto: medida.texto });
    ok(paso.ok && punto(189, 0).valorMedido === 10.5 && !!punto(189, 0).hora && !!punto(189, 0).iniciales, `El celular la guarda como número, con su hora e iniciales: ${JSON.stringify(punto(189, 0))}`);
    const q = await abrir(189, 'tecnico', { almacen });
    await pausa(300);
    ok(q.patches().length === 0 && q.caja() === '' && q.w.localStorage.getItem(CK(189, 'tecnico')) === null, `Ni envío ni aviso, y la copia se va: «${q.caja()}» · ${JSON.stringify(q.patches())}`);
    q.w.close();
  }

  { // R8 · Solo las iniciales, escritas sin señal: son lo que la persona marcó y salen al volver a abrir.
    const p = await abrir(204, 'tecnico');
    p.red.caida = true;
    p.escribir('.ck-iniciales[data-idx="0"]', 'A.M.');
    await p.hasta(() => /Sin guardar/.test(p.indicador()), 'sin señal no se guarda');
    p.w.dispatchEvent(new p.w.Event('pagehide'));
    await pausa(50);
    const almacen = almacenDe(p.w);
    p.w.close();
    const q = await abrir(204, 'tecnico', { almacen });
    await q.hasta(() => punto(204, 0).iniciales === 'A.M.', 'al volver a abrir salen las iniciales');
    ok(q.caja() === '' && q.patches().length === 1, `Sin aviso: ${q.caja()} · ${JSON.stringify(q.patches())}`);
    q.w.close();
  }

  // ── F20 · Con rango, lo escrito sin número es «Sin lectura» ──
  {
    const v = await ver(190, 'jefe');
    const fila = (doc, i) => ({ etiqueta: doc.querySelector(`.ck-rango[data-idx="${i}"]`).textContent.trim(), caja: doc.querySelector(`.ck-num[data-idx="${i}"]`).closest('div.mt-2').className });
    for (const i of [0, 1]) ok(fila(v.doc, i).etiqueta === 'Sin lectura — bloquea el cierre' && /\bbg-amber-50\b/.test(fila(v.doc, i).caja), `Paso ${i + 1}, con rango y guardado sin número: ${JSON.stringify(fila(v.doc, i))}`);
    ok(fila(v.doc, 2).etiqueta === 'Registrado' && /\bbg-slate-50\b/.test(fila(v.doc, 2).caja), `Sin rango, un texto sí es lectura: ${JSON.stringify(fila(v.doc, 2))}`);
    const insignias = [...v.doc.querySelectorAll('span')].map((s) => s.textContent.trim()).filter((s) => /^\d+ sin lectura$/.test(s));
    ok(JSON.stringify(insignias) === '["2 sin lectura"]', `El progreso cuenta los mismos: ${insignias.join(' | ')}`);
    const p = await abrir(190, 'tecnico');
    p.escribir('.ck-num[data-idx="0"]', '10');
    ok(fila(p.doc, 0).etiqueta === '✓ Dentro del rango' && /\bbg-emerald-50\b/.test(fila(p.doc, 0).caja), `Con el número, se juzga: ${JSON.stringify(fila(p.doc, 0))}`);
    p.escribir('.ck-num[data-idx="0"]', 'alto');
    ok(fila(p.doc, 0).etiqueta === 'Sin lectura — bloquea el cierre' && /\bbg-amber-50\b/.test(fila(p.doc, 0).caja), `Sin número, la pantalla dice lo mismo: ${JSON.stringify(fila(p.doc, 0))}`);
    p.w.close();
  }

  // ── F21 · Un envío a verificación que falla no deja nada sin guardar ──
  { // E4 · Marca con señal y enseguida «Enviar a verificación», que falla (sin trabajos): lo marcado se guarda solo.
    const p = await abrir(191, 'tecnico');
    p.marcar(0, 'ok'); p.marcar(1, 'ok');
    p.doc.querySelector('[data-transition="completada"]').click();
    await p.hasta(() => p.avisos.length > 0, 'el envío falla');
    ok(/Describe los trabajos realizados/.test(p.avisos[0]) && one('SELECT estado FROM ordenes WHERE id=191').estado === 'en_proceso', `El servidor lo rechaza: ${p.avisos.join(' | ')}`);
    const cerrar = new p.w.Event('beforeunload', { cancelable: true });
    p.w.dispatchEvent(cerrar);
    ok(cerrar.defaultPrevented, `Mientras no se guarda, el navegador avisa al cerrar: «${p.indicador()}»`);
    await p.hasta(() => estados(191) === 'ok, ok' && /Guardado/.test(p.indicador()), 'lo marcado se guarda solo');
    ok(p.recargas.length === 0 && p.w.localStorage.getItem(CK(191, 'tecnico')) === null, 'Guardado, ya no queda copia');
    p.w.close();
  }
  { // E4 · Con lo escrito también: el envío falla por un paso pendiente y lo escrito y lo marcado se guardan solos.
    const trabajos = 'Planta en manual; transferencia operada con un segundo técnico.';
    const p = await abrir(192, 'tecnico');
    p.escribir('#trabajosRealizados', trabajos);
    p.marcar(0, 'ok');
    p.doc.querySelector('[data-transition="completada"]').click();
    await p.hasta(() => p.avisos.length > 0, 'el envío falla');
    ok(/pendiente/.test(p.avisos[0]) && one('SELECT estado FROM ordenes WHERE id=192').estado === 'en_proceso', `El servidor lo rechaza por el paso pendiente: ${p.avisos.join(' | ')}`);
    await p.hasta(() => one('SELECT trabajos_realizados t FROM ordenes WHERE id=192').t === trabajos && estados(192) === 'ok, pendiente', 'lo escrito y lo marcado se guardan solos');
    await p.hasta(() => /Guardado/.test(p.doc.querySelector('#autosaveIndicador').textContent), 'la ficha lo da por guardado');
    p.w.close();
  }
  { // E4 · Sin señal al enviar: lo marcado queda pendiente, el navegador avisa al cerrar y sale al dejar la página.
    const p = await abrir(199, 'tecnico');
    p.red.caida = true;
    p.marcar(0, 'ok');
    p.doc.querySelector('[data-transition="completada"]').click();
    await p.hasta(() => /Sin guardar/.test(p.indicador()), 'sin señal no sale');
    // F32 · El envío dice que no salió, en la misma ventana con que muestra sus otros errores.
    ok(JSON.stringify(p.avisos) === JSON.stringify(['Sin señal: la orden no se envió. Lo que marcaste y escribiste queda en este equipo; vuelve a enviarla cuando haya señal.']),
      `Sin señal, «Enviar a verificación» dice que no salió, una vez: ${p.avisos.join(' | ')}`);
    const cerrar = new p.w.Event('beforeunload', { cancelable: true });
    p.w.dispatchEvent(cerrar);
    ok(cerrar.defaultPrevented && !!p.w.localStorage.getItem(CK(199, 'tecnico')), 'Queda pendiente: el navegador avisa al cerrar y la copia sigue en el equipo');
    p.red.caida = false;
    p.w.dispatchEvent(new p.w.Event('pagehide'));
    await p.hasta(() => estados(199) === 'ok, pendiente, pendiente', 'al salir se manda');
    p.w.close();
  }

  // ── F22 · El error del servidor se muestra tal cual ──
  {
    const p = await abrir(193, 'jefe');
    const OTRA = 'La orden cambió durante la operación. Actualiza la página e inténtalo de nuevo.';
    p.red.falsas.push({ status: 409, body: { error: OTRA, motivo: 'otra-escritura' } });
    p.doc.querySelector('#horaLlegada').value = app.ordenes.isoALocalInput(hace(0.4));
    p.doc.querySelector('#eopSave').click();
    await p.hasta(() => p.doc.querySelector('#eopMsg').textContent !== '', 'responde el servidor a las horas');
    ok(p.doc.querySelector('#eopMsg').textContent === OTRA, `«Guardar horas» dice el error del servidor: ${p.doc.querySelector('#eopMsg').textContent}`);
    p.red.falsas.push({ status: 400, body: { error: 'Solo la jefatura puede modificar los datos de la orden.' } });
    p.doc.querySelector('#clasifSave').click();
    await p.hasta(() => p.doc.querySelector('#clasifMsg').textContent !== '', 'responde el servidor a la clasificación');
    ok(p.doc.querySelector('#clasifMsg').textContent === 'Solo la jefatura puede modificar los datos de la orden.', `La clasificación también: ${p.doc.querySelector('#clasifMsg').textContent}`);
    p.red.falsas.push({ status: 400, body: { error: 'El procedimiento ya no está vigente.' } });
    p.doc.querySelector('#rigeVincular').click();
    await p.hasta(() => p.doc.querySelector('#rigeMsg').textContent !== '', 'responde el servidor al vincular');
    ok(p.doc.querySelector('#rigeMsg').textContent === 'El procedimiento ya no está vigente.', `«Vincular» también: ${p.doc.querySelector('#rigeMsg').textContent}`);
    ok(p.recargas.length === 0 && p.avisos.length === 0, 'Sin volver a cargar ni ventanas');
    p.w.close();
  }

  // ── F23 · K12: lo que la ficha cambia en un mismo guardado se aplica tal cual ──
  { // N5 · La jefatura corrige tres horas y borra la cuarta en un mismo «Guardar horas»: la cuarta queda borrada.
    const p = await abrir(194, 'jefe');
    const nuevas = { horaAlarma: hace(2.2), horaLlegada: hace(1.9), horaMitigacion: hace(1.6) };
    for (const [c, iso] of Object.entries(nuevas)) p.doc.querySelector(`#${c}`).value = app.ordenes.isoALocalInput(iso);
    p.doc.querySelector('#horaRestablecimiento').value = '';
    p.doc.querySelector('#eopSave').click();
    await p.hasta(() => p.enviados.some((e) => e.metodo === 'PATCH' && e.respuesta), 'guarda las horas');
    const envio = p.patches()[0];
    ok(envio.soloCambios === true && envio.horaRestablecimiento === null && Object.keys(envio).length === 5, `Viajan las cuatro horas con soloCambios: ${JSON.stringify(envio)}`);
    const o = one('SELECT hora_alarma a, hora_llegada l, hora_mitigacion m, hora_restablecimiento r FROM ordenes WHERE id=194');
    const minuto = (iso) => Math.floor(Date.parse(iso) / 60000);
    ok(o.r === null && minuto(o.a) === minuto(nuevas.horaAlarma) && minuto(o.l) === minuto(nuevas.horaLlegada) && minuto(o.m) === minuto(nuevas.horaMitigacion), `La cuarta queda borrada y las otras tres corregidas: ${JSON.stringify(o)}`);
    p.w.close();
  }
  { // N3 · La jefatura cambia el plan, desmarca la reversa y borra sus notas en un mismo «Guardar plan de reversa»: la reversa queda desmarcada.
    const notas = 'Se volvió al tablero anterior; el interruptor nuevo no cerró.';
    const [rev] = await celular({ tipo: 'mop.reversa', ordenId: 195, notas });
    ok(rev.ok && one('SELECT reversa_ejecutada e FROM ordenes WHERE id=195').e === 1, `El técnico marca la reversa en el celular: ${JSON.stringify(rev)}`);
    const p = await abrir(195, 'jefe');
    ok(p.doc.querySelector('#reversaEjecutada').checked && p.doc.querySelector('#reversaNotas').value === notas, 'La ficha abre con la reversa del celular');
    const plan = 'Volver al tablero anterior y avisar a la jefatura de turno.';
    p.doc.querySelector('#planReversa').value = plan;
    p.doc.querySelector('#reversaEjecutada').checked = false;
    p.doc.querySelector('#reversaNotas').value = '';
    p.doc.querySelector('#reversaSave').click();
    await p.hasta(() => p.enviados.some((e) => e.metodo === 'PATCH' && e.respuesta) && p.recargas.length === 1, 'guarda y vuelve a cargar por la reversa');
    ok(JSON.stringify(p.patches()) === JSON.stringify([{ planReversa: plan, reversaEjecutada: false, reversaNotas: null, soloCambios: true }]), `Viajan los tres campos con soloCambios: ${JSON.stringify(p.patches())}`);
    const o = one('SELECT plan_reversa p, reversa_ejecutada e, reversa_notas n FROM ordenes WHERE id=195');
    ok(o.e === 0 && o.n === null && o.p === plan, `La reversa queda desmarcada, sin notas y con el plan nuevo: ${JSON.stringify(o)}`);
    p.w.close();
  }

  // ── F24 · Cada paso dice su número ──
  {
    const v = await ver(196, 'jefe');
    const numeros = [...v.doc.querySelectorAll('.ck-row')].map((li) => li.querySelector('.ck-paso')?.textContent.trim());
    ok(JSON.stringify(numeros) === JSON.stringify(['Paso 1', 'Paso 2']), `Se numeran los pasos que se ven, como en el celular: ${numeros.join(' | ')}`);
    const clase = v.doc.querySelector('.ck-paso').className;
    ok(/\btext-xs\b/.test(clase) && /\btabular-nums\b/.test(clase) && /\btext-slate-500\b/.test(clase), `Pequeño, con números tabulares y en el color secundario: ${clase}`);
    const almacen = await sinSenal(196, 'jefe', [[1, 'ok']]);
    const l = JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=196').c);
    Object.assign(l[2], { estado: 'desviacion', notas: NOTA_CELULAR, hora: '10:30', iniciales: 'P.T.' });
    sqlite.prepare('UPDATE ordenes SET checklist_ejecucion=? WHERE id=196').run(JSON.stringify(l));
    const q = await abrir(196, 'jefe', { almacen });
    await pausa(300);
    const fila = q.doc.querySelector('.ck-row[data-idx="1"]');
    ok(q.caja() === 'El paso 2 cambió mientras tanto: revísalo y márcalo otra vez.' && fila.querySelector('.ck-paso').textContent.trim() === 'Paso 2' && fila.textContent.includes(PASOS[1]),
      `El aviso nombra el paso con el número de su fila: ${q.caja()}`);
    q.w.close();
  }

  // ── F25 · K15: la hora del turno en una frase ──
  {
    const v = await ver(197, 'jefe');
    const rondas = [...v.doc.querySelectorAll('a[href^="/ronda/"]')].map((a) => a.textContent.replace(/\s+/g, ' ').trim());
    ok(rondas.some((t) => t.startsWith('Ronda de la 01:00 · Sede Uno · 08/11/2026')) && rondas.some((t) => t.startsWith('Ronda de las 14:00 · Sede Uno')) && !/Ronda de las 01:00/.test(v.texto),
      `«Ronda de la 01:00» y «Ronda de las 14:00»: ${rondas.join(' | ')}`);
  }

  // ── El guardado del checklist en vuelo ─────────────────────────────────
  { // Con 300 ms de viaje: lo marcado durante el viaje sigue en pantalla y sale después, con la base que respondió el servidor.
    const p = await abrir(140, 'jefe');
    p.red.demora = 300;
    p.doc.querySelector('.ck-estado-btn[data-idx="0"][data-estado="ok"]').click();
    await p.hasta(() => p.patches().length === 1, 'sale el primer guardado');
    p.doc.querySelector('.ck-estado-btn[data-idx="1"][data-estado="na"]').click();
    await p.hasta(() => /Guardado/.test(p.doc.querySelector('#ckAutosave').textContent), 'responde el primer guardado');
    ok(enPantalla(p, 3) === 'ok, na, pendiente', `Al responder, la pantalla conserva lo marcado durante el viaje: ${enPantalla(p, 3)}`);
    await p.hasta(() => p.patches().length === 2 && estados(140) === 'ok, na, pendiente', 'sale lo marcado durante el viaje');
    const [primero, segundo] = p.patches();
    ok(JSON.parse(primero.checklistEjecucion).map((x) => x.estado).join(', ') === 'ok, pendiente, pendiente', `El primero lleva lo marcado antes de salir: ${primero.checklistEjecucion}`);
    ok(JSON.parse(segundo.checklistBase).map((x) => x.estado).join(', ') === 'ok, pendiente, pendiente' && JSON.parse(segundo.checklistEjecucion)[1].estado === 'na', `El segundo lleva la base que respondió el servidor: ${segundo.checklistBase}`);
    await pausa(400);
    ok(p.patches().length === 2 && enPantalla(p, 3) === 'ok, na, pendiente', `No sale nada más y la pantalla queda igual: ${enPantalla(p, 3)}`);
    p.w.close();
  }
  { // Con 2,5 s de viaje: lo marcado durante el viaje espera la respuesta y sale después.
    const p = await abrir(141, 'jefe');
    p.red.demora = 2500;
    p.doc.querySelector('.ck-estado-btn[data-idx="0"][data-estado="ok"]').click();
    await p.hasta(() => p.patches().length === 1, 'sale el primer guardado');
    p.doc.querySelector('.ck-estado-btn[data-idx="1"][data-estado="na"]').click();
    await pausa(1300);
    ok(p.patches().length === 1, 'Mientras viaja el primero no sale otro');
    await p.hasta(() => p.patches().length === 2, 'al responder el primero sale lo marcado durante el viaje', 6000);
    ok(JSON.parse(p.patches()[1].checklistBase).map((x) => x.estado).join(', ') === 'ok, pendiente, pendiente', `El segundo lleva la base que respondió el servidor: ${p.patches()[1].checklistBase}`);
    ok(enPantalla(p, 3) === 'ok, na, pendiente', `La pantalla conserva lo marcado durante el viaje: ${enPantalla(p, 3)}`);
    await p.hasta(() => estados(141) === 'ok, na, pendiente', 'quedan los dos', 6000);
    p.w.close();
  }
  { // Al salir con un guardado en vuelo, se manda otra vez con keepalive y su base.
    const p = await abrir(142, 'jefe');
    p.red.demora = 2500;
    p.doc.querySelector('.ck-estado-btn[data-idx="2"][data-estado="ok"]').click();
    await p.hasta(() => p.patches().length === 1, 'sale el guardado');
    p.red.demora = 0;
    p.w.dispatchEvent(new p.w.Event('pagehide'));
    await p.hasta(() => p.enviados.some((e) => e.metodo === 'PATCH' && e.keepalive), 'al salir se manda otra vez');
    const envio = p.enviados.find((e) => e.metodo === 'PATCH' && e.keepalive).data;
    ok(JSON.parse(envio.checklistEjecucion)[2].estado === 'ok' && JSON.parse(envio.checklistBase).every((x) => x.estado === 'pendiente'), `Sale con keepalive y la base que tenía la ficha: ${JSON.stringify(envio)}`);
    await p.hasta(() => estados(142) === 'pendiente, pendiente, ok', 'queda guardado');
    await p.hasta(() => !/Guardando/.test(p.doc.querySelector('#ckAutosave').textContent) && p.patches().length === 2, 'termina el que iba en camino', 4000);
    await pausa(2600);
    p.w.close();
  }
  { // 409 de la guarda de concurrencia: se reintenta una vez con la misma base y se quita el aviso.
    const enMedio = (id, veces) => {
      let quedan = veces;
      const escribe = async () => {
        const l = JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=?', id).c);
        Object.assign(l[0], { estado: 'ok', hora: `10:3${quedan}`, iniciales: 'P.T.' });
        sqlite.prepare('UPDATE ordenes SET checklist_ejecucion=? WHERE id=?').run(JSON.stringify(l), id);
        faults.beforeBatch = --quedan > 0 ? escribe : null;
      };
      faults.beforeBatch = escribe;
    };
    const p = await abrir(138, 'jefe');
    enMedio(138, 1);
    p.doc.querySelector('.ck-estado-btn[data-idx="2"][data-estado="ok"]').click();
    await p.hasta(() => /Guardado/.test(p.doc.querySelector('#ckAutosave').textContent), 'reintenta y guarda');
    const [uno, dos] = p.patches();
    ok(p.patches().length === 2 && uno.checklistBase === dos.checklistBase && uno.checklistEjecucion === dos.checklistEjecucion, `Reintenta una vez, con la misma base: ${JSON.stringify(p.patches())}`);
    ok(estados(138) === 'ok, pendiente, ok' && p.doc.querySelector('#ckConflicto').classList.contains('hidden') && p.avisos.length === 0, `Quedan el paso del celular y el de la ficha, sin aviso de conflicto: ${estados(138)}`);
    ok(enPantalla(p, 3) === 'ok, pendiente, ok', `La ficha pinta el paso del celular: ${enPantalla(p, 3)}`);
    p.w.close();
    // Dos veces seguidas: queda pendiente, con el aviso, hasta el guardado siguiente.
    const dosVeces = async (id) => {
      const q = await abrir(id, 'jefe');
      enMedio(id, 2);
      q.doc.querySelector('.ck-estado-btn[data-idx="2"][data-estado="ok"]').click();
      await q.hasta(() => /Sin guardar/.test(q.doc.querySelector('#ckAutosave').textContent), 'dos veces seguidas no se guarda');
      ok(q.patches().length === 2 && estados(id) === 'ok, pendiente, pendiente', `Un solo reintento; el servidor conserva lo del celular: ${estados(id)}`);
      ok(!q.doc.querySelector('#ckConflicto').classList.contains('hidden') && /^La orden cambió durante la operación/.test(q.doc.querySelector('#ckConflictoMsg').textContent), `Avisa que la orden cambió: ${q.doc.querySelector('#ckConflictoMsg').textContent}`);
      const cerrar = new q.w.Event('beforeunload', { cancelable: true });
      q.w.dispatchEvent(cerrar);
      ok(cerrar.defaultPrevented && !!q.w.localStorage.getItem(CK(id, 'jefe')), 'Queda pendiente: el navegador avisa al cerrar y la copia sigue en el equipo');
      return q;
    };
    const q = await dosVeces(139);
    q.doc.querySelector('.ck-estado-btn[data-idx="1"][data-estado="na"]').click();
    await q.hasta(() => estados(139) === 'ok, na, ok', 'el guardado siguiente lleva los dos puntos');
    await q.hasta(() => q.doc.querySelector('#ckConflicto').classList.contains('hidden'), 'un guardado que sale bien quita el aviso');
    ok(q.w.localStorage.getItem(CK(139, 'jefe')) === null && q.patches().at(-1).checklistBase === q.patches()[0].checklistBase, 'Sale con la misma base y ya no queda copia en el equipo');
    q.w.close();
    const s = await dosVeces(152);
    s.w.dispatchEvent(new s.w.Event('pagehide'));
    await s.hasta(() => estados(152) === 'ok, pendiente, ok', 'al salir se manda');
    const alSalir = s.enviados.filter((e) => e.metodo === 'PATCH').at(-1);
    ok(alSalir.keepalive && alSalir.data.checklistBase === s.patches()[0].checklistBase, `Al salir sale con keepalive y la misma base: ${JSON.stringify(alSalir)}`);
    await s.hasta(() => s.doc.querySelector('#ckConflicto').classList.contains('hidden'), 'al salir bien también se quita el aviso');
    ok(s.w.localStorage.getItem(CK(152, 'jefe')) === null, 'Guardado al salir, ya no queda copia en el equipo');
    faults.beforeBatch = null;
    s.w.close();
  }
  { // Un error del servidor no es un rechazo: lo marcado se queda en el equipo y sale al salir.
    const p = await abrir(155, 'jefe');
    const registrar = console.error;
    console.error = () => {};
    faults.statement = () => true;
    p.doc.querySelector('.ck-estado-btn[data-idx="1"][data-estado="na"]').click();
    try { await p.hasta(() => p.avisos.length === 1, 'el servidor falla'); } finally { console.error = registrar; }
    ok(estados(155) === 'pendiente, pendiente, pendiente' && !!p.w.localStorage.getItem(CK(155, 'jefe')), `No se guardó y la copia sigue en el equipo: ${p.avisos.join(' | ')}`);
    const cerrar = new p.w.Event('beforeunload', { cancelable: true });
    p.w.dispatchEvent(cerrar);
    ok(cerrar.defaultPrevented, 'Queda pendiente: el navegador avisa al cerrar');
    console.error = () => {};
    faults.statement = () => true;
    p.w.dispatchEvent(new p.w.Event('pagehide'));
    try { await p.hasta(() => p.enviados.some((e) => e.keepalive), 'al salir se manda'); await pausa(100); } finally { console.error = registrar; }
    ok(estados(155) === 'pendiente, pendiente, pendiente' && !!p.w.localStorage.getItem(CK(155, 'jefe')), 'Si al salir también falla el servidor, la copia sigue en el equipo');
    p.w.dispatchEvent(new p.w.Event('pagehide'));
    await p.hasta(() => estados(155) === 'pendiente, na, pendiente', 'a la siguiente salida se manda');
    await p.hasta(() => p.w.localStorage.getItem(CK(155, 'jefe')) === null, 'guardado, ya no queda copia');
    faults.statement = null;
    p.w.close();
  }
  { // Al salir, el envío recibe el 409 de la guarda de concurrencia: la copia sigue en el equipo y el aviso se ve.
    const p = await abrir(167, 'jefe');
    p.red.caida = true;
    p.marcar(2, 'ok');
    await p.hasta(() => /Sin guardar/.test(p.indicador()), 'sin señal no se guarda');
    p.red.caida = false;
    faults.beforeBatch = async () => {
      const l = JSON.parse(one('SELECT checklist_ejecucion c FROM ordenes WHERE id=167').c);
      Object.assign(l[0], { estado: 'ok', hora: '10:31', iniciales: 'P.T.' });
      sqlite.prepare('UPDATE ordenes SET checklist_ejecucion=? WHERE id=167').run(JSON.stringify(l));
    };
    p.w.dispatchEvent(new p.w.Event('pagehide'));
    await p.hasta(() => p.enviados.some((e) => e.keepalive) && p.caja() !== '', 'el envío al salir recibe el 409');
    ok(/^La orden cambió durante la operación/.test(p.caja()) && estados(167) === 'ok, pendiente, pendiente' && !!p.w.localStorage.getItem(CK(167, 'jefe')), `La copia queda y el aviso se ve: ${p.caja()}`);
    const cerrar = new p.w.Event('beforeunload', { cancelable: true });
    p.w.dispatchEvent(cerrar);
    ok(cerrar.defaultPrevented, 'Queda pendiente: el navegador avisa al cerrar');
    p.w.dispatchEvent(new p.w.Event('pagehide'));
    await p.hasta(() => estados(167) === 'ok, pendiente, ok', 'a la salida siguiente se guarda');
    await p.hasta(() => p.w.localStorage.getItem(CK(167, 'jefe')) === null && p.caja() === '', 'guardado, ya no quedan copia ni aviso');
    p.w.close();
  }
  { // K10 · El 409 de la guarda de concurrencia se reconoce por su motivo y, si no viene, por la frase: se reintenta una vez.
    for (const [id, cuerpo] of [[173, { error: 'Otra escritura entró en medio.', motivo: 'otra-escritura' }], [174, { error: 'La orden cambió durante la operación. Actualiza la página e inténtalo de nuevo.' }]]) {
      const p = await abrir(id, 'jefe');
      p.red.falsas.push({ status: 409, body: cuerpo });
      p.marcar(2, 'ok');
      await p.hasta(() => /Guardado/.test(p.indicador()), 'reintenta y guarda');
      const [uno, dos] = p.patches();
      ok(p.patches().length === 2 && uno.checklistBase === dos.checklistBase && estados(id) === 'pendiente, pendiente, ok' && p.caja() === '',
        `${cuerpo.motivo ? 'Por su motivo' : 'Por la frase'}, reintenta una vez con la misma base: ${JSON.stringify(p.patches())}`);
      p.w.close();
    }
  }

  // ── Lo escrito mientras viaja un guardado de horas o de reversa ────────
  { // J3: la hora escrita mientras viaja «Guardar horas» queda en pantalla y sale en el siguiente.
    const p = await abrir(145, 'jefe');
    p.red.demora = 300;
    const alarma = one('SELECT hora_alarma h FROM ordenes WHERE id=145').h;
    const aLocal = (min) => app.ordenes.isoALocalInput(new Date(Date.parse(alarma) + min * 60000).toISOString());
    p.doc.querySelector('#horaLlegada').value = aLocal(9);
    p.doc.querySelector('#eopSave').click();
    await p.hasta(() => p.patches().length === 1, 'sale la llegada');
    p.doc.querySelector('#horaMitigacion').value = aLocal(30);
    await p.hasta(() => /Guardado/.test(p.doc.querySelector('#eopMsg').textContent), 'responde el servidor');
    ok(p.doc.querySelector('#horaMitigacion').value === aLocal(30) && p.doc.querySelector('#horaLlegada').value === aLocal(9), 'La hora escrita durante el viaje sigue en pantalla');
    ok(p.doc.querySelector('#eopMsg').textContent === 'Guardado. Falta guardar lo último que escribiste.', `Dice que falta guardar lo último: ${p.doc.querySelector('#eopMsg').textContent}`);
    p.red.demora = 0;
    p.doc.querySelector('#eopSave').click();
    await p.hasta(() => p.patches().length === 2 && !!one('SELECT hora_mitigacion h FROM ordenes WHERE id=145').h, 'sale la mitigación');
    ok(JSON.stringify(p.patches()[1]) === JSON.stringify({ horaMitigacion: `${aLocal(30)}:00-06:00`, soloCambios: true }), `El segundo guardado lleva solo la hora que faltaba: ${JSON.stringify(p.patches()[1])}`);
    ok(Date.parse(one('SELECT hora_llegada h FROM ordenes WHERE id=145').h) === Date.parse(`${aLocal(9)}:00-06:00`), 'La llegada quedó como se mandó');
    p.w.close();
  }
  { // J4: las notas escritas mientras viaja «Guardar plan de reversa» se quedan y salen en el siguiente.
    const p = await abrir(146, 'tecnico');
    p.red.demora = 300;
    const plan = 'Volver al tablero anterior y avisar a la jefatura de turno.';
    const notas = 'Se volvió al tablero anterior; el interruptor nuevo no cerró.';
    p.doc.querySelector('#planReversa').value = plan;
    p.doc.querySelector('#reversaSave').click();
    await p.hasta(() => p.patches().length === 1, 'sale el plan');
    p.doc.querySelector('#reversaNotas').value = notas;
    await p.hasta(() => /Guardado/.test(p.doc.querySelector('#reversaMsg').textContent), 'responde el servidor');
    ok(p.doc.querySelector('#reversaNotas').value === notas && p.doc.querySelector('#planReversa').value === plan, 'Las notas escritas durante el viaje siguen en pantalla');
    ok(p.doc.querySelector('#reversaMsg').textContent === 'Guardado. Falta guardar lo último que escribiste.', `Dice que falta guardar lo último: ${p.doc.querySelector('#reversaMsg').textContent}`);
    p.red.demora = 0;
    p.doc.querySelector('#reversaSave').click();
    await p.hasta(() => p.patches().length === 2 && one('SELECT reversa_notas n FROM ordenes WHERE id=146').n === notas, 'salen las notas');
    ok(JSON.stringify(p.patches()) === JSON.stringify([{ planReversa: plan, soloCambios: true }, { reversaNotas: notas, soloCambios: true }]), `Cada guardado lleva solo lo suyo: ${JSON.stringify(p.patches())}`);
    ok(one('SELECT plan_reversa p FROM ordenes WHERE id=146').p === plan, 'El plan quedó como se mandó');
    p.w.close();
  }
  { // J3: corregir la alarma mueve el plazo, pero la ficha no se vuelve a cargar mientras falta guardar lo escrito durante el viaje.
    const p = await abrir(165, 'jefe');
    p.red.demora = 300;
    const alarma = one('SELECT hora_alarma h FROM ordenes WHERE id=165').h;
    const aLocal = (min) => app.ordenes.isoALocalInput(new Date(Date.parse(alarma) + min * 60000).toISOString());
    p.doc.querySelector('#horaAlarma').value = aLocal(-5);
    p.doc.querySelector('#eopSave').click();
    await p.hasta(() => p.patches().length === 1, 'sale la alarma corregida');
    p.doc.querySelector('#horaMitigacion').value = aLocal(30);
    await p.hasta(() => /Guardado/.test(p.doc.querySelector('#eopMsg').textContent), 'responde el servidor');
    await pausa(50);
    ok(p.recargas.length === 0 && p.doc.querySelector('#eopMsg').textContent === 'Guardado. Falta guardar lo último que escribiste.' && p.doc.querySelector('#horaMitigacion').value === aLocal(30),
      `Con la mitigación sin guardar no se vuelve a cargar: ${p.recargas.length} recargas · ${p.doc.querySelector('#eopMsg').textContent}`);
    p.red.demora = 0;
    p.doc.querySelector('#eopSave').click();
    await p.hasta(() => p.recargas.length === 1, 'guardada la mitigación, se vuelve a cargar por el plazo nuevo');
    ok(JSON.stringify(p.patches()[1]) === JSON.stringify({ horaMitigacion: `${aLocal(30)}:00-06:00`, soloCambios: true }), `El segundo guardado lleva la mitigación: ${JSON.stringify(p.patches()[1])}`);
    p.w.close();
  }
  { // J4: marcar la reversa cambia lo que se exige, pero la ficha no se vuelve a cargar mientras falta guardar el plan escrito durante el viaje.
    const p = await abrir(166, 'jefe');
    p.red.demora = 300;
    p.doc.querySelector('#reversaEjecutada').checked = true;
    p.doc.querySelector('#reversaNotas').value = 'Se volvió al tablero anterior; el interruptor nuevo no cerró.';
    p.doc.querySelector('#reversaSave').click();
    await p.hasta(() => p.patches().length === 1, 'sale la reversa');
    const plan = 'Volver al tablero anterior y avisar al jefe de turno.';
    p.doc.querySelector('#planReversa').value = plan;
    await p.hasta(() => /Guardado/.test(p.doc.querySelector('#reversaMsg').textContent), 'responde el servidor');
    await pausa(50);
    ok(p.recargas.length === 0 && p.doc.querySelector('#reversaMsg').textContent === 'Guardado. Falta guardar lo último que escribiste.' && p.doc.querySelector('#planReversa').value === plan,
      `Con el plan sin guardar no se vuelve a cargar: ${p.recargas.length} recargas · ${p.doc.querySelector('#reversaMsg').textContent}`);
    p.red.demora = 0;
    p.doc.querySelector('#reversaSave').click();
    await p.hasta(() => p.recargas.length === 1, 'guardado el plan, se vuelve a cargar por la reversa');
    ok(JSON.stringify(p.patches()[1]) === JSON.stringify({ planReversa: plan, soloCambios: true }) && one('SELECT reversa_ejecutada e FROM ordenes WHERE id=166').e === 1, `El segundo guardado lleva el plan: ${JSON.stringify(p.patches()[1])}`);
    p.w.close();
  }
  { // El error del servidor al guardar el plan de reversa se muestra tal cual, no «No se guardó».
    const p = await abrir(175, 'jefe');
    p.doc.querySelector('#reversaEjecutada').checked = true;
    p.doc.querySelector('#reversaNotas').value = 'Revertido';
    p.doc.querySelector('#reversaSave').click();
    await p.hasta(() => p.patches().length === 1 && p.doc.querySelector('#reversaMsg').textContent !== '', 'responde el servidor');
    const respuesta = p.enviados.find((e) => e.metodo === 'PATCH').respuesta;
    ok(typeof respuesta?.error === 'string' && /mínimo 10 caracteres/.test(respuesta.error) && p.doc.querySelector('#reversaMsg').textContent === respuesta.error,
      `Dice lo que respondió el servidor: ${p.doc.querySelector('#reversaMsg').textContent}`);
    p.w.close();
  }

  // ── Causa raíz: enviada o cerrada, un texto corto no se manda ──────────
  {
    const p = await abrir(147, 'jefe');
    p.escribir('#causaRaiz', 'Breaker flojo');
    p.w.dispatchEvent(new p.w.Event('pagehide'));
    await pausa(1700);
    ok(p.patches().length === 0 && p.doc.querySelector('#causaMsg').textContent === 'Faltan 7 caracteres para guardar', `Corta no se manda, ni al salir: ${p.doc.querySelector('#causaMsg').textContent} ${JSON.stringify(p.patches())}`);
    p.escribir('#causaRaiz', 'Breaker flojo en barra');
    p.escribir('#causaRaiz', 'Breaker flojo en ba');
    p.doc.querySelector('#causaSave').click();
    await pausa(50);
    ok(p.patches().length === 0 && p.doc.querySelector('#causaMsg').textContent === 'Falta 1 carácter para guardar', `Cuenta lo que falta: ${p.doc.querySelector('#causaMsg').textContent}`);
    p.doc.querySelector('[data-transition="verificada"]').click();
    await pausa(50);
    ok(p.doc.querySelector('#verifModal').classList.contains('hidden') && p.patches().length === 0, 'Con la causa corta no se abre la verificación');
    const causa = 'Breaker flojo en la barra principal del tablero de transferencia.';
    p.escribir('#causaRaiz', causa);
    await p.hasta(() => one('SELECT causa_raiz c FROM ordenes WHERE id=147').c === causa, 'con el mínimo se guarda');
    ok(JSON.stringify(p.patches()) === JSON.stringify([{ causaRaiz: causa, soloCambios: true }]) && /Guardada/.test(p.doc.querySelector('#causaMsg').textContent), `Sale sola y se guarda: ${JSON.stringify(p.patches())}`);
    p.escribir('#causaRaiz', '');
    await pausa(1700);
    ok(p.patches().length === 1 && p.doc.querySelector('#causaMsg').textContent === 'Faltan 20 caracteres para guardar' && one('SELECT causa_raiz c FROM ordenes WHERE id=147').c === causa, 'Tampoco se borra: la causa guardada queda');
    ok(p.avisos.length === 0 && p.errores.length === 0, `Sin avisos ni errores: ${p.avisos.join(' | ')} ${p.errores.join(' | ')}`);
    p.w.close();
    const q = await abrir(148, 'jefe');
    q.escribir('#causaRaiz', 'Breaker flojo');
    ok(q.w.localStorage.getItem('ot-148-causa-2') !== null && q.w.localStorage.getItem('ot-148-causa') === null, 'El borrador de la causa lleva la cuenta en la clave');
    await q.hasta(() => one('SELECT causa_raiz c FROM ordenes WHERE id=148').c === 'Breaker flojo', 'en proceso guarda el borrador');
    ok(JSON.stringify(q.patches()) === JSON.stringify([{ causaRaiz: 'Breaker flojo', soloCambios: true }]), `En proceso, el borrador corto sí se guarda: ${JSON.stringify(q.patches())}`);
    q.w.close();
  }

  // ── La reversa, igual que el servidor ──────────────────────────────────
  {
    const campos = (v) => JSON.stringify({ plan: !v.doc.querySelector('#planReversa').disabled, casilla: !v.doc.querySelector('#reversaEjecutada').disabled, notas: !v.doc.querySelector('#reversaNotas').disabled, guardar: v.hay('#reversaSave') });
    const TODO = JSON.stringify({ plan: true, casilla: true, notas: true, guardar: true });
    const NADA = JSON.stringify({ plan: false, casilla: false, notas: false, guardar: false });
    const abierta = await ver(129, 'tecnico');
    ok(campos(abierta) === JSON.stringify({ plan: true, casilla: false, notas: false, guardar: true }), `Abierta, el técnico asignado escribe solo el plan: ${campos(abierta)}`);
    ok(/La reversa se marca después de empezar la intervención\./.test(abierta.doc.querySelector('#reversaAntes')?.textContent ?? ''), 'Y la ficha dice por qué');
    const jefeAbierta = await ver(129, 'jefe');
    ok(campos(jefeAbierta) === TODO && !jefeAbierta.hay('#reversaAntes'), `La jefatura, con la orden abierta: ${campos(jefeAbierta)}`);
    ok(campos(await ver(126, 'tecnico')) === NADA, 'Enviada, el técnico ya no la toca');
    ok(campos(await ver(126, 'jefe')) === TODO, 'Enviada, la registra la jefatura');
    for (const [id, rol] of [[149, 'jefe'], [149, 'admin'], [149, 'tecnico'], [150, 'jefe'], [150, 'tecnico']]) {
      ok(campos(await ver(id, rol)) === NADA, `${id === 149 ? 'Cerrada' : 'Cancelada'}, nadie la toca (${rol})`);
    }
    const p = await abrir(129, 'tecnico');
    const plan = 'Volver al tablero anterior y avisar al jefe de turno antes de energizar.';
    p.doc.querySelector('#planReversa').value = plan;
    p.doc.querySelector('#reversaSave').click();
    await p.hasta(() => one('SELECT plan_reversa p FROM ordenes WHERE id=129').p === plan, 'guarda el plan');
    ok(JSON.stringify(p.patches()) === JSON.stringify([{ planReversa: plan, soloCambios: true }]), `Del técnico, con la orden abierta, viaja solo el plan: ${JSON.stringify(p.patches())}`);
    ok(one('SELECT reversa_ejecutada e FROM ordenes WHERE id=129').e === 0 && p.avisos.length === 0, 'La reversa sigue sin marcar');
    p.w.close();
  }

  // ── F26 · El borrador lleva lo que tenía el servidor cuando se escribió ──
  const trabajosDe = (id) => one('SELECT trabajos_realizados t FROM ordenes WHERE id=?', id).t;
  const causaDe = (id) => one('SELECT causa_raiz c FROM ordenes WHERE id=?', id).c;
  const FECHA = '\\d{2}/\\d{2}/\\d{4}, \\d{2}:\\d{2}';
  const indicadorTexto = (p) => p.doc.querySelector('#autosaveIndicador').textContent;
  // Escribe sin señal y deja la página: lo escrito queda solo en el equipo.
  const escribirSinSenal = async (p, sel, texto, msg) => {
    p.red.caida = true;
    p.escribir(sel, texto);
    await p.hasta(() => /Sin conexión/.test(p.doc.querySelector(msg).textContent), 'sin señal no se guarda');
    p.w.dispatchEvent(new p.w.Event('pagehide'));
    await pausa(50);
    p.w.close();
  };
  { // H1 · La jefatura escribe los trabajos sin señal y sale; el técnico, en el mismo navegador, guarda los suyos; la jefatura vuelve.
    const DE_JEFATURA = 'Texto de la jefatura escrito sin señal en la ficha.';
    const DEL_TECNICO = 'Texto del técnico: se cambió el fusible de control y se probó la transferencia.';
    const PREGUNTA = new RegExp(`^Tienes cambios sin guardar de ${FECHA} en esta OT\\. Después de que los escribiste en este equipo se guardó otro texto en Trabajos realizados\\. ¿Reemplazarlo con lo que escribiste aquí\\? \\(Cancelar = dejar lo guardado\\)$`);
    for (const [id, acepta] of [[210, true], [211, false]]) {
      const equipo = new Almacen();
      await escribirSinSenal(await abrir(id, 'jefe', { compartido: equipo }), '#trabajosRealizados', DE_JEFATURA, '#autosaveIndicador');
      const borrador = JSON.parse(equipo.getItem(`ot-${id}-draft-2`) ?? 'null');
      ok(borrador?.payload?.trabajosRealizados === DE_JEFATURA && borrador.base?.trabajosRealizados === '', `El borrador lleva lo que tenía el servidor cuando se escribió: ${equipo.getItem(`ot-${id}-draft-2`)}`);
      const t = await abrir(id, 'tecnico', { compartido: equipo });
      t.escribir('#trabajosRealizados', DEL_TECNICO);
      await t.hasta(() => trabajosDe(id) === DEL_TECNICO, 'el técnico guarda los suyos');
      ok(t.confirmaciones.length === 0, 'Al técnico no se le ofrece el borrador de la jefatura');
      t.w.close();
      const q = await abrir(id, 'jefe', { compartido: equipo, confirmar: acepta });
      ok(q.confirmaciones.length === 1 && PREGUNTA.test(q.confirmaciones[0]), `La pregunta dice que después se guardó otro texto: ${q.confirmaciones.join(' | ')}`);
      if (acepta) {
        await q.hasta(() => trabajosDe(id) === DE_JEFATURA && equipo.getItem(`ot-${id}-draft-2`) === null, 'aceptar lo pone y lo guarda');
        ok(q.doc.querySelector('#trabajosRealizados').value === DE_JEFATURA, 'Aceptar pone lo que se escribió en este equipo');
      } else {
        await pausa(1700);
        ok(trabajosDe(id) === DEL_TECNICO && q.doc.querySelector('#trabajosRealizados').value === DEL_TECNICO && q.patches().length === 0 && equipo.getItem(`ot-${id}-draft-2`) === null,
          `Cancelar deja lo guardado y descarta el borrador: ${JSON.stringify(q.patches())}`);
      }
      q.w.close();
    }
  }
  { // El borrador de la misma cuenta, con el servidor como lo dejó la ficha, se ofrece como hoy: lo que la ficha guardó antes es la base.
    const PRIMERO = 'Planta en manual; se cambió el fusible de control.';
    const SEGUNDO = 'Planta en manual; se cambió el fusible de control y se probó la transferencia.';
    const equipo = new Almacen();
    const j = await abrir(212, 'jefe', { compartido: equipo });
    j.escribir('#trabajosRealizados', PRIMERO);
    await j.hasta(() => trabajosDe(212) === PRIMERO && equipo.getItem('ot-212-draft-2') === null, 'con señal se guarda');
    await escribirSinSenal(j, '#trabajosRealizados', SEGUNDO, '#autosaveIndicador');
    ok(JSON.parse(equipo.getItem('ot-212-draft-2') ?? 'null')?.base?.trabajosRealizados === PRIMERO, `La base es lo último que la ficha guardó: ${equipo.getItem('ot-212-draft-2')}`);
    const q = await abrir(212, 'jefe', { compartido: equipo });
    ok(q.confirmaciones.length === 1 && new RegExp(`^Tienes cambios sin guardar de ${FECHA} en esta OT\\. ¿Restaurarlos\\? \\(Cancelar = descartar\\)$`).test(q.confirmaciones[0]), `Se ofrece como hoy: ${q.confirmaciones.join(' | ')}`);
    await q.hasta(() => trabajosDe(212) === SEGUNDO && equipo.getItem('ot-212-draft-2') === null, 'lo recuperado se guarda');
    q.w.close();
  }
  { // H2 · La jefatura escribe la causa sin señal y sale; el admin, en el mismo navegador, guarda otra; la jefatura vuelve.
    const DE_JEFATURA = 'Causa de la jefatura escrita sin señal: breaker flojo en la barra.';
    const DEL_ADMIN = 'Causa del admin: el breaker principal está subdimensionado para la carga nueva.';
    const PREGUNTA = new RegExp(`^Tienes una causa raíz sin guardar del ${FECHA}\\. Después de que la escribiste en este equipo se guardó otro texto en Causa raíz\\. ¿Reemplazarlo con lo que escribiste aquí\\? \\(Cancelar = dejar lo guardado\\)$`);
    for (const [id, acepta] of [[213, true], [214, false]]) {
      const equipo = new Almacen();
      await escribirSinSenal(await abrir(id, 'jefe', { compartido: equipo }), '#causaRaiz', DE_JEFATURA, '#causaMsg');
      ok(JSON.parse(equipo.getItem(`ot-${id}-causa-2`) ?? 'null')?.base === '', `El borrador lleva la causa que tenía el servidor: ${equipo.getItem(`ot-${id}-causa-2`)}`);
      const a = await abrir(id, 'admin', { compartido: equipo });
      a.escribir('#causaRaiz', DEL_ADMIN);
      await a.hasta(() => causaDe(id) === DEL_ADMIN, 'el admin guarda la suya');
      ok(a.confirmaciones.length === 0, 'Al admin no se le ofrece el borrador de la jefatura');
      a.w.close();
      const q = await abrir(id, 'jefe', { compartido: equipo, confirmar: acepta });
      ok(q.confirmaciones.length === 1 && PREGUNTA.test(q.confirmaciones[0]), `La pregunta dice que después se guardó otra causa: ${q.confirmaciones.join(' | ')}`);
      if (acepta) await q.hasta(() => causaDe(id) === DE_JEFATURA && q.doc.querySelector('#causaRaiz').value === DE_JEFATURA && equipo.getItem(`ot-${id}-causa-2`) === null, 'aceptar la pone y la guarda');
      else {
        await pausa(1700);
        ok(causaDe(id) === DEL_ADMIN && q.doc.querySelector('#causaRaiz').value === DEL_ADMIN && q.patches().length === 0 && equipo.getItem(`ot-${id}-causa-2`) === null,
          `Cancelar deja la guardada y descarta el borrador: ${JSON.stringify(q.patches())}`);
      }
      q.w.close();
    }
  }
  { // La causa de la misma cuenta, con el servidor como lo dejó la ficha, se ofrece como hoy.
    const PRIMERA = 'Breaker flojo en la barra principal.';
    const SEGUNDA = 'Breaker flojo en la barra principal del tablero de transferencia.';
    const equipo = new Almacen();
    const j = await abrir(215, 'jefe', { compartido: equipo });
    j.escribir('#causaRaiz', PRIMERA);
    await j.hasta(() => causaDe(215) === PRIMERA && equipo.getItem('ot-215-causa-2') === null, 'con señal se guarda');
    await escribirSinSenal(j, '#causaRaiz', SEGUNDA, '#causaMsg');
    const q = await abrir(215, 'jefe', { compartido: equipo });
    ok(q.confirmaciones.length === 1 && new RegExp(`^Tienes una causa raíz sin guardar del ${FECHA}\\. ¿Recuperarla\\? \\(Cancelar = descartar\\)$`).test(q.confirmaciones[0]), `Se ofrece como hoy: ${q.confirmaciones.join(' | ')}`);
    await q.hasta(() => causaDe(215) === SEGUNDA && equipo.getItem('ot-215-causa-2') === null, 'lo recuperado se guarda');
    q.w.close();
  }
  { // F29 · B3: con un borrador de la cuenta y otro de la clave vieja, el viejo no se borra sin haberlo ofrecido.
    const VIEJO = 'Texto del borrador viejo, sin la cuenta en la clave.';
    const NUEVO = 'Texto del borrador nuevo de la cuenta.';
    const equipo = new Almacen();
    equipo.setItem('ot-223-draft', JSON.stringify({ payload: { trabajosRealizados: VIEJO }, savedAt: Date.now() - 120000 }));
    equipo.setItem('ot-223-draft-3', JSON.stringify({ payload: { trabajosRealizados: NUEVO }, base: { trabajosRealizados: '' }, savedAt: Date.now() - 60000 }));
    const p = await abrir(223, 'tecnico', { compartido: equipo });
    ok(p.confirmaciones.length === 1 && equipo.getItem('ot-223-draft') !== null, `Se ofrece el de la cuenta y el viejo espera: ${p.confirmaciones.join(' | ')}`);
    await p.hasta(() => trabajosDe(223) === NUEVO && equipo.getItem('ot-223-draft-3') === null, 'lo recuperado se guarda');
    p.w.close();
    const q = await abrir(223, 'tecnico', { compartido: equipo, confirmar: false });
    ok(q.confirmaciones.length === 1 && /¿Restaurarlos\? \(Cancelar = descartar\)$/.test(q.confirmaciones[0]) && equipo.getItem('ot-223-draft') === null && trabajosDe(223) === NUEVO,
      `Al volver a abrir se ofrece el viejo, como hoy, y sale del equipo: ${q.confirmaciones.join(' | ')}`);
    q.w.close();
    const r = await abrir(223, 'tecnico', { compartido: equipo });
    ok(r.confirmaciones.length === 0, 'Una sola vez: ya no se ofrece');
    r.w.close();
  }

  // ── F35 · K16: la causa de la ficha viaja con soloCambios ──
  { // La jefatura vuelve la causa a una anterior que escribió otra cuenta: se guarda, al escribir y al salir.
    const PRIMERA = 'Breaker flojo en la barra principal del tablero de transferencia.';
    const SEGUNDA = 'El breaker principal está subdimensionado para la carga nueva.';
    for (const [id, alSalir] of [[216, false], [217, true]]) {
      for (const c of [PRIMERA, SEGUNDA]) ok((await patch(id, 'admin', { causaRaiz: c })).status === 200 && causaDe(id) === c, `Otra cuenta escribe la causa: ${causaDe(id)}`);
      const p = await abrir(id, 'jefe');
      p.escribir('#causaRaiz', PRIMERA);
      if (alSalir) p.w.dispatchEvent(new p.w.Event('pagehide'));
      await p.hasta(() => causaDe(id) === PRIMERA, 'vuelve a la primera y se guarda');
      const envio = p.enviados.filter((e) => e.metodo === 'PATCH');
      ok(envio.length === 1 && envio[0].data.soloCambios === true && envio[0].keepalive === alSalir, `${alSalir ? 'Al salir' : 'Al escribir'}, viaja con soloCambios: ${JSON.stringify(envio.map((e) => e.data))}`);
      p.w.close();
    }
  }

  // ── F27 · El aviso de un paso que el servidor no tomó sigue hasta volver a marcarlo ──
  { // A11 (marcado mientras viaja el guardado) y A12 (marcado 2 s después): el guardado bueno de otro paso no quita el aviso.
    for (const [id, demora, espera] of [[218, 300, 0], [219, 0, 2000]]) {
      const p = await abrir(id, 'jefe');
      p.red.caida = true;
      p.marcar(1, 'ok');
      await p.hasta(() => /Sin guardar/.test(p.indicador()), 'sin señal no se guarda');
      const delCelular = await desviacionDelCelular(id, 1);
      p.red.caida = false; p.red.demora = demora;
      p.marcar(2, 'ok');
      if (demora) await p.hasta(() => p.patches().length === 2, 'sale el guardado');
      else await p.hasta(() => p.caja() !== '', 'avisa el paso que cambió');
      await pausa(espera);
      p.marcar(0, 'ok');
      await p.hasta(() => estados(id) === 'ok, desviacion, ok' && /Guardado/.test(p.indicador()), 'el otro paso se guarda');
      ok(p.caja() === 'El paso 2 cambió mientras tanto: revísalo y márcalo otra vez.' && JSON.stringify(punto(id, 1)) === delCelular,
        `${demora ? 'Marcado mientras viaja el guardado' : 'Marcado 2 s después'}, el guardado de otro paso no quita el aviso: «${p.caja()}»`);
      p.red.demora = 0;
      p.marcar(1, 'ok');
      ok(p.caja() === '', `Al volver a marcar ese paso, el aviso se va: «${p.caja()}»`);
      await p.hasta(() => estados(id) === 'ok, ok, ok', 'y se guarda');
      p.w.close();
    }
  }

  // ── F28 · Las iniciales y una hora escrita a mano dicen si una marca ya llegó ──
  { // C1 · Sin señal: la lectura, las iniciales y OK; el celular marca OK con las suyas. C2 · La hora escrita a mano y OK.
    for (const [id, escribe, sellada] of [[221, [['.ck-num', '10,5'], ['.ck-iniciales', 'J.M.']], true], [222, [['.ck-hora', '09:15']], false]]) {
      const p = await abrir(id, 'jefe');
      p.red.caida = true;
      for (const [clase, valor] of escribe) p.escribir(`${clase}[data-idx="0"]`, valor);
      p.marcar(0, 'ok');
      await p.hasta(() => /Sin guardar/.test(p.indicador()), 'sin señal no se guarda');
      p.w.dispatchEvent(new p.w.Event('pagehide'));
      await pausa(50);
      const almacen = almacenDe(p.w);
      p.w.close();
      const copia = JSON.parse(almacen[CK(id, 'jefe')]);
      const marca = JSON.parse(copia.checklist)[0];
      ok(sellada ? copia.selladas?.[0] === marca.hora && marca.iniciales === 'J.M.' : marca.hora === '09:15' && !('0' in (copia.selladas ?? {})),
        `La copia marca solo la hora que selló la ficha: ${almacen[CK(id, 'jefe')]}`);
      const [paso] = await celular({ tipo: 'orden.paso', ordenId: id, idx: 0, estado: 'ok', ...(sellada ? { valor: '10,5', texto: medida.texto } : { texto: 'Anotar la corriente de fase' }) });
      const delCelular = JSON.stringify(punto(id, 0));
      ok(paso.ok && punto(id, 0).iniciales === 'P.T.', `El celular marca OK con su hora e iniciales: ${delCelular}`);
      const q = await abrir(id, 'jefe', { almacen });
      await pausa(300);
      ok(q.caja() === 'El paso 1 cambió mientras tanto: revísalo y márcalo otra vez.' && q.patches().length === 0 && JSON.stringify(punto(id, 0)) === delCelular && q.w.localStorage.getItem(CK(id, 'jefe')) === null,
        `${sellada ? 'Las iniciales' : 'La hora escrita a mano'} no se dan por guardadas: la ficha avisa y no pisa al celular: «${q.caja()}» · ${JSON.stringify(q.patches())}`);
      q.w.close();
    }
  }

  // ── F30 · Un paso N/A no bloquea por su lectura. F34 · Un límite ilegible es sin límite ──
  {
    const fila = (doc, i) => ({ etiqueta: doc.querySelector(`.ck-rango[data-idx="${i}"]`).textContent.trim(), caja: doc.querySelector(`.ck-num[data-idx="${i}"]`).closest('div.mt-2').className.match(/\bbg-\w+-50\b/)?.[0] });
    const NA = JSON.stringify({ etiqueta: 'N/A: no se exige lectura', caja: 'bg-slate-50' });
    const BLOQUEA = JSON.stringify({ etiqueta: 'Sin lectura — bloquea el cierre', caja: 'bg-amber-50' });
    const v = await ver(224, 'jefe');
    for (const i of [0, 1]) ok(JSON.stringify(fila(v.doc, i)) === NA, `D1 · Paso ${i + 1}, N/A ${i ? 'sin lectura' : 'con texto'}, con rango: ${JSON.stringify(fila(v.doc, i))}`);
    ok(JSON.stringify(fila(v.doc, 2)) === BLOQUEA, `Pendiente y sin lectura sí bloquea: ${JSON.stringify(fila(v.doc, 2))}`);
    const insignias = [...v.doc.querySelectorAll('span')].map((s) => s.textContent.trim()).filter((s) => /^\d+ sin lectura$/.test(s));
    ok(JSON.stringify(insignias) === '["1 sin lectura"]', `La insignia cuenta lo mismo: ${insignias.join(' | ')}`);
    const p = await abrir(224, 'jefe');
    p.marcar(2, 'na');
    ok(JSON.stringify(fila(p.doc, 2)) === NA, `Al marcarlo N/A, la fila lo dice enseguida: ${JSON.stringify(fila(p.doc, 2))}`);
    p.marcar(1, 'ok');
    ok(JSON.stringify(fila(p.doc, 1)) === BLOQUEA, `De N/A a OK sin lectura, bloquea: ${JSON.stringify(fila(p.doc, 1))}`);
    ok(fila(p.doc, 3).etiqueta === 'Registrado', `Límite «abc» con texto: ${fila(p.doc, 3).etiqueta}`);
    p.escribir('.ck-num[data-idx="3"]', '5');
    ok(JSON.stringify(fila(p.doc, 3)) === JSON.stringify({ etiqueta: 'Registrado', caja: 'bg-slate-50' }), `F34 · Con un número, el límite «abc» no lo pone fuera de rango, como el render y el servidor: ${JSON.stringify(fila(p.doc, 3))}`);
    p.w.close();
  }
  { // F34 · La constancia de una lectura fuera de rango dice la hora como en una frase (K15).
    const p = await abrir(225, 'jefe');
    const nota = () => p.doc.querySelector('.ck-nota[data-idx="0"]').value;
    for (const [hora, valor, frase] of [['01:05', '15', 'a la 01:05'], ['1:05', '16', 'a la 1:05'], ['10:05', '17', 'a las 10:05'], ['13:05', '18', 'a las 13:05']]) {
      p.escribir('.ck-hora[data-idx="0"]', hora);
      p.escribir('.ck-num[data-idx="0"]', valor);
      ok(nota() === `Lectura fuera de rango: ${valor} A (rango normal 8 a 12 A) ${frase}.`, `«${nota()}»`);
    }
    p.w.close();
  }

  // ── F31 · El envío rechazado por permiso abre una sola ventana ──
  { // A15 · La orden pasó a otro técnico: el envío y los guardados que siguen reciben el mismo rechazo.
    const p = await abrir(226, 'tecnico');
    p.marcar(0, 'ok'); p.marcar(1, 'ok');
    p.escribir('#trabajosRealizados', 'Planta en manual; transferencia operada con un segundo técnico y probada.');
    sqlite.prepare('UPDATE ordenes SET asignado_a=8 WHERE id=226').run();
    p.doc.querySelector('[data-transition="completada"]').click();
    const envios = () => p.enviados.filter((e) => e.metodo === 'PATCH');
    await p.hasta(() => envios().length === 3 && envios().every((e) => e.status === 403), 'el envío y los dos guardados que siguen reciben el mismo rechazo');
    await pausa(100);
    ok(p.avisos.length === 1 && /asignada a ti/.test(p.avisos[0]), `Una sola ventana: ${p.avisos.join(' | ')}`);
    p.w.close();
  }

  // ── F33 · Lo que ya se guardó no espera al salir ──
  { // Lo escrito que ya se guardó: el navegador no pregunta al cerrar y la salida no lo vuelve a mandar. Sin señal sí espera.
    const p = await abrir(228, 'tecnico');
    p.escribir('#trabajosRealizados', 'Planta en manual; transferencia operada con un segundo técnico.');
    await p.hasta(() => /Guardado/.test(indicadorTexto(p)), 'lo escrito se guarda solo');
    const cerrar = new p.w.Event('beforeunload', { cancelable: true });
    p.w.dispatchEvent(cerrar);
    ok(!cerrar.defaultPrevented, 'Guardado, el navegador no pregunta al cerrar');
    p.w.dispatchEvent(new p.w.Event('pagehide'));
    await pausa(100);
    ok(p.patches().length === 1 && !p.enviados.some((e) => e.keepalive), `La salida no lo vuelve a mandar: ${JSON.stringify(p.patches())}`);
    p.red.caida = true;
    p.escribir('#trabajosRealizados', 'Planta en manual; transferencia operada con un segundo técnico y probada.');
    await p.hasta(() => /Sin conexión/.test(indicadorTexto(p)), 'sin señal no se guarda');
    const otra = new p.w.Event('beforeunload', { cancelable: true });
    p.w.dispatchEvent(otra);
    ok(otra.defaultPrevented, 'Sin señal, lo escrito espera: el navegador pregunta al cerrar');
    p.red.caida = false;
    p.w.dispatchEvent(new p.w.Event('pagehide'));
    await p.hasta(() => /y probada/.test(trabajosDe(228) ?? ''), 'al salir se manda');
    ok(p.enviados.filter((e) => e.metodo === 'PATCH').at(-1).keepalive, 'Sale con keepalive');
    p.w.close();
  }
  { // Tras el 409 de un paso que cambió, sin nada más por guardar, el navegador no pregunta al cerrar.
    const p = await abrir(229, 'tecnico');
    p.red.caida = true;
    p.marcar(1, 'ok');
    await p.hasta(() => /Sin guardar/.test(p.indicador()), 'sin señal no se guarda');
    await desviacionDelCelular(229, 1);
    p.red.caida = false;
    p.doc.querySelector('[data-transition="completada"]').click();
    await p.hasta(() => p.caja() !== '', 'el envío vuelve con el paso que cambió');
    const cerrar = new p.w.Event('beforeunload', { cancelable: true });
    p.w.dispatchEvent(cerrar);
    ok(!cerrar.defaultPrevented && p.indicador() === '', `Nada más por guardar: el navegador no pregunta al cerrar («${p.indicador()}»)`);
    p.w.close();
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
