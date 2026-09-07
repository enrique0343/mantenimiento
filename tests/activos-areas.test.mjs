import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import * as collection from '../src/pages/api/activos/index.ts';
import * as item from '../src/pages/api/activos/[id]/index.ts';
import * as bulk from '../src/pages/api/admin/import-equipos.ts';
import { createSessionToken } from '../src/lib/auth.ts';
import { AREA_KEYS } from '../src/lib/areas.ts';
const sqlite = new DatabaseSync(':memory:');
for (const file of fs.readdirSync('migrations').filter(f => f.endsWith('.sql')).sort()) sqlite.exec(fs.readFileSync('migrations/'+file,'utf8'));
class Statement {
 constructor(sql,params=[]) {this.sql=sql;this.params=params;}
 bind(...params){return new Statement(this.sql,params);}
 async raw(){const q=sqlite.prepare(this.sql);q.setReturnArrays(true);return q.all(...this.params);}
 async all(){return {results:sqlite.prepare(this.sql).all(...this.params),success:true};}
 async run(){return {meta:sqlite.prepare(this.sql).run(...this.params),success:true};}
}
const DB={prepare(sql){return new Statement(sql);}};
const secret='local-asset-integration-test-only';
const users=['admin','tecnico','jefe','solicitante'];
const tokens={};
for(let i=0;i<users.length;i++){
 sqlite.prepare('INSERT INTO usuarios (id,email,nombre,password_hash,rol) VALUES (?,?,?,?,?)').run(i+1,users[i]+'@example.test','Usuario '+users[i],'fixture-no-login',users[i]);
 tokens[users[i]]=await createSessionToken({sub:i+1,email:users[i]+'@example.test',nombre:'Usuario '+users[i],rol:users[i]},secret);
}
const usersBefore=JSON.stringify(sqlite.prepare('SELECT * FROM usuarios').all());
function ctx(method,path,body,role='admin') {return {request:new Request('https://test.local'+path,{method,headers:{'content-type':'application/json',cookie:role ? 'mant_session='+tokens[role] : ''},...(body===undefined?{}:{body:JSON.stringify(body)})}),params:{id:path.split('/')[3]?.split('?')[0]},locals:{runtime:{env:{DB,JWT_SECRET:secret}},user:role?{id:users.indexOf(role)+1,rol:role}:null}};}
let checks=0;
async function expect(route, context, status) {const r=await route(context);assert.equal(r.status,status,await r.clone().text());checks++;return r.headers.get('content-type')?.includes('json')?r.json():null;}
const fields={aires:{tipoUnidad:'Mini split',capacidadBtuH:12000,refrigerante:'R-410A'},infraestructura:{tipoInstalacion:'Cubierta',sector:'Edificio A'},equipo_general:{servicio:'Oficina'},biomedico:{servicio:'Consulta'}};
const ids={};
for(const [idx,area] of AREA_KEYS.entries()){
 const out=await expect(collection.POST,ctx('POST','/api/activos',{codigo:'TEST-'+area,nombre:'Prueba '+area,rubro:area,datosTecnicos:fields[area],criticidadOperacional:['alta','media','baja'][idx%3]}),201);
 ids[area]=out.activo.id;assert.equal(out.activo.rubro,area);assert.deepEqual(JSON.parse(out.activo.datosTecnicos),fields[area]);assert.equal(out.activo.tipo,area==='biomedico'?'biomedico':'general');
}
for(const area of AREA_KEYS){const out=await expect(collection.GET,ctx('GET','/api/activos?area='+area),200);assert.deepEqual(out.activos.map(a=>a.id),[ids[area]]);}
await expect(collection.GET,ctx('GET','/api/activos?area=vehiculos'),400);
await expect(collection.POST,ctx('POST','/api/activos',{codigo:'BAD1',nombre:'Bad',rubro:'aires',datosTecnicos:{capacidadBtuH:-1}}),400);
await expect(collection.POST,ctx('POST','/api/activos',{codigo:'BAD2',nombre:'Bad',rubro:'infraestructura',datosTecnicos:{refrigerante:'R32'}}),400);
await expect(collection.POST,ctx('POST','/api/activos',{codigo:'BAD3',nombre:'Bad',rubro:'aires',tipo:'biomedico'}),400);
for(const criticidadOperacional of ['urgente','A',null]) await expect(collection.POST,ctx('POST','/api/activos',{codigo:'BAD4',nombre:'Bad',rubro:'aires',criticidadOperacional}),400);
const edited=await expect(item.PATCH,ctx('PATCH','/api/activos/'+ids.aires,{datosTecnicos:{tipoUnidad:'Cassette',capacidadBtuH:24000,refrigerante:'R32'},criticidadOperacional:'baja'}),200);
assert.equal(edited.activo.rubro,'aires');assert.equal(JSON.parse(edited.activo.datosTecnicos).capacidadBtuH,24000);
await expect(item.PATCH,ctx('PATCH','/api/activos/'+ids.aires,{datosTecnicos:'{broken'}),400);
await expect(item.PATCH,ctx('PATCH','/api/activos/'+ids.aires,{criticidadOperacional:null}),400);
const moved=await expect(item.PATCH,ctx('PATCH','/api/activos/'+ids.aires,{rubro:'infraestructura'}),200);
assert.equal(moved.activo.rubro,'infraestructura');assert.equal(moved.activo.datosTecnicos,null);
assert.equal((await expect(collection.GET,ctx('GET','/api/activos?area=aires'),200)).activos.length,0);
assert.equal((await expect(collection.GET,ctx('GET','/api/activos?area=infraestructura'),200)).activos.length,2);
sqlite.prepare('INSERT INTO activos (codigo,nombre,tipo,rubro) VALUES (?,?,?,?)').run('LEGACY','Legacy biomedical','biomedico',null);
assert.equal((await expect(collection.GET,ctx('GET','/api/activos?area=biomedico'),200)).activos.length,2);
const imported=await expect(bulk.POST,ctx('POST','/api/admin/import-equipos',{area:'aires',csv:'codigo,nombre,rubro,criticidad,capacidad_btu_h,refrigerante\nCSV-1,Aire importado,aires,alta,18000,R32\nCSV-2,Otra area,infraestructura,media,,\nCSV-1,Duplicado,aires,baja,12000,R32'}),200);
assert.equal(imported.insertados,1);assert.equal(imported.errores.length,2);
assert.equal((await expect(collection.GET,ctx('GET','/api/activos?area=aires'),200)).activos[0].criticidadOperacional,'alta');
// Reclassification must preserve the area of existing work, including closed work.
const relatedBefore = {};
for (const relation of ['ticket', 'orden', 'proyecto']) {
 const { activo } = await expect(collection.POST, ctx('POST', '/api/activos', { codigo: 'LINKED-'+relation, nombre: 'Activo vinculado '+relation, rubro: 'aires', datosTecnicos: fields.aires }), 201);
 if (relation === 'ticket') sqlite.prepare("INSERT INTO tickets (tracking_token,solicitante_nombre,solicitante_email,asunto,descripcion,activo_id,rubro,estado) VALUES (?,?,?,?,?,?,?,?)").run('ticket-locked', 'Prueba', 'fixture@example.test', 'Solicitud cerrada', 'Prueba', activo.id, 'aires', 'cerrado');
 if (relation === 'orden') sqlite.prepare("INSERT INTO ordenes (titulo,creado_por,activo_id,rubro,estado) VALUES (?,?,?,?,?)").run('Orden cerrada', 1, activo.id, 'aires', 'cerrada');
 if (relation === 'proyecto') sqlite.prepare("INSERT INTO proyectos (codigo,titulo,creado_por,activo_id,estado) VALUES (?,?,?,?,?)").run('PROJECT-LOCKED', 'Proyecto vinculado', 1, activo.id, 'evaluacion');
 relatedBefore[relation] = JSON.stringify(sqlite.prepare('SELECT * FROM activos WHERE id=?').get(activo.id));
 const rejected = await expect(item.PATCH, ctx('PATCH', '/api/activos/'+activo.id, { rubro: 'infraestructura', nombre: 'No guardar cambio parcial' }), 409);
 assert.match(rejected.error, /solicitudes, órdenes o proyectos vinculados/);
 assert.equal(JSON.stringify(sqlite.prepare('SELECT * FROM activos WHERE id=?').get(activo.id)), relatedBefore[relation]);
 // Criticidad and other fields remain editable without reclassification.
 const sameArea = await expect(item.PATCH, ctx('PATCH', '/api/activos/'+activo.id, { rubro: 'aires', criticidadOperacional: 'alta' }), 200);
 assert.equal(sameArea.activo.rubro, 'aires');
 assert.equal(sameArea.activo.criticidadOperacional, 'alta');
 // Bulk import cannot bypass the guard by reusing an existing code.
 const duplicate = await expect(bulk.POST, ctx('POST', '/api/admin/import-equipos', { area: 'infraestructura', csv: 'codigo,nombre,rubro\nLINKED-'+relation+',Cambio,infraestructura' }), 200);
 assert.equal(duplicate.insertados, 0);
 assert.equal(duplicate.errores.length, 1);
 assert.equal(sqlite.prepare('SELECT rubro FROM activos WHERE id=?').get(activo.id).rubro, 'aires');
}
assert.equal(sqlite.prepare("SELECT rubro FROM tickets WHERE tracking_token='ticket-locked'").get().rubro, 'aires');
assert.equal(sqlite.prepare("SELECT rubro FROM ordenes WHERE titulo='Orden cerrada'").get().rubro, 'aires');
// Plans follow their asset; they do not retain a separate area until an OT exists.
const { activo: planned } = await expect(collection.POST, ctx('POST', '/api/activos', { codigo: 'PLAN-NO-WORK', nombre: 'Plan sin trabajo generado', rubro: 'aires', mantenimientoFrecuencia: 'mensual' }), 201);
const plannedMoved = await expect(item.PATCH, ctx('PATCH', '/api/activos/'+planned.id, { rubro: 'infraestructura' }), 200);
assert.equal(plannedMoved.activo.rubro, 'infraestructura');
await expect(collection.GET,ctx('GET','/api/activos',undefined,null),401);
await expect(collection.POST,ctx('POST','/api/activos',{codigo:'UNAUTHORIZED',nombre:'No'},'solicitante'),403);
await expect(collection.POST,ctx('POST','/api/activos',{codigo:'JEFE',nombre:'No'},'jefe'),403);
assert.equal(JSON.stringify(sqlite.prepare('SELECT * FROM usuarios').all()),usersBefore);
console.log('PASS: '+checks+' comprobaciones API; cuatro áreas, JSON técnico, criticidad, cambio de área protegido con trabajo vinculado, legado, importación y permisos. Usuarios intactos.');
