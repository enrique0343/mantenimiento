import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { setup } from './test-support/sqlite-app.mjs';
const {api,sqlite,ctx,close}=await setup({modules:{rounds:'api/rondas/[...path].ts'}});
let checks=0;
const eq=(a,b,m)=>{assert.equal(a,b,m);checks++;};
// Actual D1-style transactional batches; fail atomically rather than Promise.all.
function statement(sql,args=[]){const s=sqlite.prepare(sql);return {bind(...v){return statement(sql,v)},async all(){return {results:s.all(...args),success:true}},async first(){return s.get(...args)??null},async run(){return {success:true,meta:s.run(...args)}}};}
const DB={prepare:sql=>statement(sql),async batch(qs){sqlite.exec('BEGIN');try{const r=[];for(const q of qs)r.push(await q.all());sqlite.exec('COMMIT');return r}catch(e){sqlite.exec('ROLLBACK');throw e}}};
async function call(path,{userId=1,rol='admin',data,method=data?'POST':'GET'}={}){const c=ctx(`/api/rondas${path}`,{method,data});c.testUser={id:userId,nombre:`User ${userId}`,rol};c.locals.runtime.env.DB=DB;const response=await api.rounds[method](c);return {status:response.status,...await response.json()};}
try{
 sqlite.exec(await fs.readFile('migrations/0051_rondas.sql','utf8'));
 sqlite.exec(`INSERT INTO usuarios(id,nombre,email,password_hash,rol) VALUES(2,'Inspector','i@example.invalid','x','tecnico'),(3,'Suplente','b@example.invalid','x','tecnico'),(4,'Jefe','j@example.invalid','x','jefe'),(5,'Relevo','r@example.invalid','x','tecnico'); INSERT INTO sucursales(id,nombre) VALUES(1,'Sede'),(2,'Otra'); INSERT INTO ubicaciones(id,nombre,sucursal_id) VALUES(1,'Quirófano',1),(2,'Otra sala',2); INSERT INTO activos(id,codigo,nombre,ubicacion_id,rubro) VALUES(1,'AC-01','Aire',1,'aires'); INSERT INTO proveedores(id,nombre) VALUES(1,'Especialista HVAC'); INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha,asignado_a) VALUES(1,1,'Servicio AC','mensual','2026-09-01',2); INSERT INTO ordenes(id,titulo,tipo,estado,activo_id,plan_id,asignado_a,creado_por,completada_en,verificado_por,verificado_en,trabajos_realizados,verificacion_notas) VALUES(1,'Último servicio','preventivo','cerrada',1,1,2,1,'2026-08-01T12:00:00Z',4,'2026-08-02T12:00:00Z','Limpieza y prueba','Prueba revisada');`);
 const original=sqlite.prepare('SELECT * FROM planes_mantenimiento').all();
 const config={effectiveFrom:'2026-10-01',name:'Quirófano mañana',siteId:1,locationId:1,shift:'mañana',timezoneOffset:'-06:00',time:'08:00',windowMinutes:60,ownerId:2,backupId:3,reviewerId:4,reviewerBackupId:5,reason:'Piloto aprobado',points:[{code:'ac',group:'hvac',label:'AC sin goteo',criterion:'Sin fuga ni alarma observada',active:true,frequency:'diaria',firstDate:'2026-10-01',evidencePolicy:'findings',assetId:1},{code:'puerta',group:'puertas',label:'Puerta segura',criterion:'Abre y cierra sin anomalía',active:true,frequency:'semanal',firstDate:'2026-10-01',evidencePolicy:'none',assetId:null}],notifications:{recipientIds:[4],events:['asignada','pendiente_validacion','validada','devuelta','vencida']}};
 eq((await call('/templates',{data:{...config,reviewerId:2}})).status,400,'independence config');
 eq((await call('/templates',{data:{...config,siteId:2}})).status,400,'cross-site');
 eq((await call('/templates',{userId:2,rol:'tecnico',data:config})).status,403);
 let r=await call('/templates',{data:config});eq(r.status,201,JSON.stringify(r));const templateId=r.template.id;
 r=await call('/generate',{data:{templateId,dateFrom:'2026-10-01',dateTo:'2026-10-03'}});eq(r.status,200,JSON.stringify(r));eq(r.executions.length,3);const id=r.executions[0].id;
 eq((await call('/generate',{data:{templateId,dateFrom:'2026-10-01',dateTo:'2026-10-03'}})).executions.length,3);eq(sqlite.prepare('SELECT COUNT(*) n FROM rondas_executions').get().n,3);
 r=await call(`/executions/${id}`,{userId:2,rol:'tecnico'});eq(r.points.length,2);eq(r.points[0].result,'pendiente');eq(r.equipment[0].planes[0].frecuencia,'mensual');
 eq((await call(`/executions/${id}/action`,{userId:2,rol:'tecnico',data:{action:'submit',expectedRevision:0}})).status,400,'cannot submit uninspected');
 eq((await call(`/executions/${id}/action`,{userId:1,data:{action:'save',expectedRevision:0,pointId:'ac',result:'conforme'}})).status,403,'no admin impersonation');
 const inspect=async(data,userId=2)=>await call(`/executions/${id}/action`,{userId,rol:'tecnico',data});
 r=await inspect({action:'save',expectedRevision:0,pointId:'ac',result:'hallazgo',notes:'Goteo visible',evidence:''});eq(r.status,400);
 r=await inspect({action:'save',expectedRevision:0,pointId:'ac',result:'hallazgo',notes:'Goteo visible',evidence:'Lectura y goteo documentados'});eq(r.status,200,JSON.stringify(r));
 eq(sqlite.prepare('SELECT COUNT(*) n FROM ordenes').get().n,1,'no OT before approval');eq(sqlite.prepare('SELECT COUNT(*) n FROM rondas_proposals').get().n,2,'mandatory PM request and actual-condition request separate');
 eq((await inspect({action:'save',expectedRevision:0,pointId:'puerta',result:'conforme'})).status,409,'stale form');
 eq((await inspect({action:'save',expectedRevision:1,pointId:'puerta',result:'no_aplica',notes:''})).status,400);
 r=await inspect({action:'save',expectedRevision:1,pointId:'puerta',result:'conforme'});eq(r.status,200);
 r=await inspect({action:'submit',expectedRevision:2});eq(r.execution.status,'pendiente_validacion');
 eq((await inspect({action:'approve',expectedRevision:3,reason:'Yo revisé'})).status,403,'executor cannot review');
 r=await call(`/executions/${id}/action`,{userId:5,rol:'tecnico',data:{action:'return',expectedRevision:3,reason:'Confirme condición de puerta'}});eq(r.execution.status,'devuelta');
 r=await inspect({action:'save',expectedRevision:4,pointId:'puerta',result:'conforme',notes:'Revisada otra vez'},3);eq(r.status,200);
 r=await inspect({action:'submit',expectedRevision:5},3);eq(r.status,200);
 r=await call(`/executions/${id}/action`,{userId:4,rol:'jefe',data:{action:'approve',expectedRevision:6,reason:'Puntos y evidencias revisados; acciones pendientes'}});eq(r.execution.status,'validada');eq(r.execution.executed_by,3);eq(r.execution.reviewed_by,4);
 r=await call(`/executions/${id}`);eq(r.proposals.length,2);eq(r.linkedOrders.length,0);
 const proposal=r.proposals.find(p=>p.kind==='preventivo');
 eq((await call(`/proposals/${proposal.id}/decision`,{userId:2,rol:'tecnico',data:{action:'approve'}})).status,403);
 eq((await call(`/proposals/${proposal.id}/decision`,{userId:4,rol:'jefe',data:{action:'approve',reason:'Prioridad evaluada'}})).status,400);
 const approval={action:'approve',reason:'Sin peligro inmediato, recuperación programada',priority:'alta',dueAt:'2026-10-04T16:00:00Z',assignedTo:2,executorType:'provider',providerId:1};
 r=await call(`/proposals/${proposal.id}/decision`,{userId:4,rol:'jefe',data:approval});eq(r.status,200,JSON.stringify(r));const orderId=r.orderId;assert.ok(orderId>1);checks++;
 eq((await call(`/proposals/${proposal.id}/decision`,{userId:4,rol:'jefe',data:approval})).orderId,orderId,'idempotent approval');eq(sqlite.prepare('SELECT COUNT(*) n FROM ordenes').get().n,2);
 r=await call(`/executions/${id}`);eq(r.execution.status,'validada');eq(r.linkedOrders[0].estado,'abierta');eq(r.equipment[0].planes[0].overdue,true,'tomorrow OT is not maintenance done');
 eq(sqlite.prepare('SELECT proxima_fecha FROM planes_mantenimiento WHERE id=1').get().proxima_fecha,original[0].proxima_fecha);eq(sqlite.prepare('SELECT frecuencia FROM planes_mantenimiento WHERE id=1').get().frecuencia,original[0].frecuencia);
 const snapshot=sqlite.prepare('SELECT snapshot_json,data_json FROM rondas_executions WHERE id=?').get(id);
 r=await call(`/templates/${templateId}/version`,{data:{...config,name:'Nueva versión',effectiveFrom:'2026-10-03',expectedVersion:1,points:[{...config.points[0],label:'Texto revisado'}],reason:'Nueva versión revisada'}});eq(r.status,200);
 eq(sqlite.prepare('SELECT snapshot_json FROM rondas_executions WHERE id=?').get(id).snapshot_json,snapshot.snapshot_json,'old snapshot immutable');
 assert.throws(()=>sqlite.exec("UPDATE rondas_template_versions SET reason='x'"),/immutable/);checks++;
 r=await call(`/executions/${r?.id??id}`);eq(r.status,200);
 const execution2=sqlite.prepare('SELECT id FROM rondas_executions WHERE scheduled_date=?').get('2026-10-02').id;
 r=await call(`/executions/${execution2}/action`,{data:{action:'reschedule',expectedRevision:0,dueAt:'2026-11-01T12:00:00Z',reason:'Acceso clínico diferido'}});eq(r.status,200);assert.notEqual(r.execution.due_at,r.execution.original_due_at);checks++;
 eq((await call('/notifications/process',{data:{}})).status,200);eq(sqlite.prepare("SELECT COUNT(*) n FROM rondas_notifications WHERE status='sent'").get().n,0,'no real email');
 eq((await call('/actions')).orders.length,2,'shared PM and derived actions');
 console.log(`PASS: ${checks} rounds integration assertions, real SQLite transactions; no network, email, production or PM calendar writes.`);
}finally{await close()}
