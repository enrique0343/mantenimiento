// Formulario único real: selección de los tres espacios, áreas generales y respuesta tardía.
// Páginas construidas + API real sobre SQLite; todas las personas son ficticias, sin red.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { experimental_AstroContainer } from 'astro/container';
import { JSDOM } from 'jsdom';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const f=await setupConjuntos({modules:{equipos:'pages/api/tickets/publico/equipos', publico:'pages/api/tickets/publico'}});
const {sqlite,app,ctx,call,close}=f;
const tick=()=>new Promise(r=>setTimeout(r,10));
let n=0;
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);n++;};
const ok=(v,m)=>{assert.ok(v,m);n++;};
const doms=[];
try {
  sqlite.exec(`INSERT INTO sucursales(id,nombre) VALUES(1,'SEDE FICTICIA');
    INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo) VALUES(1,1,'OFICINA FICTICIA','area');
    INSERT INTO activos(id,codigo,nombre,rubro,tipo,ubicacion_id,datos_tecnicos) VALUES
      (801,'TEC-F','TELEFONO FICTICIO','tecnologia','general',1,'{"direccionIp":"192.0.2.10"}'),
      (802,'BIO-F','EQUIPO BIOMEDICO FICTICIO','biomedico','biomedico',1,NULL),
      (803,'AC-F','AIRE FICTICIO','aires','general',1,NULL),
      (804,'INF-F','INSTALACION FICTICIA','infraestructura','general',1,NULL),
      (805,'GEN-F','EQUIPO GENERAL FICTICIO','equipo_general','general',1,NULL);`);
  eq((await call(app.assetCreate.GET,'/api/activos?area=tecnologia&espacio=tecnologia',{rol:null})).status,401,'Formulario público no da acceso al inventario privado');
  eq((await call(app.assetCreate.GET,'/api/activos?area=tecnologia&espacio=tecnologia',{rol:'jefe'})).status,403,'Jefatura anterior sin Tecnología conserva sus espacios');
  let r=await call(app.equipos.GET,'/api/tickets/publico/equipos?ubicacionId=1&espacio=general',{rol:null});
  eq(r.status,200);eq(r.body.equipos.map(e=>e.area).sort(),['aires','equipo_general','infraestructura']);
  r=await call(app.equipos.GET,'/api/tickets/publico/equipos?ubicacionId=1&espacio=tecnologia',{rol:null});
  eq(r.body.equipos,[{id:801,codigo:'TEC-F',nombre:'TELEFONO FICTICIO',area:'tecnologia'}],'Equipos públicos solo muestran cuatro campos mínimos');
  eq((await call(app.equipos.GET,'/api/tickets/publico/equipos?ubicacionId=1&espacio=general&area=tecnologia',{rol:null})).status,400);
  eq((await call(app.equipos.GET,'/api/tickets/publico/equipos?ubicacionId=1&espacio=invalido',{rol:null})).status,400);

  const container=await experimental_AstroContainer.create();
  const page=(await import(pathToFileURL(path.join(process.cwd(),'dist/_worker.js/pages/soporte.astro.mjs')).href)).page().default;
  async function render(route,{rol=null,demorar=false}={}) {
    const c=ctx(route,{rol});
    const response=await container.renderToResponse(page,{request:c.request,locals:c.locals});
    eq(response.status,200);
    const dom=new JSDOM(await response.text(),{runScripts:'outside-only',url:c.url.href});doms.push(dom);
    const w=dom.window;let payload,postStatus;const pendientes=[];
    w.fetch=async(url,options={})=>{
      if(options.method==='POST') {
        eq(url,'/api/tickets/publico','El origen con ?area= no restringe el destino elegido');
        payload=JSON.parse(options.body);
        const res=await app.publico.POST(ctx(url,{method:'POST',data:payload,rol:null}));postStatus=res.status;return res;
      }
      if(demorar) return new Promise(resolve=>pendientes.push({url,resolve}));
      return app.equipos.GET(ctx(url,{rol:null}));
    };
    for(const script of w.document.querySelectorAll('script:not([src])')) if(script.textContent.includes('__encodedScriptVars')) w.eval(script.textContent);
    await tick();
    const el=id=>w.document.getElementById(id);
    const elegir=(id,value)=>{el(id).value=value;el(id).dispatchEvent(new w.Event('change'));};
    const enviar=async()=>{
      for(const [id,value] of Object.entries({solicitanteNombre:'PERSONA FICTICIA',solicitanteEmail:'persona@example.invalid',asunto:'REPORTE FICTICIO',descripcion:'DESCRIPCION DE FALLA PARA PRUEBA'}))el(id).value=value;
      el('form').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));await tick();
      return {payload,postStatus};
    };
    return {el,elegir,enviar,pendientes,w};
  }
  const libre=await render('/soporte');
  eq([...libre.el('tipoReporte').options].filter(o=>o.value).map(o=>o.value),['general','biomedico','tecnologia']);
  eq(libre.el('tipoReporte').value,'');eq(libre.el('tipoReporte').disabled,false);
  for(const area of ['aires','infraestructura','equipo_general','biomedico','tecnologia']) {
    const p=await render(`/soporte?area=${area}&espacio=tecnologia`);
    eq(p.el('tipoReporte').value,['biomedico','tecnologia'].includes(area)?area:'general');
    eq(p.el('tipoReporte').disabled,false,`${area}: el enlace no bloquea el formulario`);
    eq(p.el('rubro').value,area);
  }
  const desdeFicha=await render('/soporte?area=tecnologia&activoId=801',{rol:'admin'});
  eq(desdeFicha.el('activoId').value,'801');
  desdeFicha.elegir('tipoReporte','biomedico');
  eq(desdeFicha.el('activoId').value,'','Cambio de tipo limpia el equipo antes de esperar la red');
  await tick();
  eq([...desdeFicha.el('activoId').options].filter(o=>o.value).map(o=>o.value),['802']);
  const enviado=await desdeFicha.enviar();eq(enviado.postStatus,201);
  eq(enviado.payload.rubro,'biomedico');eq(enviado.payload.activoId,null,'No arrastra el teléfono al reporte biomédico');

  const general=await render('/soporte?area=tecnologia');
  general.elegir('tipoReporte','general');general.elegir('sucursalId','1');general.elegir('ubicacionId','1');await tick();
  eq(general.el('rubro').value,'equipo_general','No estoy seguro se recibe como General');
  eq(general.el('rubroGeneralBox').hidden,false);
  eq([...general.el('activoId').options].filter(o=>o.value).map(o=>Number(o.value)).sort(),[803,804,805]);
  general.elegir('activoId','803');
  const aire=await general.enviar();eq(aire.postStatus,201);eq(aire.payload.rubro,'aires');eq(aire.payload.activoId,803,'El equipo aporta el rubro general preciso');

  const tardia=await render('/soporte?area=tecnologia&activoId=801',{rol:'admin',demorar:true});
  eq(tardia.pendientes.length,1);
  tardia.elegir('tipoReporte','biomedico');eq(tardia.pendientes.length,2);
  tardia.pendientes[1].resolve(await app.equipos.GET(ctx(tardia.pendientes[1].url,{rol:null})));await tick();
  tardia.pendientes[0].resolve(await app.equipos.GET(ctx(tardia.pendientes[0].url,{rol:null})));await tick();
  eq(tardia.el('tipoReporte').value,'biomedico');eq(tardia.el('activoId').value,'');
  eq([...tardia.el('activoId').options].filter(o=>o.value).map(o=>o.value),['802'],'Respuesta antigua TI no restaura equipo ni opciones');
  ok(!tardia.w.document.body.textContent.includes('192.0.2.10'),'El formulario no revela datos de red');
  console.log(`PASS soporte único: ${n} comprobaciones API y SSR/DOM de tipos, contexto, selección y respuestas tardías.`);
} finally {for(const dom of doms)dom.window.close();await close();}
