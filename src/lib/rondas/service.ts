import { z } from 'zod';
import { ROUND_GROUPS } from './catalog';
import { configSchema, daySchema, pointDue, dueAt, temporalStatus, ensure, RoundError, type RoundConfig } from './model';
import { getEquipmentContext, getAssetMaintenance } from './equipment';
type User={id:number;nombre:string;rol:string};
const now=()=>new Date().toISOString();
const token=()=>crypto.randomUUID();
const json=(v:any)=>JSON.stringify(v);
const stmt=(db:D1Database,sql:string,...args:any[])=>db.prepare(sql).bind(...args);
const all=async(db:D1Database,sql:string,...args:any[])=>((await stmt(db,sql,...args).all()).results as any[]);
const one=async(db:D1Database,sql:string,...args:any[])=>await stmt(db,sql,...args).first<any>();
const admin=(u:User)=>ensure(['admin','jefe'].includes(u.rol),403,'Solo jefe o administrador');
const canRead=(u:User,r:any)=>['admin','jefe','visualizador'].includes(u.rol)||[r.owner_id,r.backup_id,r.reviewer_id,r.reviewer_backup_id].includes(u.id);
const publicRow=(r:any)=>({...r,snapshot_json:undefined,data_json:undefined,equipment_snapshot_json:undefined,mutation_token:undefined,temporalStatus:temporalStatus(r)});
const readRow=async(db:D1Database,id:number,u:User)=>{const r=await one(db,'SELECT * FROM rondas_executions WHERE id=?',id);ensure(r,404,'Ronda no encontrada');ensure(canRead(u,r),403,'Ronda no asignada a este usuario');return r;};
async function validateReferences(db:D1Database,c:RoundConfig){
 const location=await one(db,'SELECT * FROM ubicaciones WHERE id=? AND activa=1',c.locationId);
 ensure(location&&location.sucursal_id===c.siteId,400,'Ubicación y sede no corresponden');
 ensure(await one(db,'SELECT id FROM sucursales WHERE id=? AND activa=1',c.siteId),400,'Sede inactiva');
 for(const id of new Set([c.ownerId,c.backupId,c.reviewerId,c.reviewerBackupId,...c.notifications.recipientIds].filter(Boolean))){
  const user=await one(db,'SELECT id,rol FROM usuarios WHERE id=? AND activo=1',id);
  ensure(user,400,'Usuario inexistente o inactivo');
  if([c.ownerId,c.backupId,c.reviewerId,c.reviewerBackupId].includes(id as number))ensure(['admin','jefe','tecnico'].includes(user.rol),400,'El responsable debe ser personal operativo');
 }
 const equipment=await getEquipmentContext(db,c.locationId);
 for(const p of c.points)if(p.assetId)ensure(equipment.some((a:any)=>a.id===p.assetId),400,'El equipo debe pertenecer a la zona o sus subzonas');
}
function notificationStatements(db:D1Database,r:any,c:RoundConfig,event:string,revision:number,key:string,date:string){
 if(!c.notifications.events.includes(event as any))return [];
 return [...new Set(c.notifications.recipientIds)].map(id=>stmt(db,`INSERT OR IGNORE INTO rondas_notifications(execution_id,event,event_revision,recipient_id,status,created_at) SELECT id,?,?,?,'dry_run',? FROM rondas_executions WHERE id=? AND mutation_token=?`,event,revision,id,date,r.id,key));
}
type MutationExtra=(key:string,date:string)=>D1PreparedStatement[];
async function mutate(db:D1Database,r:any,u:User,action:string,details:any,fields:Record<string,any>,extra:MutationExtra[]=[]){
 const date=now(),key=token();
 const allowed=['status','data_json','equipment_snapshot_json','executed_by','executed_at','reviewed_by','reviewed_at','due_at'];
 const entries=Object.entries(fields);ensure(entries.every(([k])=>allowed.includes(k)),500,'Cambio inválido');
 const sql=`UPDATE rondas_executions SET ${entries.map(([k])=>`${k}=?`).join(',')}${entries.length?',':''}revision=revision+1,mutation_token=? WHERE id=? AND revision=?`;
 const c=JSON.parse(r.snapshot_json) as RoundConfig;
 const results=await db.batch([
  stmt(db,sql,...entries.map(([,v])=>v),key,r.id,r.revision),
  stmt(db,`INSERT INTO rondas_events(execution_id,action,actor_id,actor_name,details,created_at) SELECT id,?,?,?,?,? FROM rondas_executions WHERE id=? AND mutation_token=?`,action,u.id,u.nombre,json(details),date,r.id,key),
  ...notificationStatements(db,r,c,action,r.revision+1,key,date),
  ...extra.flatMap(build=>build(key,date)),
  stmt(db,'SELECT * FROM rondas_executions WHERE id=?',r.id),
 ]);
 const saved=results[results.length-1].results[0] as any;
 ensure(saved.mutation_token===key,409,'La ronda cambió; actualice antes de guardar');
 return saved;
}
export async function listRounds(db:D1Database,u:User){
 ensure(['admin','jefe','tecnico','visualizador'].includes(u.rol),403,'Sin permisos');
 const templates=await all(db,'SELECT * FROM rondas_templates ORDER BY id DESC');
 const executions=(await all(db,'SELECT * FROM rondas_executions ORDER BY scheduled_date DESC,id DESC LIMIT 1000')).filter(r=>canRead(u,r));
 return {templates:templates.map(t=>({id:t.id,name:t.name,version:t.version,config:JSON.parse(t.config_json)})).filter(t=>['admin','jefe','visualizador'].includes(u.rol)||[t.config.ownerId,t.config.backupId,t.config.reviewerId,t.config.reviewerBackupId].includes(u.id)),executions:executions.map(publicRow)};
}
export async function catalog(db:D1Database,u:User){
 ensure(['admin','jefe','tecnico','visualizador'].includes(u.rol),403,'Sin permisos');
 return {groups:ROUND_GROUPS,sites:await all(db,'SELECT id,nombre FROM sucursales WHERE activa=1'),locations:await all(db,'SELECT id,nombre,sucursal_id AS sucursalId,padre_id AS padreId FROM ubicaciones WHERE activa=1'),users:await all(db,'SELECT id,nombre,rol FROM usuarios WHERE activo=1'),assets:await all(db,'SELECT id,codigo,nombre,ubicacion_id AS ubicacionId FROM activos WHERE estado<>?', 'baja'),providers:await all(db,'SELECT id,nombre FROM proveedores WHERE activo=1')};
}
export async function saveTemplate(db:D1Database,u:User,body:any,id?:number){
 admin(u);const parsed=configSchema.safeParse(body);if(!parsed.success)throw new RoundError(400,parsed.error.issues.map(i=>i.message).join('; '));const c=parsed.data;
 await validateReferences(db,c);const date=now(),key=token();
 if(id){
  const old=await one(db,'SELECT * FROM rondas_templates WHERE id=?',id);ensure(old,404,'Plantilla inexistente');ensure(body.expectedVersion===old.version,409,'La plantilla cambió');
  await db.batch([
   stmt(db,'UPDATE rondas_templates SET name=?,version=version+1,config_json=?,mutation_token=? WHERE id=? AND version=?',c.name,json(c),key,id,old.version),
   stmt(db,'INSERT INTO rondas_template_versions(template_id,version,config_json,reason,created_by,created_at) SELECT id,version,config_json,?,?,? FROM rondas_templates WHERE id=? AND mutation_token=?',c.reason,u.id,date,id,key),
  ]);
  ensure((await one(db,'SELECT mutation_token FROM rondas_templates WHERE id=?',id)).mutation_token===key,409,'La plantilla cambió');
 }else{
  await db.batch([
   stmt(db,'INSERT INTO rondas_templates(name,version,config_json,mutation_token,created_by,created_at) VALUES(?,1,?,?,?,?)',c.name,json(c),key,u.id,date),
   stmt(db,'INSERT INTO rondas_template_versions(template_id,version,config_json,reason,created_by,created_at) SELECT id,version,config_json,?,?,? FROM rondas_templates WHERE mutation_token=?',c.reason,u.id,date,key),
  ]);id=(await one(db,'SELECT id FROM rondas_templates WHERE mutation_token=?',key)).id;
 }
 return {template:{id,name:c.name,version:(await one(db,'SELECT version FROM rondas_templates WHERE id=?',id)).version,config:c}};
}
export async function generate(db:D1Database,u:User,body:any){
 admin(u);const b=z.object({templateId:z.number().int().positive(),dateFrom:daySchema,dateTo:daySchema}).parse(body);
 const days=Math.round((Date.parse(b.dateTo)-Date.parse(b.dateFrom))/86400000);ensure(days>=0&&days<31,400,'Seleccione entre 1 y 31 días');
 const t=await one(db,'SELECT * FROM rondas_templates WHERE id=?',b.templateId);ensure(t,404,'Plantilla inexistente');const current=JSON.parse(t.config_json) as RoundConfig;
 await validateReferences(db,current);const versions=await all(db,'SELECT version,config_json FROM rondas_template_versions WHERE template_id=? ORDER BY version DESC',t.id);const result=[];
 for(let i=0;i<=days;i++){
  const day=new Date(Date.parse(b.dateFrom)+i*86400000).toISOString().slice(0,10);const version=versions.find(v=>JSON.parse(v.config_json).effectiveFrom<=day);if(!version)continue;const c=JSON.parse(version.config_json) as RoundConfig;const points=c.points.filter(p=>pointDue(p,day)).map(p=>({...p,id:p.code,result:'pendiente',notes:'',evidence:'',observed_by:null,observed_at:null}));
  if(!points.length)continue;
  const key=token(),date=now(),due=dueAt(c,day);
  await db.batch([
   stmt(db,`INSERT OR IGNORE INTO rondas_executions(template_id,template_version,name,site_id,location_id,scheduled_date,shift,due_at,original_due_at,owner_id,backup_id,reviewer_id,reviewer_backup_id,snapshot_json,data_json,mutation_token,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,t.id,version.version,c.name,c.siteId,c.locationId,day,c.shift,due,due,c.ownerId,c.backupId??null,c.reviewerId,c.reviewerBackupId??null,json(c),json(points),key,date),
   stmt(db,`INSERT INTO rondas_events(execution_id,action,actor_id,actor_name,details,created_at) SELECT id,'generada',?,?,?,? FROM rondas_executions WHERE mutation_token=?`,u.id,u.nombre,json({templateVersion:version.version,scheduledDate:day}),date,key),
  ]);
  const r=await one(db,'SELECT * FROM rondas_executions WHERE template_id=? AND scheduled_date=? AND shift=?',t.id,day,c.shift);
  if(r.mutation_token===key){const ns=notificationStatements(db,r,c,'asignada',0,key,date);if(ns.length)await db.batch(ns);}
  result.push(publicRow(r));
 }
 return {executions:result};
}
export async function detail(db:D1Database,u:User,id:number){
 const r=await readRow(db,id,u);const linkedOrders=await all(db,`SELECT DISTINCT o.id,o.titulo,o.estado,o.tipo,o.prioridad,o.vencimiento,o.asignado_a AS asignadoA,l.point_id AS pointId FROM rondas_order_links l JOIN ordenes o ON o.id=l.order_id WHERE l.execution_id=?`,id);
 const proposals=await all(db,'SELECT p.* FROM rondas_proposal_links l JOIN rondas_proposals p ON p.id=l.proposal_id WHERE l.execution_id=?',id);
 const points=JSON.parse(r.data_json).map((p:any)=>({...p,order_id:linkedOrders.find(o=>o.pointId===p.id)?.id??null}));
 return {execution:publicRow(r),points,equipment:r.equipment_snapshot_json?JSON.parse(r.equipment_snapshot_json):await getEquipmentContext(db,r.location_id),equipmentCaptured:!!r.equipment_snapshot_json,linkedOrders,proposals:proposals.map(p=>({...p,mutation_token:undefined})),events:await all(db,'SELECT * FROM rondas_events WHERE execution_id=? ORDER BY id',id),notifications:await all(db,'SELECT * FROM rondas_notifications WHERE execution_id=? ORDER BY id',id)};
}
async function autoProposalStatements(db:D1Database,r:any,u:User,points:any[],equipment:any[]):Promise<MutationExtra[]>{
 // Prepare reads first; inspection, mandatory requests, links and audit commit
 // together. Every proposal write is guarded by the successful round CAS.
 const extra:MutationExtra[]=[];
 const liveAssets=new Map<number,any>();
 for(const point of points){
  if(point.result==='pendiente')continue;
  if(point.assetId&&!liveAssets.has(point.assetId))liveAssets.set(point.assetId,await getAssetMaintenance(db,point.assetId));
  // Frozen equipment is audit evidence. New requests must use current verified history.
  const asset=point.assetId?liveAssets.get(point.assetId):null;
  for(const plan of asset?.planes??[])if(plan.activo&&plan.overdue&&plan.evidenceStatus==='verificado'){
   const request=await prepareProposal(db,u,r,points,{pointId:point.id,kind:'preventivo',planId:plan.id,cycleId:plan.cycleId,reason:`Preventivo vencido según ejecución verificada y frecuencia vigente; próxima fecha calculada ${plan.nextDue}; confirmar prioridad, fecha y ejecutor.`,automatic:true});
   extra.push(request.build);
  }
  if(point.result==='hallazgo')extra.push((await prepareProposal(db,u,r,points,{pointId:point.id,kind:'correctivo',reason:point.notes,automatic:true})).build);
 }
 return extra;
}
export async function action(db:D1Database,u:User,id:number,body:any){
 ensure(['admin','jefe','tecnico'].includes(u.rol),403,'El usuario ya no tiene un rol operativo');
 let r=await readRow(db,id,u);ensure(Number.isInteger(body.expectedRevision)&&body.expectedRevision===r.revision,409,'La ronda cambió; actualice antes de guardar');
 const editable=['pendiente','en_curso','devuelta'].includes(r.status),points=JSON.parse(r.data_json),date=now();
 const reason=String(body.reason??'').trim();
 if(body.action==='save'){
  ensure([r.owner_id,r.backup_id].includes(u.id),403,'Solo el encargado o suplente puede ejecutar');ensure(editable,409,'La ronda no está abierta para inspección');
  const p=points.find((v:any)=>v.id===body.pointId);ensure(p,404,'Punto inexistente');
  ensure(['conforme','hallazgo','no_aplica'].includes(body.result),400,'Seleccione un resultado');
  const notes=String(body.notes??'').trim(),evidence=String(body.evidence??'').trim();ensure(notes.length<=4000&&evidence.length<=2000,400,'Texto demasiado largo');
  if(body.result!=='conforme')ensure(notes.length>=3,400,'El hallazgo o No aplica requiere motivo');
  if(p.mandatory&&body.result==='no_aplica')throw new RoundError(400,'Control obligatorio: solicite una revisión formal; no puede excluirse durante la ronda');
  let photo:any=null;
  if(body.evidenceId!=null){ensure(Number.isSafeInteger(body.evidenceId),400,'Fotografía inválida');photo=await one(db,'SELECT id,filename,uploaded_by,created_at FROM rondas_evidence WHERE id=? AND execution_id=? AND point_id=?',body.evidenceId,r.id,p.id);ensure(photo,400,'La foto no pertenece a este punto y ronda');}
  if(p.measurementType==='pressure'||p.photoRequired)ensure(body.result!=='no_aplica',400,'El control con medición/foto obligatoria permanece pendiente; requiere revisión del supervisor');
  if(p.measurementType==='pressure'){
   ensure(typeof body.measurementValue==='number'&&Number.isFinite(body.measurementValue)&&p.measurementUnit,400,'Registre presión numérica en la unidad configurada');
   const outside=(p.minValue!=null&&body.measurementValue<p.minValue)||(p.maxValue!=null&&body.measurementValue>p.maxValue);
   if(outside)ensure(body.result==='hallazgo',400,'La presión está fuera de los límites aprobados; registre hallazgo');
   if(p.photoRequired&&p.evidenceId&&p.measurementValue!==body.measurementValue)ensure(body.evidenceId!==p.evidenceId,400,'Una nueva lectura requiere una nueva fotografía');
  }
  if(p.photoRequired)ensure(photo,400,'Fotografía del indicador obligatoria; el punto permanece pendiente');
  if(p.evidencePolicy==='always'||(p.evidencePolicy==='findings'&&body.result==='hallazgo'))ensure(evidence.length>=3||photo,400,'Registre evidencia del control (lectura, prueba o referencia; foto solo si aporta)');
  const before={...p};Object.assign(p,{result:body.result,notes,evidence,measurementValue:p.measurementType==='pressure'?body.measurementValue:null,evidenceId:photo?.id??null,evidencePhoto:photo?{id:photo.id,url:`/api/rondas/evidence?id=${photo.id}`,nombre:photo.filename,uploadedBy:photo.uploaded_by,uploadedAt:photo.created_at}:null,observed_by:u.id,observed_name:u.nombre,observed_at:date});
  const equipment=r.equipment_snapshot_json?JSON.parse(r.equipment_snapshot_json):await getEquipmentContext(db,r.location_id,date);
  const requests=await autoProposalStatements(db,r,u,points,equipment);
  r=await mutate(db,r,u,'punto_guardado',{pointId:p.id,before,after:p,actingAs:u.id===r.backup_id?'suplente':'encargado'},{status:'en_curso',data_json:json(points),equipment_snapshot_json:json(equipment)},requests);
 }else if(body.action==='submit'){
  ensure([r.owner_id,r.backup_id].includes(u.id),403,'Solo encargado o suplente');ensure(editable,409,'La ronda ya fue enviada');ensure(points.every((p:any)=>p.result!=='pendiente'),400,'Quedan puntos pendientes');
  const requests=await autoProposalStatements(db,r,u,points,JSON.parse(r.equipment_snapshot_json??'[]'));
  r=await mutate(db,r,u,'pendiente_validacion',{pointCount:points.length,actingAs:u.id===r.backup_id?'suplente':'encargado'},{status:'pendiente_validacion',executed_by:u.id,executed_at:date},requests);
 }else if(body.action==='approve'||body.action==='return'){
  ensure([r.reviewer_id,r.reviewer_backup_id].includes(u.id),403,'Solo el verificador designado o su relevo');ensure(r.status==='pendiente_validacion',409,'No está pendiente de validación');
  ensure(r.executed_by!==u.id&&!points.some((p:any)=>p.observed_by===u.id),403,'No puede verificar su propio trabajo');ensure(reason.length>=3&&reason.length<=4000,400,'Registre comprobación u observaciones');
  const approved=body.action==='approve';r=await mutate(db,r,u,approved?'validada':'devuelta',{reason,actingAs:u.id===r.reviewer_backup_id?'relevo_verificador':'verificador'},{status:approved?'validada':'devuelta',reviewed_by:u.id,reviewed_at:date});
 }else if(body.action==='reschedule'){
  admin(u);ensure(editable,409,'No se reprograma una ronda enviada o finalizada');ensure(reason.length>=3,400,'Motivo requerido');ensure(!Number.isNaN(Date.parse(body.dueAt)),400,'Nueva fecha inválida');
  r=await mutate(db,r,u,'reprogramada',{reason,previousDue:r.due_at,originalDue:r.original_due_at,newDue:body.dueAt},{due_at:new Date(body.dueAt).toISOString()});
 }else if(body.action==='miss'){
  admin(u);ensure(editable,409,'Ronda finalizada');ensure(reason.length>=3,400,'Motivo requerido');r=await mutate(db,r,u,'omitida',{reason},{status:'omitida'});
 }else throw new RoundError(400,'Acción desconocida');
 return {execution:publicRow(r)};
}
async function prepareProposal(db:D1Database,u:User,r:any,points:any[],body:any){
 const p=points.find((p:any)=>p.id===body.pointId);ensure(p,404,'Punto inexistente');
 ensure(['correctivo','preventivo'].includes(body.kind),400,'Tipo de acción inválido');const reason=String(body.reason??'').trim();ensure(reason.length>=3&&reason.length<=4000,400,'Describa el hallazgo o atraso');
 let plan:any=null,maintenance:any=null;if(body.kind==='preventivo'){
  ensure(p.assetId&&Number.isInteger(body.planId),400,'Seleccione equipo y actividad preventiva existentes');
  plan=await one(db,'SELECT * FROM planes_mantenimiento WHERE id=? AND activo_id=? AND activo=1',body.planId,p.assetId);ensure(plan,400,'Plan ajeno al equipo o inactivo');maintenance=(await getAssetMaintenance(db,p.assetId))?.planes.find((v:any)=>v.id===plan.id);
  if(body.automatic)ensure(maintenance?.overdue&&maintenance.evidenceStatus==='verificado'&&maintenance.cycleId===body.cycleId,409,'El historial preventivo cambió durante el guardado; actualice para revisar su estado real');
 }
 const proposalKey=token();
 const normalizeReason=(value:string)=>value.trim().replace(/\s+/g,' ').toLocaleLowerCase('es');
 const normalizedReason=normalizeReason(reason);
 const reasonFingerprint=plan?'':Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalizedReason)))).map(v=>v.toString(16).padStart(2,'0')).join('');
 const baseKey=plan?`pm:${maintenance?.cycleId??`${p.assetId}:${plan.id}:${plan.proxima_fecha}`}`:`condition:${r.location_id}:${p.assetId??'zone'}:${p.code}:${reasonFingerprint}`;
 let dedupKey=baseKey;
 if(!plan){
  // Compare the actual identities, never a LIKE prefix: codes such as ac/ac2,
  // '%' or '_' must not absorb another control's condition request.
  // Different symptoms on a broad control remain distinct requests; only exact
  // normalized observations reuse a request. A chief can link related OTs explicitly.
  const previous=(await all(db,`SELECT p.id,p.order_id,p.dedup_key,p.reason,o.estado FROM rondas_proposals p JOIN rondas_executions source ON source.id=p.execution_id LEFT JOIN ordenes o ON o.id=p.order_id WHERE p.kind='correctivo' AND source.location_id=? AND p.asset_id IS ? AND p.point_id=? ORDER BY p.id DESC`,r.location_id,p.assetId??null,p.id)).find(v=>normalizeReason(v.reason)===normalizedReason);
  if(previous&&['cerrada','cancelada'].includes(previous.estado))dedupKey=`${baseKey}:after:${previous.order_id}`;
  else if(previous)dedupKey=previous.dedup_key;
 }
 const build:MutationExtra=(executionKey,date)=>{
  const guard='EXISTS(SELECT 1 FROM rondas_executions WHERE id=? AND mutation_token=?)';
  return [
   stmt(db,`INSERT OR IGNORE INTO rondas_proposals(execution_id,point_id,asset_id,plan_id,kind,reason,cycle_date,dedup_key,created_by,created_at,mutation_token) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}`,r.id,p.id,p.assetId??null,plan?.id??null,body.kind,reason,plan?.proxima_fecha??null,dedupKey,u.id,date,proposalKey,r.id,executionKey),
   stmt(db,`INSERT OR IGNORE INTO rondas_proposal_links(execution_id,point_id,proposal_id) SELECT ?,?,id FROM rondas_proposals WHERE dedup_key=? AND ${guard}`,r.id,p.id,dedupKey,r.id,executionKey),
   stmt(db,`INSERT OR IGNORE INTO rondas_order_links(execution_id,point_id,order_id,proposal_id) SELECT ?,?,order_id,id FROM rondas_proposals WHERE dedup_key=? AND order_id IS NOT NULL AND ${guard}`,r.id,p.id,dedupKey,r.id,executionKey),
   stmt(db,`INSERT INTO rondas_events(execution_id,action,actor_id,actor_name,details,created_at) SELECT ?,'solicitud_creada',?,?,?,? FROM rondas_proposals WHERE mutation_token=? AND ${guard}`,r.id,u.id,u.nombre,json({pointId:p.id,kind:body.kind,reason,automatic:!!body.automatic}),date,proposalKey,r.id,executionKey),
  ];
 };
 return {dedupKey,proposalKey,build};
}
export async function createProposal(db:D1Database,u:User,executionId:number,body:any){
 ensure(['admin','jefe','tecnico'].includes(u.rol),403,'El usuario ya no tiene un rol operativo');
 const r=await readRow(db,executionId,u);ensure(['admin','jefe'].includes(u.rol)||[r.owner_id,r.backup_id].includes(u.id),403,'Sin permiso para solicitar acciones');
 const request=await prepareProposal(db,u,r,JSON.parse(r.data_json),body);
 const results=await db.batch([
  ...request.build(r.mutation_token,now()),
  stmt(db,'SELECT p.* FROM rondas_proposals p WHERE p.dedup_key=? AND EXISTS(SELECT 1 FROM rondas_executions WHERE id=? AND mutation_token=?)',request.dedupKey,r.id,r.mutation_token),
 ]);
 const proposal=results[results.length-1].results[0] as any;ensure(proposal,409,'La ronda cambió; actualice antes de solicitar una acción');
 return {proposalId:proposal.id,reused:proposal.mutation_token!==request.proposalKey,status:proposal.status,orderId:proposal.order_id};
}
export async function decideProposal(db:D1Database,u:User,id:number,body:any){
 admin(u);const p=await one(db,'SELECT * FROM rondas_proposals WHERE id=?',id);ensure(p,404,'Solicitud inexistente');
 if(p.status==='aprobada'&&body.action==='approve')return {orderId:p.order_id,reused:true};
 ensure(['pendiente_aprobacion','devuelta'].includes(p.status),409,'Solicitud ya decidida; su historial permanece visible');
 const reason=String(body.reason??'').trim();ensure(reason.length>=3&&reason.length<=4000,400,'Registre el motivo de la decisión');
 ensure(['approve','return','reject'].includes(body.action),400,'Decisión inválida');
 const r=await readRow(db,p.execution_id,u),key=token(),date=now();
 if(body.action!=='approve'){
  const status=body.action==='return'?'devuelta':'rechazada';
  await db.batch([
   stmt(db,'UPDATE rondas_proposals SET status=?,decision_reason=?,decided_by=?,decided_at=?,revision=revision+1,mutation_token=? WHERE id=? AND revision=?',status,reason,u.id,date,key,id,p.revision),
   stmt(db,`INSERT INTO rondas_events(execution_id,action,actor_id,actor_name,details,created_at) SELECT execution_id,?,?,?,?,? FROM rondas_proposals WHERE id=? AND mutation_token=?`,`solicitud_${status}`,u.id,u.nombre,json({proposalId:id,reason}),date,id,key),
  ]);
  ensure((await one(db,'SELECT mutation_token FROM rondas_proposals WHERE id=?',id)).mutation_token===key,409,'La solicitud cambió');return {status};
 }
 ensure(['baja','media','alta','urgente'].includes(body.priority),400,'Defina prioridad según riesgo');
 ensure(typeof body.dueAt==='string'&&!Number.isNaN(Date.parse(body.dueAt)),400,'Defina fecha de ejecución');
 ensure(Number.isInteger(body.assignedTo),400,'Defina ejecutor o coordinador interno');
 const assigned=await one(db,"SELECT id,rol FROM usuarios WHERE id=? AND activo=1 AND rol IN ('admin','jefe','tecnico')",body.assignedTo);ensure(assigned,400,'Responsable interno no válido');
 const executorType=body.executorType??'internal';ensure(['internal','provider'].includes(executorType),400,'Modalidad inválida');
 let provider:any=null;if(executorType==='provider'){provider=await one(db,'SELECT id,nombre FROM proveedores WHERE id=? AND activo=1',body.providerId??null);ensure(provider,400,'Seleccione proveedor existente');}
 let plan:any=null;if(p.plan_id){plan=await one(db,'SELECT * FROM planes_mantenimiento WHERE id=? AND activo_id=? AND activo=1',p.plan_id,p.asset_id);ensure(plan&&plan.proxima_fecha===p.cycle_date,409,'El plan cambió desde la inspección: revise su historial antes de aprobar');const live=(await getAssetMaintenance(db,p.asset_id))?.planes.find(v=>v.id===plan.id);ensure(live&&p.dedup_key===`pm:${live.cycleId}`,409,'La regla o la ejecución verificada cambió: revise la solicitud actualizada antes de aprobar');}
 let existing:any=null;
 if(body.existingOrderId){existing=await one(db,'SELECT * FROM ordenes WHERE id=?',body.existingOrderId);ensure(existing&&existing.tipo===p.kind&&existing.activo_id===p.asset_id&&existing.plan_id===p.plan_id&&(p.asset_id!==null||existing.ubicacion_id===r.location_id)&&!['cerrada','cancelada'].includes(existing.estado),400,'La OT seleccionada no corresponde a este equipo, actividad y trabajo abierto');}
 else if(plan){const candidates=await all(db,"SELECT id,titulo,estado,vencimiento FROM ordenes WHERE plan_id=? AND activo_id=? AND tipo='preventivo' AND estado NOT IN ('cerrada','cancelada') ORDER BY id DESC",plan.id,p.asset_id);if(candidates.length)throw new RoundError(409,'Ya hay una OT de esta actividad; confirme cuál cubre este ciclo para evitar duplicados',{candidateOrders:candidates});}
 const asset=p.asset_id?await one(db,'SELECT * FROM activos WHERE id=?',p.asset_id):null;
 // Re-check mutable PM/routing facts inside the same transaction as approval.
 // A cron creation or a rule/history change after the read must not create a stale/duplicate OT.
 const history=plan?await one(db,"SELECT COUNT(*) AS count,COALESCE(MAX(verificado_en),'') AS verified FROM ordenes WHERE plan_id=?",plan.id):null;
 let approvalGuard='',guardArgs:any[]=[];
 if(plan){approvalGuard+=` AND EXISTS(SELECT 1 FROM planes_mantenimiento WHERE id=? AND activo=1 AND activo_id=? AND frecuencia=? AND proxima_fecha=?) AND (SELECT COUNT(*) FROM ordenes WHERE plan_id=?)=? AND COALESCE((SELECT MAX(verificado_en) FROM ordenes WHERE plan_id=?),'')=?`;guardArgs.push(plan.id,p.asset_id,plan.frecuencia,plan.proxima_fecha,plan.id,history.count,plan.id,history.verified);}
 if(plan&&!existing){approvalGuard+=` AND NOT EXISTS(SELECT 1 FROM ordenes WHERE plan_id=? AND activo_id=? AND tipo='preventivo' AND estado NOT IN ('cerrada','cancelada'))`;guardArgs.push(plan.id,p.asset_id);}
 if(existing){approvalGuard+=` AND EXISTS(SELECT 1 FROM ordenes WHERE id=? AND tipo=? AND activo_id IS ? AND plan_id IS ? AND estado NOT IN ('cerrada','cancelada'))`;guardArgs.push(existing.id,p.kind,p.asset_id,p.plan_id);}
 const state=stmt(db,`UPDATE rondas_proposals SET status='aprobada',priority=?,due_at=?,assigned_to=?,executor_type=?,provider_id=?,decision_reason=?,decided_by=?,decided_at=?,mutation_token=?,revision=revision+1 WHERE id=? AND revision=?${approvalGuard}`,body.priority,new Date(body.dueAt).toISOString(),body.assignedTo,executorType,provider?.id??null,reason,u.id,date,key,id,p.revision,...guardArgs);
 const statements:any[]=[state];
 if(existing){statements.push(stmt(db,'UPDATE rondas_proposals SET order_id=? WHERE id=? AND mutation_token=?',existing.id,id,key));}
 else{
  const title=`[Ronda · ${p.kind==='preventivo'?'Recuperación preventiva':'Hallazgo'}] ${asset?.codigo??r.name} · ${plan?.titulo??p.point_id}`;
  const description=`${p.reason}\nOrigen: /rondas?execution=${r.id} · solicitud ${id}.\nDecisión: ${reason}${provider?`\nProveedor: ${provider.nombre}; coordinador interno #${body.assignedTo}.`:''}`;
  statements.push(stmt(db,`INSERT INTO ordenes(titulo,descripcion,tipo,prioridad,estado,activo_id,sucursal_id,ubicacion_id,rubro,asignado_a,asignado_en,creado_por,plan_id,vencimiento,checklist_ejecucion) SELECT ?,?,?,?,'abierta',?,?,?,?,?,?,?,?,?,? FROM rondas_proposals WHERE id=? AND mutation_token=?`,title,description,p.kind,body.priority,p.asset_id,r.site_id,r.location_id,asset?.rubro??'infraestructura',body.assignedTo,date,u.id,p.plan_id,new Date(body.dueAt).toISOString(),plan?.checklist??null,id,key));
  statements.push(stmt(db,'UPDATE rondas_proposals SET order_id=last_insert_rowid() WHERE id=? AND mutation_token=?',id,key));
  // Generation bookkeeping only; never alter the existing PM cadence, date or checklist.
  if(plan)statements.push(stmt(db,'UPDATE planes_mantenimiento SET ultima_generacion=? WHERE id=? AND EXISTS(SELECT 1 FROM rondas_proposals WHERE id=? AND mutation_token=?)',date,plan.id,id,key));
 }
 statements.push(stmt(db,`INSERT OR IGNORE INTO rondas_order_links(execution_id,point_id,order_id,proposal_id) SELECT l.execution_id,l.point_id,p.order_id,p.id FROM rondas_proposal_links l JOIN rondas_proposals p ON p.id=l.proposal_id WHERE p.id=? AND p.mutation_token=?`,id,key));
 statements.push(stmt(db,`INSERT INTO rondas_events(execution_id,action,actor_id,actor_name,details,created_at) SELECT l.execution_id,'solicitud_aprobada',?,?,?,? FROM rondas_proposal_links l JOIN rondas_proposals p ON p.id=l.proposal_id WHERE p.id=? AND p.mutation_token=?`,u.id,u.nombre,json({proposalId:id,reason,executorType,providerId:provider?.id??null,assignedTo:body.assignedTo,priority:body.priority,dueAt:body.dueAt,reused:!!existing}),date,id,key));
 await db.batch(statements);
 const saved=await one(db,'SELECT * FROM rondas_proposals WHERE id=?',id);ensure(saved.mutation_token===key,409,'La solicitud cambió');return {orderId:saved.order_id,reused:!!existing};
}
export async function actionDashboard(db:D1Database,u:User){
 ensure(['admin','jefe','tecnico','visualizador'].includes(u.rol),403,'Sin permisos');
 const scope=['admin','jefe','visualizador'].includes(u.rol)?'': ' AND o.asignado_a=?';
 const orders=await all(db,`SELECT o.id,o.titulo,o.tipo,o.estado,o.prioridad,o.vencimiento,o.asignado_a AS assignedTo,o.plan_id AS planId,o.activo_id AS assetId,u.nombre AS assignedName FROM ordenes o LEFT JOIN usuarios u ON u.id=o.asignado_a WHERE (o.plan_id IS NOT NULL OR EXISTS(SELECT 1 FROM rondas_order_links l WHERE l.order_id=o.id))${scope} ORDER BY o.vencimiento,o.id`,...(!scope?[]:[u.id]));
 return {orders:orders.map(o=>({...o,overdue:!['cerrada','cancelada'].includes(o.estado)&&!!o.vencimiento&&o.vencimiento<now(),managementStatus:o.estado==='completada'?'pendiente_validacion':o.estado})),proposals:['admin','jefe'].includes(u.rol)?await all(db,"SELECT * FROM rondas_proposals WHERE status<>'rechazada' ORDER BY created_at DESC"):[]};
}
