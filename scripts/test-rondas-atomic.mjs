import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { setup, root } from './test-support/sqlite-app.mjs';
const base=root;
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
async function fixture(points){
 let beforeBatch=null;
 const {api,sqlite,ctx,close}=await setup({modules:{rounds:'api/rondas/[...path].ts'}});
 function statement(sql,args=[]){const s=sqlite.prepare(sql);return {sql,bind(...v){return statement(sql,v)},async all(){return {results:s.all(...args),success:true}},async first(){return s.get(...args)??null},async run(){return {success:true,meta:s.run(...args)}}};}
 const DB={prepare:sql=>statement(sql),async batch(qs){if(beforeBatch)await beforeBatch(qs);sqlite.exec('BEGIN');try{const r=[];for(const q of qs)r.push(await q.all());sqlite.exec('COMMIT');return r}catch(e){sqlite.exec('ROLLBACK');throw e}}};
 async function call(path,{userId=1,rol='admin',data,method=data?'POST':'GET'}={}){const c=ctx(`/api/rondas${path}`,{method,data});c.testUser={id:userId,nombre:`User ${userId}`,rol};c.locals.runtime.env.DB=DB;const response=await api.rounds[method](c);return {status:response.status,...await response.json()};}
 sqlite.exec(await fs.readFile(base+'/migrations/0051_rondas.sql','utf8'));
 sqlite.exec(`INSERT INTO usuarios(id,nombre,email,password_hash,rol) VALUES(2,'Inspector','i@example.invalid','x','tecnico'),(3,'Reviewer','r@example.invalid','x','jefe'); INSERT INTO sucursales(id,nombre) VALUES(1,'Sede'); INSERT INTO ubicaciones(id,nombre,sucursal_id) VALUES(1,'Sala',1); INSERT INTO activos(id,codigo,nombre,ubicacion_id,rubro) VALUES(1,'AC-01','Aire',1,'aires'); INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha,asignado_a) VALUES(1,1,'Servicio AC','mensual','2026-09-01',2); INSERT INTO ordenes(id,titulo,tipo,estado,activo_id,plan_id,asignado_a,creado_por,completada_en,verificado_por,verificado_en,trabajos_realizados,verificacion_notas,created_at) VALUES(1,'Último servicio','preventivo','cerrada',1,1,2,1,'2026-08-01T12:00:00Z',3,'2026-08-02T12:00:00Z','Limpieza y prueba','Prueba revisada','2026-08-01T00:00:00Z');`);
 const point=code=>({code,group:'hvac',label:code,criterion:'Sin fuga ni alarma observada',active:true,frequency:'diaria',firstDate:'2026-10-01',evidencePolicy:'none',assetId:1});
 const config={effectiveFrom:'2026-10-01',name:'Mañana',siteId:1,locationId:1,shift:'mañana',timezoneOffset:'-06:00',time:'08:00',windowMinutes:60,ownerId:2,reviewerId:3,reason:'Piloto aprobado',points:(points??['ac']).map(point),notifications:{recipientIds:[],events:[]}};
 const t=await call('/templates',{data:config}); assert.equal(t.status,201,JSON.stringify(t));
 const g=await call('/generate',{data:{templateId:t.template.id,dateFrom:'2026-10-01',dateTo:'2026-10-01'}});assert.equal(g.status,200,JSON.stringify(g));const id=g.executions[0].id;
 const save=async(pointId='ac',rev=0,result='conforme')=>call(`/executions/${id}/action`,{userId:2,rol:'tecnico',data:{action:'save',pointId,expectedRevision:rev,result,notes:result==='hallazgo'?'Goteo confirmado':'',evidence:'Lectura de prueba'}});
 const approval={action:'approve',reason:'Prioridad evaluada',priority:'alta',dueAt:'2026-10-04T16:00:00Z',assignedTo:2};
 return {call,sqlite,close,save,approval,id,beforeBatch(fn){beforeBatch=fn;}};
}
const tableCounts=sqlite=>['rondas_proposals','rondas_proposal_links','rondas_order_links','rondas_events','rondas_notifications'].map(t=>sqlite.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n);
async function expectedStorageFailure(fn){const log=console.error;console.error=()=>{};try{return await fn();}finally{console.error=log;}}
{
 const f=await fixture();try{
  const before=tableCounts(f.sqlite);
  f.sqlite.exec(`CREATE TRIGGER fail_proposal BEFORE INSERT ON rondas_proposals BEGIN SELECT RAISE(ABORT,'injected proposal failure'); END;`);
  let r=await expectedStorageFailure(()=>f.save('ac',0,'hallazgo'));
  let execution=f.sqlite.prepare('SELECT * FROM rondas_executions').get();
  eq(r.status,500,'proposal failure reaches the caller');eq(execution.status,'pendiente');eq(execution.revision,0);eq(JSON.parse(execution.data_json)[0].result,'pendiente');eq(execution.equipment_snapshot_json,null);eq(tableCounts(f.sqlite),before,'no inspection, proposal, link, audit or notification is partly committed');
  f.sqlite.exec('DROP TRIGGER fail_proposal');
  r=await f.save('ac',0,'hallazgo');eq(r.status,200);eq(f.sqlite.prepare('SELECT COUNT(*) n FROM rondas_proposals').get().n,2,'retry atomically creates PM and condition actions');
  const beforeSubmit=tableCounts(f.sqlite);
  f.sqlite.exec(`CREATE TRIGGER fail_proposal BEFORE INSERT ON rondas_proposals BEGIN SELECT RAISE(ABORT,'injected proposal failure'); END;`);
  r=await expectedStorageFailure(()=>f.call(`/executions/${f.id}/action`,{userId:2,rol:'tecnico',data:{action:'submit',expectedRevision:1}}));
  execution=f.sqlite.prepare('SELECT * FROM rondas_executions').get();
  eq(r.status,500);eq(execution.status,'en_curso');eq(execution.revision,1);eq(execution.executed_at,null);eq(tableCounts(f.sqlite),beforeSubmit,'failed submit rolls back status and every dependent write');
  f.sqlite.exec('DROP TRIGGER fail_proposal');
  r=await f.call(`/executions/${f.id}/action`,{userId:2,rol:'tecnico',data:{action:'submit',expectedRevision:1}});eq(r.status,200);eq(r.execution.status,'pendiente_validacion');eq(f.sqlite.prepare('SELECT COUNT(*) n FROM rondas_proposals').get().n,2,'submit reuses required requests');
 }finally{await f.close()}
}
{
 const f=await fixture();try{
  const before=tableCounts(f.sqlite);
  f.beforeBatch(qs=>{if(qs.some(q=>q.sql.startsWith('UPDATE rondas_executions SET'))){f.beforeBatch(null);f.sqlite.exec("UPDATE rondas_executions SET revision=revision+1,mutation_token='concurrent-writer'");}});
  const r=await f.save('ac',0,'hallazgo');
  eq(r.status,409,'a writer racing after preparation wins the revision guard');eq(tableCounts(f.sqlite),before,'losing round CAS cannot insert proposals, links, audit or notifications');eq(JSON.parse(f.sqlite.prepare('SELECT data_json FROM rondas_executions').get().data_json)[0].result,'pendiente');
 }finally{await f.close()}
}
{
 const f=await fixture();try{
  const before=tableCounts(f.sqlite);
  f.beforeBatch(qs=>{if(qs.some(q=>q.sql.startsWith('INSERT OR IGNORE INTO rondas_proposals'))){f.beforeBatch(null);f.sqlite.exec("UPDATE rondas_executions SET revision=revision+1,mutation_token='concurrent-writer'");}});
  const r=await f.call(`/executions/${f.id}/order`,{userId:2,rol:'tecnico',data:{pointId:'ac',kind:'correctivo',reason:'Observación documentada'}});
  eq(r.status,409,'a direct action request must use the same round state it read');eq(tableCounts(f.sqlite),before,'losing direct proposal race is write-free');
 }finally{await f.close()}
}
{
 const f=await fixture(['ac2','ac','%','_']);try{
  for(const [revision,point] of ['ac2','ac','%','_'].entries())eq((await f.save(point,revision,'hallazgo')).status,200);
  eq(f.sqlite.prepare("SELECT COUNT(*) n FROM rondas_proposals WHERE kind='correctivo'").get().n,4,'exact corrective identity handles prefixes and LIKE wildcard characters');
  eq(f.sqlite.prepare("SELECT COUNT(*) n FROM rondas_proposals WHERE kind='preventivo'").get().n,1,'one PM request per exact cycle across different points');
  eq(f.sqlite.prepare('SELECT COUNT(*) n FROM rondas_proposal_links').get().n,8,'all four points retain separate condition and shared PM links');
  eq(f.sqlite.prepare("SELECT COUNT(*) n FROM rondas_events WHERE action='solicitud_creada'").get().n,5,'only newly-created requests produce creation audit events');
 }finally{await f.close()}
}
{
 const f=await fixture();try{
  f.sqlite.exec(`INSERT INTO ordenes(id,titulo,tipo,estado,activo_id,plan_id,asignado_a,creado_por,created_at,vencimiento) VALUES(2,'Old open cycle','preventivo','abierta',1,1,2,1,'2026-06-01T00:00:00Z','2026-06-20T00:00:00Z')`);
  eq((await f.save()).status,200);
  const p=f.sqlite.prepare("SELECT * FROM rondas_proposals WHERE kind='preventivo'").get();
  const r=await f.call(`/proposals/${p.id}/decision`,{data:f.approval});eq(r.status,409,'an older legacy OT cannot be silently assigned to the current cycle');eq(r.candidateOrders[0].id,2);eq(f.sqlite.prepare('SELECT status FROM rondas_proposals').get().status,'pendiente_aprobacion');
 }finally{await f.close()}
}
{
 const f=await fixture();try{
  eq((await f.save()).status,200);
  const p=f.sqlite.prepare("SELECT * FROM rondas_proposals WHERE kind='preventivo'").get();
  f.sqlite.exec(`UPDATE planes_mantenimiento SET frecuencia='anual' WHERE id=1`);
  const r=await f.call(`/proposals/${p.id}/decision`,{data:f.approval});eq(r.status,409,'changed real frequency invalidates stale cycle proposal even with unchanged configured due date');eq(f.sqlite.prepare('SELECT COUNT(*) n FROM ordenes').get().n,1);
 }finally{await f.close()}
}

for(const scenario of [
 {name:'frequency change',sql:"UPDATE planes_mantenimiento SET frecuencia='anual' WHERE id=1",open:0},
 {name:'concurrent generated PM',sql:"INSERT INTO ordenes(titulo,tipo,estado,activo_id,plan_id,asignado_a,creado_por) VALUES('Concurrent PM','preventivo','abierta',1,1,2,1)",open:1},
 {name:'new verified history',sql:"INSERT INTO ordenes(titulo,tipo,estado,activo_id,plan_id,asignado_a,creado_por,completada_en,verificado_por,verificado_en,trabajos_realizados,verificacion_notas) VALUES('New verified service','preventivo','cerrada',1,1,2,1,'2026-10-01T12:00:00Z',3,'2026-10-02T12:00:00Z','Trabajo documentado','Verificación documentada')",open:0},
]){
 const f=await fixture();try{
  eq((await f.save()).status,200);
  const p=f.sqlite.prepare("SELECT * FROM rondas_proposals WHERE kind='preventivo'").get();const before=tableCounts(f.sqlite);
  f.beforeBatch(qs=>{if(qs.some(q=>q.sql.startsWith("UPDATE rondas_proposals SET status='aprobada'"))){f.beforeBatch(null);f.sqlite.exec(scenario.sql);}});
  const r=await f.call(`/proposals/${p.id}/decision`,{data:f.approval});
  eq(r.status,409,`approval rejects ${scenario.name} after prevalidation but before its batch`);
  eq(f.sqlite.prepare("SELECT COUNT(*) n FROM ordenes WHERE estado='abierta'").get().n,scenario.open,'no stale or duplicate order created');
  eq(f.sqlite.prepare('SELECT status FROM rondas_proposals WHERE id=?').get(p.id).status,'pendiente_aprobacion');
  eq(tableCounts(f.sqlite),before,'failed approval writes no links or audit');
 }finally{await f.close()}
}
{
 const f=await fixture();try{
  eq((await f.save()).status,200);
  const p=f.sqlite.prepare("SELECT * FROM rondas_proposals WHERE kind='preventivo'").get();
  f.sqlite.exec("INSERT INTO ordenes(id,titulo,tipo,estado,activo_id,plan_id,asignado_a,creado_por) VALUES(2,'Selected PM','preventivo','abierta',1,1,2,1)");
  const before=tableCounts(f.sqlite);
  f.beforeBatch(qs=>{if(qs.some(q=>q.sql.startsWith("UPDATE rondas_proposals SET status='aprobada'"))){f.beforeBatch(null);f.sqlite.exec("UPDATE ordenes SET estado='cerrada' WHERE id=2");}});
  const r=await f.call(`/proposals/${p.id}/decision`,{data:{...f.approval,existingOrderId:2}});
  eq(r.status,409,'selected OT closing during approval invalidates its link');eq(tableCounts(f.sqlite),before);
 }finally{await f.close()}
}

{
 const f=await fixture();try{
  eq((await f.save()).status,200);
  const snapshot=f.sqlite.prepare('SELECT equipment_snapshot_json FROM rondas_executions').get().equipment_snapshot_json;
  eq(JSON.parse(snapshot)[0].planes[0].overdue,true);
  f.sqlite.exec("INSERT INTO ordenes(titulo,tipo,estado,activo_id,plan_id,asignado_a,creado_por,completada_en,verificado_por,verificado_en,trabajos_realizados,verificacion_notas) VALUES('Completed while round open','preventivo','cerrada',1,1,2,1,'2026-10-01T12:00:00Z',3,'2026-10-02T12:00:00Z','Servicio documentado','Revisión documentada'); UPDATE planes_mantenimiento SET proxima_fecha='2026-11-01' WHERE id=1");
  eq((await f.save('ac',1)).status,200);
  eq(f.sqlite.prepare('SELECT COUNT(*) n FROM rondas_proposals').get().n,1,'frozen overdue snapshot cannot create a new recovery action after live verified maintenance');
  eq(f.sqlite.prepare('SELECT equipment_snapshot_json FROM rondas_executions').get().equipment_snapshot_json,snapshot,'original inspection snapshot remains immutable during the live recheck');
 }finally{await f.close()}
}
{
 const f=await fixture();try{
  const request=reason=>f.call(`/executions/${f.id}/order`,{userId:2,rol:'tecnico',data:{pointId:'ac',kind:'correctivo',reason}});
  const first=await request('Goteo visible');eq(first.status,'pendiente_aprobacion');
  const repeat=await request('  GOTEO   visible  ');eq(repeat.proposalId,first.proposalId,'whitespace/case only is the same finding');
  const different=await request('Ruido anormal');eq(different.status,'pendiente_aprobacion');eq(different.proposalId!==first.proposalId,true,'different symptom remains a separate request');
  eq(f.sqlite.prepare("SELECT COUNT(*) n FROM rondas_proposals WHERE kind='correctivo'").get().n,2);
 }finally{await f.close()}
}
console.log(`PASS: ${checks} rounds integrity checks: atomic save/submit, stale CAS, exact identity/cycle dedup; local SQLite only.`);
