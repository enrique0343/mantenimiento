// Transport is injected deliberately. This feature ships dry-run only; no email
// provider is called by the API or scheduler until deployment is authorized.
type Message={to:string;subject:string;text:string;idempotencyKey:string};
type Options={dryRun?:boolean;send?:(message:Message)=>Promise<void>;appUrl?:string;now?:string};
const q=(db:D1Database,sql:string,...params:any[])=>db.prepare(sql).bind(...params);
export async function queueOverdueNotifications(db:D1Database,date=new Date().toISOString()){
 const rows=(await q(db,"SELECT * FROM rondas_executions WHERE original_due_at<? AND status IN ('pendiente','en_curso','devuelta')",date).all()).results as any[];
 let queued=0;
 for(const r of rows){const config=JSON.parse(r.snapshot_json);if(!config.notifications.events.includes('vencida'))continue;
  for(const recipient of new Set(config.notifications.recipientIds)){
   const inserted=await q(db,"INSERT OR IGNORE INTO rondas_notifications(execution_id,event,event_revision,recipient_id,status,created_at) VALUES(?,'vencida',0,?,'dry_run',?) RETURNING id",r.id,recipient,date).all();queued+=inserted.results.length;
  }
 }
 return {considered:rows.length,queued};
}
export async function processRoundNotifications(db:D1Database,options:Options={}){
 const date=options.now??new Date().toISOString(),dryRun=options.dryRun!==false;
 if(!dryRun&&!options.send)throw new Error('No transport explicitly configured');
 const rows=(await q(db,`SELECT n.*,u.email,u.activo FROM rondas_notifications n JOIN usuarios u ON u.id=n.recipient_id WHERE (n.status='dry_run' AND (n.attempts=0 OR ?=0)) OR (n.status IN ('pending','failed','sending') AND n.attempts<8 AND (n.next_attempt_at IS NULL OR n.next_attempt_at<=?)) ORDER BY n.id LIMIT 50`,dryRun?1:0,date).all()).results as any[];
 const result={dryRun,processed:0,sent:0,failed:0};
 for(const n of rows){
  // Simulation is audited but must not consume the later real-delivery budget.
  const attempt=!dryRun&&n.status==='dry_run'?1:n.attempts+1,lease=new Date(Date.parse(date)+5*60000).toISOString();
  const claim=await q(db,"UPDATE rondas_notifications SET status='sending',attempts=?,next_attempt_at=? WHERE id=? AND attempts=? AND status=? RETURNING id",attempt,lease,n.id,n.attempts,n.status).all();
  if(!claim.results.length)continue;
  let status=dryRun?'dry_run':'sent',error:string|null=null;
  try{
   if(!n.activo)throw new Error('Recipient is inactive; administrator review required');
   if(!dryRun){
    const url=new URL(`/rondas?execution=${n.execution_id}`,options.appUrl??'https://invalid.local').toString();
    await options.send!({to:n.email,subject:`Ronda #${n.execution_id}: ${n.event}`,text:`La ronda #${n.execution_id} tiene el estado ${n.event}. Revise el detalle y la evidencia dentro del sistema autenticado: ${url}. No responda con información clínica.`,idempotencyKey:`ronda-notification-${n.id}`});result.sent++;
   }
  }catch(e){status='failed';error='No se pudo entregar. Revise configuración, destinatario y conectividad.';result.failed++;}
  const retry=status==='failed'&&attempt<8?new Date(Date.parse(date)+Math.min(24*60,2**attempt)*60000).toISOString():null;
  await db.batch([
   q(db,'UPDATE rondas_notifications SET status=?,last_error=?,next_attempt_at=?,delivered_at=? WHERE id=? AND attempts=?',status,error,retry,status==='sent'?date:null,n.id,attempt),
   q(db,'INSERT INTO rondas_notification_attempts(notification_id,status,details,created_at) VALUES(?,?,?,?)',n.id,status,error??(dryRun?'Simulación: no se envió correo':'Aceptado por el transporte; entrega final no confirmada'),date),
  ]);result.processed++;
 }
 return result;
}
