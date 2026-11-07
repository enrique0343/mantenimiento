// Authenticated OT routes, actual migrations, isolated SQLite/D1; no network.
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';
const fixture = await setupConjuntos({ modules: {
  verification: 'lib/orden-verificacion', database: 'lib/db', attachment: 'pages/api/adjuntos/[id]',
  prerreq: 'pages/api/ordenes/[id]/prerrequisitos', liber: 'pages/api/ordenes/[id]/liberaciones',
} });
const { app, sqlite, faults, call } = fixture;
const one = (q, ...args) => sqlite.prepare(q).get(...args);
const all = (q, ...args) => sqlite.prepare(q).all(...args);
const patch = (id, data, rol='admin') => call(app.order.PATCH, `/api/ordenes/${id}`, { method:'PATCH', id, data, rol });
const expect = async (promise, status=200) => { const r=await promise; assert.equal(r.status,status,JSON.stringify(r.body)); return r.body; };
const history = id => all('SELECT * FROM orden_verificacion_eventos WHERE orden_id=? ORDER BY id',id);
const order = id => one('SELECT * FROM ordenes WHERE id=?',id);
const pm = () => one('SELECT * FROM planes_mantenimiento WHERE id=1');
const checklist = estado => JSON.stringify([{texto:'Comprobar punto crítico',bloqueante:true,criterio:'Sin fugas',estado,notas:estado==='desviacion'?'Hay una fuga confirmada':undefined}]);
const seed = (id, extra={}) => {
  sqlite.prepare(`INSERT INTO ordenes(creado_por,id,titulo,rubro,tipo,activo_id,plan_id,estado,asignado_a,iniciada_en,trabajos_realizados,checklist_ejecucion) VALUES(1,?,?,'biomedico',?,?,?,?,?,?,?,?)`)
    .run(id,`Prueba ${id}`,extra.tipo??'preventivo',extra.activo??1,extra.planId??null,extra.estado??'en_proceso',extra.asignado??3,'2026-10-01T10:00:00.000Z',extra.trabajos??null,extra.checklist??null);
};
try {
  sqlite.exec(`INSERT INTO activos(id,codigo,nombre,tipo,rubro) VALUES(1,'EQ-TEST','Equipo de prueba','biomedico','biomedico');
    INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha) VALUES(1,1,'PM mensual','mensual','2026-01-01');`);
  seed(1,{planId:1,checklist:checklist('pendiente')});
  const originalPM=JSON.stringify(pm());
  await expect(patch(1,{activoId:null}),409);
  await expect(patch(1,{estado:'completada'},null),401);
  for (const rol of ['visualizador','solicitante','motorista','bodega']) await expect(patch(1,{estado:'completada'},rol),403);
  await expect(patch(1,{estado:'cerrada',verificacionNotas:'Sin verificar ejecución'}),409);
  await expect(patch(1,{estado:'completada'}),400); // no administrative evidence bypass
  await expect(patch(1,{estado:'completada',trabajosRealizados:'Trabajo documentado correctamente'}),400);
  await expect(patch(1,{checklistEjecucion:'[]'},'tecnico'),400);
  await expect(patch(1,{checklistEjecucion:JSON.stringify([{texto:'Comprobar punto crítico',bloqueante:false,estado:'ok'}])},'tecnico'),400);
  await expect(patch(1,{trabajosRealizados:'Se ajustaron conexiones y comprobó ausencia de fugas',checklistEjecucion:checklist('desviacion')},'tecnico'));
  await expect(patch(1,{estado:'completada'},'admin'),400);
  await expect(patch(1,{checklistEjecucion:checklist('ok')},'tecnico'));
  await expect(patch(1,{estado:'completada',horasTrabajadas:999},'tecnico'));
  assert.equal(order(1).estado,'completada'); assert.equal(order(1).cerrado_en,null); assert.equal(order(1).verificado_en,null);
  assert.equal(one('SELECT ejecutado_por FROM orden_verificacion WHERE orden_id=1').ejecutado_por,3);
  assert.notEqual(order(1).horas_trabajadas,999); assert.equal(JSON.stringify(pm()),originalPM);
  await expect(patch(1,{revisorId:3}),400);
  await expect(patch(1,{estado:'verificada',verificacionNotas:'Verifiqué mi propia tarea'},'tecnico'),403);
  await expect(patch(1,{trabajosRealizados:'Modificar evidencia después de completar'},'admin'),409);
  await expect(patch(1,{estado:'verificada'},'jefe'),400);
  await expect(patch(1,{estado:'verificada',verificacionNotas:'Inspección independiente: criterio sin fugas confirmado'},'jefe'));
  assert.equal(order(1).estado,'cerrada'); assert.equal(order(1).verificado_por,2); assert.equal(order(1).cerrado_por,2);
  assert.notEqual(pm().proxima_fecha,'2026-01-01'); assert.equal(pm().frecuencia,'mensual');
  const beforeReopen=history(1); const closeSnapshot=JSON.parse(beforeReopen.at(-1).evidencia_json);
  assert.equal(closeSnapshot.despues.verificadoPor,2);
  await expect(patch(1,{accion:'reabrir',motivo:'La prueba posterior requiere otro ajuste'},'tecnico'),403);
  await expect(patch(1,{accion:'reabrir'},'jefe'),400);
  await expect(patch(1,{accion:'reabrir',motivo:'La prueba posterior requiere otro ajuste'},'jefe'));
  assert.equal(order(1).estado,'en_proceso'); assert.equal(order(1).cerrado_en,null);
  assert.equal(history(1).at(-1).actor_id,2); assert.equal(history(1).at(-1).accion,'reapertura');
  assert.deepEqual(history(1).slice(0,beforeReopen.length),beforeReopen);
  sqlite.exec("UPDATE planes_mantenimiento SET proxima_fecha='2039-12-01' WHERE id=1");
  await expect(patch(1,{estado:'completada'},'tecnico'));
  await expect(patch(1,{estado:'verificada',verificacionNotas:'Segunda comprobación independiente conforme'},'admin'));
  assert.equal(pm().proxima_fecha,'2039-12-01','Reclosing the same OT must never advance the PM twice');
  assert.throws(()=>sqlite.exec("UPDATE orden_verificacion_eventos SET motivo='changed'"),/inmutable/);
  assert.throws(()=>sqlite.exec('DELETE FROM orden_verificacion_eventos'),/inmutable/);
  await expect(call(app.order.DELETE,'/api/ordenes/1',{method:'DELETE',id:1}),409);
  await expect(call(app.bulkOrderDelete.POST,'/api/ordenes/bulk-delete',{method:'POST',data:{ids:[1]}}),409);

  seed(2,{asignado:1,trabajos:'Trabajo del administrador documentado'});
  await expect(patch(2,{estado:'completada'},'admin'));
  await expect(patch(2,{estado:'verificada',verificacionNotas:'Soy admin e intento aprobar mi ejecución'},'admin'),403);
  await expect(patch(2,{estado:'verificada',verificacionNotas:'Revisión independiente del trabajo registrada'},'jefe'));

  seed(3,{asignado:1,trabajos:'Trabajo con revisor designado y suplente'});
  await expect(patch(3,{revisorId:3,revisorSuplenteId:2}));
  await expect(patch(3,{estado:'completada'},'admin'));
  await expect(patch(3,{estado:'verificada',verificacionNotas:'Revisor designado comprueba funcionamiento'},'tecnico'));
  assert.equal(order(3).verificado_por,3);

  seed(4,{trabajos:'Trabajo documentado para devolución'});
  await expect(patch(4,{estado:'completada'},'tecnico'));
  await expect(patch(4,{estado:'en_proceso'},'jefe'),400);
  await expect(patch(4,{accion:'devolver',motivo:'Falta comprobar el aislamiento antes de aceptar'},'jefe'));
  assert.equal(history(4).at(-1).accion,'devolucion');

  seed(5,{trabajos:'Trabajo de prueba atómica',planId:1});
  await expect(patch(5,{estado:'completada'},'tecnico'));
  const untouched=JSON.stringify([order(5),history(5),pm()]);
  faults.statement=sql=>/insert into "orden_verificacion_eventos"/i.test(sql);
  await expect(patch(5,{estado:'verificada',verificacionNotas:'Verificación que fallará de forma atómica'},'jefe'),500);
  assert.equal(JSON.stringify([order(5),history(5),pm()]),untouched);

  seed(6,{trabajos:'Ejecución concurrente sin duplicaciones'});
  faults.beforeBatch=async()=>await expect(patch(6,{estado:'completada'},'tecnico'));
  await expect(patch(6,{estado:'completada'},'tecnico'),409);
  assert.equal(history(6).filter(e=>e.accion==='ejecucion_completada').length,1);

  seed(7,{estado:'cerrada',trabajos:'Registro histórico de cierre sin revisión'});
  const legacy=JSON.stringify(order(7));
  await expect(call(app.order.GET,'/api/ordenes/7',{id:7}));
  assert.equal(JSON.stringify(order(7)),legacy); assert.equal(history(7).length,0);
  await expect(patch(7,{accion:'reabrir',motivo:'Reabrir explícitamente el registro histórico'},'jefe'));
  await expect(patch(7,{estado:'completada'},'tecnico'));
  await expect(patch(7,{estado:'verificada',verificacionNotas:'Revisión documentada sin inventar historial'},'jefe'));
  assert.equal(JSON.parse(history(7)[0].evidencia_json).antes.estado,'cerrada');

  seed(8,{trabajos:'Conservar documentos de soporte'});
  sqlite.exec("INSERT INTO adjuntos(id,orden_id,usuario_id,nombre,content_type,tamano,r2_key,categoria) VALUES(1,8,3,'Prueba.pdf','application/pdf',10,'isolated','documento')");
  await expect(patch(8,{estado:'completada'},'tecnico'));
  await expect(call(app.attachment.DELETE,'/api/adjuntos/1',{method:'DELETE',id:1}),409);
  assert.throws(()=>sqlite.exec('DELETE FROM adjuntos WHERE id=1'),/inmutable/);
  assert.equal(fixture.effects.r2Deletes,0);

  // A deletion between the evidence read and the completion batch must not
  // publish a snapshot pointing to an attachment that has already left R2.
  seed(14,{trabajos:'Evidencia concurrente al envío para verificación',planId:1});
  sqlite.exec("INSERT INTO adjuntos(id,orden_id,usuario_id,nombre,content_type,tamano,r2_key,categoria) VALUES(2,14,3,'Concurrente.pdf','application/pdf',10,'isolated-before-completion','documento')");
  const beforeConcurrentCompletion=JSON.stringify([order(14),history(14),pm()]);
  const beforeConcurrentPM=JSON.stringify(pm());
  let deletedBeforeCompletion=0;
  faults.beforeBatch=async()=>{
    const deletionContext=fixture.ctx('/api/adjuntos/2',{method:'DELETE',id:2,rol:'tecnico'});
    deletionContext.locals.runtime.env.R2.delete=async()=>{deletedBeforeCompletion++;};
    const response=await app.attachment.DELETE(deletionContext);
    assert.equal(response.status,200,await response.text());
  };
  await expect(patch(14,{estado:'completada'},'tecnico'),409);
  assert.equal(deletedBeforeCompletion,1);
  assert.equal(one('SELECT id FROM adjuntos WHERE id=2'),undefined);
  assert.equal(JSON.stringify([order(14),history(14),pm()]),beforeConcurrentCompletion);
  assert.equal(one('SELECT ejecutado_por FROM orden_verificacion WHERE orden_id=14').ejecutado_por,null);
  await expect(patch(14,{estado:'completada'},'tecnico'));
  assert.deepEqual(JSON.parse(history(14).at(-1).evidencia_json).adjuntos,[]);

  // The opposite ordering preserves both the published evidence and its blob:
  // a stale DELETE precheck cannot remove an attachment after completion wins.
  seed(15,{trabajos:'Evidencia conservada cuando la finalización gana',planId:1});
  sqlite.exec("INSERT INTO adjuntos(id,orden_id,usuario_id,nombre,content_type,tamano,r2_key,categoria) VALUES(3,15,3,'Conservada.pdf','application/pdf',10,'isolated-after-completion','documento')");
  faults.beforeStatement={matches:sql=>/^delete from "adjuntos"/i.test(sql),run:async()=>{
    await expect(patch(15,{estado:'completada'},'tecnico'));
  }};
  let deletedAfterCompletion=0;
  const staleDeletionContext=fixture.ctx('/api/adjuntos/3',{method:'DELETE',id:3,rol:'tecnico'});
  staleDeletionContext.locals.runtime.env.R2.delete=async()=>{deletedAfterCompletion++;};
  const staleDeletionResponse=await app.attachment.DELETE(staleDeletionContext);
  assert.equal(staleDeletionResponse.status,409,await staleDeletionResponse.text());
  assert.equal(deletedAfterCompletion,0);
  assert.equal(one('SELECT id FROM adjuntos WHERE id=3').id,3);
  assert.deepEqual(JSON.parse(history(15).at(-1).evidencia_json).adjuntos.map(a=>a.id),[3]);
  assert.equal(order(15).estado,'completada');
  assert.equal(one('SELECT ejecutado_por FROM orden_verificacion WHERE orden_id=15').ejecutado_por,3);
  assert.equal(JSON.stringify(pm()),beforeConcurrentPM);

  seed(9,{trabajos:'Trabajo con espera y reprogramación'});
  await expect(patch(9,{estado:'en_espera'},'jefe'),400);
  await expect(patch(9,{estado:'en_espera',motivo:'Pendiente de repuesto aprobado'},'jefe'));
  await expect(patch(9,{vencimiento:'2026-10-20'},'jefe'),400);
  await expect(patch(9,{vencimiento:'2026-10-20',motivo:'Proveedor confirma entrega el día anterior'},'jefe'));
  assert.equal(history(9).at(-1).accion,'reprogramacion');
  const db = app.database.getDb(fixture.ctx('/'));
  seed(10,{trabajos:'PM ejecutado antes de la verificación',planId:1});
  const orderModel = async id => (await expect(call(app.order.GET,`/api/ordenes/${id}`,{id}))).orden;
  await app.verification.actualizarOrdenConVerificacion(db,await orderModel(10),{id:3,rol:'tecnico',nombre:'Prueba técnico'},{estado:'completada'},'2026-09-03T12:00:00.000Z');
  await app.verification.actualizarOrdenConVerificacion(db,await orderModel(10),{id:2,rol:'jefe',nombre:'Prueba jefe'},{estado:'verificada',verificacionNotas:'Revisión tardía con evidencia de ejecución fechada'},'2026-10-03T12:00:00.000Z');
  assert.equal(pm().proxima_fecha,'2026-10-03','Delayed review must preserve execution-based recurrence');
  seed(11,{tipo:'correctivo',trabajos:'Correctivo menor sin reiniciar los preventivos'});
  await expect(patch(11,{estado:'completada',reprogramarPreventivos:false},'tecnico'));
  await expect(patch(11,{estado:'verificada',verificacionNotas:'Corrección menor verificada sin cambio de ciclo'},'jefe'));
  assert.equal(pm().proxima_fecha,'2026-10-03');
  seed(12,{estado:'completada',trabajos:'Ejecución antigua sin identidad trazable'});
  sqlite.exec("UPDATE ordenes SET completada_en='2026-10-01T12:00:00Z' WHERE id=12");
  await expect(patch(12,{estado:'verificada',verificacionNotas:'No inventar quién ejecutó el trabajo histórico'},'jefe'),409);
  seed(13,{trabajos:'Trabajo que el solicitante devuelve públicamente'});
  await expect(patch(13,{estado:'completada'},'tecnico'));
  await app.verification.devolverOrdenDesdeTicket(db,await orderModel(13),{id:999,solicitanteNombre:'Solicitante de prueba'},'El problema todavía ocurre en una prueba posterior','2026-10-03T12:00:00.000Z');
  assert.equal(order(13).estado,'en_proceso'); assert.equal(history(13).at(-1).actor_id,null);
  assert.match(history(13).at(-1).actor_nombre,/Solicitante externo/);
  await assert.rejects(()=>app.verification.devolverOrdenDesdeTicket(db,order(1),{id:999,solicitanteNombre:'Prueba'},'No reabrir cierres desde un token','2026-10-03T12:00:00.000Z'));

  // La orden conserva de qué parada de ronda nació; el texto sale de la foto del recorrido de ese turno.
  sqlite.exec("INSERT INTO sucursales(id,nombre) VALUES(1,'Sede fuente');");
  const parada=one("SELECT id,ronda_id FROM ronda_puntos ORDER BY id LIMIT 1");
  sqlite.prepare("INSERT INTO ronda_ejecuciones(id,ronda_id,sucursal_id,fecha,turno,estado,recorrido_json) VALUES(1,?,1,'2026-10-01','06:00','en_curso',?)").run(parada.ronda_id,JSON.stringify([{id:parada.id,etiqueta:'Válvula original'}]));
  sqlite.prepare("INSERT INTO ronda_lecturas(ejecucion_id,punto_id,resultado,nota,orden_id,registrado_por,registrado_en) VALUES(1,?,'fuera','Fuga visible',1,3,'2026-10-01T12:10:00Z')").run(parada.id);
  sqlite.prepare("UPDATE ronda_puntos SET etiqueta='Texto de hoy' WHERE id=?").run(parada.id);
  const traced=await expect(call(app.order.GET,'/api/ordenes/1',{id:1}));
  assert.equal(traced.roundsOrigins.length,1);
  assert.equal(traced.roundsOrigins[0].href,'/ronda/1');
  assert.equal(traced.roundsOrigins[0].etiqueta,'Válvula original');
  assert.equal(traced.roundsOrigins[0].sede,'Sede fuente');
  assert.equal(traced.roundsOrigins[0].nota,'Fuga visible');
  assert.equal(traced.scheduledPM.href,'/activos/1#plan-1');
  assert.equal(traced.scheduledPM.frequency,'mensual');
  const unrelated=await expect(call(app.order.GET,'/api/ordenes/2',{id:2}));
  assert.deepEqual(unrelated.roundsOrigins,[]); assert.equal(unrelated.scheduledPM,null);

  // ── La causa raíz la escribe la jefatura dentro de las 72 h: se exige al verificar, no al enviar ──
  sqlite.exec(`INSERT INTO activos(id,codigo,nombre,tipo,rubro,criticidad_operacional) VALUES(2,'EQ-A','Equipo clase A','biomedico','biomedico','alta');
    INSERT INTO usuarios(id,nombre,email,password_hash,rol) VALUES(30,'Otro técnico','otro-tecnico@example.invalid','x','tecnico');`);
  const CAUSA = 'Breaker de 30 A dañado por sobrecarga del circuito de tomas';
  seed(20,{tipo:'emergencia',trabajos:'Planta arrancada en manual y carga transferida'});
  await expect(patch(20,{estado:'completada'},'tecnico'));
  assert.equal(order(20).estado,'completada','El técnico la envía sin causa raíz'); assert.equal(order(20).causa_raiz,null);
  const sinCausa=await expect(patch(20,{estado:'verificada',verificacionNotas:'Revisión del arranque y la transferencia'},'jefe'),400);
  assert.match(sinCausa.error,/La causa raíz la escribe la jefatura dentro de las 72 h/);
  assert.equal(order(20).estado,'completada');
  assert.match((await expect(patch(20,{causaRaiz:'El técnico intenta escribirla después de enviar'},'tecnico'),403)).error,/la escribe la jefatura/);
  await expect(patch(20,{causaRaiz:CAUSA},'jefe'));
  assert.equal(order(20).causa_raiz,CAUSA); assert.equal(order(20).estado,'completada','Escribirla no devuelve la orden');
  assert.equal(history(20).at(-1).accion,'causa_raiz');
  assert.deepEqual(JSON.parse(one('SELECT executores_json e FROM orden_verificacion WHERE orden_id=20').e),[3],'Escribir la causa raíz no vuelve ejecutora a la jefatura');
  await expect(patch(20,{estado:'verificada',verificacionNotas:'Revisión del arranque y la transferencia'},'jefe'));
  assert.equal(order(20).estado,'cerrada'); assert.equal(order(20).verificado_por,2);
  await expect(patch(20,{causaRaiz:`${CAUSA}; lo confirmó el proveedor`},'admin'));
  assert.equal(order(20).estado,'cerrada','Cerrada, la jefatura todavía la completa'); assert.match(order(20).causa_raiz,/proveedor/);
  await expect(patch(20,{causaRaiz:'El técnico intenta cambiarla cerrada'},'tecnico'),403);
  // También en la misma solicitud de la verificación.
  seed(21,{tipo:'emergencia',trabajos:'Reserva de oxígeno en servicio y fuga aislada'});
  await expect(patch(21,{estado:'completada'},'tecnico'));
  await expect(patch(21,{estado:'verificada',verificacionNotas:'Verificación con la prueba de presión',causaRaiz:CAUSA},'jefe'));
  assert.equal(order(21).estado,'cerrada'); assert.equal(order(21).causa_raiz,CAUSA);
  assert.equal(JSON.parse(history(21).at(-1).evidencia_json).despues.causaRaiz,CAUSA,'La evidencia del cierre la incluye');
  // El correctivo sobre un equipo clase A comparte la regla.
  seed(22,{tipo:'correctivo',activo:2,trabajos:'Se cambió la tarjeta de control del equipo'});
  await expect(patch(22,{estado:'completada'},'tecnico'));
  assert.match((await expect(patch(22,{estado:'verificada',verificacionNotas:'Prueba funcional conforme del equipo'},'jefe'),400)).error,/jefatura/);
  await expect(patch(22,{causaRaiz:CAUSA},'jefe'));
  await expect(patch(22,{estado:'verificada',verificacionNotas:'Prueba funcional conforme del equipo'},'jefe'));
  assert.equal(order(22).estado,'cerrada');
  // Un técnico revisor verifica, pero la causa raíz no la escribe él.
  seed(23,{tipo:'emergencia',asignado:1,trabajos:'Trabajo de la jefatura en la emergencia'});
  await expect(patch(23,{revisorId:3}));
  await expect(patch(23,{estado:'completada'},'admin'));
  assert.match((await expect(patch(23,{estado:'verificada',verificacionNotas:'Revisión del técnico designado',causaRaiz:CAUSA},'tecnico'),403)).error,/la escribe la jefatura/);
  assert.match((await expect(patch(23,{estado:'verificada',verificacionNotas:'Revisión del técnico designado'},'tecnico'),400)).error,/jefatura/);
  await expect(patch(23,{causaRaiz:CAUSA},'jefe'));
  await expect(patch(23,{estado:'verificada',verificacionNotas:'Revisión del técnico designado'},'tecnico'));
  assert.equal(order(23).verificado_por,3);

  // ── Intervención: cierre sin lectura y lecturas fuera de rango ──
  const liberacion=(ordenId,valor=null)=>Number(sqlite.prepare("INSERT INTO orden_liberaciones(orden_id,etiqueta,unidad,min_aceptable,max_aceptable,valor_medido,obligatoria) VALUES(?,'Presión de línea','psi',50,55,?,1)").run(ordenId,valor).lastInsertRowid);
  const MOTIVO='Manómetro de la zona dañado; se libera con la prueba de jabón firmada';
  seed(24,{tipo:'intervencion',trabajos:'Válvula de zona reemplazada sin poder medir'});
  liberacion(24);
  await expect(patch(24,{estado:'completada'},'tecnico'),400);
  await expect(patch(24,{estado:'completada',cierreSinLecturaMotivo:MOTIVO},'tecnico'),403);
  await expect(patch(24,{estado:'completada',cierreSinLecturaMotivo:MOTIVO},'jefe'));
  assert.equal(order(24).cierre_sin_lectura_motivo,MOTIVO);
  // La verificación acepta el motivo que ya dejó la jefatura: no lo vuelve a pedir.
  await expect(patch(24,{estado:'verificada',verificacionNotas:'Revisé la prueba de jabón y el reporte firmado'},'admin'));
  assert.equal(order(24).estado,'cerrada'); assert.equal(order(24).cierre_sin_lectura_por,2);
  seed(25,{tipo:'intervencion',trabajos:'Regulador de presión ajustado en la zona'});
  liberacion(25,61);
  assert.match((await expect(patch(25,{estado:'completada'},'tecnico'),400)).error,/fuera de rango/);
  assert.match((await expect(patch(25,{estado:'completada',cierreSinLecturaMotivo:MOTIVO},'jefe'),400)).error,/fuera de rango/,'El cierre sin lectura no salva una lectura fuera de rango');
  await expect(patch(25,{reversaEjecutada:true,reversaNotas:'corto'},'tecnico'),400);
  await expect(patch(25,{reversaEjecutada:true,reversaNotas:'Se regresó el regulador original; quedó la presión de antes.'},'tecnico'));
  await expect(patch(25,{estado:'completada'},'tecnico'));
  assert.equal(order(25).estado,'completada','Con la reversa ejecutada no hay nada que liberar');
  await expect(patch(25,{estado:'verificada',verificacionNotas:'La reversa quedó documentada y probada'},'jefe'));
  // Una unidad escrita al lado del número no esconde la lectura fuera de rango.
  seed(28,{tipo:'intervencion',trabajos:'Regulador de presión ajustado en la zona'});
  const l28=liberacion(28);
  const medida=await expect(call(app.liber.PATCH,'/api/ordenes/28/liberaciones',{method:'PATCH',id:28,data:{itemId:l28,valorMedidoTexto:'61 psi en la toma 3'},rol:'tecnico'}));
  assert.equal(medida.liberacion.conforme,false);
  assert.match((await expect(patch(28,{estado:'completada'},'tecnico'),400)).error,/fuera de rango/);

  // ── Prerrequisitos y liberaciones: solo el técnico asignado o la jefatura ──
  const prerreq=(ordenId,data,rol)=>call(app.prerreq.PATCH,`/api/ordenes/${ordenId}/prerrequisitos`,{method:'PATCH',id:ordenId,data,rol});
  const liber=(ordenId,data,rol)=>call(app.liber.PATCH,`/api/ordenes/${ordenId}/liberaciones`,{method:'PATCH',id:ordenId,data,rol});
  const prerrequisito=(ordenId)=>Number(sqlite.prepare("INSERT INTO orden_prerrequisitos(orden_id,texto,tipo,obligatorio) VALUES(?,'Permiso de trabajo','permiso_trabajo',1)").run(ordenId).lastInsertRowid);
  seed(26,{tipo:'intervencion',estado:'abierta',asignado:30});
  const p26=prerrequisito(26), l26=liberacion(26);
  assert.match((await expect(prerreq(26,{itemId:p26,cumplido:true,referencia:'PT-0100'},'tecnico'),403)).error,/asignada a ti/);
  assert.match((await expect(liber(26,{itemId:l26,valorMedido:52},'tecnico'),403)).error,/asignada a ti/);
  await expect(prerreq(26,{itemId:p26,referencia:'PT-0100'},'tecnico'),403);
  assert.equal(one('SELECT cumplido FROM orden_prerrequisitos WHERE id=?',p26).cumplido,0);
  assert.equal(one('SELECT valor_medido v FROM orden_liberaciones WHERE id=?',l26).v,null);
  await expect(prerreq(26,{itemId:p26,cumplido:true,referencia:'PT-0100'},'jefe'));
  await expect(liber(26,{itemId:l26,valorMedido:52},'jefe'));
  assert.equal(one('SELECT cumplido_por p FROM orden_prerrequisitos WHERE id=?',p26).p,2);
  seed(27,{tipo:'intervencion',estado:'abierta'});
  const p27=prerrequisito(27), l27=liberacion(27);
  await expect(prerreq(27,{itemId:p27,cumplido:true},'tecnico'),400);
  await expect(prerreq(27,{itemId:p27,cumplido:true,referencia:'PT-0101'},'tecnico'));
  assert.equal(one('SELECT cumplido_por p FROM orden_prerrequisitos WHERE id=?',p27).p,3);
  await expect(prerreq(27,{itemId:p27,obligatorio:false},'tecnico'),403);
  await expect(liber(27,{itemId:l27,valorMedido:53},'tecnico'));
  assert.equal(one('SELECT conforme c FROM orden_liberaciones WHERE id=?',l27).c,1);
  await expect(prerreq(26,{itemId:p27,cumplido:true,referencia:'PT-0101'},'jefe'),404);
  for (const rol of ['visualizador','solicitante']) await expect(prerreq(27,{itemId:p27,cumplido:false},rol),403);
  // Enviada a verificación, el técnico ya no cambia la evidencia; la jefatura sí. Cerrada, nadie.
  sqlite.exec("UPDATE ordenes SET estado='completada' WHERE id=27");
  await expect(liber(27,{itemId:l27,valorMedido:54},'tecnico'),409);
  await expect(prerreq(27,{itemId:p27,cumplido:false},'tecnico'),409);
  await expect(liber(27,{itemId:l27,valorMedido:54},'jefe'));
  sqlite.exec("UPDATE ordenes SET estado='cerrada' WHERE id=27");
  await expect(liber(27,{itemId:l27,valorMedido:55},'jefe'),400);

  console.log(`PASS: independent OT verification (${fixture.requests} authenticated requests): execution evidence, independence, reviewer/backup, return/reopen history, pending PM, exactly-once advancement, immutable evidence, concurrency and rollback; root cause by management at review, MOP release rules and assigned-only MOP records. No network.`);
} finally { await fixture.close(); }
