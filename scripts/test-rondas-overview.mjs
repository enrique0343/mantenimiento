// Actual SQL and migrations; no network, emails, R2 or production data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'mantenimiento-rondas-overview-'));
const sqlite=new DatabaseSync(':memory:');
const originalFetch=globalThis.fetch;
let networkCalls=0,checks=0,batches=0;
const queries=[];
globalThis.fetch=async()=>{networkCalls++;throw new Error('Network forbidden in overview tests');};
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
function statement(sql,args=[]){
 assert.match(sql,/^WITH\s/i);
 assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|PRAGMA)\b/i);
 assert.doesNotMatch(sql,/\bdata_json\b/i,'Overview never reads inspection point data');
 return {bind(...values){return statement(sql,values);},async all(){queries.push({sql,args});return {results:sqlite.prepare(sql).all(...args),success:true};}};
}
const DB={prepare:statement,async batch(statements){
 batches++;sqlite.exec('BEGIN');
 try{const results=[];for(const s of statements)results.push(await s.all());sqlite.exec('COMMIT');return results;}
 catch(error){sqlite.exec('ROLLBACK');throw error;}
}};
const run=(sql,...args)=>sqlite.prepare(sql).run(...args);
const snapshot=()=>JSON.stringify(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
 .map(({name})=>[name,sqlite.prepare(`SELECT * FROM "${name}"`).all().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
const now='2026-10-06T05:59:59.999Z'; // October 5 at 23:59:59.999 in El Salvador.

try{
 const filename=path.join(temporary,'overview.mjs');
 await build({entryPoints:[path.join(root,'src/lib/rondas/overview.ts')],outfile:filename,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
 const {getRoundsOverview}=await import(pathToFileURL(filename).href);
 sqlite.exec('PRAGMA foreign_keys=ON');
 for(const file of (await fs.readdir(path.join(root,'migrations'))).filter(file=>/^\d{4}.*\.sql$/.test(file)).sort())sqlite.exec(await fs.readFile(path.join(root,'migrations',file),'utf8'));
 sqlite.exec(`
  INSERT INTO usuarios(id,nombre,email,password_hash,rol) VALUES
   (1,'Admin local','a@example.invalid','isolated','admin'),(2,'Jefe local','j@example.invalid','isolated','jefe'),
   (3,'Técnico local','t@example.invalid','isolated','tecnico'),(4,'Otro técnico','o@example.invalid','isolated','tecnico'),
   (5,'Consulta local','v@example.invalid','isolated','visualizador'),(6,'Solicitud local','s@example.invalid','isolated','solicitante'),
   (7,'Suplente local','b@example.invalid','isolated','tecnico'),(8,'Relevo local','r@example.invalid','isolated','tecnico');
  INSERT INTO sucursales(id,nombre) VALUES(1,'Sede local'),(2,'Otra sede local');
  INSERT INTO ubicaciones(id,sucursal_id,nombre) VALUES(1,1,'Sala local A'),(2,1,'Sala local B'),(3,2,'Sala otra sede');
  INSERT INTO rondas_zones(id,name,site_id,snapshot_json,mutation_token,created_by,created_at) VALUES
   (1,'Zona renombrada actual',1,'{}','zone1',1,'2026-10-01'),(2,'Otra zona',2,'{}','zone2',1,'2026-10-01');
  INSERT INTO rondas_zone_locations(zone_id,location_id,position) VALUES(1,1,0),(1,2,1),(2,3,0);
  INSERT INTO rondas_templates(id,name,config_json,mutation_token,created_by,created_at) VALUES
   (1,'Plantilla local','{}','template1',1,'2026-10-01'),(2,'Otra plantilla','{}','template2',1,'2026-10-01');
 `);
 function execution(id,extra={}){
  const row={status:'pendiente',day:'2026-10-05',due:'2026-10-06T05:00:00.000Z',owner:3,backup:7,reviewer:2,reviewerBackup:8,zone:1,site:1,location:1,...extra};
  run(`INSERT INTO rondas_executions(id,template_id,template_version,name,site_id,location_id,zone_id,scheduled_date,shift,due_at,original_due_at,status,owner_id,backup_id,reviewer_id,reviewer_backup_id,snapshot_json,data_json,mutation_token,created_at)
   VALUES(?,1,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'[]',?,'2026-10-01')`,id,`Ronda local ${id}`,row.site,row.location,row.zone,row.day,`Turno ${id}`,row.due,extra.originalDue??row.due,row.status,row.owner,row.backup,row.reviewer,row.reviewerBackup,
   JSON.stringify({zoneName:row.zone?'Zona histórica congelada':'Texto que no es una zona',locations:[{id:row.location,nombre:'Sala publicada'}]}),`execution${id}`);
 }
 execution(1);
 execution(2,{status:'en_curso',day:'2026-10-04',due:'2026-10-06T03:00:00.000Z'});
 execution(3,{status:'devuelta',due:'2026-10-06T07:00:00.000Z',originalDue:'2026-10-04T12:00:00.000Z'});
 execution(4,{status:'pendiente_validacion',due:'2026-10-04T01:00:00.000Z'});
 execution(5,{status:'validada',due:'2026-10-01T01:00:00.000Z'});
 execution(6,{status:'omitida',due:'2026-10-01T02:00:00.000Z'});
 execution(7,{day:'2026-10-06',due:'2026-10-06T12:00:00.000Z'});
 execution(8,{status:'pendiente_validacion',day:'2026-10-06',due:'2026-10-06T12:00:00.000Z'});
 execution(9,{owner:4});
 execution(10,{owner:4,backup:3,due:'2026-10-06T06:15:00.000Z'});
 execution(11,{owner:4,reviewer:3,due:'2026-10-06T06:20:00.000Z'});
 execution(12,{owner:4,reviewerBackup:3,due:'2026-10-06T06:30:00.000Z',zone:null});
 for(const [id,status] of [[1,'pendiente_aprobacion'],[2,'devuelta'],[3,'aprobada'],[4,'rechazada'],[5,'pendiente_aprobacion']])run("INSERT INTO rondas_proposals(id,execution_id,point_id,kind,reason,status,dedup_key,created_by,created_at,mutation_token) VALUES(?,1,?,'correctivo','Hallazgo local',?,?,1,'2026-10-01',?)",id,`point${id}`,status,`proposal${id}`,`proposal${id}`);
 // Several links to one proposal/order must not multiply the counters.
 sqlite.exec("INSERT INTO rondas_proposal_links(execution_id,point_id,proposal_id) VALUES(1,'a',1),(1,'b',1),(2,'a',1),(1,'c',2)");
 for(const [id,status,assigned] of [[1,'abierta',3],[2,'completada',3],[3,'en_proceso',4],[4,'completada',4],[5,'cerrada',3],[6,'cancelada',3],[7,'abierta',3],[8,'abierta',7]])run("INSERT INTO ordenes(id,titulo,tipo,estado,creado_por,asignado_a,sucursal_id,ubicacion_id) VALUES(?,?,'correctivo',?,1,?,1,1)",id,`OT local ${id}`,status,assigned);
 for(const id of [1,2,3,4,5,6,8])run("INSERT INTO rondas_order_links(execution_id,point_id,order_id,proposal_id) VALUES(1,?,?,1)",`order${id}`,id);
 sqlite.exec("INSERT INTO rondas_order_links(execution_id,point_id,order_id,proposal_id) VALUES(1,'second-point',1,1),(2,'other-round',1,1)");
 const initial=snapshot();
 async function overview(id,rol,time=now){
  const first=queries.length,before=batches;const result=await getRoundsOverview(DB,{id,rol},time);
  eq(queries.length-first,2,'Each overview uses exactly two SQL statements');eq(batches-before,1,'Both statements share one consistent D1 batch');
  eq(result.attention.length<=5,true,'Attention is bounded to five rows');
  eq(result.attention.every(row=>!('snapshot_json' in row)&&!('data_json' in row)),true,'No snapshot or inspection payload reaches the view');
  return result;
 }
 const admin=await overview(1,'admin');
 eq(admin.today,'2026-10-05','UTC next day does not move Salvador calendar early');
 eq({today:admin.scheduledToday,pending:admin.pendingExecution,overdue:admin.overdue,validation:admin.pendingValidation},{today:9,pending:7,overdue:3,validation:2});
 eq(admin.pendingProposals,3,'Unique proposals are counted directly without joining their repeated links');
 eq({open:admin.linkedOpenOrders,verification:admin.linkedPendingVerification},{open:5,verification:2},'Linked orders count once, even across points and rounds');
 eq(admin.configuration,{zones:2,templates:2});
 eq(admin.attention.map(row=>row.id),[2,1,9,4,8],'Expired execution precedes independent review, then current due date');
 eq(admin.attention.filter(row=>row.isOverdue).map(row=>row.id),[2,1,9]);
 eq(admin.attention[0].zoneName,'Zona histórica congelada','Published zone name survives a later zone rename');
 eq({site:admin.attention[0].siteName,location:admin.attention[0].locationName,owner:admin.attention[0].ownerName,reviewer:admin.attention[0].reviewerName},{site:'Sede local',location:'Sala local A',owner:'Técnico local',reviewer:'Jefe local'});
 const chief=await overview(2,'jefe');eq(chief,admin,'Chief has the same global operational scope');
 const viewer=await overview(5,'visualizador');eq({...viewer,pendingProposals:3},admin,'Viewer sees global operations but no approval queue count');eq(viewer.pendingProposals,null);
 const technician=await overview(3,'tecnico');
 eq({today:technician.scheduledToday,pending:technician.pendingExecution,overdue:technician.overdue,validation:technician.pendingValidation},{today:8,pending:6,overdue:2,validation:2},'Owner, backup, reviewer and reviewer backup all have access; unrelated technician rounds are excluded');
 eq(technician.configuration,null,'No global zone/template counts leak to technicians');eq(technician.pendingProposals,null);
 eq({open:technician.linkedOpenOrders,verification:technician.linkedPendingVerification},{open:2,verification:1},'Technician OT counts follow actual order assignment');
 eq(technician.attention.map(row=>row.id),[2,1,4,8,10]);
 const other=await overview(4,'tecnico');eq(other.pendingExecution,4);eq(other.linkedOpenOrders,2);eq(other.linkedPendingVerification,1);
 const beforeUnsupported=queries.length;
 for(const rol of ['solicitante','proveedor','compras','desconocido',''])eq(await getRoundsOverview(DB,{id:6,rol},'invalid-date'),null,'Unsupported roles return null without examining dates or querying');
 eq(queries.length,beforeUnsupported);
 await assert.rejects(()=>getRoundsOverview(DB,{id:3,rol:'tecnico'},'not-a-date'),RangeError);checks++;
 await assert.rejects(()=>getRoundsOverview(DB,{id:0,rol:'tecnico'},now),RangeError);checks++;
 eq(queries.length,beforeUnsupported,'Invalid supported inputs also produce no database calls');
 // A different template timezone can put a deadline before Salvador midnight
 // while its scheduled date is still tomorrow on the dashboard calendar.
 execution(13,{day:'2026-10-06',due:'2026-10-05T18:00:00.000Z'});
 const futureExpired=await overview(1,'admin');
 eq(futureExpired.pendingExecution,7,'Future scheduled dates do not inflate the current-calendar execution count');
 eq(futureExpired.scheduledToday,9);eq(futureExpired.overdue,4,'Expired actual deadlines count regardless of the local scheduled date');
 eq(futureExpired.attention[0].id,13,'Tomorrow\'s already-expired round appears as prioritized attention');
 eq(futureExpired.attention[0].isOverdue,true);
 eq(futureExpired.attention.some(row=>row.id===7),false,'Tomorrow\'s future deadline still stays outside attention');
 run('DELETE FROM rondas_executions WHERE id=13');
 const midnight=await overview(1,'admin','2026-10-06T06:00:00.000Z');
 eq(midnight.today,'2026-10-06','Calendar advances exactly at Salvador midnight');eq(midnight.scheduledToday,2);eq(midnight.pendingExecution,8);
 eq(await overview(1,'admin','2026-10-05T23:59:59.999-06:00'),admin,'Equivalent ISO instants with timezone offsets use the same calendar and deadlines');
 eq(snapshot(),initial,'All roles, dates and aggregates leave every database table unchanged');
 // A postponed round becomes actionable only when its current deadline passes.
 const later=await overview(3,'tecnico','2026-10-06T07:00:00.001Z');
 eq(later.overdue,6,'Expiry uses current due_at: the postponed round joins the five other elapsed current deadlines');
 eq(later.attention.some(row=>[5,6].includes(row.id)),false,'Validated/omitted rounds never become expired inspections');
 // The last ordinary pending row is a legacy single-location round, not a zone.
 run("UPDATE rondas_executions SET status='validada' WHERE id IN (1,2,3,4,7,8,9,10,11)");
 const legacy=await overview(1,'admin');eq(legacy.attention.map(row=>row.id),[12]);eq(legacy.attention[0].zoneName,null,'Legacy snapshots cannot invent a zone label');
 sqlite.exec('BEGIN');for(let index=0;index<1005;index++)execution(100+index,{due:'2026-10-05T01:00:00.000Z'});sqlite.exec('COMMIT');
 const largeBefore=snapshot(),large=await overview(1,'admin');
 eq(large.scheduledToday,1014,'Summary counts all rows beyond the round list 1000-row limit');
 eq(large.pendingExecution,1006);eq(large.overdue,1005);eq(large.pendingValidation,0);eq(large.attention.length,5);
 eq(snapshot(),largeBefore,'Large aggregate and bounded attention remain read-only');
 eq(networkCalls,0,'No network, scheduler, email or storage effects');eq(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 console.log(`PASS: ${checks} rounds overview checks; two consistent SQL reads, all real migrations, role scopes, Salvador boundaries, frozen zone names, actual deadlines, distinct orders/proposals and >1000 executions; no writes/network.`);
}finally{globalThis.fetch=originalFetch;sqlite.close();await fs.rm(temporary,{recursive:true,force:true});}
