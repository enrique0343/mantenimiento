import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const f = await setupConjuntos({ modules: {
  publico: 'pages/api/tickets/publico', equipos: 'pages/api/tickets/publico/equipos',
  listaTickets: 'pages/api/tickets/index', ticket: 'pages/api/tickets/[id]/index',
  convertir: 'pages/api/tickets/[id]/convertir', soporte: 'lib/soporte-equipo', db: 'lib/db',
} });
const { app, sqlite, call, ctx, faults, close } = f;
const one = (q, ...args) => sqlite.prepare(q).get(...args);
let n = 0;
const equal = (a,b,m) => { assert.deepEqual(a,b,m); n++; };
try {
  faults.enforceColumnLimit = true;
  sqlite.exec(`
    UPDATE usuarios SET especialidad='tecnologia' WHERE id IN (2,3);
    INSERT INTO sucursales(id,nombre) VALUES (1,'SEDE PRUEBA'),(2,'OTRA SEDE');
    INSERT INTO ubicaciones(id,nombre,sucursal_id,tipo) VALUES (1,'ADMISION',1,'area'),(2,'SALA',2,'area');
    INSERT INTO activos(id,codigo,nombre,rubro,tipo,ubicacion_id,datos_tecnicos) VALUES
      (101,'TEC-PRUEBA','COMPUTADORA PRUEBA','tecnologia','general',1,'{"direccionIp":"192.0.2.9","direccionMac":"00:00:5E:00:53:01"}'),
      (102,'GEN-PRUEBA','EQUIPO GENERAL','equipo_general','general',1,NULL),
      (103,'TEC-SIN-UB','IMPRESORA PENDIENTE','tecnologia','general',NULL,NULL);
  `);
  const base = { rubro:'tecnologia', solicitanteNombre:'PERSONA PRUEBA', solicitanteEmail:'solicitante@example.invalid',
    asunto:'EQUIPO NO IMPRIME', descripcion:'EL EQUIPO PRESENTA UNA FALLA DE IMPRESION', sucursalId:1, ubicacionId:1, activoId:101 };
  let r = await call(app.equipos.GET,'/api/tickets/publico/equipos?area=tecnologia&ubicacionId=1',{rol:null});
  equal(r.status,200);
  equal(r.body.equipos,[{id:101,codigo:'TEC-PRUEBA',nombre:'COMPUTADORA PRUEBA',area:'tecnologia'}],'Publico solo identidad mínima; sin red, serie o custodia');
  r = await call(app.publico.POST,'/api/tickets/publico?area=tecnologia',{method:'POST',data:{...base,ubicacionId:2,sucursalId:2},rol:null});
  equal(r.status,400,'No permite vincular equipo de otra sede');
  r = await call(app.publico.POST,'/api/tickets/publico?area=tecnologia',{method:'POST',data:{...base,activoId:102},rol:null});
  equal(r.status,400,'No mezcla áreas');
  r = await call(app.publico.POST,'/api/tickets/publico?area=tecnologia',{method:'POST',data:base,rol:'solicitante'});
  equal(r.status,201);
  const id = r.body.ticket.id;
  equal(one('SELECT rubro,activo_id,ubicacion_id,sucursal_id,solicitante_usuario_id FROM tickets WHERE id=?',id),
    Object.assign(Object.create(null),{rubro:'tecnologia',activo_id:101,ubicacion_id:1,sucursal_id:1,solicitante_usuario_id:5}));
  await call(app.publico.POST,'/api/tickets/publico?area=tecnologia',{method:'POST',data:{...base,solicitanteEmail:'otra@example.invalid'},rol:null});
  r = await call(app.listaTickets.GET,'/api/tickets?area=tecnologia',{rol:'solicitante'});
  equal(r.status,200); equal(r.body.tickets.map(t=>t.id),[id],'Solicitante solo ve la solicitud propia de TI');
  r = await call(app.ticket.GET,`/api/tickets/${id}?area=tecnologia`,{id,rol:'solicitante'});
  equal(r.status,200);
  r = await call(app.ticket.GET,`/api/tickets/${id+1}?area=tecnologia`,{id:id+1,rol:'solicitante'});
  equal(r.status,403,'No accede a la solicitud de otra persona');
  sqlite.exec("UPDATE usuarios SET especialidad='general' WHERE id=2");
  r = await call(app.ticket.GET,`/api/tickets/${id}`,{id,rol:'jefe'});
  equal(r.status,403,'General no lee solicitudes TI');
  r = await call(app.ticket.PATCH,`/api/tickets/${id}`,{id,method:'PATCH',data:{asignadoA:2},rol:'admin'});
  equal(r.status,400,'No asigna trabajo TI a personal sin acceso');
  sqlite.exec("UPDATE usuarios SET especialidad='tecnologia' WHERE id=2");
  r = await call(app.ticket.PATCH,`/api/tickets/${id}?area=tecnologia`,{id,method:'PATCH',data:{asignadoA:3},rol:'jefe'});
  equal(r.status,200);
  const ticket = one('SELECT ot_id,rubro,activo_id,asignado_a FROM tickets WHERE id=?',id);
  assert.ok(ticket.ot_id); n++;
  equal(one('SELECT rubro,activo_id,ubicacion_id,sucursal_id,asignado_a FROM ordenes WHERE id=?',ticket.ot_id),
    Object.assign(Object.create(null),{rubro:'tecnologia',activo_id:101,ubicacion_id:1,sucursal_id:1,asignado_a:3}),'OT conserva equipo, sede, ubicación y técnico');
  r = await call(app.convertir.POST,`/api/tickets/${id}/convertir?area=tecnologia`,{id,method:'POST',data:{asignadoA:3},rol:'jefe'});
  equal(r.status,400,'No duplica la orden ya vinculada');
  const db = app.db.getDb(ctx('/soporte'));
  const pre = await app.soporte.equipoInicialSoporte(db,{rol:'admin'},'101','tecnologia');
  equal(pre,{id:101,codigo:'TEC-PRUEBA',nombre:'COMPUTADORA PRUEBA',area:'tecnologia',ubicacionId:1,sucursalId:1});
  equal(await app.soporte.equipoInicialSoporte(db,null,'101','tecnologia'),null,'No expone ficha por id al público');
  equal(await app.soporte.equipoInicialSoporte(db,{rol:'jefe',especialidad:'general'},'101','tecnologia'),null);
  equal(await app.soporte.equipoInicialSoporte(db,{rol:'admin'},'101','biomedico'),null);
  equal((await app.soporte.equipoInicialSoporte(db,{rol:'admin'},'103','tecnologia')).ubicacionId,null,'Equipo pendiente de ubicación conserva identidad');
  console.log(`PASS Tecnología helpdesk: ${n} comprobaciones con migraciones, permisos y vínculos reales; sin red.`);
} finally { await close(); }
