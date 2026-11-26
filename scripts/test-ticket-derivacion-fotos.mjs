// Fotos móviles e informes: una derivación no recibe escrituras pendientes del origen.
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';
const f = await setupConjuntos({ modules: { foto:'pages/api/campo/foto', se:'pages/api/activos/[id]/seguridad-electrica', bio:'lib/biomedico', derivar:'pages/api/tickets/[id]/derivar', convertir:'pages/api/tickets/[id]/convertir' } });
const { sqlite:s,app,call,faults }=f;
const one=(q,...p)=>s.prepare(q).get(...p);
let checks=0,next=100,putHook=null;
const equal=(a,b)=>{ checks++; assert.deepEqual(a,b); };
const files=new Map();
const R2={async put(k,b){files.set(k,b); const h=putHook; putHook=null; if(h) await h();},async delete(k){files.delete(k);}};
async function nueva(bio=false) {
  const id=next++;
  s.prepare(`INSERT INTO tickets(id,rubro,tipo_mantenimiento,activo_id,solicitante_nombre,solicitante_email,asunto,descripcion,sucursal_id,ubicacion_id,tracking_token)
    VALUES(?,?,?,?, 'PRUEBA','test@example.invalid','REPORTE','PRUEBA',1,1,?)`).run(id,bio?'biomedico':'equipo_general',bio?'biomedico':'general',bio?1:null,`PRUEBA-${id}`);
  const r=await call(app.convertir.POST,`/api/tickets/${id}/convertir`,{id,method:'POST',data:{asignadoA:3}});
  equal(r.status,201); return {id,ot:r.body.orden.id,bio};
}
const move=async t=>call(app.derivar.POST,`/api/tickets/${t.id}/derivar`,{id:t.id,method:'POST',data:{espacioDestino:'tecnologia',motivo:'CORRESPONDE A TECNOLOGIA',desvincularEquipo:t.bio,expectedUpdatedAt:one('SELECT updated_at FROM tickets WHERE id=?',t.id).updated_at}});
async function multipart(route,url,id,fields,rol='tecnico') {
  const ctx=f.ctx(url,{method:'POST',id,rol}),form=new FormData();
  for(const [k,v] of Object.entries(fields)) form.set(k,v);
  ctx.request=new Request(ctx.url,{method:'POST',headers:{cookie:ctx.request.headers.get('cookie')},body:form});
  ctx.locals.runtime.env.R2=R2;
  const res=await route(ctx); return {status:res.status,body:await res.json()};
}
const photo=(t,op=`PRUEBA-FOTO-${t.id}`)=>multipart(app.foto.POST,'/api/campo/foto',undefined,{ordenId:String(t.ot),opId:op,file:new File(['FOTO FICTICIA'],'foto.jpg',{type:'image/jpeg'})});
const report=(t)=>multipart(app.se.POST,'/api/activos/1/seguridad-electrica',1,{
  ordenId:String(t.ot),confirmado:'1',fecha:app.bio.hoySV(),tipo:'periodica',claseProteccion:'I',parteAplicada:'BF',metodoFuga:'directo',
  inspeccionVisual:'conforme',pruebaFuncional:'conforme',tierraOhm:'0.12',fugaEquipoUa:'120',fugaParteUa:'15',resultado:'pasa',
  analizadorDescripcion:'PATRON FICTICIO',analizadorSerie:'PRUEBA',analizadorCalVence:app.bio.sumarMeses(app.bio.hoySV(),12),realizadoPorId:'3',
  informe:new File(['%PDF-1.4\n% SOLO PRUEBA\n'],'informe.pdf',{type:'application/pdf'})
});
try {
  faults.enforceColumnLimit=true; faults.enforceParameterLimit=true;
  s.exec(`INSERT INTO sucursales(id,nombre) VALUES(1,'SEDE PRUEBA');
    INSERT INTO ubicaciones(id,sucursal_id,nombre) VALUES(1,1,'UBICACION PRUEBA');
    INSERT INTO activos(id,codigo,nombre,tipo,rubro,ubicacion_id) VALUES(1,'BIO-PRUEBA','EQUIPO PRUEBA','biomedico','biomedico',1);
    UPDATE usuarios SET especialidad='general' WHERE id=3;`);
  // El cambio de área puede ocurrir durante la subida del archivo o justo antes del lote.
  for(const momento of ['r2','batch']) {
    const t=await nueva(),prev=files.size;
    if(momento==='r2') putHook=async()=>equal((await move(t)).status,200);
    else faults.beforeBatch=async()=>equal((await move(t)).status,200);
    equal((await photo(t)).status,409);
    equal(one('SELECT count(*) n FROM adjuntos WHERE orden_id=?',t.ot).n,0);
    equal(one('SELECT count(*) n FROM campo_operaciones WHERE orden_id=?',t.ot).n,0);
    equal(files.size,prev);
    equal(one('SELECT rubro FROM ordenes WHERE id=?',t.ot).rubro,'tecnologia');
  }
  let t=await nueva(); equal((await move(t)).status,200); equal((await photo(t)).status,403);
  t=await nueva(); equal((await photo(t)).status,201); equal((await photo(t)).body.repetida,true);
  equal(one('SELECT count(*) n FROM adjuntos WHERE orden_id=?',t.ot).n,1);
  equal((await move(t)).status,409);
  t=await nueva(); const duplicate=t;
  faults.beforeBatch=async()=>equal((await photo(duplicate)).status,201);
  const repeated=await photo(t); equal(repeated.status,200); equal(repeated.body,{ok:true,repetida:true});
  equal(one('SELECT count(*) n FROM adjuntos WHERE orden_id=?',t.ot).n,1);
  // El segundo paso del lote falla: se deshace la foto y se retira solo su archivo nuevo.
  t=await nueva(); const prev=files.size;
  faults.statement=sql=>sql.startsWith('INSERT INTO campo_operaciones');
  equal((await photo(t)).status,500); faults.statement=null;
  equal(files.size,prev); equal(one('SELECT count(*) n FROM adjuntos WHERE orden_id=?',t.ot).n,0);
  equal((await move(t)).status,200);
  // Informe biomédico vinculado: no debe quedar apuntando a una OT ya derivada y desvinculada.
  s.exec("UPDATE usuarios SET especialidad='biomedico' WHERE id=3");
  for(const momento of ['r2','insert']) {
    t=await nueva(true); const prior=files.size;
    if(momento==='r2') putHook=async()=>equal((await move(t)).status,200);
    else faults.beforeStatement={matches:sql=>sql.startsWith('INSERT INTO pruebas_seguridad_electrica'),run:async()=>equal((await move(t)).status,200)};
    equal((await report(t)).status,409); equal(files.size,prior);
    equal(one('SELECT count(*) n FROM pruebas_seguridad_electrica WHERE orden_id=?',t.ot).n,0);
    equal(one('SELECT activo_id FROM ordenes WHERE id=?',t.ot).activo_id,null);
  }
  t=await nueva(true); equal((await move(t)).status,200); equal((await report(t)).status,403);
  t=await nueva(true); const saved=await report(t); assert.equal(saved.status,201,JSON.stringify(saved)); checks++;
  equal((await move(t)).status,409);
  equal(one('SELECT count(*) n FROM pruebas_seguridad_electrica WHERE orden_id=?',t.ot).n,1);
  console.log(`PASS derivación fotos e informes: ${checks} verificaciones de permisos, carreras R2/INSERT/lote, idempotencia, rollback y evidencia previa.`);
} finally { await f.close(); }
