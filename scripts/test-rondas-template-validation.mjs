// Real template handlers and local transactional SQLite. No production or network effects.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { setup, root } from './test-support/sqlite-app.mjs';

const {api,sqlite,ctx,close}=await setup({modules:{rounds:'api/rondas/[...path].ts',model:'../lib/rondas/model.ts',catalog:'../lib/rondas/catalog.ts'}});
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('Network forbidden in template validation tests');};
function statement(sql,args=[]){
 const prepared=sqlite.prepare(sql);
 return {bind(...values){return statement(sql,values);},async all(){return {results:prepared.all(...args),success:true};},async first(){return prepared.get(...args)??null;},async run(){return {success:true,meta:prepared.run(...args)};}};
}
const DB={prepare:sql=>statement(sql),async batch(queries){
 sqlite.exec('BEGIN');try{const results=[];for(const query of queries)results.push(await query.all());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}
}};
async function call(data,{userId=1,rol='admin',authenticated=true,path='/templates'}={}){
 const context=ctx(`/api/rondas${path}`,{method:'POST',data});
 context.testUser=authenticated?{id:userId,nombre:`Local user ${userId}`,rol}:null;
 context.locals.runtime.env.DB=DB;
 const response=await api.rounds.POST(context);
 const body=await response.text();
 let result;try{result=JSON.parse(body);}catch{result={error:body};}
 return {status:response.status,...result};
}
const point=(code,extra={})=>({code,group:'hvac',label:`Control ${code}`,criterion:'Sin fuga visible',active:true,frequency:'diaria',firstDate:'2026-10-07',evidencePolicy:'none',...extra});
const config=(extra={})=>({effectiveFrom:'2026-10-07',name:'Plantilla local',siteId:1,locationId:1,shift:'diurno',timezoneOffset:'-06:00',time:'08:00',windowMinutes:60,ownerId:2,backupId:4,reviewerId:3,reviewerBackupId:5,reason:'Configuración aprobada en prueba',points:[point('hvac-1')],notifications:{recipientIds:[],events:[]},...extra});
const issuesFor=body=>api.model.configValidationIssues(body);
const at=(issues,path)=>issues.find(issue=>issue.path.join('.')===path);
const templateState=()=>['rondas_templates','rondas_template_versions'].map(table=>sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
try{
 sqlite.exec(await fs.readFile(`${root}/migrations/0051_rondas.sql`,'utf8'));
 sqlite.exec(await fs.readFile(`${root}/migrations/0053_rondas_zonas.sql`,'utf8'));
 sqlite.exec(`INSERT INTO usuarios(id,nombre,email,password_hash,rol) VALUES
 (2,'Inspector local','inspector@example.invalid','isolated','tecnico'),
 (3,'Jefe local','jefe@example.invalid','isolated','jefe'),
 (4,'Suplente local','suplente@example.invalid','isolated','tecnico'),
 (5,'Revisor suplente local','revisor@example.invalid','isolated','tecnico'),
 (6,'Consulta local','consulta@example.invalid','isolated','visualizador');
 INSERT INTO sucursales(id,nombre) VALUES(1,'Sede local'),(2,'Otra sede local');
 INSERT INTO ubicaciones(id,nombre,sucursal_id) VALUES(1,'Sala local',1),(2,'Otra sede',2);
 INSERT INTO activos(id,codigo,nombre,ubicacion_id,rubro) VALUES(1,'LOCAL-AC','Equipo local',1,'aires');`);
 const preservedTables=['usuarios','sucursales','ubicaciones','activos','ordenes','planes_mantenimiento'];
 const originalData=()=>Object.fromEntries(preservedTables.map(table=>[table,sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));
 const before=originalData();

 const defaults=api.catalog.ROUND_GROUPS.flatMap(group=>group.points.map(item=>point(item.code,{...item,group:group.code})));
 eq(defaults.length,21,'Reproduce the actual 21-point starting catalogue');
 let issues=issuesFor(config({points:defaults}));
 eq(issues.filter(issue=>issue.path.at(-1)==='criterion').length,21,'Every active empty criterion is identified');
 ok(at(issues,'points.5.criterion').message.includes('Condensados y humedad (hvac-2)'), 'Errors identify the screenshot point by name and stable code');
 issues=issuesFor(config({siteId:null,ownerId:null,reviewerId:null,points:defaults}));
 eq(issues.filter(issue=>issue.path.at(-1)==='criterion').length,21,'Missing general selections do not hide point requirements');
 ok(at(issues,'siteId').message.startsWith('Sede: Seleccione'),'Required selections use Spanish names');
 ok(at(issues,'ownerId').message.startsWith('Encargado: Seleccione'));
 issues=issuesFor(config({points:defaults.map((item,index)=>index===5?{...item,criterion:'Sin condensado observado'}:item)}));
 eq(issues.filter(issue=>issue.path.at(-1)==='criterion').length,20,'Completing one criterion leaves the remaining actual requirements');
 ok(!at(issues,'points.5.criterion'),'The completed point no longer appears as pending');
 const invalid=config({points:[point('hvac-1',{criterion:'  a  '}),point('hvac-2',{label:'Condensados y humedad',active:false,criterion:'',exclusionReason:'   '})]});
 issues=issuesFor(invalid);
 ok(at(issues,'points.0.criterion'),'Trimmed short criterion remains invalid');
 ok(at(issues,'points.1.exclusionReason'),'An inactive optional point still requires its exclusion reason');
 ok(!at(issues,'points.1.criterion'),'Inactive points do not require criteria');
 const emptyState=templateState();
 let result=await call(invalid);
 eq(result.status,400);
 eq(result.issues,issues,'Server and client return the same precise requirements');
 ok(result.error.includes('Condensados y humedad (hvac-2) — Motivo de exclusión'),'API text identifies the blocking field');
 eq(templateState(),emptyState,'Invalid configuration writes neither template nor audit version');

 issues=issuesFor(config({points:[point('required',{active:false,mandatory:true,exclusionReason:'No aplica en este alcance'})]}));
 ok(at(issues,'points.0.active'),'An exclusion reason cannot deactivate a mandatory control');
 for(const reviewer of ['reviewerId','reviewerBackupId'])for(const executor of [2,4]){
  const body=config({[reviewer]:executor});
  result=await call(body);eq(result.status,400,'Execution and verification stay independent');
  ok(at(result.issues,reviewer),'The conflicting reviewer field is identified');
 }
 issues=issuesFor(config({zoneId:7,points:[point('same',{assetId:1,locationId:null}),point('same')]}));
 ok(at(issues,'points.0.locationId'),'Zone equipment requires a specific point location');
 ok(at(issues,'points.1.code'),'Duplicated codes identify the repeated point');
 issues=issuesFor(config({points:[point('pressure',{measurementType:'pressure',measurementUnit:' ',minValue:10,maxValue:5,limitSource:' '})]}));
 for(const field of ['measurementUnit','limitSource','maxValue'])ok(at(issues,`points.0.${field}`),`Pressure rule ${field} remains enforced`);
 issues=issuesFor(config({locationId:null,zoneId:null}));ok(at(issues,'zoneId'),'A physical scope remains required');
 issues=issuesFor(config({name:'',reason:'a',time:'25:99',points:[point('invalid',{frequency:'inventada',firstDate:'07/10/2026'})]}));
 for(const field of ['name','reason','time','points.0.frequency','points.0.firstDate'])ok(at(issues,field),`${field} receives a labelled Spanish error`);
 ok(issues.every(issue=>!/(Required|Expected|String must|Invalid enum|Invalid input)/.test(issue.message)),'No raw English Zod messages in template errors');

 for(const actor of [{authenticated:false},{userId:2,rol:'tecnico'},{userId:6,rol:'visualizador'}]){
  result=await call(config(),actor);eq(result.status,actor.authenticated===false?401:403,'Existing creation permissions remain enforced');
  ok(!result.issues,'Unauthorized users receive no configuration detail');
 }
 eq(templateState(),emptyState,'All invalid and unauthorized submissions remain write-free');
 result=await call(config({siteId:2}));eq(result.status,400,'Physical site and location mismatch still blocked');
 eq(templateState(),emptyState);

 const valid=config({points:[point('hvac-1',{criterion:'  Sin fuga ni alarma observada  '}),point('hvac-2',{active:false,criterion:'',exclusionReason:'Este alcance no incluye condensados'})]});
 eq(issuesFor(valid),[],'Complete valid active and excluded controls pass');
 result=await call(valid);eq(result.status,201,JSON.stringify(result));
 eq(result.template.config.points[0].criterion,'Sin fuga ni alarma observada','Approved criterion is trimmed before persistence');
 eq(result.template.config.points[1].active,false,'Explicit exclusions remain inactive');
 eq(sqlite.prepare('SELECT COUNT(*) n FROM rondas_template_versions').get().n,1,'Successful creation preserves the audit version');
 const templateId=result.template.id;
 result=await call({...valid,expectedVersion:1,reason:'Ajuste local aprobado'},{path:`/templates/${templateId}/version`,userId:3,rol:'jefe'});
 eq(result.status,200,'A jefe can continue creating authorized template versions');eq(result.template.version,2);
 result=await call(config({name:'Plantilla del jefe'}),{userId:3,rol:'jefe'});eq(result.status,201,'A jefe can create a valid new template');
 eq(originalData(),before,'Users, permissions, equipment, locations, orders and plans remain unchanged');
 console.log(`PASS: ${checks} template validation assertions; real handlers and local SQLite, no production or network.`);
}finally{
 globalThis.fetch=originalFetch;await close();
}
