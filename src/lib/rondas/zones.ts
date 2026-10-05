import { z } from 'zod';
import { ensure, RoundError } from './model';

type User = { id:number; rol:string };
export type ZoneLocation = { id:number; nombre:string; position:number };
export type RoundZone = { id:number; name:string; siteId:number; version:number; locations:ZoneLocation[] };
const schema = z.object({
 name:z.string().trim().min(1).max(160),siteId:z.number().int().positive(),
 locationIds:z.array(z.number().int().positive()).max(100),
 reason:z.string().trim().min(3).max(2000),expectedVersion:z.number().int().positive().optional(),
}).superRefine((v,c)=>{if(new Set(v.locationIds).size!==v.locationIds.length)c.addIssue({code:'custom',message:'Una ubicación no puede repetirse en la zona'});});
const all = async(db:D1Database,sql:string,...args:any[]) => (await db.prepare(sql).bind(...args).all()).results as any[];

export async function listZones(db:D1Database,u:User):Promise<{zones:RoundZone[]}> {
 ensure(['admin','jefe','tecnico','visualizador'].includes(u.rol),403,'Sin permisos');
 const [zones,members] = await db.batch([
  db.prepare('SELECT id,name,site_id AS siteId,version FROM rondas_zones ORDER BY name COLLATE NOCASE,id'),
  db.prepare('SELECT m.zone_id AS zoneId,u.id,u.nombre,m.position FROM rondas_zone_locations m JOIN ubicaciones u ON u.id=m.location_id ORDER BY m.zone_id,m.position'),
 ]);
 return {zones:(zones.results as Omit<RoundZone,'locations'>[]).map(zone=>({...zone,locations:(members.results as (ZoneLocation & {zoneId:number})[]).filter(member=>member.zoneId===zone.id).map(({zoneId,...member})=>member)}))};
}

export async function saveZone(db:D1Database,u:User,body:unknown,id?:number):Promise<{zone:RoundZone}> {
 ensure(['admin','jefe'].includes(u.rol),403,'Solo jefe o administrador');
 const config=schema.parse(body);
 ensure(id||config.locationIds.length,400,'Una zona nueva debe incluir al menos una ubicación');
 ensure(await db.prepare('SELECT id FROM sucursales WHERE id=? AND activa=1').bind(config.siteId).first(),400,'Sede inactiva');
 const existing=id?await db.prepare('SELECT * FROM rondas_zones WHERE id=?').bind(id).first<any>():null;
 if(id){ensure(existing,404,'Zona inexistente');ensure(config.expectedVersion===existing.version,409,'La zona cambió; actualice antes de guardar');}
 const rows=await all(db,'SELECT id,nombre,sucursal_id AS siteId FROM ubicaciones WHERE activa=1 AND id IN (SELECT value FROM json_each(?))',JSON.stringify(config.locationIds));
 ensure(rows.length===config.locationIds.length&&rows.every(row=>row.siteId===config.siteId),400,'Todas las ubicaciones deben estar activas y pertenecer a la sede');
 const occupied=await all(db,'SELECT location_id FROM rondas_zone_locations WHERE zone_id<>? AND location_id IN (SELECT value FROM json_each(?))',id??-1,JSON.stringify(config.locationIds));
 ensure(!occupied.length,409,'Una ubicación ya pertenece a otra zona. Retírela de esa zona antes de asignarla aquí.');
 const locations=config.locationIds.map((locationId,position)=>({id:locationId,nombre:rows.find(row=>row.id===locationId)!.nombre,position}));
 const snapshot=JSON.stringify({name:config.name,siteId:config.siteId,locations});
 const key=crypto.randomUUID(),date=new Date().toISOString();
 const statements:D1PreparedStatement[]=[];
 if(id){
  statements.push(db.prepare('UPDATE rondas_zones SET name=?,site_id=?,version=version+1,snapshot_json=?,mutation_token=? WHERE id=? AND version=?').bind(config.name,config.siteId,snapshot,key,id,config.expectedVersion));
  statements.push(db.prepare('DELETE FROM rondas_zone_locations WHERE zone_id=? AND EXISTS(SELECT 1 FROM rondas_zones WHERE id=? AND mutation_token=?)').bind(id,id,key));
 }else statements.push(db.prepare('INSERT INTO rondas_zones(name,site_id,snapshot_json,mutation_token,created_by,created_at) VALUES(?,?,?,?,?,?)').bind(config.name,config.siteId,snapshot,key,u.id,date));
 statements.push(db.prepare("INSERT INTO rondas_zone_locations(zone_id,location_id,position) SELECT z.id,json_extract(member.value,'$.id'),json_extract(member.value,'$.position') FROM rondas_zones z,json_each(?) member WHERE z.mutation_token=?").bind(JSON.stringify(locations),key));
 statements.push(db.prepare('INSERT INTO rondas_zone_versions(zone_id,version,snapshot_json,reason,created_by,created_at) SELECT id,version,snapshot_json,?,?,? FROM rondas_zones WHERE mutation_token=?').bind(config.reason,u.id,date,key));
 statements.push(db.prepare('SELECT id,name,site_id AS siteId,version FROM rondas_zones WHERE mutation_token=?').bind(key));
 let result:D1Result[];
 try {result=await db.batch(statements);} catch(error) {
  const message=String(error);
  if(message.includes('rondas_zone_locations.location_id'))throw new RoundError(409,'Una ubicación se asignó a otra zona mientras guardabas. Actualice y revise las asignaciones.');
  if(message.includes('Zone location must'))throw new RoundError(409,'Una ubicación o sede cambió mientras guardabas. Actualice y revise la zona.');
  throw error;
 }
 const saved=result[result.length-1].results[0] as Omit<RoundZone,'locations'>|undefined;
 ensure(saved,409,'La zona cambió; actualice antes de guardar');
 return {zone:{...saved,locations}};
}
