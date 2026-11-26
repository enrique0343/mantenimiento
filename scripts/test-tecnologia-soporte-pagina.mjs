import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { experimental_AstroContainer } from 'astro/container';
import { JSDOM } from 'jsdom';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const f = await setupConjuntos({modules:{equipos:'pages/api/tickets/publico/equipos'}});
const {sqlite,app,ctx,close}=f;
let n=0;
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);n++;};
try {
  sqlite.exec(`INSERT INTO sucursales(id,nombre) VALUES (1,'PRUEBA'),(2,'OTRA');
    INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo) VALUES(1,1,'OFICINA','area'),(2,2,'SALA','area');
    INSERT INTO activos(id,codigo,nombre,rubro,tipo,ubicacion_id) VALUES
      (501,'TEC-TEST','COMPUTADORA <PRUEBA>','tecnologia','general',1),
      (502,'TEC-PEND','IMPRESORA PENDIENTE','tecnologia','general',NULL);`);
  const container=await experimental_AstroContainer.create();
  const page=(await import(pathToFileURL(path.join(process.cwd(),'dist/_worker.js/pages/soporte.astro.mjs')).href)).page().default;
  async function render(id,rol='admin',fallarLista=false) {
    const c=ctx(`/soporte?area=tecnologia&activoId=${id}`,{rol});
    const res=await container.renderToResponse(page,{request:c.request,locals:c.locals});
    eq(res.status,200);
    const dom=new JSDOM(await res.text(),{runScripts:'outside-only',url:c.url.href});
    const w=dom.window;
    let payload;
    w.fetch=async (url,opts)=>{
      if (opts?.method==='POST') {payload=JSON.parse(opts.body);return Response.json({ticket:{id:1,trackingToken:'FICTICIO',vencimientoSla:null}},{status:201});}
      if(fallarLista) throw new Error("Fallo de conexión simulado");
      return app.equipos.GET(ctx(url,{rol:null}));
    };
    for(const script of w.document.querySelectorAll('script:not([src])')) if(script.textContent.includes('__encodedScriptVars')) w.eval(script.textContent);
    await new Promise(r=>setTimeout(r,10));
    return {w,el:id=>w.document.getElementById(id),payload:()=>payload};
  }
  const a=await render(501);
  eq(a.el('tipoReporte').value,'tecnologia');eq(a.el('tipoReporte').disabled,false,'Origen TI preselecciona pero permite cambiar tipo');eq(a.el('rubro').value,'tecnologia');eq(a.el('sucursalId').value,'1');eq(a.el('ubicacionId').value,'1');eq(a.el('activoId').value,'501');
  eq(a.el('activoId').selectedOptions[0].textContent,'TEC-TEST · COMPUTADORA <PRUEBA>','Texto escapado, sin HTML ejecutable');
  for(const [id,v] of Object.entries({solicitanteNombre:'PERSONA',solicitanteEmail:'test@example.invalid',asunto:'FALLA DE PRUEBA',descripcion:'DESCRIPCION FICTICIA DE FALLA'})) a.el(id).value=v;
  a.el('form').dispatchEvent(new a.w.Event('submit',{cancelable:true,bubbles:true}));
  await new Promise(r=>setTimeout(r,10));
  eq(a.payload().activoId,501);eq(a.payload().sucursalId,1);eq(a.payload().ubicacionId,1);eq(a.payload().rubro,'tecnologia');
  a.el('sucursalId').value='2';a.el('sucursalId').dispatchEvent(new a.w.Event('change'));
  eq(a.el('activoId').value,'','Cambiar sede elimina selección incompatible');a.w.close();
  const b=await render(502);
  eq(b.el('activoId').value,'502');eq(b.el('sucursalId').value,'');
  b.el('sucursalId').value='1';b.el('sucursalId').dispatchEvent(new b.w.Event('change'));
  eq(b.el('activoId').value,'502','Equipo pendiente de ubicación conserva identidad al elegir sede');b.w.close();
  const sinRed=await render(501,'admin',true);
  eq(sinRed.el('activoId').value,'501','Un fallo de la lista no pierde el equipo de la ficha');
  sinRed.el('sucursalId').value='2';sinRed.el('sucursalId').dispatchEvent(new sinRed.w.Event('change'));
  eq(sinRed.el('activoId').value,'','Un cambio de sede sí elimina la selección anterior');sinRed.w.close();
  const anon=await render(501,null);eq(anon.el('activoId').value,'','No preselecciona ficha por ID sin sesión');anon.w.close();
  console.log(`PASS Tecnología soporte SSR/DOM: ${n} comprobaciones, sin crear datos ni enviar correo real.`);
} finally {await close();}
