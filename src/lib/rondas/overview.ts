export type RoundsOverviewUser = { id:number; rol:string };

export interface RoundAttention {
 id:number;
 name:string;
 status:string;
 dueAt:string;
 shift:string;
 scheduledDate:string;
 isOverdue:boolean;
 zoneName:string|null;
 siteName:string|null;
 locationName:string|null;
 ownerName:string|null;
 reviewerName:string|null;
}

export interface RoundsOverview {
 /** Calendar date in America/El_Salvador, independent of the Worker timezone. */
 today:string;
 scheduledToday:number;
 pendingExecution:number;
 overdue:number;
 pendingValidation:number;
 /** Proposal decisions belong to chief/admin; other roles receive no count. */
 pendingProposals:number|null;
 linkedOpenOrders:number;
 linkedPendingVerification:number;
 /** Technicians do not receive global configuration counts. */
 configuration:{zones:number;templates:number}|null;
 attention:RoundAttention[];
}

type Counts = Omit<RoundsOverview,'today'|'configuration'|'attention'> & {
 zones:number|null;
 templates:number|null;
};
type AttentionRow = Omit<RoundAttention,'isOverdue'> & {isOverdue:number};
const openStatuses="'pendiente','en_curso','devuelta'";
const localDateFormatter=new Intl.DateTimeFormat('en-CA',{
 timeZone:'America/El_Salvador',year:'numeric',month:'2-digit',day:'2-digit',
});

/** Two consistent, read-only queries: complete aggregates and at most five rows. */
export async function getRoundsOverview(db:D1Database,user:RoundsOverviewUser,now=new Date().toISOString()):Promise<RoundsOverview|null> {
 if(!['admin','jefe','tecnico','visualizador'].includes(user.rol))return null;
 if(!Number.isSafeInteger(user.id)||user.id<=0)throw new RangeError('Usuario no válido');
 const date=new Date(now);
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(now)||!Number.isFinite(+date))throw new RangeError('Fecha de consulta no válida');
 const instant=date.toISOString();
 const parts=localDateFormatter.formatToParts(date);
 const value=(type:string)=>parts.find(part=>part.type===type)!.value;
 const today=`${value('year')}-${value('month')}-${value('day')}`;
 const technician=user.rol==='tecnico',canDecide=['admin','jefe'].includes(user.rol);
 const roundScope=technician?'? IN (r.owner_id,r.backup_id,r.reviewer_id,r.reviewer_backup_id)':'1=1';
 const roundArgs=technician?[user.id]:[];
 const orderScope=technician?' AND o.asignado_a=?':'';
 const orderArgs=technician?[user.id]:[];
 const summary=db.prepare(`WITH visible_rounds AS (
  SELECT r.status,r.scheduled_date,r.due_at FROM rondas_executions r WHERE ${roundScope}
 ), linked_orders AS (
  SELECT o.estado FROM ordenes o WHERE EXISTS(SELECT 1 FROM rondas_order_links l WHERE l.order_id=o.id)${orderScope}
 ) SELECT
  COALESCE(SUM(CASE WHEN scheduled_date=? THEN 1 ELSE 0 END),0) AS scheduledToday,
  COALESCE(SUM(CASE WHEN status IN (${openStatuses}) AND scheduled_date<=? THEN 1 ELSE 0 END),0) AS pendingExecution,
  COALESCE(SUM(CASE WHEN status IN (${openStatuses}) AND due_at<? THEN 1 ELSE 0 END),0) AS overdue,
  COALESCE(SUM(CASE WHEN status='pendiente_validacion' THEN 1 ELSE 0 END),0) AS pendingValidation,
  ${canDecide?"(SELECT COUNT(*) FROM rondas_proposals WHERE status IN ('pendiente_aprobacion','devuelta'))":'NULL'} AS pendingProposals,
  (SELECT COUNT(*) FROM linked_orders WHERE estado NOT IN ('cerrada','cancelada')) AS linkedOpenOrders,
  (SELECT COUNT(*) FROM linked_orders WHERE estado='completada') AS linkedPendingVerification,
  ${technician?'NULL':'(SELECT COUNT(*) FROM rondas_zones)'} AS zones,
  ${technician?'NULL':'(SELECT COUNT(*) FROM rondas_templates)'} AS templates
  FROM visible_rounds`).bind(...roundArgs,...orderArgs,today,today,instant);
 const attention=db.prepare(`WITH attention_rows AS (
  SELECT r.id,r.name,r.status,r.due_at,r.shift,r.scheduled_date,r.zone_id,r.snapshot_json,
   r.site_id,r.location_id,r.owner_id,r.reviewer_id,
   CASE WHEN r.status IN (${openStatuses}) AND r.due_at<? THEN 1 ELSE 0 END AS isOverdue
  FROM rondas_executions r WHERE ${roundScope}
   AND ((r.status IN (${openStatuses}) AND (r.scheduled_date<=? OR r.due_at<?)) OR r.status='pendiente_validacion')
  ORDER BY CASE WHEN isOverdue=1 THEN 0 WHEN r.status='pendiente_validacion' THEN 1 ELSE 2 END,
   r.due_at,r.scheduled_date,r.id LIMIT 5
 ) SELECT r.id,r.name,r.status,r.due_at AS dueAt,r.shift,r.scheduled_date AS scheduledDate,r.isOverdue,
  CASE WHEN r.zone_id IS NOT NULL THEN json_extract(r.snapshot_json,'$.zoneName') ELSE NULL END AS zoneName,
  s.nombre AS siteName,l.nombre AS locationName,owner.nombre AS ownerName,reviewer.nombre AS reviewerName
  FROM attention_rows r LEFT JOIN sucursales s ON s.id=r.site_id LEFT JOIN ubicaciones l ON l.id=r.location_id
  LEFT JOIN usuarios owner ON owner.id=r.owner_id LEFT JOIN usuarios reviewer ON reviewer.id=r.reviewer_id
  ORDER BY CASE WHEN r.isOverdue=1 THEN 0 WHEN r.status='pendiente_validacion' THEN 1 ELSE 2 END,
   r.due_at,r.scheduled_date,r.id`).bind(instant,...roundArgs,today,instant);
 const results=await db.batch([summary,attention]);
 const counts=results[0].results[0] as unknown as Counts|undefined;
 if(!counts)throw new Error('No se pudo obtener el panorama de rondas');
 const {zones,templates,...totals}=counts;
 return {today,...totals,configuration:technician?null:{zones:zones!,templates:templates!},
  attention:(results[1].results as unknown as AttentionRow[]).map(row=>({...row,isOverdue:row.isOverdue===1}))};
}
