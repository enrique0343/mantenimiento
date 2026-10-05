import { z } from 'zod';
export const frequencies = ['diaria','semanal','quincenal','mensual','bimestral','trimestral','semestral','anual'] as const;
export const events = ['asignada','vencida','pendiente_validacion','devuelta','validada','omitida','reprogramada'] as const;
export const daySchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'Fecha inválida');
const id=z.number().int().positive();
export const configSchema=z.object({
 effectiveFrom:daySchema.default(()=>new Date().toISOString().slice(0,10)),name:z.string().trim().min(1).max(160),siteId:id,locationId:id.nullable().optional(),
 zoneId:id.nullable().optional(),zoneName:z.string().max(160).optional(),zoneVersion:z.number().int().positive().optional(),
 locations:z.array(z.object({id,nombre:z.string().max(300)})).max(100).optional(),shift:z.string().trim().min(1).max(50),
 timezoneOffset:z.string().regex(/^[+-](0\d|1[0-4]):[0-5]\d$/), time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),windowMinutes:z.number().int().min(0).max(1440),
 ownerId:id,backupId:id.nullable().optional(),reviewerId:id,reviewerBackupId:id.nullable().optional(),reason:z.string().trim().min(3).max(2000),
 points:z.array(z.object({code:z.string().trim().min(1).max(80),group:z.string().trim().min(1).max(80),label:z.string().trim().min(1).max(300),criterion:z.string().trim().max(2000),active:z.boolean(),exclusionReason:z.string().max(2000).optional().default(''),mandatory:z.boolean().optional().default(false),frequency:z.enum(frequencies),firstDate:daySchema,evidencePolicy:z.enum(['none','findings','always']),assetId:id.nullable().optional(),locationId:id.nullable().optional(),measurementType:z.enum(['none','pressure']).default('none'),measurementUnit:z.string().trim().max(30).default(''),photoRequired:z.boolean().default(false),minValue:z.number().finite().nullable().optional(),maxValue:z.number().finite().nullable().optional(),limitSource:z.string().trim().max(1000).default('')})).min(1).max(150),
 notifications:z.object({recipientIds:z.array(id).max(30),events:z.array(z.enum(events)).max(7)}).default({recipientIds:[],events:[]}),
}).superRefine((v,c)=>{
 if(!v.zoneId&&!v.locationId)c.addIssue({code:'custom',message:'Seleccione una zona de ronda o una ubicación'});
 if(v.zoneId&&v.points.some(p=>p.active&&p.assetId&&!p.locationId))c.addIssue({code:'custom',message:'Seleccione la ubicación concreta de cada control vinculado a un equipo'});
 if(new Set(v.points.map(p=>p.code)).size!==v.points.length)c.addIssue({code:'custom',message:'Códigos de punto duplicados'});
 const executors=[v.ownerId,v.backupId].filter(Boolean);
 if([v.reviewerId,v.reviewerBackupId].some(i=>i&&executors.includes(i)))c.addIssue({code:'custom',message:'El verificador y su suplente deben ser distintos de los ejecutores'});
 for(const p of v.points){if(p.measurementType==='pressure'&&p.active&&!p.measurementUnit)c.addIssue({code:'custom',message:'Defina la unidad aprobada de presión'});if((p.minValue!=null||p.maxValue!=null)&&!p.limitSource)c.addIssue({code:'custom',message:'Indique la fuente técnica aprobada de los límites'});if(p.minValue!=null&&p.maxValue!=null&&p.minValue>p.maxValue)c.addIssue({code:'custom',message:'Rango de medición inválido'});}
 for(const p of v.points)if(p.active&&p.criterion.length<3)c.addIssue({code:'custom',message:'Defina el criterio aprobado de cada punto activo'});
 for(const p of v.points)if(!p.active&&(!p.exclusionReason.trim()||p.mandatory))c.addIssue({code:'custom',message:'Un control obligatorio no se desactiva; otras exclusiones requieren motivo'});
});
export type RoundConfig=z.infer<typeof configSchema>;
export function pointDue(point:RoundConfig['points'][number],day:string){
 if(!point.active||day<point.firstDate)return false;
 const a=new Date(`${point.firstDate}T00:00:00Z`),d=new Date(`${day}T00:00:00Z`);
 const delta=Math.round((+d-+a)/86400000);
 const days={diaria:1,semanal:7,quincenal:15} as Record<string,number>;
 if(days[point.frequency])return delta%days[point.frequency]===0;
 const months={mensual:1,bimestral:2,trimestral:3,semestral:6,anual:12} as Record<string,number>;
 const md=(d.getUTCFullYear()-a.getUTCFullYear())*12+d.getUTCMonth()-a.getUTCMonth();
 const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
 return md%months[point.frequency]===0&&d.getUTCDate()===Math.min(a.getUTCDate(),last);
}
export function dueAt(config:RoundConfig,day:string){return new Date(+new Date(`${day}T${config.time}:00${config.timezoneOffset}`)+config.windowMinutes*60000).toISOString();}
export function temporalStatus(row:any,now=new Date().toISOString()){
 if(row.executed_at)return row.executed_at>row.original_due_at?'ejecutada_tarde':'a_tiempo';
 if(row.status==='omitida')return 'omitida';
 return row.original_due_at<now?'vencida':'en_ventana';
}
export class RoundError extends Error { constructor(public status:number,message:string,public extra:any={}){super(message);} }
export function ensure(condition:any,status:number,message:string):asserts condition {if(!condition)throw new RoundError(status,message);}
