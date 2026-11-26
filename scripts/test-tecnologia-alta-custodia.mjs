// Alta real + asignación libre + plan opcional en una sola transacción D1/SQLite.
import assert from 'node:assert/strict';
import { setupConjuntos } from './test-support/conjuntos-app.mjs';
const f = await setupConjuntos({ modules:{custodia:'pages/api/activos/[id]/custodia'} });
const {app,sqlite,call,faults}=f;
const one=(sql,...args)=>sqlite.prepare(sql).get(...args);
const count=(tabla)=>one(`SELECT count(*) AS n FROM ${tabla}`).n;
const create=(data,rol='admin')=>call(app.assetCreate.POST,'/api/activos?area=tecnologia',{method:'POST',rol,data});
const expect=(r,status)=>{assert.equal(r.status,status,JSON.stringify(r));return r.body;};
try {
  faults.enforceColumnLimit=true; faults.enforceParameterLimit=true;
  sqlite.exec(`INSERT INTO sucursales(id,nombre) VALUES(1,'HOSPITAL');
    INSERT INTO ubicaciones(id,sucursal_id,nombre) VALUES(1,1,'ADMISIONES');`);
  const users=count('usuarios');
  for (const rol of [null,'visualizador','solicitante','bodega']) expect(await create({rubro:'tecnologia',custodiaInicial:{nombre:'Persona'}},rol),rol?403:401);
  for (const rol of ['tecnico','jefe']) expect(await create({rubro:'tecnologia',custodiaInicial:{nombre:'Persona'}},rol),403);
  expect(await create({rubro:'equipo_general',custodiaInicial:{nombre:'Persona'}}),400);
  for(const custodiaInicial of [{nombre:'x'.repeat(181)},{nombre:'',cargo:'ENFERMERIA'},{nombre:'Persona',usuarioId:1}]) expect(await create({rubro:'tecnologia',custodiaInicial}),400);
  assert.equal(count('activos'),0);
  for(const custodiaInicial of [undefined,null,{}, {nombre:'   ',departamento:'',cargo:''}]) {
    const row=expect(await create({rubro:'tecnologia',custodiaInicial}),201).activo;
    assert.equal(one('SELECT count(*) n FROM tecnologia_custodia WHERE activo_id=?',row.id).n,0);
  }
  const result=expect(await create({rubro:'tecnologia',nombre:'computadora',ubicacionId:1,ubicacion:'mesa de recepción',responsableId:3,
    custodiaInicial:{nombre:'  María pérez  ',departamento:' administración ',cargo:' asistente '},
    mantenimientoFrecuencia:'mensual',mantenimientoProximaFecha:'2026-12-01'}),201);
  const a=result.activo;
  assert.match(a.codigo,/^TEC-/); assert.equal(a.nombre,'COMPUTADORA');assert.equal(a.responsableId,3);
  assert.equal(a.ubicacionId,1);assert.equal(typeof a.requiereCalibracion,'boolean','Respuesta conserva shape Drizzle');
  assert.equal(count('usuarios'),users,'No crea cuentas para personas libres');
  const c=one('SELECT * FROM tecnologia_custodia WHERE activo_id=?',a.id);
  assert.equal(c.nombre,'MARÍA PÉREZ');assert.equal(c.departamento,'ADMINISTRACIÓN');assert.equal(c.cargo,'ASISTENTE');
  assert.equal(c.usuario_id,null);assert.equal(c.revision,1);
  assert.equal(one('SELECT activo_id FROM planes_mantenimiento').activo_id,a.id);
  const e=one('SELECT * FROM tecnologia_custodia_eventos WHERE activo_id=?',a.id);
  assert.equal(e.accion,'asignar');assert.equal(e.actor_id,1);assert.equal(e.actor_nombre,'Prueba admin');
  assert.equal(e.motivo,'ASIGNACIÓN INICIAL AL REGISTRAR EL EQUIPO');assert.match(e.fecha,/Z$/);
  const before=JSON.parse(e.antes_json),after=JSON.parse(e.despues_json);
  assert.equal(before.nombre,null);assert.equal(before.revision,0);assert.equal(after.nombre,'MARÍA PÉREZ');assert.equal(after.revision,1);
  assert.equal(after.sedeNombre,'HOSPITAL');assert.equal(after.ubicacionNombre,'ADMISIONES');assert.equal(after.ubicacionDetalle,'MESA DE RECEPCIÓN');
  assert.equal(one("SELECT count(*) n FROM audit_log WHERE entidad_id=? AND accion='create'",a.id).n,1);
  const audit=one("SELECT * FROM audit_log WHERE entidad_id=? AND accion='custodia'",a.id);
  assert.deepEqual(JSON.parse(audit.cambios),{custodia:{antes:before,despues:after}});assert.equal(audit.usuario_id,1);
  const view=expect(await call(app.custodia.GET,`/api/activos/${a.id}/custodia`,{id:a.id}),200);
  assert.equal(view.custodia.nombre,'MARÍA PÉREZ');assert.equal(view.historial.length,1);
  expect(await call(app.custodia.POST,`/api/activos/${a.id}/custodia`,{id:a.id,method:'POST',data:{accion:'reasignar',revision:1,ubicacionActualId:1,requestId:crypto.randomUUID(),motivo:'CAMBIO DE PERSONA',nombre:'Otra persona'}}),200);
  assert.equal(one('SELECT nombre FROM tecnologia_custodia WHERE activo_id=?',a.id).nombre,'OTRA PERSONA');
  assert.equal(one('SELECT count(*) n FROM tecnologia_custodia_eventos WHERE activo_id=?',a.id).n,2);

  // Sin ubicación también conserva una asignación libre válida y trazable.
  expect(await create({rubro:'tecnologia',estado:'baja',custodiaInicial:{nombre:'PERSONA BAJA'}}),409);
  const noLocation=expect(await create({rubro:'tecnologia',custodiaInicial:{nombre:'  Persona sin ubicación  '}}),201).activo;
  const noLocationEvent=JSON.parse(one('SELECT despues_json FROM tecnologia_custodia_eventos WHERE activo_id=?',noLocation.id).despues_json);
  assert.equal(noLocationEvent.ubicacionId,null);assert.equal(noLocationEvent.sedeId,null);
  assert.equal(noLocationEvent.nombre,'PERSONA SIN UBICACIÓN');

  // Un fallo en cualquier escritura posterior no deja activo, plan ni historial a medias.
  for (const failure of ['planes_mantenimiento','tecnologia_custodia(','tecnologia_custodia_eventos','audit_log',"json_object('custodia'"]) {
    const tables=['activos','planes_mantenimiento','tecnologia_custodia','tecnologia_custodia_eventos','audit_log'];
    const previous=tables.map(count), rollbacks=faults.rollbackCount;
    faults.statement=(sql)=>sql.includes(failure);
    await assert.rejects(()=>create({rubro:'tecnologia',custodiaInicial:{nombre:'PERSONA ROLLBACK'},mantenimientoFrecuencia:'mensual'}));
    assert.deepEqual(tables.map(count),previous,`Rollback completo ante fallo en ${failure}`);
    assert.equal(faults.rollbackCount,rollbacks+1);
  }
  // La sede/ubicación del historial se toma dentro del batch, sin snapshot previo obsoleto.
  faults.beforeBatch=()=>sqlite.exec("UPDATE ubicaciones SET nombre='ADMISIONES NUEVA' WHERE id=1");
  const fresh=expect(await create({rubro:'tecnologia',ubicacionId:1,custodiaInicial:{nombre:'PERSONA VIGENTE'}}),201).activo;
  assert.equal(JSON.parse(one('SELECT despues_json FROM tecnologia_custodia_eventos WHERE activo_id=?',fresh.id).despues_json).ubicacionNombre,'ADMISIONES NUEVA');
  sqlite.exec("UPDATE usuarios SET especialidad='tecnologia' WHERE id IN (2,3)");
  for(const rol of ['jefe','tecnico']) expect(await create({rubro:'tecnologia',custodiaInicial:{nombre:`PERSONA ${rol}`}},rol),201);
  assert.equal(count('usuarios'),users);
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  console.log('PASS Tecnología alta custodia: persona libre opcional, mayúsculas, permisos, mantenimiento separado, snapshot vigente, plan y auditoría atómicos, rollback y cero cuentas nuevas.');
} finally {await f.close();}
