import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';
const f=await setupConjuntos({modules:{ticket:'pages/api/tickets/[id]/index',convert:'pages/api/tickets/[id]/convertir'}});
try {
  const {sqlite:s,app,call,faults}=f;
  faults.enforceColumnLimit=true;faults.enforceParameterLimit=true;
  const get=(q,...args)=>s.prepare(q).get(...args);
  const count=(table)=>get(`SELECT count(*) AS n FROM ${table}`).n;
  const expect=(r,status)=>{assert.equal(r.status,status,JSON.stringify(r));return r.body;};
  s.exec(`INSERT INTO sucursales(id,nombre) VALUES(1,'PRUEBA'); INSERT INTO ubicaciones(id,sucursal_id,nombre) VALUES(1,1,'PRUEBA');
    INSERT INTO activos(id,codigo,nombre,rubro,tipo,ubicacion_id) VALUES(100,'TEC','HARDWARE','tecnologia','general',1);
    UPDATE usuarios SET especialidad='general' WHERE id=2; UPDATE usuarios SET especialidad='tecnologia' WHERE id=3;`);
  let ticketId=100;
  function ticket(rubro='tecnologia',activoId=100) {
    const id=ticketId++;
    s.prepare(`INSERT INTO tickets(id,solicitante_nombre,solicitante_email,solicitante_usuario_id,asunto,descripcion,rubro,activo_id,sucursal_id,ubicacion_id,tracking_token)
      VALUES(?,'PRUEBA','test@example.invalid',5,'FALLA','PRUEBA DE FALLA',?,?,1,1,?)`).run(id,rubro,activoId,`PRUEBA-${id}`);
    return id;
  }
  const patch=(id,data,rol='admin')=>call(app.ticket.PATCH,`/api/tickets/${id}`,{id,method:'PATCH',data,rol});
  const convert=(id,data={},rol='admin')=>call(app.convert.POST,`/api/tickets/${id}/convertir`,{id,method:'POST',data,rol});
  // Permiso del destino: legacy sin rubro no puede heredar TI desde personal General.
  const legacy=ticket(null,null);
  expect(await patch(legacy,{activoId:100},'jefe'),403);
  expect(await patch(legacy,{activoId:100,asignadoA:2},'jefe'),403);
  assert.equal(get('SELECT activo_id FROM tickets WHERE id=?',legacy).activo_id,null);
  assert.equal(count('ordenes'),0);
  expect(await patch(legacy,{activoId:100,asignadoA:2}),400,'Incluso admin debe asignar técnico del destino');
  expect(await patch(legacy,{activoId:100,asignadoA:3}),200);
  assert.equal(get('SELECT rubro,asignado_a FROM ordenes').rubro,'tecnologia');
  assert.equal(get('SELECT rubro,asignado_a FROM ordenes').asignado_a,3);
  // La persona solicitante recibe solo comentarios públicos; técnicos conservan internos.
  s.prepare('INSERT INTO ticket_comentarios(ticket_id,usuario_id,texto,publico) VALUES(?,1,?,0),(?,1,?,1)').run(legacy,'NOTA INTERNA',legacy,'RESPUESTA PUBLICA');
  const owner=expect(await call(app.ticket.GET,`/api/tickets/${legacy}`,{id:legacy,rol:'solicitante'}),200);
  assert.deepEqual(owner.comentarios.map(c=>c.texto),['RESPUESTA PUBLICA']);
  assert.equal(expect(await call(app.ticket.GET,`/api/tickets/${legacy}`,{id:legacy}),200).comentarios.length,2);
  // Conversión simultánea: se crea una sola OT y se conserva un solo vínculo.
  let id=ticket(), before=count('ordenes'), audit=count('audit_log');
  let responses=await Promise.all([convert(id,{asignadoA:3}),convert(id,{asignadoA:3})]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
  assert.equal(count('ordenes'),before+1);assert.equal(count('audit_log'),audit+2);
  assert.equal(get('SELECT ot_id FROM tickets WHERE id=?',id).ot_id,responses.find(r=>r.status===201).body.orden.id);
  // Dos asignaciones automáticas tampoco crean órdenes huérfanas.
  id=ticket();before=count('ordenes');audit=count('audit_log');
  responses=await Promise.all([patch(id,{asignadoA:3}),patch(id,{asignadoA:3})]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  assert.equal(count('ordenes'),before+1);assert.equal(count('audit_log'),audit+2);
  const only=get('SELECT ot_id FROM tickets WHERE id=?',id).ot_id;
  assert.equal(responses.find(r=>r.status===200).body.otCreada,only);
  // Conversión manual contra asignación automática comparten la misma reserva.
  id=ticket();before=count('ordenes');
  responses=await Promise.all([convert(id,{asignadoA:3}),patch(id,{asignadoA:3})]);
  assert.equal(responses.filter(r=>r.status===200||r.status===201).length,1);
  assert.equal(responses.filter(r=>r.status===409).length,1);
  assert.equal(count('ordenes'),before+1);
  // Un fallo al enlazar la orden o al auditar revierte también orden y numeración.
  for(const action of [convert,patch]) {
    id=ticket();before=count('ordenes');audit=count('audit_log');
    const original=JSON.stringify(get('SELECT * FROM tickets WHERE id=?',id));
    const series=JSON.stringify(s.prepare('SELECT * FROM orden_series ORDER BY serie').all());
    faults.statement=(sql)=>sql.includes('INSERT INTO audit_log');
    expect(await action(id,{asignadoA:3}),500);
    assert.equal(count('ordenes'),before);assert.equal(count('audit_log'),audit);
    assert.equal(JSON.stringify(get('SELECT * FROM tickets WHERE id=?',id)),original);
    assert.equal(JSON.stringify(s.prepare('SELECT * FROM orden_series ORDER BY serie').all()),series);
  }
  // Una actualización ordinaria no sobrescribe un cambio concurrente de estado.
  id=ticket();
  faults.beforeStatement={matches:(sql)=>/^update "tickets"/i.test(sql),run:()=>s.prepare("UPDATE tickets SET estado='cerrado' WHERE id=?").run(id)};
  expect(await patch(id,{estado:'en_proceso'}),409);
  assert.equal(get('SELECT estado FROM tickets WHERE id=?',id).estado,'cerrado');
  // Baja o pérdida de acceso del técnico entre lectura y batch no deja una orden.
  id=ticket();before=count('ordenes');
  faults.beforeBatch=()=>s.exec("UPDATE activos SET estado='baja' WHERE id=100");
  expect(await convert(id,{asignadoA:3}),409);assert.equal(count('ordenes'),before);
  s.exec("UPDATE activos SET estado='operativo' WHERE id=100");
  faults.beforeBatch=()=>s.exec("UPDATE usuarios SET especialidad='general' WHERE id=3");
  expect(await patch(id,{asignadoA:3}),409);assert.equal(count('ordenes'),before);
  assert.equal(get('SELECT ot_id FROM tickets WHERE id=?',id).ot_id,null);
  assert.deepEqual(s.prepare('PRAGMA foreign_key_check').all(),[]);
  console.log('PASS Tecnología ticket concurrencia: permisos destino legacy, privacidad comentarios, conversión/asignación simultáneas, reserva compartida, rollback y referencias concurrentes.');
} finally {await f.close();}
