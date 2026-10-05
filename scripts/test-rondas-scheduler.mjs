import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {setup} from './test-support/sqlite-app.mjs';
const {api,sqlite,ctx,close}=await setup({modules:{rounds:'api/rondas/[...path].ts',cron:'api/cron/rondas.ts'}});let checks=0;const eq=(a,b)=>{assert.equal(a,b);checks++};
function statement(sql,args=[]){const q=sqlite.prepare(sql);return{bind(...p){return statement(sql,p)},async all(){return{results:q.all(...args)}},async first(){return q.get(...args)??null},async run(){return{meta:q.run(...args)}}}}
const DB={prepare:sql=>statement(sql),async batch(qs){sqlite.exec('BEGIN');try{const out=[];for(const q of qs)out.push(await q.all());sqlite.exec('COMMIT');return out}catch(e){sqlite.exec('ROLLBACK');throw e}}};
async function call(route,path,data,env={},headers={}){const c=ctx(path,{method:'POST',data,headers,env:{DB,...env}});const r=await route(c);return{status:r.status,...await r.json()}}
try{
 sqlite.exec(await fs.readFile('migrations/0051_rondas.sql','utf8'));
 sqlite.exec(`INSERT INTO usuarios(id,nombre,email,password_hash,rol) VALUES(2,'Inspector','i@example.invalid','x','tecnico'),(3,'Reviewer','r@example.invalid','x','jefe');INSERT INTO sucursales(id,nombre) VALUES(1,'Local');INSERT INTO ubicaciones(id,nombre,sucursal_id) VALUES(1,'Local',1)`);
 const start=new Date(Date.now()-35*86400000).toISOString().slice(0,10);
 const config={effectiveFrom:start,name:'Daily audit',siteId:1,locationId:1,shift:'AM',timezoneOffset:'+00:00',time:'06:00',windowMinutes:30,ownerId:2,reviewerId:3,reason:'Explicit local test schedule',points:[{code:'visual',group:'puertas',label:'Observe',criterion:'Condition observed',active:true,frequency:'diaria',firstDate:start,evidencePolicy:'none'}],notifications:{recipientIds:[],events:[]}};
 eq((await call(api.rounds.POST,'/api/rondas/templates',config)).status,201);
 eq((await call(api.cron.POST,'/api/cron/rondas',{}, {CRON_SECRET:'local'})).status,401);
 eq((await call(api.cron.POST,'/api/cron/rondas',{}, {CRON_SECRET:'local'},{'x-cron-secret':'local'})).enabled,false);
 const env={CRON_SECRET:'local',RONDAS_SCHEDULER_ENABLED:'true'},headers={'x-cron-secret':'local'};
 let r=await call(api.cron.POST,'/api/cron/rondas',{},env,headers);eq(r.status,200);eq(r.executions,31);eq(r.backlog,true);
 r=await call(api.cron.POST,'/api/cron/rondas',{},env,headers);eq(r.executions,5);eq(r.backlog,false);
 eq((await call(api.cron.POST,'/api/cron/rondas',{},env,headers)).executions,0);eq(sqlite.prepare('SELECT COUNT(*) n FROM rondas_executions').get().n,36);
 eq(sqlite.prepare("SELECT COUNT(*) n FROM rondas_executions WHERE status='pendiente'").get().n,36);
 eq(sqlite.prepare('SELECT COUNT(*) n FROM ordenes').get().n,0);
 eq(sqlite.prepare("SELECT COUNT(*) n FROM rondas_events WHERE actor_name='Programador automático de rondas'").get().n,36);
 console.log(`PASS: ${checks} scheduler assertions; opt-in auth, bounded backlog without dropping missed obligations, idempotent repeat, no OTs/email.`);
}finally{await close()}
