// Local FTS and predictive maintenance checks; no external calls.
import assert from 'node:assert/strict';
import { setup } from './test-support/sqlite-app.mjs';
const {api,sqlite,call,close}=await setup({modules:{search:'api/search.ts',measurement:'api/mediciones/index.ts'},pages:['taller']});
try {
sqlite.exec("INSERT INTO sucursales (id,nombre) VALUES (1,'Local test sede'), (2,'Otra sede'); INSERT INTO ubicaciones(id,nombre,tipo,sucursal_id) VALUES(1,'Sala','area',1); INSERT INTO actividad_categorias(id,nombre,rubro) VALUES(1,'Solo aires','aires'),(2,'Solo infraestructura','infraestructura');");
for(const [i,area] of ['aires','infraestructura','equipo_general','biomedico'].entries()) sqlite.prepare("INSERT INTO activos (id,codigo,nombre,rubro,tipo) VALUES(?,?,?,?,?)").run(i+1,`TEST-${i}`,`Activo ${area}`,area,area==='biomedico'?'biomedico':'general');
sqlite.exec("UPDATE activos SET nombre='Comunscope ' || nombre; INSERT INTO activos(id,codigo,nombre,tipo) VALUES(5,'LEGACY-TEST','Comunscope legacy','biomedico');");
for(const [i,area] of ['aires','infraestructura','equipo_general','biomedico'].entries()){
 const id=(i+1)*100;
 sqlite.prepare('INSERT INTO ordenes(id,titulo,tipo,rubro,activo_id,creado_por) VALUES(?,?,?,?,?,1)').run(id,'Comunscope OT '+area,'correctivo',area,i+1);
 sqlite.prepare('INSERT INTO tickets(id,tracking_token,solicitante_nombre,solicitante_email,asunto,descripcion,rubro,activo_id) VALUES(?,?,?,?,?,?,?,?)').run(id,'TOKEN-'+area,'Persona test','test@example.invalid','Comunscope ticket '+area,'Prueba aislada',area,i+1);
 sqlite.prepare('INSERT INTO comentarios(id,orden_id,usuario_id,texto) VALUES(?,?,?,?)').run(id,id,1,'Comunscope comentario '+area);
}
sqlite.exec("INSERT INTO items(codigo,nombre) VALUES('SHARED-TEST','Comunscope repuesto'); INSERT INTO requisiciones(numero,notas) VALUES('SHARED-TEST','Comunscope requisición');");
for(const name of ['activos','ordenes','tickets','items','comentarios'])sqlite.exec(`INSERT INTO ${name}_fts(${name}_fts) VALUES('rebuild')`);
for(const area of ['aires','infraestructura','equipo_general','biomedico']){
 const r=await call(api.search.GET,`/api/search?q=Comunscope&area=${area}`);assert.equal(r.status,200,JSON.stringify(r));
 const {ordenes,equipos,tickets,comentarios,items,requisiciones}=r.body.resultados;
 assert.equal(ordenes.length,1);assert.equal(equipos.length,area==='biomedico'?2:1);assert.equal(tickets.length,1);assert.equal(comentarios.length,1);
 for(const row of [...ordenes,...equipos,...tickets,...comentarios])assert.equal(row.rubro,area);
 assert.equal(items.length,1);assert.equal(requisiciones.length,1);
}
let r=await call(api.search.GET,'/api/search?q=200&area=aires');assert.equal(r.body.resultados.ordenes.length,0);assert.equal(r.body.resultados.tickets.length,0);
r=await call(api.search.GET,'/api/search?q=200&area=infraestructura');assert.equal(r.body.resultados.ordenes[0].id,200);assert.equal(r.body.resultados.tickets[0].id,200);
r=await call(api.search.GET,'/api/search?q=Comunscope&area=invalid');assert.equal(r.status,400);
r=await call(api.search.GET,'/api/search?q=Comunscope');assert.equal(r.body.resultados.ordenes.length,4);assert.equal(r.body.resultados.equipos.length,5);
sqlite.exec("INSERT INTO variables_predictivas(id,activo_id,nombre,max_critico,max_warning) VALUES(1,1,'Temperatura test',40,35),(2,5,'Temperatura legacy test',40,35)");
r=await call(api.measurement.POST,'/api/mediciones?area=infraestructura',{method:'POST',data:{variableId:1,valor:45}});assert.equal(r.status,400);assert.equal(sqlite.prepare('SELECT count(*) AS n FROM mediciones').get().n,0);
r=await call(api.measurement.POST,'/api/mediciones?area=aires',{method:'POST',data:{variableId:1,valor:45}});assert.equal(r.status,201,JSON.stringify(r));assert.equal(r.body.ordenAutomatica.rubro,'aires');assert.equal(r.body.ordenAutomatica.prioridad,'alta');
r=await call(api.measurement.POST,'/api/mediciones?area=aires',{method:'POST',data:{variableId:1,valor:20}});assert.equal(r.status,201);assert.equal(r.body.ordenAutomatica,null);
r=await call(api.measurement.POST,'/api/mediciones?area=biomedico',{method:'POST',data:{variableId:2,valor:45}});assert.equal(r.status,201);assert.equal(r.body.ordenAutomatica.rubro,'biomedico');assert.equal(r.body.ordenAutomatica.prioridad,'alta');
r=await call(api.measurement.POST,'/api/mediciones?area=aires',{method:'POST',rol:'solicitante',data:{variableId:1,valor:45}});assert.equal(r.status,403);
console.log('PASS: Taller Astro compiles; FTS and numeric search isolate 4 areas including comments/legacy assets, shared resources remain visible; predictive orders inherit area and retain high priority; validation rejects cross-area writes. SQLite memory only.');

} finally { await close(); }
process.exit(0);
