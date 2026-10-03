import { generate } from './service';
import { queueOverdueNotifications,processRoundNotifications } from './notifications';
export async function scheduleRounds(db:D1Database,date=new Date().toISOString()){
 const templates=(await db.prepare('SELECT t.*,u.activo AS creator_active,u.rol AS creator_role FROM rondas_templates t JOIN usuarios u ON u.id=t.created_by ORDER BY t.id').all()).results as any[];
 const result:{processed:number;executions:number;backlog:boolean;skipped:{templateId:number;reason:string}[]}={processed:0,executions:0,backlog:false,skipped:[]};
 for(const t of templates){
  if(!t.creator_active||!['admin','jefe'].includes(t.creator_role)){result.skipped.push({templateId:t.id,reason:'El autor de la programación está inactivo o sin permisos; revisión del jefe requerida'});continue;}
  const c=JSON.parse(t.config_json),offset=(c.timezoneOffset[0]==='-'?-1:1)*(Number(c.timezoneOffset.slice(1,3))*60+Number(c.timezoneOffset.slice(4,6)));
  const today=new Date(Date.parse(date)+offset*60000).toISOString().slice(0,10);
  const cursor=await db.prepare('SELECT last_date FROM rondas_schedule_cursors WHERE template_id=?').bind(t.id).first<any>();
  const first=await db.prepare('SELECT config_json FROM rondas_template_versions WHERE template_id=? ORDER BY version LIMIT 1').bind(t.id).first<any>();
  const start=cursor?new Date(Date.parse(cursor.last_date)+86400000).toISOString().slice(0,10):JSON.parse(first.config_json).effectiveFrom;
  if(start>today)continue;
  const until=new Date(Math.min(Date.parse(today),Date.parse(start)+30*86400000)).toISOString().slice(0,10);
  try{
   const generated=await generate(db,{id:t.created_by,nombre:'Programador automático de rondas',rol:t.creator_role},{templateId:t.id,dateFrom:start,dateTo:until});
   await db.prepare('INSERT INTO rondas_schedule_cursors(template_id,last_date,updated_at) VALUES(?,?,?) ON CONFLICT(template_id) DO UPDATE SET last_date=MAX(last_date,excluded.last_date),updated_at=excluded.updated_at').bind(t.id,until,date).run();
   result.processed++;result.executions+=generated.executions.length;if(until<today)result.backlog=true;
  }catch{result.skipped.push({templateId:t.id,reason:'No se pudo generar: revise configuración y responsables; no se avanzó el cursor'});}
 }
 await queueOverdueNotifications(db,date);await processRoundNotifications(db,{dryRun:true,now:date});return result;
}
