// Local integration test; no production, mail or network calls.
import assert from 'node:assert/strict';
import { setup } from './test-support/sqlite-app.mjs';
const modules={activity:'api/actividades/index.ts',activityDetail:'api/actividades/[id].ts',activityGenerate:'api/actividades/[id]/generar-ot.ts',plans:'api/planes/index.ts',assetPlans:'api/activos/[id]/planes.ts',planGenerate:'api/planes/[id]/generar-ot.ts',planEdit:'api/planes/[id].ts',planBulk:'api/planes/bulk.ts',planConfig:'api/plan-config.ts'};
const {api,sqlite,call,close}=await setup({modules,pages:['planes/index','actividades/index','actividades/nuevo','actividades/[id]','cronograma','gantt','plan-mantenimiento','planificador']});
try {
sqlite.exec("INSERT INTO sucursales (id,nombre) VALUES (1,'Local test sede'), (2,'Otra sede'); INSERT INTO ubicaciones(id,nombre,tipo,sucursal_id) VALUES(1,'Sala','area',1); INSERT INTO actividad_categorias(id,nombre,rubro) VALUES(1,'Solo aires','aires'),(2,'Solo infraestructura','infraestructura');");
for(const [i,area] of ['aires','infraestructura','equipo_general','biomedico'].entries()) sqlite.prepare("INSERT INTO activos (id,codigo,nombre,rubro,tipo) VALUES(?,?,?,?,?)").run(i+1,`TEST-${i}`,`Activo ${area}`,area,area==='biomedico'?'biomedico':'general');
const base={titulo:'Rutina local',rubro:'infraestructura',frecuencia:'mensual',proximaFecha:'2027-01-15',ubicacionId:1};
let r=await call(api.activity.POST,'/api/actividades?area=infraestructura',{method:'POST',data:base});assert.equal(r.status,201,JSON.stringify(r));const activityId=r.body.actividad.id;assert.equal(r.body.actividad.rubro,'infraestructura');assert.equal(r.body.actividad.sucursalId,1);
r=await call(api.activity.POST,'/api/actividades?area=aires',{method:'POST',data:base});assert.equal(r.status,400);
r=await call(api.activity.POST,'/api/actividades',{method:'POST',data:{...base,rubro:undefined}});assert.equal(r.status,400);
r=await call(api.activity.POST,'/api/actividades',{method:'POST',data:{...base,categoriaId:1}});assert.equal(r.status,400);
r=await call(api.activity.POST,'/api/actividades',{method:'POST',data:{...base,sucursalId:2}});assert.equal(r.status,400);
r=await call(api.activity.GET,'/api/actividades?area=aires');assert.equal(r.body.actividades.length,0);
r=await call(api.activity.GET,'/api/actividades?area=infraestructura');assert.equal(r.body.actividades.length,1);
r=await call(api.activityDetail.GET,'/api/actividades/1?area=aires',{id:activityId});assert.equal(r.status,404);
r=await call(api.activityDetail.PATCH,'/api/actividades/1?area=aires',{id:activityId,method:'PATCH',data:{titulo:'Forbidden'}});assert.equal(r.status,404);
r=await call(api.activityGenerate.POST,'/api/actividades/1/generar-ot?area=infraestructura',{id:activityId,method:'POST'});assert.equal(r.status,201,JSON.stringify(r));assert.equal(r.body.orden.rubro,'infraestructura');
for(const [i,area] of ['aires','infraestructura','equipo_general','biomedico'].entries()){
 r=await call(api.assetPlans.POST,`/api/activos/${i+1}/planes?area=${area}`,{id:i+1,method:'POST',data:{titulo:`Plan ${area}`,frecuencia:'mensual',proximaFecha:'2027-02-01'}});assert.equal(r.status,201,JSON.stringify(r));
}
r=await call(api.assetPlans.POST,'/api/activos/1/planes?area=biomedico',{id:1,method:'POST',data:{titulo:'Incorrecto',frecuencia:'mensual',proximaFecha:'2027-02-01'}});assert.equal(r.status,404);
r=await call(api.plans.GET,'/api/planes?area=aires');assert.equal(r.body.planes.length,1);const planId=r.body.planes[0].id;assert.equal(r.body.planes[0].activo.rubro,'aires');
r=await call(api.planGenerate.POST,'/api/planes/1/generar-ot?area=infraestructura',{id:planId,method:'POST'});assert.equal(r.status,404);
r=await call(api.planGenerate.POST,'/api/planes/1/generar-ot?area=aires',{id:planId,method:'POST'});assert.equal(r.status,201,JSON.stringify(r));assert.equal(r.body.orden.rubro,'aires');
r=await call(api.planBulk.POST,'/api/planes/bulk?area=aires',{method:'POST',data:{accion:'desactivar',ids:[1,2]}});assert.equal(r.status,400);
assert.equal(sqlite.prepare('SELECT count(*) AS n FROM planes_mantenimiento WHERE activo=1').get().n,4);
r=await call(api.planConfig.POST,'/api/plan-config?area=aires',{method:'POST',data:{valores:{'plan.codigo':'AA-TEST'}}});assert.equal(r.status,200);assert.equal(sqlite.prepare("SELECT valor FROM app_config WHERE clave='plan.aires.codigo'").get().valor,'AA-TEST');assert.equal(sqlite.prepare("SELECT count(*) AS n FROM app_config WHERE clave='plan.codigo'").get().n,0);
r=await call(api.planEdit.PATCH,'/api/planes/1?area=aires',{id:planId,method:'PATCH',rol:'solicitante',data:{titulo:'No permitido'}});assert.equal(r.status,403);
console.log('PASS: 8 Astro pages compile; planning API isolation, area validation, OT inheritance and plan text scoping verified in memory. No cron execution or email calls.');

} finally { await close(); }
process.exit(0);
