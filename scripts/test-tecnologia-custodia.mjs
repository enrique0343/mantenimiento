// Handlers reales + todas las migraciones + FK/triggers/batch SQLite. Ningún servicio externo.
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';
let fixture;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('La prueba no permite red'); };
try {
  fixture = await setupConjuntos({ modules:{custodia:'pages/api/activos/[id]/custodia', tecnologia:'lib/tecnologia', bulkLocation:'pages/api/activos/asignar-ubicacion'} });
  const {app,sqlite,call,faults,ctx}=fixture;
  const one=(sql,...args)=>sqlite.prepare(sql).get(...args);
  const count=(table)=>one(`SELECT count(*) AS n FROM ${table}`).n;
  const expect=(r,s)=>{assert.equal(r.status,s,JSON.stringify(r));return r.body;};
  const get=(id,options={})=>call(app.custodia.GET,`/api/activos/${id}/custodia`,{id,...options});
  const body=(extra={})=>({accion:'asignar',revision:0,ubicacionActualId:1,requestId:crypto.randomUUID(),motivo:'Entrega de equipo',nombre:'colaborador sin cuenta',...extra});
  const move=(id,data,options={})=>call(app.custodia.POST,`/api/activos/${id}/custodia`,{method:'POST',id,data,...options});
  const patch=(id,data,options={})=>call(app.assets.PATCH,`/api/activos/${id}`,{method:'PATCH',id,data,...options});
  sqlite.exec(`
    INSERT INTO sucursales(id,nombre) VALUES(1,'HOSPITAL'),(2,'CENTRO'),(3,'INACTIVA');
    UPDATE sucursales SET activa=0 WHERE id=3;
    INSERT INTO ubicaciones(id,sucursal_id,nombre) VALUES(1,1,'ADMISION'),(2,1,'SISTEMAS'),(3,2,'OFICINA'),(4,3,'SEDE INACTIVA'),(5,1,'INACTIVA');
    UPDATE ubicaciones SET activa=0 WHERE id=5;
    INSERT INTO activos(id,codigo,nombre,rubro,ubicacion_id,ubicacion) VALUES
      (100,'TEC-1','COMPUTADORA','tecnologia',1,'ADMISION'),
      (101,'TEC-2','IMPRESORA','tecnologia',1,'ADMISION'),
      (102,'TEC-3','SWITCH','tecnologia',NULL,NULL),
      (103,'BIO-1','BIOMEDICO','biomedico',1,'ADMISION');
    INSERT INTO centros_costo(id,codigo,nombre,sucursal_id) VALUES(1,'CC1','CENTRO COSTO',1);
    UPDATE activos SET centro_costo_id=1 WHERE id=100;
  `);
  const users=count('usuarios');
  for(const rol of [null,'solicitante','motorista','bodega']) {
    expect(await get(100,{rol}),rol?403:401);
    expect(await move(100,body(),{rol}),rol?403:401);
  }
  for(const rol of ['jefe','tecnico']) { expect(await get(100,{rol}),403);expect(await move(100,body(),{rol}),403); }
  expect(await move(100,body(),{rol:'visualizador'}),403);
  expect(await get(103),403); expect(await move(103,body()),403);
  expect(await get(999),404); expect(await get('mal'),400);
  const initial=expect(await get(100),200);
  assert.equal(initial.custodia.revision,0);assert.equal(initial.custodia.nombre,null);assert.deepEqual(initial.historial,[]);
  assert(initial.usuarios.every(u=>Object.keys(u).sort().join(',')==='id,nombre'));
  assert.equal(initial.ubicaciones.length,3);
  for (const extra of [{motivo:'  '},{nombre:''},{usuarioId:999},{ubicacionId:4},{ubicacionId:5},{secreto:'no'},{revision:-1},{ubicacionActualId:null}]) {
    expect(await move(100,body(extra)),extra.ubicacionActualId===null?409:400);
  }
  assert.equal(count('tecnologia_custodia'),0);
  let request=body({nombre:'  María pérez  ',departamento:' administracion ',cargo:' asistente '});
  let result=expect(await move(100,request),200);
  assert.equal(result.custodia.nombre,'MARÍA PÉREZ');assert.equal(result.custodia.departamento,'ADMINISTRACION');
  assert.equal(result.custodia.cargo,'ASISTENTE');assert.equal(result.custodia.revision,1);
  assert.equal(count('usuarios'),users,'El custodio sin cuenta no crea usuarios');
  assert.equal(count('tecnologia_custodia_eventos'),1);assert.equal(count('audit_log'),1);
  assert.equal(result.historial[0].antes.nombre,null);assert.equal(result.historial[0].despues.nombre,'MARÍA PÉREZ');
  assert.equal(result.historial[0].actorId,1);assert.match(result.historial[0].fecha,/Z$/);
  assert.equal(expect(await move(100,request),200).repetido,true);
  expect(await move(100,{...request,motivo:'otro motivo'}),409);assert.equal(count('audit_log'),1);
  expect(await move(100,body()),409);
  expect(await move(100,body({revision:1})),409,'asignar exige ausencia de custodio');
  request={accion:'reasignar',revision:1,ubicacionActualId:1,requestId:crypto.randomUUID(),motivo:'Entrega a tecnico',usuarioId:3};
  result=expect(await move(100,request),200);assert.equal(result.custodia.usuarioId,3);assert.equal(result.custodia.nombre,'PRUEBA TECNICO');
  assert.equal(result.historial[0].antes.nombre,'MARÍA PÉREZ');
  const assigned=result.custodia.asignadoEn;
  const transfer={accion:'trasladar',revision:2,ubicacionActualId:1,requestId:crypto.randomUUID(),motivo:'Cambio de sede',ubicacionId:3};
  expect(await move(100,transfer),409,'centro costo de otra sede requiere retiro explícito');
  result=expect(await move(100,{...transfer,centroCostoId:null}),200);
  assert.equal(result.custodia.ubicacionId,3);assert.equal(result.custodia.sedeId,2);
  assert.equal(result.custodia.asignadoEn,assigned);assert.equal(result.custodia.centroCostoId,null);
  assert.equal(one('SELECT ubicacion FROM activos WHERE id=100').ubicacion,'OFICINA');
  assert.equal(result.historial[0].antes.sedeId,1);assert.equal(result.historial[0].despues.sedeId,2);
  expect(await patch(100,{ubicacionId:1}),409);expect(await patch(100,{ubicacion:'OTRO TEXTO'}),409);
  expect(await patch(100,{rubro:'equipo_general'}),409);
  assert.throws(()=>sqlite.exec("UPDATE activos SET ubicacion_id=1 WHERE id=100"),/trazabilidad/);
  assert.throws(()=>sqlite.exec("UPDATE activos SET rubro='equipo_general' WHERE id=100"),/historial/);
  assert.throws(()=>sqlite.exec("UPDATE tecnologia_custodia_eventos SET motivo='ALTERADO' WHERE activo_id=100"),/inmutable/);
  assert.throws(()=>sqlite.exec('DELETE FROM tecnologia_custodia_eventos WHERE activo_id=100'),/inmutable/);
  result=expect(await move(100,{accion:'devolver',revision:3,ubicacionActualId:3,requestId:crypto.randomUUID(),motivo:'Retorno a inventario'}),200);
  assert.equal(result.custodia.nombre,null);assert.equal(result.custodia.usuarioId,null);assert.equal(result.custodia.revision,4);
  expect(await call(app.assets.DELETE,'/api/activos/100',{method:'DELETE',id:100}),409);
  assert.equal(count('tecnologia_custodia_eventos'),4);
  expect(await patch(100,{nombre:'equipo actualizado'}),200);
  // Lectura sin listas de selección para el visualizador; otro espacio no ve nombres.
  const readonly=expect(await get(100,{rol:'visualizador'}),200);
  assert.equal(readonly.puedeEditar,false);assert.deepEqual(readonly.usuarios,[]);assert.deepEqual(readonly.ubicaciones,[]);
  sqlite.exec("UPDATE usuarios SET especialidad='tecnologia' WHERE id IN (2,3)");
  expect(await get(100,{rol:'tecnico'}),200);
  expect(await move(101,body({usuarioId:5,nombre:undefined}),{rol:'jefe'}),200);
  const inventoryCtx=ctx('/activos');inventoryCtx.locals.user={id:1,rol:'admin'};
  const inventory=await app.tecnologia.custodiasParaInventario(inventoryCtx,[100,101,103]);
  assert.equal(inventory.length,1);assert.equal(inventory[0].activoId,101);assert.equal(inventory[0].nombre,'PRUEBA SOLICITANTE');
  inventoryCtx.locals.user={id:2,rol:'jefe',especialidad:'general'};
  assert.deepEqual(await app.tecnologia.custodiasParaInventario(inventoryCtx,[101]),[]);
  // Fallo después del UPDATE del activo: rollback de estado, evento, ubicación y audit.
  const before=JSON.stringify(one('SELECT * FROM tecnologia_custodia WHERE activo_id=101'));
  const auditBefore=count('audit_log'),eventsBefore=count('tecnologia_custodia_eventos');
  faults.statement=(sql)=>sql.includes('INSERT INTO tecnologia_custodia_eventos');
  expect(await move(101,{accion:'trasladar',revision:1,ubicacionActualId:1,requestId:crypto.randomUUID(),motivo:'Entrega en sistemas',ubicacionId:2}),500);
  assert.equal(JSON.stringify(one('SELECT * FROM tecnologia_custodia WHERE activo_id=101')),before);
  assert.equal(one('SELECT ubicacion_id FROM activos WHERE id=101').ubicacion_id,1);
  assert.equal(count('audit_log'),auditBefore);assert.equal(count('tecnologia_custodia_eventos'),eventsBefore);
  // Dos operadores leen la misma revisión: gana uno, el otro no escribe ninguna parte.
  const competitor={accion:'trasladar',revision:1,ubicacionActualId:1,requestId:crypto.randomUUID(),motivo:'Movimiento concurrente',ubicacionId:2};
  faults.beforeBatch=async()=>expect(await move(101,competitor),200);
  expect(await move(101,{...competitor,requestId:crypto.randomUUID(),ubicacionId:3}),409);
  assert.equal(one('SELECT ubicacion_id FROM activos WHERE id=101').ubicacion_id,2);
  assert.equal(count('tecnologia_custodia_eventos'),eventsBefore+1);
  // Mismo request simultáneo: respuesta idempotente, solo un evento/audit.
  const duplicate={accion:'trasladar',revision:2,ubicacionActualId:2,requestId:crypto.randomUUID(),motivo:'Misma petición',ubicacionId:1};
  faults.beforeBatch=async()=>expect(await move(101,duplicate),200);
  assert.equal(expect(await move(101,duplicate),200).repetido,true);
  assert.equal(one('SELECT count(*) AS n FROM tecnologia_custodia_eventos WHERE request_id=?',duplicate.requestId).n,1);
  // Destino se desactiva durante la operación: CAS no toca ningún registro.
  faults.beforeBatch=()=>sqlite.exec('UPDATE ubicaciones SET activa=0 WHERE id=2');
  expect(await move(102,{accion:'trasladar',revision:0,ubicacionActualId:null,requestId:crypto.randomUUID(),motivo:'Primera ubicación',ubicacionId:2}),409);
  assert.equal(one('SELECT * FROM tecnologia_custodia WHERE activo_id=102'),undefined);
  sqlite.exec('UPDATE ubicaciones SET activa=1 WHERE id=2');
  expect(await call(app.bulkLocation.POST,'/api/activos/asignar-ubicacion',{method:'POST',data:{activoIds:[102],ubicacionId:1}}),409);
  assert.equal(one('SELECT ubicacion_id FROM activos WHERE id=102').ubicacion_id,null);
  // La simulación y la importación rechazan un traslado directo de tecnología.
  for(const dryRun of [true,false]) {
    const imported=expect(await call(app.assetImport.POST,'/api/admin/import-equipos',{method:'POST',data:{modo:'actualizar',dryRun,area:'tecnologia',csv:'codigo,sucursal,ubicacion\nTEC-2,CENTRO,OFICINA\n'}}),200);
    assert.equal(imported.actualizados,0);assert.equal(imported.errores.length,1);
  }
  // Ni los errores ni avisos de importación revelan equipos de otro espacio.
  for (const modo of ['crear','actualizar']) {
    const denied=expect(await call(app.assetImport.POST,'/api/admin/import-equipos',{method:'POST',rol:'jefe',data:{modo,dryRun:true,csv:'codigo,nombre\nBIO-1,OTRO NOMBRE\n'}}),200);
    assert.equal(denied.errores.length,1);assert.match(denied.errores[0].error,/permiso/);
    assert.equal(denied.avisos.length,0);
  }
  expect(await call(app.assetImport.POST,'/api/admin/import-equipos',{method:'POST',rol:'jefe',data:{modo:'crear',area:'biomedico',csv:'codigo,nombre\nBIO-9,PRUEBA\n'}}),403);
  // Cursor estable: no omite ni duplica eventos entre páginas, aun con muchos movimientos.
  let current=expect(await get(102),200).custodia;
  for(let i=0;i<52;i++) {
    const to=current.ubicacionId===1?2:1;
    const moved=expect(await move(102,{accion:'trasladar',revision:current.revision,ubicacionActualId:current.ubicacionId,
      requestId:crypto.randomUUID(),motivo:`Movimiento de prueba ${i}`,ubicacionId:to}),200);
    current=moved.custodia;
  }
  const page1=expect(await get(102),200);
  assert.equal(page1.historial.length,50);assert(page1.nextCursor);
  const page2=expect(await call(app.custodia.GET,`/api/activos/102/custodia?before=${page1.nextCursor}`,{id:102}),200);
  assert.equal(page2.historial.length,2);assert.equal(page2.nextCursor,null);
  assert.equal(new Set([...page1.historial,...page2.historial].map(e=>e.id)).size,52);
  expect(await call(app.custodia.GET,'/api/activos/102/custodia?before=abc',{id:102}),400);
  // Baja bloquea movimientos; se conserva consulta del historial.
  sqlite.exec("UPDATE activos SET estado='baja' WHERE id=100");
  expect(await move(100,body({revision:4,ubicacionActualId:3})),409);
  assert.equal(expect(await get(100),200).puedeEditar,false);
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  // La autorización de una carga sigue siendo válida en el instante de escribir.
  // Un administrador puede reclasificar durante el proceso: la carga del jefe
  // general pierde la carrera, sin cambiar TI ni inventar una línea de auditoría.
  sqlite.exec("UPDATE usuarios SET especialidad='general' WHERE id=2; INSERT INTO activos(id,codigo,nombre,rubro,tipo) VALUES(901,'RACE-IMPORT','ORIGINAL','equipo_general','general')");
  const auditImport=count('audit_log');
  faults.beforeBatch=()=>sqlite.exec("UPDATE activos SET rubro='tecnologia' WHERE id=901");
  const racedImport=expect(await call(app.assetImport.POST,'/api/admin/import-equipos',{method:'POST',rol:'jefe',data:{modo:'actualizar',csv:'codigo,nombre\nRACE-IMPORT,CAMBIO NO AUTORIZADO\n'}}),200);
  assert.equal(racedImport.actualizados,0); assert.equal(racedImport.errores.length,1);
  assert.equal(one('SELECT nombre FROM activos WHERE id=901').nombre,'ORIGINAL');
  assert.equal(count('audit_log'),auditImport);
  // También se preserva un cambio simultáneo del mismo campo aunque el área siga igual.
  faults.beforeBatch=()=>sqlite.exec("UPDATE activos SET nombre='CAMBIO DE OTRA PERSONA' WHERE id=901");
  const staleImport=expect(await call(app.assetImport.POST,'/api/admin/import-equipos',{method:'POST',data:{modo:'actualizar',area:'tecnologia',csv:'codigo,nombre\nRACE-IMPORT,CAMBIO VIEJO\n'}}),200);
  assert.equal(staleImport.actualizados,0); assert.equal(staleImport.errores.length,1);
  assert.equal(one('SELECT nombre FROM activos WHERE id=901').nombre,'CAMBIO DE OTRA PERSONA');
  assert.equal(count('audit_log'),auditImport);
  console.log('Custodia TI: permisos, colaborador/usuario, reasignación, devolución, traslado, inmutabilidad, rollback, concurrencia, idempotencia, inventario y bypass: OK');
} finally {globalThis.fetch=originalFetch;await fixture?.close();}
