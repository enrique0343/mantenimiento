// Authenticated OT routes, actual migrations, isolated SQLite/D1; no network.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';
import { fijarReloj } from './test-support/reloj.mjs';
fijarReloj();
// mop.ts con un logAudit que anota el resumen que recibe: así se lee lo que queda en el historial.
async function mopConHistorial(resumenes) {
  const carpeta=await fs.mkdtemp(path.join(os.tmpdir(),'mantenimiento-historial-'));
  const salida=path.join(carpeta,'mop.mjs');
  globalThis.__resumenesHistorial=resumenes;
  await build({ stdin:{ contents:"export * as mop from './src/lib/mop'; export * as database from './src/lib/db';", resolveDir:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), loader:'ts' },
    outfile:salida, bundle:true, platform:'node', format:'esm', logLevel:'silent',
    plugins:[{ name:'historial', setup(b) {
      b.onResolve({ filter:/^@\/lib\/audit$/ },()=>({ path:'audit', namespace:'historial' }));
      b.onLoad({ filter:/.*/, namespace:'historial' },()=>({ contents:'export const logAudit=async(_ctx,args)=>{ globalThis.__resumenesHistorial.push(args.resumen); };', loader:'js' }));
    } }] });
  try { return await import(pathToFileURL(salida).href); } finally { await fs.rm(carpeta,{ recursive:true, force:true }); }
}
const fixture = await setupConjuntos({ modules: {
  verification: 'lib/orden-verificacion', database: 'lib/db', attachment: 'pages/api/adjuntos/[id]',
  prerreq: 'pages/api/ordenes/[id]/prerrequisitos', liber: 'pages/api/ordenes/[id]/liberaciones',
  sync: 'pages/api/campo/sync', reporte: 'lib/reporte-mantenimiento', mop: 'lib/mop', ordenes: 'lib/ordenes',
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

  const sync=(ops,rol='tecnico')=>expect(call(app.sync.POST,'/api/campo/sync',{method:'POST',data:{ops},rol}));

  // ── La causa raíz solo la escribe la jefatura, en cualquier estado ──
  const SOLO_JEFATURA=/^La causa raíz la escribe la jefatura dentro de las 72 h\.$/;
  seed(40,{tipo:'emergencia'});
  await expect(patch(40,{causaRaiz:CAUSA},'jefe'));
  // La pestaña vieja guarda lo del técnico con «causaRaiz: valor || null»: se guardan los
  // trabajos y la causa de la jefatura queda intacta.
  await expect(patch(40,{trabajosRealizados:'Rearmé el breaker del ATS y verifiqué tensión.',causaRaiz:null,solucionAplicada:null},'tecnico'));
  assert.equal(order(40).causa_raiz,CAUSA,'La causa de la jefatura queda intacta');
  assert.equal(order(40).trabajos_realizados,'Rearmé el breaker del ATS y verifiqué tensión.','Los trabajos de la pestaña vieja se guardan');
  // Si escribió otra causa, lo que vio queda en los trabajos, como con un celular viejo, y una sola vez.
  await expect(patch(40,{trabajosRealizados:'Rearmé el breaker del ATS y verifiqué tensión.',causaRaiz:' Se fue la luz '},'tecnico'));
  const conCausa40='Rearmé el breaker del ATS y verifiqué tensión. Causa probable según el técnico: Se fue la luz';
  assert.equal(order(40).trabajos_realizados,conCausa40); assert.equal(order(40).causa_raiz,CAUSA);
  const eventosCausa40=history(40).length;
  await expect(patch(40,{trabajosRealizados:conCausa40,causaRaiz:'Se fue la luz'},'tecnico'));
  assert.equal(order(40).trabajos_realizados,conCausa40,'Si ya está, no se repite'); assert.equal(history(40).length,eventosCausa40,'Ni deja evento');
  // Sola, la causa sigue siendo de la jefatura.
  assert.match((await expect(patch(40,{causaRaiz:'Se fue la luz, nada más que revisar.'},'tecnico'),403)).error,SOLO_JEFATURA);
  sqlite.exec("UPDATE ordenes SET estado='en_espera' WHERE id=40");
  assert.match((await expect(patch(40,{causaRaiz:''},'tecnico'),403)).error,SOLO_JEFATURA);
  sqlite.exec("UPDATE ordenes SET estado='en_proceso' WHERE id=40");
  await expect(patch(40,{causaRaiz:'Otra causa escrita por quien no es jefatura'},'visualizador'),403);
  assert.equal(order(40).causa_raiz,CAUSA);
  // Igual a la guardada (con espacios de más) no es un cambio: se ignora sin error.
  const eventos40=history(40).length;
  await expect(patch(40,{trabajosRealizados:'Rearmé el breaker del ATS, verifiqué tensión y dejé la planta en automático.',causaRaiz:` ${CAUSA} `},'tecnico'));
  assert.equal(order(40).causa_raiz,CAUSA); assert.match(order(40).trabajos_realizados,/automático/);
  assert.equal((await expect(patch(40,{causaRaiz:CAUSA},'tecnico'))).orden.causaRaiz,CAUSA);
  // Tampoco la de la jefatura: guardar la misma causa no escribe ni deja evento.
  await expect(patch(40,{causaRaiz:`  ${CAUSA}  `},'jefe'));
  assert.equal(history(40).length,eventos40+1,'Solo el guardado de los trabajos deja evento');
  seed(41,{tipo:'emergencia'});
  await expect(patch(41,{causaRaiz:''},'tecnico'));
  await expect(patch(41,{causaRaiz:null},'tecnico'));
  await expect(patch(41,{causaRaiz:'   '},'jefe'));
  assert.equal(order(41).causa_raiz,null,'null y vacío son lo mismo');
  assert.equal(history(41).length,0,'Vacío sobre vacío no es un cambio, tampoco de la jefatura');

  // ── Horas de la emergencia: el técnico fija una vacía con la hora de la operación; lo demás, la jefatura ──
  const SOLO_JEFATURA_HORAS=/^Las horas de la emergencia las corrige la jefatura\.$/;
  const ALARMA='2026-10-01T09:00:27.123Z', VENCE='2026-10-04T09:00:27.123Z', LLEGADA='2026-10-01T09:20:00.000Z';
  const TECNICO={id:3,rol:'tecnico',nombre:'Prueba tecnico'};
  const HORAS_RECHAZO={status:403,message:'Las horas de la emergencia las corrige la jefatura.'};
  seed(42,{tipo:'emergencia'});
  sqlite.prepare('UPDATE ordenes SET hora_alarma=?,causa_raiz_vencimiento=? WHERE id=42').run(ALARMA,VENCE);
  // Por la ficha, una hora vacía no se fija con cualquier valor: ni una llegada un minuto
  // después de la alarma, ni una de antes de la alarma, ni un texto.
  for (const horaLlegada of ['2026-10-01T09:01:27.123Z','2026-10-01T01:00:00.000Z','ayer en la tarde']) {
    assert.match((await expect(patch(42,{horaLlegada},'tecnico'),403)).error,SOLO_JEFATURA_HORAS,horaLlegada);
  }
  assert.equal(order(42).hora_llegada,null,'La hora sigue vacía');
  // Solo con la hora de la operación, al minuto: la del toque ya validada o la del servidor.
  await assert.rejects(async()=>app.verification.actualizarOrdenConVerificacion(db,await orderModel(42),TECNICO,{horaLlegada:LLEGADA},'2026-10-01T09:21:00.000Z'),HORAS_RECHAZO);
  assert.equal(order(42).hora_llegada,null);
  await app.verification.actualizarOrdenConVerificacion(db,await orderModel(42),TECNICO,{horaLlegada:LLEGADA},'2026-10-01T09:20:41.000Z');
  assert.equal(order(42).hora_llegada,LLEGADA,'El técnico fija una hora vacía con la hora de la operación');
  assert.match((await expect(patch(42,{horaLlegada:'2026-10-01T09:05:00.000Z'},'tecnico'),403)).error,SOLO_JEFATURA_HORAS);
  assert.match((await expect(patch(42,{horaLlegada:null},'tecnico'),403)).error,SOLO_JEFATURA_HORAS,'Tampoco la borra');
  assert.match((await expect(patch(42,{horaAlarma:'2026-10-01T08:00:00.000Z'},'tecnico'),403)).error,SOLO_JEFATURA_HORAS);
  assert.equal(order(42).hora_llegada,LLEGADA); assert.equal(order(42).hora_alarma,ALARMA);
  assert.equal(order(42).causa_raiz_vencimiento,VENCE,'El plazo de la causa raíz no se mueve');
  seed(43,{tipo:'emergencia'});
  await expect(patch(43,{horaAlarma:'2026-10-01T08:00:00.000Z'},'tecnico'),403);
  await assert.rejects(async()=>app.verification.actualizarOrdenConVerificacion(db,await orderModel(43),TECNICO,{horaAlarma:'2026-10-01T08:00:00.000Z'},'2026-10-01T08:00:00.000Z'),HORAS_RECHAZO);
  assert.equal(order(43).hora_alarma,null,'Una alarma vacía tampoco la fija el técnico, ni con la hora de la operación');
  seed(49,{tipo:'emergencia',estado:'completada',trabajos:'Planta arrancada en manual y carga transferida'});
  assert.match((await expect(patch(49,{horaRestablecimiento:'2026-10-01T11:00:00.000Z'},'tecnico'),403)).error,SOLO_JEFATURA_HORAS);
  await assert.rejects(async()=>app.verification.actualizarOrdenConVerificacion(db,await orderModel(49),TECNICO,{horaRestablecimiento:'2026-10-01T11:00:00.000Z'},'2026-10-01T11:00:00.000Z'),HORAS_RECHAZO);
  assert.equal(order(49).hora_restablecimiento,null,'Enviada, una hora vacía también la registra la jefatura');
  // La pestaña vieja reenvía las cuatro horas como las muestra (al minuto, con su zona): no es un cambio.
  await expect(patch(42,{horaAlarma:'2026-10-01T03:00:00-06:00',horaLlegada:'2026-10-01T03:20:00-06:00',horaMitigacion:null,horaRestablecimiento:null},'tecnico'));
  assert.equal(order(42).hora_alarma,ALARMA); assert.equal(order(42).causa_raiz_vencimiento,VENCE);
  // El celular fija la hora vacía por su propio camino.
  const hito=await sync([{opId:'reglas-hito-42',tipo:'emergencia.hito',ordenId:42,hito:'mitigacion'}]);
  assert.equal(hito.resultados[0].ok,true,JSON.stringify(hito)); assert.ok(order(42).hora_mitigacion);
  // Capturado sin señal, el toque guarda la hora en que se tocó, no la de la señal.
  seed(50,{tipo:'emergencia'});
  const alarma50=new Date(Date.now()-2*3_600_000).toISOString(), tocado50=new Date(Date.now()-30*60_000).toISOString();
  sqlite.prepare('UPDATE ordenes SET hora_alarma=? WHERE id=50').run(alarma50);
  const hito50=await sync([{opId:'reglas-hito-50',tipo:'emergencia.hito',ordenId:50,hito:'llegada',at:tocado50}]);
  assert.equal(hito50.resultados[0].ok,true,JSON.stringify(hito50));
  assert.equal(order(50).hora_llegada,tocado50,'La llegada es la del toque sin señal');
  // La jefatura corrige hacia atrás y el plazo corre desde la alarma nueva.
  await expect(patch(42,{horaAlarma:'2026-10-01T08:55:00.000Z',horaLlegada:'2026-10-01T09:10:00.000Z'},'jefe'));
  assert.equal(order(42).hora_alarma,'2026-10-01T08:55:00.000Z'); assert.equal(order(42).hora_llegada,'2026-10-01T09:10:00.000Z');
  assert.equal(order(42).causa_raiz_vencimiento,'2026-10-04T08:55:00.000Z');

  // ── Enviada o cerrada, la causa raíz no queda vacía ni corta; en proceso, la jefatura guarda un borrador ──
  const causa20=order(20).causa_raiz;
  for (const causaRaiz of ['',null,'x','   breve   ']) assert.match((await expect(patch(20,{causaRaiz},'jefe'),400)).error,/al menos 20 caracteres/);
  assert.equal(order(20).causa_raiz,causa20,'La causa de la emergencia cerrada queda intacta');
  seed(44,{tipo:'emergencia',estado:'completada',trabajos:'Planta arrancada en manual y carga transferida'});
  await expect(patch(44,{causaRaiz:'Breaker'},'admin'),400);
  await expect(patch(44,{causaRaiz:CAUSA},'admin'));
  seed(45,{tipo:'emergencia'});
  await expect(patch(45,{causaRaiz:'Breaker'},'jefe')); assert.equal(order(45).causa_raiz,'Breaker');
  await expect(patch(45,{causaRaiz:null},'jefe')); assert.equal(order(45).causa_raiz,null);
  await expect(patch(2,{causaRaiz:'Nota breve'},'jefe')); // un preventivo cerrado no exige causa raíz
  // El reporte cuenta cuándo se registró.
  const rep20=await app.reporte.reporteDeOrden(db,20);
  assert.ok(rep20.historial.some(h=>h.titulo==='Causa raíz registrada'),JSON.stringify(rep20.historial.map(h=>h.titulo)));

  // ── Una lectura de liberación con rango lleva número ──
  const SIN_NUMERO='Esta lectura tiene rango: anota el número que marcó el instrumento (por ejemplo 14,5).';
  seed(46,{tipo:'intervencion',trabajos:'Regulador de presión ajustado en la zona'});
  const l46=liberacion(46);
  for (const valorMedidoTexto of ['aprox 52 psi','Arrancó bien','≈ 52 psi']) assert.equal((await expect(liber(46,{itemId:l46,valorMedidoTexto},'tecnico'),400)).error,SIN_NUMERO);
  await expect(liber(46,{itemId:l46,valorMedido:null,valorMedidoTexto:'Sin manómetro'},'jefe'),400);
  assert.deepEqual({...one('SELECT valor_medido_texto t, medido_por p, conforme c FROM orden_liberaciones WHERE id=?',l46)},{t:null,p:null,c:null},'La lectura rechazada no se guarda');
  const libSync=await sync([{opId:'reglas-lib-46',tipo:'mop.liberacion',ordenId:46,liberacionId:l46,valor:'aprox 52 psi'}]);
  assert.equal(libSync.resultados[0].ok,false); assert.equal(libSync.resultados[0].error,SIN_NUMERO);
  assert.equal((await expect(liber(46,{itemId:l46,valorMedidoTexto:'52 psi en la toma 3'},'tecnico'))).liberacion.conforme,true,'Con el número al inicio se juzga');
  // Una lectura vieja con rango y sin número cuenta como no medida: no se envía.
  seed(47,{tipo:'intervencion',trabajos:'Válvula de zona reemplazada y probada'});
  sqlite.prepare("INSERT INTO orden_liberaciones(orden_id,etiqueta,unidad,min_aceptable,max_aceptable,valor_medido_texto,obligatoria) VALUES(47,'Presión de línea','psi',50,55,'aprox 52 psi',1)").run();
  const noMedida=(await expect(patch(47,{estado:'completada'},'tecnico'),400)).error;
  assert.match(noMedida,/Falta 1 lectura de liberación obligatoria/); assert.match(noMedida,/«aprox 52 psi» no trae número/);
  assert.equal(order(47).estado,'en_proceso');
  // Con la reversa ejecutada se envía: no hay nada que liberar.
  await expect(patch(47,{reversaEjecutada:true,reversaNotas:'Se regresó la válvula original; el sistema quedó como antes.'},'tecnico'));
  await expect(patch(47,{estado:'completada'},'tecnico'));

  // ── La ficha guarda con su base: lo que el técnico marcó en el celular se conserva ──
  seed(48,{checklist:JSON.stringify([{texto:'Revisar tablero',estado:'pendiente'},{texto:'Limpiar contactos',estado:'pendiente'},{texto:'Medir tensión',estado:'pendiente',requiereValor:true,unidad:'V'}])});
  const base48=order(48).checklist_ejecucion;
  const paso=await sync([{opId:'reglas-paso-48',tipo:'orden.paso',ordenId:48,idx:0,texto:'Revisar tablero',estado:'ok'}]);
  assert.equal(paso.resultados[0].ok,true,JSON.stringify(paso));
  // La ficha abrió antes del toque, rellena las claves al cargar y marca el paso 3.
  const comoFicha=it=>({texto:it.texto,estado:it.estado,notas:it.notas??'',criterio:it.criterio??null,bloqueante:it.bloqueante===true,minutos:it.minutos??null,materiales:it.materiales??null,valorMedido:it.valorMedido??'',requiereValor:it.requiereValor===true,unidad:it.unidad??null,esperadoMin:it.esperadoMin??null,esperadoMax:it.esperadoMax??null,variableId:it.variableId??null,hora:it.hora??'',iniciales:it.iniciales??''});
  const enFicha=JSON.parse(base48).map(comoFicha);
  enFicha[2]={...enFicha[2],estado:'ok',valorMedido:'121'};
  const guardada48=await expect(patch(48,{checklistEjecucion:JSON.stringify(enFicha),checklistBase:base48},'jefe'));
  const fusion48=JSON.parse(order(48).checklist_ejecucion);
  assert.deepEqual(fusion48.map(p=>p.estado),['ok','pendiente','ok'],'Quedan el paso del celular y el de la ficha');
  assert.ok(fusion48[0].hora && fusion48[0].iniciales,'El paso 1 conserva la firma del celular');
  assert.equal(fusion48[2].valorMedido,'121');
  assert.deepEqual(JSON.parse(guardada48.orden.checklistEjecucion),fusion48,'La respuesta trae el checklist fusionado');
  // Base, nuevo y guardado de largos distintos: 409 y nada cambia.
  const actual48=order(48).checklist_ejecucion;
  assert.equal((await expect(patch(48,{checklistEjecucion:JSON.stringify(enFicha.slice(0,2)),checklistBase:JSON.stringify(JSON.parse(base48).slice(0,2))},'jefe'),409)).error,'El checklist cambió mientras lo editabas. Vuelve a cargar la ficha.');
  assert.equal(order(48).checklist_ejecucion,actual48);
  // Las reglas de siempre se aplican a lo fusionado.
  const otroTexto=JSON.parse(actual48); otroTexto[1]={...otroTexto[1],texto:'Otro paso'};
  assert.match((await expect(patch(48,{checklistEjecucion:JSON.stringify(otroTexto),checklistBase:actual48},'jefe'),400)).error,/No se pueden eliminar puntos/);
  // Sin puntos cambiados frente a su base no se escribe nada.
  const eventos48=history(48).length;
  await expect(patch(48,{checklistEjecucion:actual48,checklistBase:actual48},'jefe'));
  assert.equal(history(48).length,eventos48);
  // Si el checklist cambia entre la lectura y la escritura, lo de en medio no se pisa.
  const marcaFicha=JSON.parse(actual48); marcaFicha[1]={...marcaFicha[1],estado:'na',notas:'No aplica en este tablero'};
  faults.beforeBatch=async()=>{ const l=JSON.parse(order(48).checklist_ejecucion); l[1]={...l[1],estado:'desviacion'}; sqlite.prepare('UPDATE ordenes SET checklist_ejecucion=? WHERE id=48').run(JSON.stringify(l)); };
  await expect(patch(48,{checklistEjecucion:JSON.stringify(marcaFicha),checklistBase:actual48},'jefe'),409);
  assert.equal(JSON.parse(order(48).checklist_ejecucion)[1].estado,'desviacion');

  // ── El mismo punto cambió en la ficha y en el celular, en una misma clave (K11): no se pisa ──
  const PASOS51=[{texto:'Medir la corriente de fase',estado:'pendiente',requiereValor:true,unidad:'A',esperadoMin:8,esperadoMax:12},{texto:'Revisar tablero',estado:'pendiente'}];
  seed(51,{tipo:'intervencion',checklist:JSON.stringify(PASOS51)});
  const base51=order(51).checklist_ejecucion;
  assert.equal((await sync([{opId:'reglas-paso-51',tipo:'orden.paso',ordenId:51,idx:0,texto:PASOS51[0].texto,estado:'ok',valor:'10,4'}])).resultados[0].ok,true);
  const celular51=JSON.parse(order(51).checklist_ejecucion)[0];
  // N/A desde una base vieja sobre el «ok» del celular choca: el paso del celular queda entero y lo demás se aplica.
  const ficha51=JSON.parse(base51).map(comoFicha);
  ficha51[0]={...ficha51[0],estado:'na',notas:'Se midió en el tablero de respaldo',hora:'10:31',iniciales:'J.P.'};
  ficha51[1]={...ficha51[1],estado:'ok'};
  const choque51=await expect(patch(51,{checklistEjecucion:JSON.stringify(ficha51),checklistBase:base51},'jefe'));
  assert.deepEqual(choque51.pasosSinAplicar,[0],'El índice del paso que chocó');
  assert.deepEqual(JSON.parse(order(51).checklist_ejecucion)[0],celular51,'El «ok» y la lectura del celular quedan enteros');
  assert.equal(JSON.parse(order(51).checklist_ejecucion)[1].estado,'ok','El otro paso se aplica');
  // Con la base al día, N/A se aplica y la lectura queda.
  const base51b=order(51).checklist_ejecucion, ficha51b=JSON.parse(base51b).map(comoFicha);
  ficha51b[0]={...ficha51b[0],estado:'na',notas:'Se midió en el tablero de respaldo',hora:'10:31',iniciales:'J.P.'};
  assert.equal((await expect(patch(51,{checklistEjecucion:JSON.stringify(ficha51b),checklistBase:base51b},'jefe'))).pasosSinAplicar,undefined);
  const fusion51=JSON.parse(order(51).checklist_ejecucion)[0];
  assert.deepEqual([fusion51.estado,fusion51.notas,fusion51.hora,fusion51.iniciales],['na','Se midió en el tablero de respaldo','10:31','J.P.']);
  assert.equal(fusion51.valorMedido,celular51.valorMedido,'La lectura del celular se conserva'); assert.equal(Number(fusion51.valorMedido),10.4);
  // Claves distintas en cada lado se fusionan: la ficha solo cambió la nota del paso que el celular marcó, y el paso sigue marcado.
  seed(52,{checklist:JSON.stringify([{texto:'Revisar tablero',estado:'pendiente'},{texto:'Limpiar contactos',estado:'pendiente'}])});
  const base52=order(52).checklist_ejecucion;
  await sync([{opId:'reglas-paso-52',tipo:'orden.paso',ordenId:52,idx:0,texto:'Revisar tablero',estado:'ok'}]);
  const ficha52=JSON.parse(base52); ficha52[0].notas='Revisar también el neutro';
  assert.equal((await expect(patch(52,{checklistEjecucion:JSON.stringify(ficha52),checklistBase:base52},'jefe'))).pasosSinAplicar,undefined,'Sin choque');
  const fusion52=JSON.parse(order(52).checklist_ejecucion)[0];
  assert.equal(fusion52.estado,'ok'); assert.equal(fusion52.notas,'Revisar también el neutro'); assert.ok(fusion52.hora && fusion52.iniciales,'Con la firma del celular');

  // ── Sin base (pestaña vieja), un paso ya marcado no vuelve a pendiente ──
  const PASOS53=[{texto:'Revisar tablero',estado:'pendiente'},{texto:'Limpiar contactos',estado:'pendiente'},{texto:'Medir tensión',estado:'pendiente',requiereValor:true,unidad:'V'}];
  seed(53,{checklist:JSON.stringify(PASOS53)});
  const vieja53=JSON.parse(order(53).checklist_ejecucion);
  const pasos53=await sync([
    {opId:'reglas-paso-53a',tipo:'orden.paso',ordenId:53,idx:0,texto:'Revisar tablero',estado:'ok'},
    {opId:'reglas-paso-53b',tipo:'orden.paso',ordenId:53,idx:1,texto:'Limpiar contactos',estado:'desviacion',nota:'Contacto quemado'},
  ]);
  assert.ok(pasos53.resultados.every(r=>r.ok),JSON.stringify(pasos53));
  vieja53[2]={...vieja53[2],estado:'ok',valorMedido:'121'};
  await expect(patch(53,{checklistEjecucion:JSON.stringify(vieja53)},'jefe'));
  const lista53=JSON.parse(order(53).checklist_ejecucion);
  assert.deepEqual(lista53.map(p=>p.estado),['ok','desviacion','ok'],'Quedan los dos pasos del celular y el de la ficha');
  assert.equal(lista53[1].notas,'Contacto quemado'); assert.ok(lista53[0].hora && lista53[0].iniciales);
  const fin53=await sync([{opId:'reglas-fin-53',tipo:'orden.terminar',ordenId:53,nota:'Contactos limpiados y tensión medida.'}]);
  assert.equal(fin53.resultados[0].ok,true,JSON.stringify(fin53)); assert.equal(order(53).estado,'completada');
  // Lo que la pestaña vieja marca de verdad (no pendiente) entra como hoy.
  seed(54,{checklist:JSON.stringify(PASOS53)});
  const vieja54=JSON.parse(order(54).checklist_ejecucion);
  await sync([{opId:'reglas-paso-54',tipo:'orden.paso',ordenId:54,idx:0,texto:'Revisar tablero',estado:'ok'}]);
  vieja54[0]={...vieja54[0],estado:'na',notas:'No aplica en este tablero'};
  assert.equal((await expect(patch(54,{checklistEjecucion:JSON.stringify(vieja54)},'jefe'))).pasosSinAplicar,undefined,'Sin base no hay choque');
  assert.equal(JSON.parse(order(54).checklist_ejecucion)[0].estado,'na');
  // Solo pendientes viejos sobre pasos ya marcados: no hay nada que escribir.
  seed(59,{checklist:JSON.stringify(PASOS53)});
  const vieja59=order(59).checklist_ejecucion;
  await sync([{opId:'reglas-paso-59',tipo:'orden.paso',ordenId:59,idx:0,texto:'Revisar tablero',estado:'ok'}]);
  const eventos59=history(59).length, marcado59=order(59).checklist_ejecucion;
  await expect(patch(59,{checklistEjecucion:vieja59},'tecnico'));
  assert.equal(order(59).checklist_ejecucion,marcado59); assert.equal(history(59).length,eventos59,'Sin cambios no deja evento');

  // ── Un número escrito a mano con separador de miles no se adivina (numero.ts) ──
  const AMBIGUO='¿1200 o 1,2? Escribe el número sin separador de miles.';
  const AMBIGUO_ESPACIO='Escribe el número sin separador de miles: 1200.';
  // El valor de un paso: ni por la ficha ni por el celular.
  seed(55,{checklist:JSON.stringify([{texto:'Medir CO2 de la sala',estado:'pendiente',requiereValor:true,unidad:'ppm',esperadoMax:1000},{texto:'Anotar la hora',estado:'pendiente'}])});
  const base55=order(55).checklist_ejecucion;
  const paso55=JSON.parse(base55); paso55[0]={...paso55[0],estado:'ok',valorMedido:'1,200'};
  assert.equal((await expect(patch(55,{checklistEjecucion:JSON.stringify(paso55),checklistBase:base55},'tecnico'),400)).error,AMBIGUO);
  assert.equal(order(55).checklist_ejecucion,base55,'El valor ambiguo no se guarda');
  const sync55=await sync([{opId:'reglas-paso-55',tipo:'orden.paso',ordenId:55,idx:0,texto:'Medir CO2 de la sala',estado:'ok',valor:'1,200'}]);
  assert.equal(sync55.resultados[0].ok,false); assert.equal(sync55.resultados[0].error,AMBIGUO);
  assert.equal(order(55).checklist_ejecucion,base55);
  paso55[0].valorMedido=1200;
  await expect(patch(55,{checklistEjecucion:JSON.stringify(paso55),checklistBase:base55},'tecnico'));
  assert.equal(JSON.parse(order(55).checklist_ejecucion)[0].valorMedido,1200,'Un número que llega como número entra tal cual');
  assert.equal(app.ordenes.evaluarValorChecklist({texto:'CO2',estado:'ok',valorMedido:'1,200',esperadoMax:1000}).dentro,null,'«1,200» no se juzga en rango');
  assert.equal(app.ordenes.evaluarValorChecklist({texto:'CO2',estado:'ok',valorMedido:'1200',esperadoMax:1000}).dentro,false);
  assert.equal(app.ordenes.evaluarValorChecklist({texto:'Corriente',estado:'ok',valorMedido:'10,4',esperadoMin:8,esperadoMax:12}).numero,10.4);
  // Un valor viejo que no cambia no impide guardar lo demás.
  seed(56,{checklist:JSON.stringify([{texto:'Medir CO2 de la sala',estado:'ok',valorMedido:'1.200',hora:'09:00',iniciales:'P.T.'},{texto:'Anotar la hora',estado:'pendiente'}])});
  const base56=order(56).checklist_ejecucion; const paso56=JSON.parse(base56); paso56[1].estado='ok';
  await expect(patch(56,{checklistEjecucion:JSON.stringify(paso56),checklistBase:base56},'tecnico'));
  // La lectura de liberación con máximo 1000 ppm: ni por la ficha ni por el celular queda conforme.
  seed(57,{tipo:'intervencion',trabajos:'Cambio del filtro HEPA de la manejadora del quirófano 2.'});
  const co2=Number(sqlite.prepare("INSERT INTO orden_liberaciones(orden_id,etiqueta,unidad,min_aceptable,max_aceptable,obligatoria) VALUES(57,'CO2 en el quirófano','ppm',NULL,1000,1)").run().lastInsertRowid);
  const lectura57=()=>({...one('SELECT valor_medido v, valor_medido_texto t, conforme c, medido_por p FROM orden_liberaciones WHERE id=?',co2)});
  for (const [valorMedidoTexto,mensaje] of [['1,200',AMBIGUO],['1.200',AMBIGUO],['1 200 ppm',AMBIGUO_ESPACIO],['1,200 ppm',AMBIGUO]]) {
    assert.equal((await expect(liber(57,{itemId:co2,valorMedido:null,valorMedidoTexto},'tecnico'),400)).error,mensaje,valorMedidoTexto);
  }
  for (const [valor,mensaje] of [['1,200',AMBIGUO],['1.200',AMBIGUO],['1 200 ppm',AMBIGUO_ESPACIO]]) {
    const r=await sync([{opId:`reglas-co2-${valor}`,tipo:'mop.liberacion',ordenId:57,liberacionId:co2,valor}]);
    assert.equal(r.resultados[0].ok,false,valor); assert.equal(r.resultados[0].error,mensaje,valor);
  }
  assert.deepEqual(lectura57(),{v:null,t:null,c:null,p:null},'Nada ambiguo se guarda ni queda conforme');
  assert.equal((await sync([{opId:'reglas-co2-numero',tipo:'mop.liberacion',ordenId:57,liberacionId:co2,valor:1200}])).resultados[0].datos.conforme,false,'1200 que llega como número se juzga: fuera');
  assert.equal((await expect(liber(57,{itemId:co2,valorMedido:900},'tecnico'))).liberacion.conforme,true);
  // «14,5 A» sigue siendo 14,5.
  const corriente57=Number(sqlite.prepare("INSERT INTO orden_liberaciones(orden_id,etiqueta,unidad,min_aceptable,max_aceptable,obligatoria) VALUES(57,'Corriente de fase','A',10,20,1)").run().lastInsertRowid);
  assert.equal((await expect(liber(57,{itemId:corriente57,valorMedido:null,valorMedidoTexto:'14,5 A'},'tecnico'))).liberacion.conforme,true);
  assert.equal((await sync([{opId:'reglas-corriente-57',tipo:'mop.liberacion',ordenId:57,liberacionId:corriente57,valor:'14,5 A'}])).resultados[0].datos.conforme,true);
  assert.equal(app.ordenes.numeroDeLectura(null,'14,5 A'),14.5); assert.equal(app.ordenes.numeroDeLectura(null,'1,200 ppm'),null); assert.equal(app.ordenes.numeroDeLectura(61,'1,200'),61);
  assert.deepEqual(app.mop.lecturaEscrita('1,200'),{valorMedido:null,valorMedidoTexto:'1,200'});
  assert.deepEqual(app.mop.lecturaEscrita('14,5'),{valorMedido:14.5,valorMedidoTexto:null});
  assert.deepEqual(app.mop.lecturaEscrita(12),{valorMedido:12,valorMedidoTexto:null});
  assert.deepEqual(app.mop.lecturaEscrita('  '),{valorMedido:null,valorMedidoTexto:null});
  // Sin rango, lo escrito se guarda como texto.
  const fugas57=Number(sqlite.prepare("INSERT INTO orden_liberaciones(orden_id,etiqueta,obligatoria) VALUES(57,'Prueba de fugas',1)").run().lastInsertRowid);
  await expect(liber(57,{itemId:fugas57,valorMedido:null,valorMedidoTexto:'1,200'},'tecnico'));
  assert.deepEqual({...one('SELECT valor_medido v, valor_medido_texto t, conforme c FROM orden_liberaciones WHERE id=?',fugas57)},{v:null,t:'1,200',c:null});
  // Una fila vieja con «1,200 ppm» cuenta como no medida: no se envía ni se juzga fuera de rango.
  seed(58,{tipo:'intervencion',trabajos:'Cambio del filtro HEPA de la manejadora del quirófano 3.'});
  sqlite.prepare("INSERT INTO orden_liberaciones(orden_id,etiqueta,unidad,min_aceptable,max_aceptable,valor_medido_texto,obligatoria) VALUES(58,'CO2 en el quirófano','ppm',NULL,1000,'1,200 ppm',1)").run();
  const vieja58=(await expect(patch(58,{estado:'completada'},'tecnico'),400)).error;
  assert.match(vieja58,/Falta 1 lectura de liberación obligatoria/); assert.ok(vieja58.includes(`«1,200 ppm». ${AMBIGUO}`),vieja58);
  assert.doesNotMatch(vieja58,/fuera de rango/); assert.equal(order(58).estado,'en_proceso');

  // ── El plan y la reversa del MOP: misma regla que las lecturas y los prerrequisitos ──
  const ENVIADA='La orden ya se envió a verificación. La reversa la registra la jefatura en la ficha.';
  const reversa=id=>({...one('SELECT plan_reversa p, reversa_ejecutada e, reversa_notas n FROM ordenes WHERE id=?',id)});
  const version=id=>one('SELECT version FROM orden_verificacion WHERE orden_id=?',id)?.version ?? null;
  const PLAN='Volver al tablero anterior y avisar a la jefatura de turno.';
  const NOTAS='Se volvió al tablero anterior; el interruptor nuevo no cerró.';
  // Enviada a verificación, la pestaña vieja del técnico no la marca.
  seed(60,{tipo:'intervencion',estado:'completada',trabajos:'Cambio del interruptor del tablero de la rama crítica.'});
  sqlite.prepare('UPDATE ordenes SET plan_reversa=? WHERE id=60').run(PLAN);
  const antes60=reversa(60);
  assert.equal((await expect(patch(60,{reversaEjecutada:true,reversaNotas:NOTAS},'tecnico'),409)).error,ENVIADA);
  assert.equal((await expect(patch(60,{planReversa:'Plan reescrito después de enviarla.'},'tecnico'),409)).error,ENVIADA);
  assert.deepEqual(reversa(60),antes60,'Nada cambia');
  // Con los valores iguales a lo guardado no hay error ni cambio.
  const eventos60=history(60).length, version60=version(60);
  await expect(patch(60,{planReversa:` ${PLAN} `,reversaEjecutada:false,reversaNotas:null},'tecnico'));
  assert.equal(history(60).length,eventos60); assert.equal(version(60),version60);
  // La jefatura sí la registra con la orden enviada.
  await expect(patch(60,{reversaEjecutada:true,reversaNotas:NOTAS},'jefe'));
  assert.deepEqual(reversa(60),{p:PLAN,e:1,n:NOTAS});
  // Cerrada, nadie la cambia; una pestaña vieja con lo mismo no choca.
  sqlite.exec("UPDATE ordenes SET estado='cerrada' WHERE id=60");
  assert.match((await expect(patch(60,{reversaEjecutada:false},'jefe'),400)).error,/ya está cerrada/);
  assert.match((await expect(patch(60,{reversaNotas:'Notas cambiadas con la orden cerrada.'},'tecnico'),400)).error,/ya está cerrada/);
  assert.match((await expect(patch(60,{planReversa:'Plan reescrito con la orden cerrada.'},'admin'),400)).error,/ya está cerrada/);
  await expect(patch(60,{planReversa:PLAN,reversaEjecutada:true,reversaNotas:NOTAS},'jefe'));
  assert.deepEqual(reversa(60),{p:PLAN,e:1,n:NOTAS});
  // Abierta y asignada: el técnico escribe el plan, pero la reversa se marca después de empezar.
  seed(61,{tipo:'intervencion',estado:'abierta'});
  await expect(patch(61,{planReversa:PLAN},'tecnico'));
  assert.equal((await expect(patch(61,{reversaEjecutada:true,reversaNotas:NOTAS},'tecnico'),409)).error,'La reversa se marca después de empezar la intervención.');
  assert.deepEqual(reversa(61),{p:PLAN,e:0,n:null});
  // Solo el técnico asignado.
  seed(62,{tipo:'intervencion',asignado:30});
  await expect(patch(62,{reversaEjecutada:true,reversaNotas:NOTAS},'tecnico'),403);
  await expect(patch(62,{planReversa:PLAN},'tecnico'),403);
  await expect(patch(62,{planReversa:PLAN},'visualizador'),403);
  assert.deepEqual(reversa(62),{p:null,e:0,n:null});
  // Una orden libre: primero se toma y después se escribe el plan.
  seed(68,{tipo:'intervencion',estado:'abierta'}); sqlite.exec('UPDATE ordenes SET asignado_a=NULL WHERE id=68');
  await expect(patch(68,{asignadoA:3,planReversa:PLAN},'tecnico'),403);
  assert.deepEqual(reversa(68),{p:null,e:0,n:null}); assert.equal(order(68).asignado_a,null);
  await expect(patch(68,{asignadoA:3},'tecnico'));
  await expect(patch(68,{planReversa:PLAN},'tecnico'));
  assert.equal(reversa(68).p,PLAN);
  // En proceso, el técnico asignado la marca con sus notas; ejecutada, las notas no se vacían.
  seed(63,{tipo:'intervencion'});
  await expect(patch(63,{reversaEjecutada:true,reversaNotas:NOTAS},'tecnico'));
  assert.match((await expect(patch(63,{reversaNotas:'corto'},'tecnico'),400)).error,/mínimo 10 caracteres/);
  assert.deepEqual(reversa(63),{p:null,e:1,n:NOTAS});

  // ── Una pestaña vieja vuelve a enviar a verificación una orden ya enviada: nada que escribir ──
  seed(64,{tipo:'correctivo',trabajos:'Se cambió el fusible y se probó la carga.'});
  await expect(patch(64,{estado:'completada'},'tecnico'));
  const eventos64=history(64).length, version64=version(64);
  const reenvio=await expect(patch(64,{estado:'completada',trabajosRealizados:'Se cambió el fusible y se probó la carga.',solucionAplicada:null},'tecnico'));
  assert.equal(reenvio.orden.estado,'completada');
  assert.equal(history(64).length,eventos64,'No deja un evento «edicion» completada → completada'); assert.equal(version(64),version64,'La versión no cambia');
  // Pedir el estado que ya tiene tampoco es un cambio.
  seed(65,{trabajos:'Trabajo en curso sin cambios'});
  await expect(patch(65,{estado:'en_proceso'},'tecnico'));
  assert.equal(history(65).length,0);

  // ── El reporte: la causa raíz en una fila por tanda, la borrada, y «No se pudo» en una emergencia ──
  seed(66,{tipo:'emergencia',checklist:JSON.stringify([{texto:'Asegurar el área',estado:'ok'},{texto:'Encender la planta',estado:'desviacion',notas:'No se pudo: sin combustible'}])});
  for (const borrador of ['Brea','Breaker del','Breaker del ATS disparado por sobrecarga']) await expect(patch(66,{causaRaiz:borrador},'jefe'));
  await expect(patch(66,{estado:'en_espera',motivo:'Esperando el diésel'},'tecnico'));
  await expect(patch(66,{causaRaiz:null},'jefe'));
  await expect(patch(66,{causaRaiz:'Breaker del ATS disparado por sobrecarga del circuito'},'admin'));
  assert.equal(history(66).filter(e=>e.accion==='causa_raiz').length,5,'Cada guardado queda como evidencia');
  const rep66=await app.reporte.reporteDeOrden(db,66);
  assert.deepEqual(rep66.historial.map(h=>h.titulo),['Causa raíz registrada','Pausa','Causa raíz borrada','Causa raíz registrada'],JSON.stringify(rep66.historial));
  assert.equal(rep66.historial[0].cuando,history(66).filter(e=>e.accion==='causa_raiz')[2].ocurrido_en,'La fila es la del último guardado');
  assert.deepEqual(rep66.pasos.map(p=>p.estadoLabel),['Realizado','No se pudo']);
  seed(67,{tipo:'correctivo',checklist:JSON.stringify([{texto:'Revisar la unión',estado:'desviacion',notas:'Fuga en la unión'}])});
  assert.deepEqual((await app.reporte.reporteDeOrden(db,67)).pasos.map(p=>p.estadoLabel),['Con novedad']);

  // ── Un número guardado vuelve a texto sin ambigüedad (K7): 12.345 no se lee «12.345» ──
  const pasoMedido=valorMedido=>JSON.stringify([{texto:'Medir la corriente de fase',estado:'ok',requiereValor:true,unidad:'A',esperadoMin:8,esperadoMax:12,valorMedido,hora:'10:00',iniciales:'P.T.'}]);
  for (const [valorMedido,texto,dentro] of [[12.345,'12.3450',false],['12.3450','12.3450',false],[9.125,'9.1250',true],[9.8,'9.8',true]]) {
    const pasos=app.ordenes.parseChecklist(pasoMedido(valorMedido));
    assert.equal(pasos[0].valorMedido,texto,`${JSON.stringify(valorMedido)} vuelve a texto`);
    assert.equal(app.ordenes.evaluarValorChecklist(pasos[0]).dentro,dentro,`${JSON.stringify(valorMedido)} con rango 8 a 12 A`);
    assert.deepEqual(app.ordenes.lecturasFueraDeRango(pasos),dentro?[]:[0]);
    assert.equal(app.ordenes.progresoChecklist(pasos).valoresFaltantes,0,'Es un número: no falta la lectura');
  }
  seed(70,{tipo:'correctivo',checklist:pasoMedido(12.345)});
  const rep70=(await app.reporte.reporteDeOrden(db,70)).pasos[0];
  assert.deepEqual([rep70.valor,rep70.dentro],['12.3450',false],'El reporte lo marca fuera de rango');

  // ── Un paso con rango lleva número (K8): al guardarlo, desde el celular y al enviar o cerrar ──
  const PASO_SIN_NUMERO='Este paso tiene rango: anota el número que marcó el instrumento (por ejemplo 14,5).';
  seed(71,{checklist:JSON.stringify([{texto:'Medir la corriente de fase',estado:'pendiente',requiereValor:true,unidad:'A',esperadoMin:8,esperadoMax:12},{texto:'Anotar cómo quedó el tablero',estado:'pendiente',requiereValor:true}])});
  const con71=(i,cambio)=>{ const l=JSON.parse(order(71).checklist_ejecucion); l[i]={...l[i],...cambio}; return {checklistEjecucion:JSON.stringify(l),checklistBase:order(71).checklist_ejecucion}; };
  const antes71=order(71).checklist_ejecucion;
  for (const valorMedido of ['aprox 14','14 A','Arrancó bien']) assert.equal((await expect(patch(71,con71(0,{estado:'ok',valorMedido}),'tecnico'),400)).error,PASO_SIN_NUMERO,valorMedido);
  assert.equal((await expect(patch(71,con71(0,{estado:'ok',valorMedido:'1,200'}),'tecnico'),400)).error,AMBIGUO,'Ambiguo, con la frase de numero.ts');
  const sync71=await sync([{opId:'reglas-paso-71',tipo:'orden.paso',ordenId:71,idx:0,texto:'Medir la corriente de fase',estado:'ok',valor:'aprox 14'}]);
  assert.equal(sync71.resultados[0].ok,false); assert.equal(sync71.resultados[0].error,PASO_SIN_NUMERO);
  assert.equal(order(71).checklist_ejecucion,antes71,'Nada de eso se guarda');
  await expect(patch(71,con71(1,{estado:'ok',valorMedido:'Sin novedad, tablero limpio'}),'tecnico'));
  assert.equal(JSON.parse(order(71).checklist_ejecucion)[1].valorMedido,'Sin novedad, tablero limpio','Sin rango, el texto entra como siempre');
  for (const valorMedido of ['10,4','',11]) {
    await expect(patch(71,con71(0,{estado:'ok',valorMedido}),'tecnico'));
    assert.equal(JSON.parse(order(71).checklist_ejecucion)[0].valorMedido,valorMedido,JSON.stringify(valorMedido));
  }
  // Al enviar y al cerrar, lo escrito sin número en un paso con rango es una lectura que falta; N/A no se exige.
  const conTexto=(estado='ok')=>JSON.stringify([{texto:'Medir la corriente de fase',estado,requiereValor:true,unidad:'A',esperadoMin:8,esperadoMax:12,valorMedido:'aprox 14',hora:'10:00',iniciales:'P.T.'}]);
  const items=estado=>app.ordenes.parseChecklist(conTexto(estado));
  assert.equal(app.ordenes.progresoChecklist(items('ok')).valoresFaltantes,1); assert.equal(app.ordenes.validarLecturasChecklistParaCierre(items('ok')).ok,false);
  assert.equal(app.ordenes.progresoChecklist(items('na')).valoresFaltantes,0); assert.equal(app.ordenes.validarLecturasChecklistParaCierre(items('na')).ok,true);
  assert.equal(app.ordenes.progresoChecklist(app.ordenes.parseChecklist(conTexto().replace('aprox 14','1,200'))).valoresFaltantes,1,'Ambiguo tampoco es lectura');
  seed(72,{trabajos:'Se midió la corriente de fase del tablero.',checklist:conTexto()});
  assert.match((await expect(patch(72,{estado:'completada'},'tecnico'),400)).error,/exige valor medido y está sin lectura: «Medir la corriente de fase»/);
  assert.equal(order(72).estado,'en_proceso');
  seed(73,{trabajos:'Se midió la corriente de fase del tablero.',checklist:conTexto().replace('aprox 14','10,4')});
  await expect(patch(73,{estado:'completada'},'tecnico'));
  sqlite.prepare('UPDATE ordenes SET checklist_ejecucion=? WHERE id=73').run(conTexto());
  assert.match((await expect(patch(73,{estado:'verificada',verificacionNotas:'Revisé la lectura de la corriente de fase.'},'jefe'),400)).error,/sin lectura/);
  assert.equal(order(73).estado,'completada');
  seed(69,{trabajos:'Se midió la corriente de fase del tablero.',checklist:conTexto('na')});
  await expect(patch(69,{estado:'completada'},'tecnico'));

  // ── Pestaña de antes (K9b): plan, casilla y notas juntos no desmarcan la reversa del celular ──
  for (const [id,rol] of [[74,'tecnico'],[75,'jefe']]) {
    seed(id,{tipo:'intervencion',trabajos:'Cambio del interruptor de la rama crítica.'});
    sqlite.prepare("UPDATE ordenes SET plan_reversa='Plan corto.' WHERE id=?").run(id);
    sqlite.prepare("INSERT INTO orden_liberaciones(orden_id,etiqueta,unidad,min_aceptable,max_aceptable,obligatoria) VALUES(?,'Corriente de fase','A',8,12,1)").run(id);
    const pantalla=reversa(id);
    assert.equal((await sync([{opId:`reglas-reversa-${id}`,tipo:'mop.reversa',ordenId:id,notas:NOTAS}])).resultados[0].ok,true);
    await expect(patch(id,{planReversa:PLAN,reversaEjecutada:!!pantalla.e,reversaNotas:pantalla.n||null},rol));
    assert.deepEqual(reversa(id),{p:PLAN,e:1,n:NOTAS},`El plan se guarda y la reversa sigue marcada (${rol})`);
    const fin=await sync([{opId:`reglas-fin-${id}`,tipo:'orden.terminar',ordenId:id,nota:'Se volvió al interruptor anterior.'}]);
    assert.equal(fin.resultados[0].ok,true,JSON.stringify(fin)); assert.equal(order(id).estado,'completada','Con la reversa marcada, el celular la envía');
  }
  // La ficha nueva manda solo lo que cambió: la jefatura sí la desmarca.
  seed(76,{tipo:'intervencion'});
  sqlite.prepare('UPDATE ordenes SET reversa_ejecutada=1,reversa_notas=? WHERE id=76').run(NOTAS);
  await expect(patch(76,{reversaEjecutada:false},'jefe'));
  assert.deepEqual(reversa(76),{p:null,e:0,n:NOTAS});
  sqlite.exec('UPDATE ordenes SET reversa_ejecutada=1 WHERE id=76');
  await expect(patch(76,{reversaEjecutada:false,reversaNotas:null},'jefe'));
  assert.deepEqual(reversa(76),{p:null,e:0,n:null});

  // ── Pestaña de antes (K9a): las cuatro horas juntas no borran la que registró el celular ──
  const MITIGA='2026-10-01T09:40:00.000Z';
  const horas=id=>({...one('SELECT hora_alarma a, hora_llegada l, hora_mitigacion m, hora_restablecimiento r, causa_raiz_vencimiento v FROM ordenes WHERE id=?',id)});
  const cuatro=(a,l,m,r)=>({horaAlarma:a,horaLlegada:l,horaMitigacion:m,horaRestablecimiento:r});
  // La jefatura corrige la alarma con la pestaña que abrió antes de la llegada y la mitigación del celular.
  seed(77,{tipo:'emergencia'});
  sqlite.prepare('UPDATE ordenes SET hora_alarma=?,causa_raiz_vencimiento=?,hora_llegada=?,hora_mitigacion=? WHERE id=77').run(ALARMA,VENCE,LLEGADA,MITIGA);
  await expect(patch(77,cuatro('2026-10-01T02:50:00-06:00',null,null,null),'jefe'));
  assert.deepEqual(horas(77),{a:'2026-10-01T02:50:00-06:00',l:LLEGADA,m:MITIGA,r:null,v:'2026-10-04T08:50:00.000Z'},'La alarma se corrige; la llegada y la mitigación quedan');
  // Una alarma vacía en la pestaña tampoco borra la guardada ni su plazo.
  seed(78,{tipo:'emergencia'});
  sqlite.prepare('UPDATE ordenes SET hora_alarma=?,causa_raiz_vencimiento=? WHERE id=78').run(ALARMA,VENCE);
  await expect(patch(78,cuatro(null,'2026-10-01T03:20:00-06:00',null,null),'jefe'));
  assert.deepEqual(horas(78),{a:ALARMA,l:'2026-10-01T03:20:00-06:00',m:null,r:null,v:VENCE});
  // El técnico, con la pestaña sin la mitigación del celular, registra el restablecimiento con la hora de la operación.
  seed(79,{tipo:'emergencia'});
  sqlite.prepare('UPDATE ordenes SET hora_alarma=?,causa_raiz_vencimiento=?,hora_llegada=?,hora_mitigacion=? WHERE id=79').run(ALARMA,VENCE,LLEGADA,MITIGA);
  await app.verification.actualizarOrdenConVerificacion(db,await orderModel(79),TECNICO,cuatro('2026-10-01T03:00:00-06:00','2026-10-01T03:20:00-06:00',null,'2026-10-01T04:10:00-06:00'),'2026-10-01T10:10:30.000Z');
  assert.deepEqual(horas(79),{a:ALARMA,l:LLEGADA,m:MITIGA,r:'2026-10-01T04:10:00-06:00',v:VENCE});
  // Sola, una hora vacía sigue sus reglas: la jefatura la borra.
  await expect(patch(77,{horaMitigacion:null},'jefe'));
  assert.equal(horas(77).m,null);

  // ── Pestaña de antes (K9c): la causa que llega con los trabajos ──
  const T80='Rearmé el breaker del ATS y verifiqué tensión.';
  // La pestaña del técnico pintó el borrador de la jefatura; la jefatura lo cambió o lo borró después.
  for (const [id,despues] of [[80,CAUSA],[81,null]]) {
    seed(id,{tipo:'emergencia'});
    await expect(patch(id,{causaRaiz:'Breaker del ATS'},'jefe'));
    await expect(patch(id,{causaRaiz:despues},'jefe'));
    await expect(patch(id,{trabajosRealizados:T80,causaRaiz:'Breaker del ATS',solucionAplicada:null},'tecnico'));
    assert.equal(order(id).causa_raiz,despues,'La causa de la jefatura no cambia');
    assert.equal(order(id).trabajos_realizados,T80,'El borrador viejo no pasa a los trabajos');
  }
  // La pestaña de la jefatura se abrió sin causa; otra persona la escribió después.
  seed(82,{tipo:'emergencia',trabajos:T80});
  await expect(patch(82,{causaRaiz:CAUSA},'admin'));
  await expect(patch(82,{trabajosRealizados:`${T80} Se revisó también el tablero B.`,causaRaiz:null,solucionAplicada:null},'jefe'));
  assert.equal(order(82).causa_raiz,CAUSA,'Vacía no borra la guardada'); assert.match(order(82).trabajos_realizados,/tablero B/,'Lo demás se guarda');
  // Igual a una que ya se guardó antes, también es vieja para la jefatura.
  await expect(patch(82,{causaRaiz:`${CAUSA}; lo confirmó el proveedor`},'admin'));
  await expect(patch(82,{trabajosRealizados:`${T80} Se revisó también el tablero B y el C.`,causaRaiz:CAUSA,solucionAplicada:null},'jefe'));
  assert.equal(order(82).causa_raiz,`${CAUSA}; lo confirmó el proveedor`); assert.match(order(82).trabajos_realizados,/y el C/);
  // Sola (ficha nueva), la causa se guarda aunque se haya escrito antes, y vacía la borra.
  await expect(patch(82,{causaRaiz:CAUSA},'jefe')); assert.equal(order(82).causa_raiz,CAUSA);
  await expect(patch(82,{causaRaiz:null},'jefe')); assert.equal(order(82).causa_raiz,null);

  // ── Reglas de la segunda ronda que ninguna prueba cuidaba ──
  // Cancelada, nadie cambia el plan ni la reversa.
  const CANCELADA='La orden fue cancelada: el plan y la reversa ya no se editan.';
  seed(83,{tipo:'intervencion',estado:'cancelada'});
  for (const [rol,cambio] of [['jefe',{planReversa:PLAN}],['admin',{reversaEjecutada:true,reversaNotas:NOTAS}],['tecnico',{planReversa:PLAN}]]) assert.equal((await expect(patch(83,cambio,rol),400)).error,CANCELADA,rol);
  assert.deepEqual(reversa(83),{p:null,e:0,n:null});
  // Sin base, un punto guardado sin hora ni iniciales no cuenta como marcado: entra lo que llega.
  seed(84,{checklist:JSON.stringify([{texto:'Revisar tablero',estado:'ok'},{texto:'Limpiar contactos',estado:'pendiente'}])});
  await expect(patch(84,{checklistEjecucion:JSON.stringify([{texto:'Revisar tablero',estado:'pendiente'},{texto:'Limpiar contactos',estado:'ok'}])},'jefe'));
  assert.deepEqual(JSON.parse(order(84).checklist_ejecucion).map(p=>p.estado),['pendiente','ok']);
  // Sin base, un pendiente que llega con hora lo tocó quien guarda: entra como llega.
  seed(85,{checklist:JSON.stringify([{texto:'Revisar tablero',estado:'ok',hora:'09:10',iniciales:'P.T.'},{texto:'Limpiar contactos',estado:'pendiente'}])});
  await expect(patch(85,{checklistEjecucion:JSON.stringify([{texto:'Revisar tablero',estado:'pendiente',hora:'10:05'},{texto:'Limpiar contactos',estado:'pendiente'}])},'jefe'));
  const punto85=JSON.parse(order(85).checklist_ejecucion)[0];
  assert.deepEqual([punto85.estado,punto85.hora],['pendiente','10:05']);
  // Con base, la ficha quitó la nota de un paso que el celular marcó: la nota se va y la marca queda.
  seed(86,{checklist:JSON.stringify([{texto:'Revisar tablero',estado:'pendiente',notas:'Nota vieja de la jefatura'},{texto:'Cerrar el tablero',estado:'pendiente'}])});
  const base86=order(86).checklist_ejecucion;
  sqlite.prepare('UPDATE ordenes SET checklist_ejecucion=? WHERE id=86').run(JSON.stringify([{texto:'Revisar tablero',estado:'ok',notas:'Nota vieja de la jefatura',hora:'10:05',iniciales:'P.T.'},{texto:'Cerrar el tablero',estado:'pendiente'}]));
  const ficha86=JSON.parse(base86); delete ficha86[0].notas;
  await expect(patch(86,{checklistEjecucion:JSON.stringify(ficha86),checklistBase:base86},'jefe'));
  assert.deepEqual(JSON.parse(order(86).checklist_ejecucion)[0],{texto:'Revisar tablero',estado:'ok',hora:'10:05',iniciales:'P.T.'});
  // Una liberación que llega como número se juzga tal cual, aunque escrita se leería de dos formas.
  seed(87,{tipo:'intervencion',trabajos:'Cambio del interruptor de la rama crítica.'});
  const corriente87=()=>Number(sqlite.prepare("INSERT INTO orden_liberaciones(orden_id,etiqueta,unidad,min_aceptable,max_aceptable,obligatoria) VALUES(87,'Corriente de fase','A',8,12,1)").run().lastInsertRowid);
  const l87=corriente87(), l87b=corriente87();
  assert.equal((await expect(liber(87,{itemId:l87,valorMedido:12.345},'tecnico'))).liberacion.conforme,false,'12.345 queda fuera de rango');
  assert.equal(one('SELECT valor_medido v FROM orden_liberaciones WHERE id=?',l87).v,12.345);
  assert.equal((await sync([{opId:'reglas-lib-87',tipo:'mop.liberacion',ordenId:87,liberacionId:l87b,valor:9.125}])).resultados[0].datos?.conforme,true,'9.125 por el celular, conforme');

  // ── El 409 de la guarda de concurrencia lleva su motivo (K10) ──
  seed(88,{trabajos:'Dos envíos a verificación al mismo tiempo.'});
  faults.beforeBatch=async()=>await expect(patch(88,{estado:'completada'},'tecnico'));
  assert.deepEqual(await expect(patch(88,{estado:'completada'},'tecnico'),409),{error:'La orden cambió durante la operación. Actualiza la página e inténtalo de nuevo.',motivo:'otra-escritura'});
  assert.equal((await expect(patch(88,{trabajosRealizados:'Cambio después de enviarla a verificación.'},'tecnico'),409)).motivo,undefined,'Otro 409 no lo lleva');

  // ── K11: un paso que cambió en el servidor y en lo que llega, en una misma clave y con otro valor, no se pisa ──
  const PASO_CAMBIO='Un paso del checklist cambió mientras tanto. Revísalo y vuelve a enviar.';
  const PASOS89=[{texto:'Verificar que la planta arrancó',estado:'pendiente'},{texto:'Confirmar la transferencia',estado:'pendiente'},{texto:'Avisar a enfermería',estado:'pendiente'}];
  const DESVIACION='La transferencia no retornó a normal.';
  const desviaEnCelular=async(id,idx)=>assert.equal((await sync([{opId:`reglas-k11-${id}-${idx}`,tipo:'orden.paso',ordenId:id,idx,texto:PASOS89[idx].texto,estado:'desviacion',nota:DESVIACION}])).resultados[0].ok,true);
  // Lo que manda la ficha que abrió con esa base, con lo que marcó en cada punto.
  const fichaVieja=(base,cambios)=>JSON.stringify(JSON.parse(base).map(comoFicha).map((p,i)=>({...p,...(cambios[i]??{})})));
  // La ficha marcó «ok» sin señal; el celular registró una desviación con su nota en el mismo paso; vuelve la señal y la ficha marca otro.
  seed(89,{tipo:'emergencia',checklist:JSON.stringify(PASOS89)});
  const base89=order(89).checklist_ejecucion;
  await desviaEnCelular(89,1);
  const celular89=JSON.parse(order(89).checklist_ejecucion)[1];
  const r89=await expect(patch(89,{checklistEjecucion:fichaVieja(base89,{1:{estado:'ok'},2:{estado:'ok'}}),checklistBase:base89},'jefe'));
  assert.deepEqual(r89.pasosSinAplicar,[1],'200 con el índice del paso que chocó');
  const lista89=JSON.parse(order(89).checklist_ejecucion);
  assert.deepEqual(lista89[1],celular89,'La desviación del celular queda entera'); assert.equal(lista89[1].notas,DESVIACION);
  assert.equal(lista89[2].estado,'ok','Lo demás se aplica');
  assert.deepEqual(JSON.parse(r89.orden.checklistEjecucion),lista89,'La respuesta trae el checklist guardado');
  // Con el envío a verificación en la misma solicitud no se aplica nada: 409 con los pasos y el checklist guardado.
  seed(90,{tipo:'emergencia',trabajos:'Planta en manual; transferencia operada con un segundo técnico.',checklist:JSON.stringify(PASOS89.slice(0,2))});
  const base90=order(90).checklist_ejecucion;
  await desviaEnCelular(90,1);
  const guardado90=order(90).checklist_ejecucion, antes90=JSON.stringify([order(90),history(90),version(90)]);
  const envio90=await expect(patch(90,{trabajosRealizados:'Planta en manual y transferencia probada con carga.',checklistEjecucion:fichaVieja(base90,{0:{estado:'ok'},1:{estado:'ok'}}),checklistBase:base90,estado:'completada'},'tecnico'),409);
  assert.deepEqual(envio90,{error:PASO_CAMBIO,motivo:'paso-cambio',pasos:[1],orden:{checklistEjecucion:guardado90}});
  assert.equal(order(90).estado,'en_proceso'); assert.equal(JSON.stringify([order(90),history(90),version(90)]),antes90,'Todo queda como estaba');
  // También el envío sin lectura de la jefatura y la verificación.
  seed(91,{tipo:'intervencion',trabajos:'Válvula de zona reemplazada sin poder medir',checklist:JSON.stringify(PASOS89.slice(0,2))});
  liberacion(91);
  const base91=order(91).checklist_ejecucion;
  await desviaEnCelular(91,0);
  const sinLectura91=await expect(patch(91,{checklistEjecucion:fichaVieja(base91,{0:{estado:'ok'},1:{estado:'ok'}}),checklistBase:base91,estado:'completada',cierreSinLecturaMotivo:MOTIVO},'jefe'),409);
  assert.deepEqual([sinLectura91.motivo,sinLectura91.pasos],['paso-cambio',[0]]);
  assert.deepEqual([order(91).estado,order(91).cierre_sin_lectura_motivo],['en_proceso',null]);
  seed(92,{trabajos:'Tablero revisado y probado con carga.',checklist:JSON.stringify([{texto:'Revisar tablero',estado:'ok',hora:'09:00',iniciales:'P.T.'}])});
  await expect(patch(92,{estado:'completada'},'tecnico'));
  const base92=order(92).checklist_ejecucion;
  sqlite.prepare('UPDATE ordenes SET checklist_ejecucion=? WHERE id=92').run(JSON.stringify([{texto:'Revisar tablero',estado:'desviacion',notas:'Neutro flojo en la barra principal.',hora:'09:40',iniciales:'P.T.'}]));
  const cierre92=await expect(patch(92,{estado:'verificada',verificacionNotas:'Revisé el tablero y la prueba de carga.',checklistEjecucion:fichaVieja(base92,{0:{estado:'na'}}),checklistBase:base92},'jefe'),409);
  assert.deepEqual([cierre92.motivo,cierre92.pasos],['paso-cambio',[0]]); assert.equal(order(92).estado,'completada');
  // La misma clave al mismo valor no choca (la misma lectura escrita de otra forma, la misma nota con espacios), y claves distintas se fusionan.
  seed(93,{checklist:JSON.stringify([{texto:'Medir la corriente de fase',estado:'pendiente',requiereValor:true,unidad:'A',esperadoMin:8,esperadoMax:12},{texto:'Revisar tablero',estado:'pendiente'},{texto:'Cerrar el tablero',estado:'pendiente'}])});
  const base93=order(93).checklist_ejecucion;
  const pasos93=[...(await sync([
    {opId:'reglas-k11-93a',tipo:'orden.paso',ordenId:93,idx:0,texto:'Medir la corriente de fase',estado:'ok',valor:'10,5'},
    {opId:'reglas-k11-93b',tipo:'orden.paso',ordenId:93,idx:1,texto:'Revisar tablero',estado:'desviacion',nota:'Neutro flojo en la barra principal.'},
  ])).resultados, ...(await sync([{opId:'reglas-k11-93c',tipo:'orden.paso',ordenId:93,idx:2,texto:'Cerrar el tablero',estado:'ok'}])).resultados];
  assert.ok(pasos93.length===3 && pasos93.every(r=>r.ok),JSON.stringify(pasos93));
  const celular93=JSON.parse(order(93).checklist_ejecucion);
  const r93=await expect(patch(93,{checklistEjecucion:fichaVieja(base93,{0:{estado:'ok',valorMedido:'10,5'},1:{estado:'desviacion',notas:' Neutro flojo en la barra principal. '},2:{notas:'Cerrar con la llave del cuarto eléctrico.'}}),checklistBase:base93},'jefe'));
  assert.equal(r93.pasosSinAplicar,undefined,'Sin choque');
  const lista93=JSON.parse(order(93).checklist_ejecucion);
  assert.deepEqual(lista93.slice(0,2),celular93.slice(0,2),'Queda lo del celular, con su firma y su número');
  assert.deepEqual([lista93[2].estado,lista93[2].notas,lista93[2].hora],['ok','Cerrar con la llave del cuarto eléctrico.',celular93[2].hora],'La marca del celular y la nota de la ficha');
  // Un punto de formato viejo (no es objeto) cambiado en los dos lados también choca.
  seed(109,{checklist:JSON.stringify(['Revisar tablero',{texto:'Limpiar contactos',estado:'pendiente'}])});
  const base109=order(109).checklist_ejecucion, otraPestana109={texto:'Revisar tablero',estado:'ok',hora:'09:10',iniciales:'P.T.'};
  sqlite.prepare('UPDATE ordenes SET checklist_ejecucion=? WHERE id=109').run(JSON.stringify([otraPestana109,{texto:'Limpiar contactos',estado:'pendiente'}]));
  const r109=await expect(patch(109,{checklistEjecucion:JSON.stringify([{texto:'Revisar tablero',estado:'na'},{texto:'Limpiar contactos',estado:'ok'}]),checklistBase:base109},'jefe'));
  assert.deepEqual(r109.pasosSinAplicar,[0]);
  assert.deepEqual(JSON.parse(order(109).checklist_ejecucion),[otraPestana109,{texto:'Limpiar contactos',estado:'ok'}]);
  // Sin base (pestaña de producción o celular), todo sigue como hoy: el paso marcado se conserva y el envío entra.
  seed(94,{trabajos:'Contactos limpiados y tablero revisado.',checklist:JSON.stringify(PASOS53.slice(0,2))});
  const vieja94=JSON.parse(order(94).checklist_ejecucion);
  assert.equal((await sync([{opId:'reglas-k11-94',tipo:'orden.paso',ordenId:94,idx:0,texto:'Revisar tablero',estado:'desviacion',nota:'Tornillo flojo en la barra.'}])).resultados[0].ok,true);
  vieja94[1]={...vieja94[1],estado:'ok'};
  const r94=await expect(patch(94,{checklistEjecucion:JSON.stringify(vieja94),estado:'completada'},'tecnico'));
  assert.equal(r94.pasosSinAplicar,undefined); assert.equal(order(94).estado,'completada');
  assert.deepEqual(JSON.parse(order(94).checklist_ejecucion).map(p=>p.estado),['desviacion','ok']);

  // ── La ficha nueva manda soloCambios (K12): sin las reglas de la pestaña de antes ──
  // Plan nuevo, casilla vacía y notas vacías en un mismo guardado: con soloCambios se desmarca; sin él, como hoy (K9b).
  for (const [id,solo] of [[95,true],[96,false]]) {
    seed(id,{tipo:'intervencion',trabajos:'Cambio del interruptor de la rama crítica.'});
    sqlite.prepare("UPDATE ordenes SET plan_reversa='Plan corto.',reversa_ejecutada=1,reversa_notas=? WHERE id=?").run(NOTAS,id);
    await expect(patch(id,{planReversa:PLAN,reversaEjecutada:false,reversaNotas:null,...(solo?{soloCambios:true}:{})},'jefe'));
  }
  assert.deepEqual(reversa(95),{p:PLAN,e:0,n:null},'Con soloCambios se desmarca y las notas se borran');
  assert.deepEqual(reversa(96),{p:PLAN,e:1,n:NOTAS},'Sin soloCambios, la reversa sigue marcada');
  // soloCambios no se guarda ni cuenta como un cambio.
  assert.equal('soloCambios' in JSON.parse(history(95).at(-1).evidencia_json).despues,false);
  const eventos95=history(95).length, version95=version(95);
  await expect(patch(95,{planReversa:` ${PLAN} `,soloCambios:true},'jefe'));
  assert.deepEqual([history(95).length,version(95)],[eventos95,version95],'Igual a lo guardado: sin evento');
  // Las cuatro horas con una vacía: con soloCambios la jefatura la borra y el técnico no; sin él, como hoy (K9a).
  const RESTA='2026-10-01T10:00:00.000Z';
  const conHoras=(id,r=RESTA)=>{ seed(id,{tipo:'emergencia'}); sqlite.prepare('UPDATE ordenes SET hora_alarma=?,causa_raiz_vencimiento=?,hora_llegada=?,hora_mitigacion=?,hora_restablecimiento=? WHERE id=?').run(ALARMA,VENCE,LLEGADA,MITIGA,r,id); };
  const corregidas=cuatro('2026-10-01T02:55:00-06:00','2026-10-01T03:15:00-06:00','2026-10-01T03:35:00-06:00',null);
  conHoras(97);
  await expect(patch(97,{...corregidas,soloCambios:true},'jefe'));
  assert.deepEqual(horas(97),{a:'2026-10-01T02:55:00-06:00',l:'2026-10-01T03:15:00-06:00',m:'2026-10-01T03:35:00-06:00',r:null,v:'2026-10-04T08:55:00.000Z'},'Corrige tres y borra el restablecimiento');
  conHoras(98,null);
  assert.match((await expect(patch(98,{...cuatro('2026-10-01T03:00:00-06:00','2026-10-01T03:20:00-06:00',null,null),soloCambios:true},'tecnico'),403)).error,SOLO_JEFATURA_HORAS);
  assert.deepEqual(horas(98),{a:ALARMA,l:LLEGADA,m:MITIGA,r:null,v:VENCE},'El técnico no borra una hora');
  conHoras(99);
  await expect(patch(99,corregidas,'jefe'));
  assert.equal(horas(99).r,RESTA,'Sin soloCambios, la vacía no borra la guardada');
  // Con soloCambios, la causa que llega con los trabajos tampoco se toma por vieja.
  seed(100,{tipo:'emergencia',trabajos:T80});
  await expect(patch(100,{causaRaiz:CAUSA},'jefe'));
  await expect(patch(100,{causaRaiz:`${CAUSA}; lo confirmó el proveedor`},'jefe'));
  await expect(patch(100,{trabajosRealizados:`${T80} Se revisó también el tablero B.`,causaRaiz:CAUSA,solucionAplicada:null,soloCambios:true},'jefe'));
  assert.equal(order(100).causa_raiz,CAUSA); assert.match(order(100).trabajos_realizados,/tablero B/);

  // ── K13: la causa de la pestaña de antes es vieja solo si los trabajos o la solución traen un cambio ──
  const C1='El breaker se disparó por sobrecarga', C2='El breaker se disparó por sobrecarga del circuito';
  // La jefatura escribe la causa en la pestaña de producción, la alarga y la deja como estaba: con los trabajos iguales, se aplica.
  for (const [id,rol] of [[101,'jefe'],[102,'admin']]) {
    seed(id,{tipo:'emergencia',trabajos:T80});
    for (const causaRaiz of [C1,C2,C1]) await expect(patch(id,{trabajosRealizados:T80,causaRaiz,solucionAplicada:null},rol));
    assert.equal(order(id).causa_raiz,C1,`La vuelta atrás se aplica (${rol})`);
  }
  // Vieja junto con los trabajos cambiados: no se aplica (como hoy) y lo demás sí.
  await expect(patch(101,{trabajosRealizados:`${T80} Se revisó también el tablero B.`,causaRaiz:C2,solucionAplicada:null},'jefe'));
  assert.equal(order(101).causa_raiz,C1); assert.match(order(101).trabajos_realizados,/tablero B/);
  // Vacía con los trabajos cambiados no borra.
  const T101=`${T80} Se revisó también el tablero B y el C.`;
  await expect(patch(101,{trabajosRealizados:T101,causaRaiz:null,solucionAplicada:null},'jefe'));
  assert.equal(order(101).causa_raiz,C1); assert.equal(order(101).trabajos_realizados,T101);
  // Vacía con los trabajos iguales se vacía si las reglas de siempre lo permiten: en proceso, sí; enviada, no.
  await expect(patch(101,{trabajosRealizados:T101,causaRaiz:null,solucionAplicada:null},'jefe'));
  assert.equal(order(101).causa_raiz,null);
  seed(103,{tipo:'emergencia',estado:'completada',trabajos:T80});
  sqlite.prepare('UPDATE ordenes SET causa_raiz=? WHERE id=103').run(CAUSA);
  assert.match((await expect(patch(103,{trabajosRealizados:T80,causaRaiz:null,solucionAplicada:null},'jefe'),400)).error,/al menos 20 caracteres/);
  assert.equal(order(103).causa_raiz,CAUSA);

  // ── K8: un texto igual al guardado salvo espacios alrededor no es un cambio ──
  const pasoConTexto=valorMedido=>JSON.stringify([{texto:'Medir la corriente de fase',estado:'pendiente',requiereValor:true,unidad:'A',esperadoMin:8,esperadoMax:12,valorMedido}]);
  for (const [id,guardado] of [[104,'aprox 14 '],[105,' aprox 14'],[106,'aprox 14\n']]) {
    // El celular lo compara y lo guarda recortado.
    seed(id,{checklist:pasoConTexto(guardado)});
    const marca=(await sync([{opId:`reglas-recorte-${id}`,tipo:'orden.paso',ordenId:id,idx:0,texto:'Medir la corriente de fase',estado:'ok',valor:guardado}])).resultados[0];
    assert.equal(marca.ok,true,`${JSON.stringify(guardado)}: ${marca.error}`);
    const paso=JSON.parse(order(id).checklist_ejecucion)[0];
    assert.deepEqual([paso.estado,paso.valorMedido],['ok','aprox 14'],JSON.stringify(guardado));
    // Por la ficha, con otros espacios alrededor.
    const base=order(id).checklist_ejecucion, l=JSON.parse(base); l[0]={...l[0],valorMedido:` ${guardado}\n`,notas:'Lectura aproximada, sin pinza.'};
    await expect(patch(id,{checklistEjecucion:JSON.stringify(l),checklistBase:base},'tecnico'));
    assert.equal(JSON.parse(order(id).checklist_ejecucion)[0].notas,'Lectura aproximada, sin pinza.');
  }
  const base104=order(104).checklist_ejecucion, otro104=JSON.parse(base104); otro104[0]={...otro104[0],valorMedido:'aprox 15'};
  assert.equal((await expect(patch(104,{checklistEjecucion:JSON.stringify(otro104),checklistBase:base104},'tecnico'),400)).error,PASO_SIN_NUMERO,'Otro texto sigue rechazado');

  // ── La lectura de liberación se escribe con textoDeNumero (K7): 12.345 no sale «12.345» ──
  assert.deepEqual(app.ordenes.validarLiberacionesEnRango('intervencion',[{etiqueta:'Corriente de fase',unidad:'A',minAceptable:8,maxAceptable:12,valorMedido:12.345,obligatoria:true}]).fuera,['Corriente de fase: leído 12.3450 A, normal 8 a 12 A']);
  assert.match((await expect(patch(87,{estado:'completada'},'tecnico'),400)).error,/· Corriente de fase: leído 12\.3450 A, normal 8 a 12 A\n/,'Al enviar a verificación');
  // El resumen del historial que deja registrarLiberacion.
  const resumenes=[], historial=await mopConHistorial(resumenes), ctxHistorial=fixture.ctx('/');
  seed(107,{tipo:'intervencion'});
  const l107=liberacion(107);
  await historial.mop.registrarLiberacion(ctxHistorial,historial.database.getDb(ctxHistorial),{id:107,estado:'en_proceso',asignadoA:3},{id:2,rol:'jefe'},{itemId:l107,valorMedido:12.345});
  assert.deepEqual(resumenes,['Liberación «Presión de línea»: 12.3450 psi — FUERA DE RANGO']);

  // ── El rango, la unidad y la lectura de un paso no se cambian durante la ejecución ──
  seed(108,{checklist:JSON.stringify([{texto:'Medir la corriente de fase',estado:'pendiente',requiereValor:true,unidad:'A',esperadoMin:8,esperadoMax:12},{texto:'Revisar tablero',estado:'pendiente'}])});
  const base108=order(108).checklist_ejecucion;
  const paso108=cambio=>{ const l=JSON.parse(base108); l[0]={...l[0],estado:'ok',...cambio}; return JSON.stringify(l); };
  for (const cambio of [{esperadoMin:null,esperadoMax:null},{esperadoMin:undefined},{esperadoMax:20},{requiereValor:false},{unidad:'V'},{unidad:null},{esperadoMin:null,esperadoMax:null,valorMedido:'aprox 14'}]) {
    for (const datos of [{checklistEjecucion:paso108(cambio),checklistBase:base108},{checklistEjecucion:paso108(cambio)}]) {
      assert.match((await expect(patch(108,datos,'tecnico'),400)).error,/No se pueden eliminar puntos/,JSON.stringify(datos));
    }
  }
  assert.equal(order(108).checklist_ejecucion,base108,'El rango queda');
  assert.equal((await expect(patch(108,{checklistEjecucion:paso108({valorMedido:'aprox 14'}),checklistBase:base108},'tecnico'),400)).error,PASO_SIN_NUMERO,'Un texto en ese paso sigue rechazado');
  await expect(patch(108,{checklistEjecucion:paso108({valorMedido:'10,4'}),checklistBase:base108},'tecnico'));
  assert.deepEqual(JSON.parse(order(108).checklist_ejecucion)[0],{...JSON.parse(base108)[0],estado:'ok',valorMedido:'10,4'},'Con su número entra como siempre');

  console.log(`PASS: independent OT verification (${fixture.requests} authenticated requests): execution evidence, independence, reviewer/backup, return/reopen history, pending PM, exactly-once advancement, immutable evidence, concurrency and rollback; root cause by management at review, MOP release rules and assigned-only MOP records; root cause and EOP hours only by management, no empty root cause once sent, ranged release readings need a number, checklist merged against the form's base; old tabs keep marked steps, key merge, ambiguous thousands never conform, reversa by state and assignment, resent completion without event, collapsed root cause rows; stored numbers read back unambiguously, ranged steps need a number, old tabs' grouped hours, reversa and root cause don't erase newer data, cancelled MOP frozen, concurrency 409 with its motivo; a step changed on both sides keeps the saved one (pasosSinAplicar, or 409 paso-cambio with a state change), soloCambios skips the old-tab rules, an old tab's root cause is stale only when the work changed, step text compared trimmed, release readings written unambiguously, step range, unit and reading protected. No network.`);
} finally { await fixture.close(); }
