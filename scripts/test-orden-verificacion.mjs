// Authenticated OT routes, actual migrations, isolated SQLite/D1; no network.
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';
const fixture = await setupConjuntos({ modules: { verification: 'lib/orden-verificacion', database: 'lib/db', attachment: 'pages/api/adjuntos/[id]' } });
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
    .run(id,`Prueba ${id}`,extra.tipo??'preventivo',1,extra.planId??null,extra.estado??'en_proceso',extra.asignado??3,'2026-10-01T10:00:00.000Z',extra.trabajos??null,extra.checklist??null);
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

  // Bidirectional origin reads use immutable round configuration, not today's template.
  const frozenConfig=JSON.stringify({points:[{code:'valvula',label:'Válvula original',criterion:'Sin fuga'}]});
  sqlite.exec("INSERT INTO sucursales(id,nombre) VALUES(1,'Sede fuente'); INSERT INTO ubicaciones(id,nombre,sucursal_id) VALUES(1,'Zona original',1); INSERT INTO proveedores(id,nombre) VALUES(1,'Proveedor técnico');");
  sqlite.prepare("INSERT INTO rondas_templates(id,name,config_json,mutation_token,created_by,created_at) VALUES(1,'Plantilla actual','{}','template',1,'2026-10-01')").run();
  sqlite.prepare(`INSERT INTO rondas_executions(id,template_id,template_version,name,site_id,location_id,scheduled_date,shift,due_at,original_due_at,status,owner_id,reviewer_id,snapshot_json,data_json,mutation_token,created_at) VALUES(1,1,1,'Ronda de origen',1,1,'2026-10-01','mañana','2026-10-01T14:00:00Z','2026-10-01T14:00:00Z','validada',3,2,?,'[]','execution','2026-10-01')`).run(frozenConfig);
  sqlite.exec(`INSERT INTO rondas_proposals(id,execution_id,point_id,asset_id,plan_id,kind,reason,executor_type,provider_id,status,dedup_key,assigned_to,order_id,created_by,created_at,mutation_token) VALUES(1,1,'valvula',1,1,'preventivo','PM pendiente detectado durante ronda','provider',1,'aprobada','unique',3,1,1,'2026-10-01','proposal'); INSERT INTO rondas_order_links(execution_id,point_id,order_id,proposal_id) VALUES(1,'valvula',1,1);`);
  const roundBefore=JSON.stringify(one('SELECT * FROM rondas_executions WHERE id=1'));
  const traced=await expect(call(app.order.GET,'/api/ordenes/1',{id:1}));
  assert.equal(traced.roundsOrigins.length,1);
  assert.equal(traced.roundsOrigins[0].href,'/rondas?execution=1');
  assert.equal(traced.roundsOrigins[0].pointLabel,'Válvula original');
  assert.equal(traced.roundsOrigins[0].proposalId,1);
  assert.equal(traced.roundsOrigins[0].zoneName,'Zona original');
  assert.equal(traced.roundsOrigins[0].providerName,'Proveedor técnico');
  assert.equal(traced.roundsOrigins[0].coordinatorName,'Prueba tecnico');
  assert.equal(traced.roundsOrigins[0].snapshotJson,undefined);
  assert.equal(traced.scheduledPM.href,'/activos/1#plan-1');
  assert.equal(traced.scheduledPM.frequency,'mensual');
  assert.equal(JSON.stringify(one('SELECT * FROM rondas_executions WHERE id=1')),roundBefore);
  const unrelated=await expect(call(app.order.GET,'/api/ordenes/2',{id:2}));
  assert.deepEqual(unrelated.roundsOrigins,[]); assert.equal(unrelated.scheduledPM,null);

  console.log(`PASS: independent OT verification (${fixture.requests} authenticated requests): execution evidence, independence, reviewer/backup, return/reopen history, pending PM, exactly-once advancement, immutable evidence, concurrency and rollback. No network.`);
} finally { await fixture.close(); }
