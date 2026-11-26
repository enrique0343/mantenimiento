import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
let checks = 0;
const equal = (actual, expected, label) => { checks++; assert.deepEqual(actual, expected, label); };
const f = await setupConjuntos({ modules: {
  variables: 'pages/api/variables/index', alertas: 'pages/api/alertas/index', seguridadCsv: 'pages/api/seguridad-electrica/csv', series: 'pages/api/activos/serie', proyectos: 'pages/api/proyectos/index', campoSync: 'pages/api/campo/sync', calendar: 'pages/api/calendar/[token]', campoBuscar: 'pages/api/campo/buscar', campoHoy: 'pages/api/campo/hoy', campoOrdenes: 'pages/api/campo/ordenes',
  E: 'lib/espacio', ED: 'lib/espacio-db', D: 'lib/db', especialidad: 'lib/especialidad',
  buscar: 'pages/api/search', tickets: 'pages/api/tickets/index', planes: 'pages/api/planes/index',
  notif: 'pages/api/notificaciones/index', reportes: 'pages/api/reportes/[tipo]', tablero: 'pages/api/dashboard',
} });
const { sqlite, app, ctx, call, close, faults } = f;
const run = (q, ...args) => sqlite.prepare(q).run(...args);
const como = (e) => run('UPDATE usuarios SET especialidad=? WHERE id=2', e);
const ids = xs => xs.map(x => x.id).sort((a,b)=>a-b);
try {
  sqlite.exec(`
    INSERT INTO sucursales(id,nombre) VALUES(1,'SEDE FICTICIA');
    INSERT INTO ubicaciones(id,sucursal_id,nombre,tipo) VALUES(1,1,'SALA FICTICIA','area');
    INSERT INTO activos(id,codigo,nombre,rubro,tipo,ubicacion_id) VALUES
    (101,'AISL-GEN','TIprueba impresora anterior','equipo_general','general',1),
    (102,'AISL-BIO','TIprueba monitor clínico','biomedico','biomedico',1),
    (103,'AISL-TEC','TIprueba computador','tecnologia','general',1);
    INSERT INTO ordenes(id,creado_por,titulo,rubro,activo_id) VALUES
    (201,1,'TIprueba general','equipo_general',101),(202,1,'TIprueba bio','biomedico',102),
    (203,1,'TIprueba tecnología','tecnologia',103),(204,1,'TIprueba tecnología por activo',NULL,103),
    (205,1,'TIprueba legacy general',NULL,NULL);
    INSERT INTO tickets(id,tracking_token,solicitante_nombre,solicitante_email,asunto,descripcion,rubro,activo_id) VALUES
    (301,'t-general','PERSONA','persona@example.invalid','TIprueba general','x','equipo_general',101),
    (302,'t-bio','PERSONA','persona@example.invalid','TIprueba bio','x','biomedico',102),
    (303,'t-tec','PERSONA','solicitante@example.invalid','TIprueba TI propia','x','tecnologia',103),
    (304,'t-tec-ajeno','OTRA','otra@example.invalid','TIprueba TI ajena','x','tecnologia',103);
    INSERT INTO planes_mantenimiento(id,activo_id,titulo,frecuencia,proxima_fecha) VALUES
    (401,101,'TIprueba general','mensual','2026-12-01'),(402,102,'TIprueba bio','mensual','2026-12-01'),
    (403,103,'TIprueba TI','mensual','2026-12-01');
    INSERT INTO proyectos(id,codigo,titulo,creado_por,activo_id,ticket_id) VALUES
    (501,'PR-GEN','PROYECTO GENERAL',1,101,NULL),(502,'PR-BIO','PROYECTO BIO',1,102,NULL),
    (503,'PR-TEC-ACT','PROYECTO TI POR ACTIVO',1,103,301),(504,'PR-TEC-TK','PROYECTO TI POR SOLICITUD',1,NULL,303);
    INSERT INTO notificaciones(usuario_id,tipo,titulo,link) VALUES
    (2,'eq','GENERAL','/activos/101'),(2,'eq','BIO','/activos/102'),(2,'eq','TI','/activos/103'),
    (2,'ot','TI OT','/ordenes/204'),(2,'tk','TI TK','/tickets/303'),(2,'plan','TI PLAN','/planes?espacio=tecnologia'),(2,'proy','TI PROYECTO','/proyectos/503'),(2,'proy','TI PROYECTO TK','/proyectos/504');
  `);
  faults.enforceParameterLimit = faults.enforceColumnLimit = true;
  const esperado = {
    general: { activos:[101], ordenes:[201,205], tickets:[301], planes:[401], proyectos:[501] },
    biomedico: { activos:[102], ordenes:[202], tickets:[302], planes:[402], proyectos:[502] },
    tecnologia: { activos:[103], ordenes:[203,204], tickets:[303,304], planes:[403], proyectos:[503,504] },
  };
  for (const [esp, expected] of Object.entries(esperado)) {
    como(esp);
    for (const [module, key] of [[app.assetCreate,'activos'],[app.orders,'ordenes'],[app.tickets,'tickets'],[app.planes,'planes'],[app.proyectos,'proyectos']]) {
      const result = await call(module.GET, '/api/prueba', {rol:'jefe'});
      equal(result.status, 200, esp+' '+key+' estado');
      equal(ids(result.body[key]), expected[key], esp+' '+key+' aislados');
    }
    const search = await call(app.buscar.GET, '/api/search?q=TIprueba', {rol:'jefe'});
    equal(ids(search.body.resultados.equipos), expected.activos, esp+' búsqueda');
    const dash = await call(app.tablero.GET, '/api/dashboard', {rol:'jefe'});
    equal(dash.body.ordenesPorEstado.reduce((n,r)=>n+Number(r.n),0),expected.ordenes.length,esp+' indicador');
  }
  como('tecnologia');
  const nt = await call(app.notif.GET, '/api/notificaciones', {rol:'jefe'});
  equal(nt.body.notificaciones.map(n=>n.link).sort(), ['/activos/103','/ordenes/204','/tickets/303','/planes?espacio=tecnologia','/proyectos/503','/proyectos/504'].sort(), 'campana TI solo TI');
  for (const e of ['general','biomedico','ambos',null]) {
    como(e);
    equal((await call(app.assetCreate.GET,'/api/activos?area=tecnologia',{rol:'jefe'})).status,403, 'legacy '+e+' no gana inventario TI');
    const db=app.D.getDb(ctx('/'));
    equal(await app.ED.espacioAjenoDeActivos(db,{rol:'jefe',especialidad:e},[103]),'tecnologia','lote no omite revisar ambos');
  }
  for (const rol of ['admin','visualizador']) {
    equal((await call(app.assetCreate.GET,'/api/activos?area=tecnologia',{rol})).status,200,rol+' alcance global conservado');
  }
  run("UPDATE activos SET serial='SERIE-COMPARTIDA' WHERE id IN (101,103)");
  for (const [e, esperado] of [['general',[101]], ['biomedico',[]], ['ambos',[101]], [null,[101]], ['tecnologia',[103]]]) {
    como(e);
    const series=await call(app.series.GET,'/api/activos/serie?valor=SERIE-COMPARTIDA',{rol:'jefe'});
    equal(series.status,200,'buscar serie '+e);
    equal(ids(series.body.coincidencias),esperado,'serie no revela equipos fuera de '+e);
  }
  equal(ids((await call(app.series.GET,'/api/activos/serie?valor=SERIE-COMPARTIDA',{rol:'admin'})).body.coincidencias),[101,103],'admin conserva coincidencias globales');
  como('biomedico');
  equal((await call(app.seguridadCsv.GET,'/api/seguridad-electrica/csv?activoId=103',{rol:'jefe'})).status,403,'CSV de pruebas por ID no expone otro espacio');
  equal((await call(app.seguridadCsv.GET,'/api/seguridad-electrica/csv?activoId=102',{rol:'jefe'})).status,200,'CSV del espacio propio conserva acceso');
  como('tecnologia');
  const variable=await call(app.variables.POST,'/api/variables',{rol:'jefe',method:'POST',data:{activoId:103,nombre:'TEMPERATURA TI PRIVADA'}});
  equal(variable.status,201,'crear variable dentro del espacio TI');
  for (const e of ['general','biomedico','ambos',null]) {
    como(e);
    equal((await call(app.variables.GET,'/api/variables?activo_id=103',{rol:'jefe'})).status,403,'variable por equipo rechaza '+e);
    equal((await call(app.variables.GET,'/api/variables',{rol:'jefe'})).body.variables,[],'lista variables filtra TI para '+e);
    equal((await call(app.variables.POST,'/api/variables',{rol:'jefe',method:'POST',data:{activoId:103,nombre:'NO AUTORIZADA'}})).status,403,'variable escritura rechaza '+e);
    equal((await call(app.alertas.GET,'/api/alertas?activoId=103',{rol:'jefe'})).status,403,'alertas por equipo rechaza '+e);
  }
  como('tecnologia');
  equal((await call(app.variables.GET,'/api/variables?activo_id=103',{rol:'jefe'})).body.variables.map(x=>x.nombre),['TEMPERATURA TI PRIVADA'],'lectura propia variable TI');
  equal(sqlite.prepare('SELECT count(*) n FROM variables_predictivas').get().n,1,'escrituras ajenas no agregan variables');
  // Notificación a la jefatura TI, sin avisar a general ni a ambos/NULL.
  como('tecnologia');
  equal((await app.especialidad.jefesNotificar(ctx('/'),'tecnologia')).map(x=>x.id),[2],'destinatario TI explícito');
  como('ambos');
  equal(await app.especialidad.jefesNotificar(ctx('/'),'tecnologia'),[],'ambos no recibe avisos TI');
  equal((await app.especialidad.jefesNotificar(ctx('/'),'general')).map(x=>x.id),[2],'ambos conserva avisosGeneral');
  // El paquete del técnico y la búsqueda móvil usan el mismo aislamiento.
  run('UPDATE ordenes SET asignado_a=3 WHERE id IN (201,203)');
  for (const [e, esperadoEquipo, mias, libres] of [
    ['tecnologia',[103],[203],[204]], ['general',[101],[201],[]],
    ['biomedico',[102],[],[202]], ['ambos',[101,102],[201],[202]],
  ]) {
    run('UPDATE usuarios SET especialidad=? WHERE id=3',e);
    const buscar=await call(app.campoBuscar.GET,'/api/campo/buscar?ubicacion=1',{rol:'tecnico'});
    equal(ids(buscar.body.equipos),esperadoEquipo,e+' búsqueda campo');
    const hoy=await call(app.campoHoy.GET,'/api/campo/hoy?sede=1',{rol:'tecnico'});
    equal(ids(hoy.body.ordenes),mias,e+' asignadas campo');
    equal(ids(hoy.body.libres),libres,e+' libres campo');
    equal((await call(app.campoOrdenes.GET,'/api/campo/ordenes?id=203',{rol:'tecnico'})).status,e==='tecnologia'?200:404,e+' orden campo por ID');
  }
  run("UPDATE usuarios SET especialidad='ambos' WHERE id=3");
  for (const op of [
    {opId:'ti-cruzada-orden',tipo:'orden.iniciar',ordenId:203},
    {opId:'ti-cruzada-falla',tipo:'correctivo.abrir',activoId:103,nota:'NO AUTORIZADO'},
  ]) {
    const before=sqlite.prepare('SELECT count(*) n FROM ordenes').get().n;
    const sync=await call(app.campoSync.POST,'/api/campo/sync',{rol:'tecnico',method:'POST',data:{ops:[{...op,at:new Date().toISOString()}]}});
    equal(sync.body.resultados[0].ok,false,'sincronización rechaza '+op.tipo+' fuera de espacio');
    equal(sqlite.prepare('SELECT count(*) n FROM ordenes').get().n,before,'sin orden añadida por operación no autorizada');
    equal(sqlite.prepare('SELECT estado FROM ordenes WHERE id=203').get().estado,'abierta','sin mutar orden TI por sync');
  }
  run("UPDATE usuarios SET calendar_token='cal-ficticio' WHERE id=3");
  for (const e of ['ambos',null,'tecnologia']) {
    run('UPDATE usuarios SET especialidad=? WHERE id=3',e);
    const c=ctx('/api/calendar/cal-ficticio.ics',{rol:null});c.params={token:'cal-ficticio.ics'};
    const response=await app.calendar.GET(c), text=await response.text();
    equal(response.status,200,'calendario '+e);
    equal(text.includes('ot-203@mantenimiento'),e==='tecnologia','calendario '+e+' respeta TI');
    equal(text.includes('ot-201@mantenimiento'),e!=='tecnologia','calendario '+e+' respeta General');
  }
  // Middleware real con sesión: ningún ID permite saltar el tercer espacio.
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tecnologia-mw-'));
  const file=path.join(dir,'mw.mjs');
  await build({entryPoints:[path.join(root,'src/middleware.ts')],outfile:file,bundle:true,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'astro',setup(b){b.onResolve({filter:/^astro:middleware$/},()=>({path:'mw',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const defineMiddleware=f=>f;',loader:'js'}));}}]});
  const {onRequest}=await import(pathToFileURL(file).href); await fs.rm(dir,{recursive:true,force:true});
  const abrir=async(url,rol='jefe')=>{const c=ctx(url,{rol});c.cookies={get:()=>undefined,set:()=>{}};c.redirect=to=>new Response(null,{status:302,headers:{location:to}});return onRequest(c,async()=>new Response('OK'));};
  for (const e of ['general','biomedico','ambos',null]) {
    como(e);
    for (const url of ['/api/activos/103','/api/activos/%31%30%33','/api/ordenes/203','/api/ordenes/204','/api/planes/403','/api/tickets/303','/api/proyectos/503','/api/proyectos/504']) equal((await abrir(url)).status,403,e+' ID '+url);
  }
  como('tecnologia');
  for(const url of ['/api/activos/101','/api/ordenes/202','/api/ronda-turno/puntos','/api/calibraciones']) equal((await abrir(url)).status,403,'TI no sale de espacio '+url);
  for(const url of ['/api/activos/103','/api/ordenes/203','/api/planes/403']) equal((await abrir(url)).status,200,'TI accede '+url);
  equal((await abrir('/api/tickets/303','solicitante')).status,200,'solicitante consulta su ayuda TI');
  equal((await abrir('/api/tickets/304','solicitante')).status,403,'solicitante no ve ayuda ajena');
  equal((await abrir('/api/activos/103','solicitante')).status,403,'solicitante no gana inventario TI');
  equal(sqlite.prepare('SELECT rubro FROM activos WHERE id=101').get().rubro,'equipo_general','impresora previa conserva clasificación');
  equal(sqlite.prepare('PRAGMA foreign_key_check').all(),[],'FKs válidas');
  console.log(`PASS tecnología espacios: ${checks} verificaciones de listas, permisos, búsqueda, indicadores, lotes, notificaciones y solicitudes propias.`);
} finally { await close(); }
