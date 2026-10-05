import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { setup, root } from './test-support/sqlite-app.mjs';
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const photos={
 'image/png':'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGOsqKhgwAaYsIoOWgkAHYcBeHFoDCsAAAAASUVORK5CYII=',
 'image/jpeg':'/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCvRRRQB//Z',
 'image/webp':'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoIAAgAAUAmJaQAA3AA/twQAAA=',
};
const {api,sqlite,ctx,close}=await setup({modules:{rounds:'api/rondas/[...path].ts',evidence:'api/rondas/evidence.ts'}});
function statement(sql,args=[]){const s=sqlite.prepare(sql);return {bind(...v){return statement(sql,v)},async all(){return {results:s.all(...args),success:true}},async first(){return s.get(...args)??null},async run(){return {success:true,meta:s.run(...args)}}};}
const DB={prepare:sql=>statement(sql),async batch(qs){sqlite.exec('BEGIN');try{const r=[];for(const q of qs)r.push(await q.all());sqlite.exec('COMMIT');return r}catch(e){sqlite.exec('ROLLBACK');throw e}}};
const blobs=new Map();let afterPut=null;
const R2={async put(key,bytes){blobs.set(key,new Uint8Array(bytes));if(afterPut)await afterPut();},async get(key){return blobs.has(key)?{body:blobs.get(key)}:null;},async delete(key){blobs.delete(key);}};
function context(path,{method='GET',data,userId=1,rol='admin'}={}){const c=ctx(`/api/rondas${path}`,{method,data});c.testUser={id:userId,nombre:`User ${userId}`,rol};c.locals.runtime.env.DB=DB;c.locals.runtime.env.R2=R2;return c;}
async function call(path,{userId=1,rol='admin',data,method=data?'POST':'GET'}={}){const response=await api.rounds[method](context(path,{method,data,userId,rol}));return {status:response.status,...await response.json()};}
let id,other;
async function upload({executionId=id,pointId='p1',type='image/png',bytes=Buffer.from(photos[type]??'', 'base64'),userId=2,rol='tecnico',name='indicador.png'}={}){
 const form=new FormData();form.set('executionId',String(executionId));form.set('pointId',pointId);form.set('file',new File([bytes],name,{type}));
 const c=context('/evidence',{method:'POST',userId,rol});c.request=new Request(c.url,{method:'POST',body:form});
 const r=await api.evidence.POST(c);return {status:r.status,...await r.json()};
}
const row=()=>sqlite.prepare('SELECT * FROM rondas_executions WHERE id=?').get(id);
const save=(data,actor={userId:2,rol:'tecnico'})=>call(`/executions/${id}/action`,{...actor,data:{action:'save',pointId:'p1',expectedRevision:row().revision,result:'conforme',...data}});
try{
 sqlite.exec(await fs.readFile(root+'/migrations/0051_rondas.sql','utf8'));
 sqlite.exec(await fs.readFile(root+'/migrations/0053_rondas_zonas.sql','utf8'));
 sqlite.exec(`INSERT INTO usuarios(id,nombre,email,password_hash,rol) VALUES(2,'Inspector','i@example.invalid','x','tecnico'),(3,'Verifier','v@example.invalid','x','tecnico'),(4,'Other inspector','o@example.invalid','x','tecnico'); INSERT INTO sucursales(id,nombre) VALUES(1,'Sede'); INSERT INTO ubicaciones(id,nombre,sucursal_id) VALUES(1,'Sala',1);`);
 const point=code=>({code,group:'pressure',label:code,criterion:'Lectura dentro del rango técnico aprobado',active:true,frequency:'diaria',firstDate:'2026-10-01',evidencePolicy:'always',assetId:null,measurementType:'pressure',measurementUnit:'bar',photoRequired:true,minValue:1,maxValue:5,limitSource:'Manual técnico del equipo'});
 const config={effectiveFrom:'2026-10-01',name:'Presiones',siteId:1,locationId:1,shift:'diurno',timezoneOffset:'-06:00',time:'08:00',windowMinutes:60,ownerId:2,reviewerId:3,reason:'Control local aprobado',points:[point('p1'),point('p2')],notifications:{recipientIds:[],events:[]}};
 eq((await call('/templates',{data:{...config,points:[{...point('p1'),measurementUnit:''}]}})).status,400,'configured pressure unit is mandatory');
 eq((await call('/templates',{data:{...config,points:[{...point('p1'),limitSource:''}]}})).status,400,'limits need an approved technical source');
 const template=await call('/templates',{data:config});eq(template.status,201);
 const generated=await call('/generate',{data:{templateId:template.template.id,dateFrom:'2026-10-01',dateTo:'2026-10-02'}});eq(generated.status,200);[id,other]=generated.executions.map(e=>e.id);
 eq((await save({measurementValue:3,evidence:'Foto tomada, sin archivo'})).status,400,'text cannot substitute the required photo');eq(row().revision,0);eq(JSON.parse(row().data_json)[0].result,'pendiente');
 eq((await save({result:'no_aplica',notes:'Sin acceso al manómetro',measurementValue:3})).status,400,'No aplica cannot bypass pressure/photo');
 eq((await upload({type:'image/png',bytes:Buffer.from('not an image')})).status,400);
 eq((await upload({type:'image/gif',bytes:Buffer.from('GIF89a')})).status,400);
 eq((await upload({bytes:Buffer.alloc(0)})).status,400);
 eq((await upload({bytes:Buffer.alloc(10*1024*1024+1)})).status,400);
 eq((await upload({userId:4})).status,403,'unassigned operator cannot upload');
 eq((await upload({userId:2,rol:'visualizador'})).status,403,'downgraded operator cannot upload');
 eq((await upload({pointId:'missing'})).status,404);eq(blobs.size,0,'invalid uploads never reach storage');
 const ids={};for(const type of Object.keys(photos)){const r=await upload({type});eq(r.status,201,`${type} real photo accepted`);ids[type]=r.id;assert.ok(r.id>0);checks++;}
 eq(row().revision,0,'photo upload alone never completes the point');
 const foreignPoint=await upload({pointId:'p2'}),foreignRound=await upload({executionId:other});
 eq((await save({measurementValue:3,evidenceId:foreignPoint.id})).status,400,'other point photo rejected');
 eq((await save({measurementValue:3,evidenceId:foreignRound.id})).status,400,'other round photo rejected');
 eq((await save({evidenceId:ids['image/png']})).status,400,'missing numeric pressure rejected');
 eq((await save({measurementValue:'3',evidenceId:ids['image/png']})).status,400,'text pressure rejected');
 eq((await save({measurementValue:6,evidenceId:ids['image/png']})).status,400,'out-of-range reading cannot be conforming');
 eq((await save({measurementValue:3,evidenceId:ids['image/png']},{userId:2,rol:'visualizador'})).status,403,'downgraded assigned operator cannot save');
 eq((await call(`/executions/${id}/order`,{userId:2,rol:'visualizador',data:{pointId:'p1',kind:'correctivo',reason:'Revisión requerida'}})).status,403,'downgraded actor cannot request actions');
 eq((await save({measurementValue:3,evidenceId:ids['image/png']})).status,200);
 let stored=JSON.parse(row().data_json)[0];eq(stored.measurementValue,3);eq(stored.measurementUnit,'bar');eq(stored.evidenceId,ids['image/png']);eq(stored.observed_by,2);eq(stored.evidencePhoto.uploadedBy,2);
 assert.throws(()=>sqlite.exec(`UPDATE rondas_evidence SET filename='changed' WHERE id=${ids['image/png']}`),/immutable/);checks++;
 assert.throws(()=>sqlite.exec(`DELETE FROM rondas_evidence WHERE id=${ids['image/png']}`),/immutable/);checks++;
 eq((await save({measurementValue:4,evidenceId:ids['image/png']})).status,400,'changed reading needs a different photo');
 eq((await save({measurementValue:6,evidenceId:ids['image/jpeg'],result:'hallazgo',notes:'Presión por encima del máximo aprobado'})).status,200,'out-of-range value can be explicitly recorded as a finding');
 eq(sqlite.prepare("SELECT COUNT(*) n FROM rondas_proposals WHERE kind='correctivo'").get().n,1,'abnormal pressure creates required action request');
 eq((await save({pointId:'p2',measurementValue:3,evidenceId:foreignPoint.id})).status,200);
 let r=await call(`/executions/${id}/action`,{userId:2,rol:'visualizador',data:{action:'submit',expectedRevision:row().revision}});eq(r.status,403,'downgraded actor cannot submit');
 r=await call(`/executions/${id}/action`,{userId:2,rol:'tecnico',data:{action:'submit',expectedRevision:row().revision}});eq(r.status,200);
 eq((await upload()).status,409,'submitted round evidence cannot be changed');
 r=await call(`/executions/${id}/action`,{userId:3,rol:'visualizador',data:{action:'approve',expectedRevision:row().revision,reason:'Pruebas revisadas'}});eq(r.status,403,'downgraded reviewer cannot approve');
 const goodDownload=await api.evidence.GET(context(`/evidence?id=${ids['image/png']}`,{userId:3,rol:'tecnico'}));eq(goodDownload.status,200);eq(goodDownload.headers.get('cache-control'),'private, no-store');eq(goodDownload.headers.get('x-content-type-options'),'nosniff');eq(Buffer.from(await goodDownload.arrayBuffer()).toString('base64'),photos['image/png']);
 const deniedDownload=await api.evidence.GET(context(`/evidence?id=${ids['image/png']}`,{userId:4,rol:'tecnico'}));eq(deniedDownload.status,403);
 const n=blobs.size;afterPut=()=>{afterPut=null;sqlite.exec(`UPDATE rondas_executions SET revision=revision+1 WHERE id=${other}`);};
 eq((await upload({executionId:other})).status,409,'upload racing a newer round revision is rejected');eq(blobs.size,n,'failed metadata insert cleans up the uploaded object');
 const metadata=sqlite.prepare('SELECT * FROM rondas_evidence WHERE id=?').get(ids['image/png']);blobs.delete(metadata.r2_key);
 const missing=await api.evidence.GET(context(`/evidence?id=${ids['image/png']}`,{userId:3,rol:'tecnico'}));eq(missing.status,404,'missing object is not reported as available evidence');
 // A signature alone is not a photograph. These must fail before R2 upload.
 eq((await upload({executionId:other,type:'image/jpeg',bytes:Uint8Array.of(0xff,0xd8,0xff)})).status,400,'truncated JPEG signature rejected');
 eq((await upload({executionId:other,type:'image/png',bytes:Uint8Array.of(0x89,0x50,0x4e,0x47)})).status,400,'truncated PNG signature rejected');
 eq((await upload({executionId:other,type:'image/webp',bytes:Buffer.from('RIFFxxxxWEBP')})).status,400,'truncated WebP signature rejected');
 console.log(`PASS: ${checks} rounds pressure/evidence checks: actual multipart files, scoped photos, required reading and unit, approved limits, immutable evidence, roles and rollback; mocked local R2 only.`);
}finally{await close();}
