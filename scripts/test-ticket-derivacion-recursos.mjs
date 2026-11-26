// Carreras reales entre una derivación y recursos de la OT, con SQLite transaccional.
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';

const f = await setupConjuntos({ modules: {
  derivar: 'pages/api/tickets/[id]/derivar', convertir: 'pages/api/tickets/[id]/convertir',
  repuestos: 'pages/api/ordenes/[id]/repuestos', prerrequisitos: 'pages/api/ordenes/[id]/prerrequisitos',
  liberaciones: 'pages/api/ordenes/[id]/liberaciones',
} });
const { sqlite: s, app, call, faults } = f;
const one = (q, ...v) => s.prepare(q).get(...v);
const count = (table, id) => one(`SELECT count(*) n FROM ${table} WHERE orden_id=?`, id).n;
let n = 0, next = 800;
const eq = (a,b,m) => { assert.deepEqual(a,b,m); n++; };
const status = (r,e) => { eq(r.status,e,JSON.stringify(r)); return r.body; };
async function pair() {
  const id=next++;
  s.prepare(`INSERT INTO tickets(id,rubro,tracking_token,solicitante_nombre,solicitante_email,asunto,descripcion,sucursal_id,ubicacion_id,updated_at)
    VALUES(?,'equipo_general',?,'PRUEBA','test@example.invalid','FALLA FICTICIA','DESCRIPCIÓN',1,1,'2026-11-26T14:00:00Z')`).run(id,`T-RECURSOS-${id}`);
  const r=status(await call(app.convertir.POST,`/api/tickets/${id}/convertir`,{id,method:'POST',data:{asignadoA:3}}),201);
  return {id,ot:r.orden.id};
}
const move = p => call(app.derivar.POST,`/api/tickets/${p.id}/derivar?espacio=general&area=equipo_general`,{
  id:p.id,rol:'jefe',method:'POST',data:{espacioDestino:'tecnologia',motivo:'CORRESPONDE A TECNOLOGÍA',expectedUpdatedAt:one('SELECT updated_at FROM tickets WHERE id=?',p.id).updated_at},
});
const resources = [
  {name:'repuestos',table:'orden_repuestos',data:{itemId:1,cantidad:2,precioUnitario:3,notas:'PRUEBA'}},
  {name:'prerrequisitos',table:'orden_prerrequisitos',data:{texto:'  PERMISO VERIFICABLE  ',tipo:'permiso_trabajo',obligatorio:true,cargoResponsable:' JEFE '}},
  {name:'liberaciones',table:'orden_liberaciones',data:{etiqueta:'  LECTURA PRUEBA  ',unidad:' V ',minAceptable:10,maxAceptable:12,obligatoria:true}},
];
const post = (r,p,data=r.data) => call(app[r.name].POST,`/api/ordenes/${p.ot}/${r.name}?area=equipo_general&espacio=general`,{id:p.ot,rol:'jefe',method:'POST',data});
try {
  faults.enforceColumnLimit=true;faults.enforceParameterLimit=true;
  s.exec(`UPDATE usuarios SET especialidad='general' WHERE id IN(2,3);
    INSERT INTO sucursales(id,nombre) VALUES(1,'SEDE FICTICIA');
    INSERT INTO ubicaciones(id,sucursal_id,nombre) VALUES(1,1,'SALA FICTICIA');
    INSERT INTO items(id,codigo,nombre,unidad) VALUES(1,'REP-F','REPUESTO FICTICIO','UNIDAD');
    INSERT INTO stock(item_id,cantidad) VALUES(1,100);`);
  for (const r of resources) {
    // Derivación gana después de autorizar el POST: nada puede entrar en el destino.
    let p=await pair(), stock=one('SELECT cantidad FROM stock WHERE item_id=1').cantidad;
    faults.beforeBatch=async()=>{status(await move(p),200);};
    status(await post(r,p),409);
    eq(count(r.table,p.ot),0,`${r.name}: sin escritura de la solicitud que perdió`);
    eq(count('movimientos_inventario',p.ot),0,'No queda un movimiento huérfano');
    eq(one('SELECT cantidad FROM stock WHERE item_id=1').cantidad,stock,'Derivar no descuenta stock');
    eq(one('SELECT rubro FROM ordenes WHERE id=?',p.ot).rubro,'tecnologia');
    status(await post(r,p),403); // No depende del middleware previo.

    // Recurso gana antes del batch de derivación: la OT pasa a tener trabajo registrado.
    p=await pair();stock=one('SELECT cantidad FROM stock WHERE item_id=1').cantidad;
    faults.beforeBatch=async()=>{status(await post(r,p),201);};
    status(await move(p),409);
    eq(count(r.table,p.ot),1,`${r.name}: conserva evidencia registrada`);
    eq(one('SELECT rubro FROM ordenes WHERE id=?',p.ot).rubro,'equipo_general');
    eq(one('SELECT cantidad FROM stock WHERE item_id=1').cantidad,stock-(r.name==='repuestos'?2:0));
    eq(count('movimientos_inventario',p.ot),r.name==='repuestos'?1:0);
  }
  // Dos consumos simultáneos no pueden gastar el mismo saldo ni producir negativos.
  let a=await pair(), b=await pair();s.exec('UPDATE stock SET cantidad=3 WHERE item_id=1');
  faults.beforeBatch=async()=>{status(await post(resources[0],b),201);};
  status(await post(resources[0],a),409);
  eq(one('SELECT cantidad FROM stock WHERE item_id=1').cantidad,1);
  eq(count('orden_repuestos',a.ot),0);eq(count('orden_repuestos',b.ot),1);
  eq(count('movimientos_inventario',a.ot),0);eq(count('movimientos_inventario',b.ot),1);
  // Fallar el último paso revierte consumo, movimiento y stock juntos.
  a=await pair();s.exec('UPDATE stock SET cantidad=10 WHERE item_id=1');
  faults.statement=(sql)=>sql.includes('INSERT INTO movimientos_inventario');
  await assert.rejects(()=>post(resources[0],a),/Injected transactional statement failure/);n++;
  eq(one('SELECT cantidad FROM stock WHERE item_id=1').cantidad,10);
  eq(count('orden_repuestos',a.ot),0);eq(count('movimientos_inventario',a.ot),0);
  // La creación conserva formato, secuencia y reglas de las lecturas del MOP.
  a=await pair();
  const req=status(await post(resources[1],a),201).prerrequisito;
  eq(req.texto,'PERMISO VERIFICABLE');eq(req.obligatorio,true);eq(req.cargoResponsable,'JEFE');eq(req.orden,1);
  const req2=status(await post(resources[1],a,{texto:'SEGUNDO REQUISITO',obligatorio:false}),201).prerrequisito;
  eq(req2.orden,2);eq(req2.obligatorio,false);
  const lectura=status(await post(resources[2],a),201).liberacion;
  eq(lectura.etiqueta,'LECTURA PRUEBA');eq(lectura.unidad,'V');eq(lectura.obligatoria,true);eq(lectura.minAceptable,10);
  status(await post(resources[2],a,{...resources[2].data,minAceptable:13}),400);
  const url=`/api/ordenes/${a.ot}/prerrequisitos?area=equipo_general`;
  status(await call(app.prerrequisitos.PATCH,url,{id:a.ot,rol:'jefe',method:'PATCH',data:{itemId:req.id,cumplido:true}}),400);
  status(await call(app.prerrequisitos.PATCH,url,{id:a.ot,rol:'jefe',method:'PATCH',data:{itemId:req.id,cumplido:true,referencia:'PT-FICTICIO'}}),200);
  eq(one('SELECT cumplido FROM orden_prerrequisitos WHERE id=?',req.id).cumplido,1);
  status(await call(app.liberaciones.PATCH,`/api/ordenes/${a.ot}/liberaciones?area=equipo_general`,{id:a.ot,rol:'jefe',method:'PATCH',data:{itemId:lectura.id,valorMedido:11}}),200);
  eq(one('SELECT conforme FROM orden_liberaciones WHERE id=?',lectura.id).conforme,1);
  console.log(`PASS derivación-recursos: ${n} comprobaciones de carrera, aislamiento, stock, rollback y MOP.`);
} finally {await f.close();}
