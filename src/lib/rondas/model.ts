import { z } from 'zod';
export const frequencies = ['diaria','semanal','quincenal','mensual','bimestral','trimestral','semestral','anual'] as const;
export const events = ['asignada','vencida','pendiente_validacion','devuelta','validada','omitida','reprogramada'] as const;
export const daySchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'Fecha inválida');
const id=z.number().int().positive();
const pointSchema=z.object({
 code:z.string().trim().min(1).max(80),group:z.string().trim().min(1).max(80),label:z.string().trim().min(1).max(300),
 criterion:z.string().trim().max(2000),active:z.boolean(),exclusionReason:z.string().max(2000).optional().default(''),
 mandatory:z.boolean().optional().default(false),frequency:z.enum(frequencies),firstDate:daySchema,
 evidencePolicy:z.enum(['none','findings','always']),assetId:id.nullable().optional(),locationId:id.nullable().optional(),
 measurementType:z.enum(['none','pressure']).default('none'),measurementUnit:z.string().trim().max(30).default(''),
 photoRequired:z.boolean().default(false),minValue:z.number().finite().nullable().optional(),maxValue:z.number().finite().nullable().optional(),
 limitSource:z.string().trim().max(1000).default(''),
}).superRefine((point,context)=>{
 // Validate each point independently so missing general fields do not hide the
 // criteria or exclusion reasons that the same form still needs to complete.
 const issue=(field:string,message:string)=>context.addIssue({code:'custom',path:[field],message});
 if(point.active&&point.criterion.length<3)issue('criterion','Escriba el criterio aprobado de este punto (al menos 3 caracteres).');
 if(!point.active&&point.mandatory)issue('active','Este control es obligatorio y debe permanecer activo.');
 if(!point.active&&!point.exclusionReason.trim())issue('exclusionReason','Indique por qué este punto no se incluirá en la ronda.');
 if(point.measurementType==='pressure'&&point.active&&!point.measurementUnit)issue('measurementUnit','Defina la unidad aprobada de presión.');
 if((point.minValue!=null||point.maxValue!=null)&&!point.limitSource)issue('limitSource','Indique la fuente técnica aprobada de los límites.');
 if(point.minValue!=null&&point.maxValue!=null&&point.minValue>point.maxValue)issue('maxValue','El límite máximo debe ser mayor o igual que el mínimo.');
});
export const configSchema=z.object({
 effectiveFrom:daySchema.default(()=>new Date().toISOString().slice(0,10)),name:z.string().trim().min(1).max(160),siteId:id,locationId:id.nullable().optional(),
 zoneId:id.nullable().optional(),zoneName:z.string().max(160).optional(),zoneVersion:z.number().int().positive().optional(),
 locations:z.array(z.object({id,nombre:z.string().max(300)})).max(100).optional(),shift:z.string().trim().min(1).max(50),
 timezoneOffset:z.string().regex(/^[+-](0\d|1[0-4]):[0-5]\d$/), time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),windowMinutes:z.number().int().min(0).max(1440),
 ownerId:id,backupId:id.nullable().optional(),reviewerId:id,reviewerBackupId:id.nullable().optional(),reason:z.string().trim().min(3).max(2000),
 points:z.array(pointSchema).min(1).max(150),
 notifications:z.object({recipientIds:z.array(id).max(30),events:z.array(z.enum(events)).max(7)}).default({recipientIds:[],events:[]}),
}).superRefine((v,c)=>{
 if(!v.zoneId&&!v.locationId)c.addIssue({code:'custom',path:['zoneId'],message:'Seleccione una zona de ronda o una ubicación.'});
 const codes=new Set<string>();
 for(const [index,point] of v.points.entries()){
  if(v.zoneId&&point.active&&point.assetId&&!point.locationId)c.addIssue({code:'custom',path:['points',index,'locationId'],message:'Seleccione la ubicación concreta de este control vinculado a un equipo.'});
  if(codes.has(point.code))c.addIssue({code:'custom',path:['points',index,'code'],message:'Este código está repetido en otro punto; use un código distinto.'});
  codes.add(point.code);
 }
 const executors=[v.ownerId,v.backupId].filter(Boolean);
 for(const field of ['reviewerId','reviewerBackupId'] as const){
  if(v[field]&&executors.includes(v[field]))c.addIssue({code:'custom',path:[field],message:'Debe ser una persona distinta del encargado y su suplente.'});
 }
});

export type RoundConfigIssue={path:(string|number)[];message:string};
const fieldLabels:Record<string,string>={
 effectiveFrom:'Vigente desde',name:'Nombre de la plantilla',siteId:'Sede',locationId:'Ubicación',zoneId:'Zona de ronda',
 zoneName:'Nombre de la zona',zoneVersion:'Versión de la zona',locations:'Ubicaciones',nombre:'Nombre de ubicación',
 shift:'Turno',timezoneOffset:'Zona horaria',time:'Hora',windowMinutes:'Margen de cumplimiento',ownerId:'Encargado',
 backupId:'Suplente del encargado',reviewerId:'Verificador',reviewerBackupId:'Suplente del verificador',reason:'Motivo de la configuración',
 points:'Puntos de inspección',code:'Código del punto',group:'Grupo',label:'Nombre del punto',criterion:'Criterio de inspección',
 active:'Activo',exclusionReason:'Motivo de exclusión',mandatory:'Control obligatorio',frequency:'Frecuencia',firstDate:'Primera fecha',
 evidencePolicy:'Evidencia requerida',assetId:'Equipo vinculado',measurementType:'Medición requerida',measurementUnit:'Unidad de medición',
 photoRequired:'Fotografía requerida',minValue:'Límite mínimo',maxValue:'Límite máximo',limitSource:'Fuente técnica de los límites',
 notifications:'Notificaciones',recipientIds:'Destinatarios de notificaciones',events:'Eventos de notificación',id:'Identificador',
};
function configIssueMessage(issue:z.ZodIssue,field:string){
 if(issue.code==='custom')return issue.message;
 if(issue.code==='invalid_type'){
  if(issue.expected==='number'&&(/Id$/.test(field)||field==='recipientIds'||field==='id'))return 'Seleccione una opción válida.';
  if(issue.expected==='integer')return 'Ingrese un número entero.';
  if(issue.received==='undefined'||issue.received==='null')return 'Complete este campo.';
  if(issue.expected==='number')return 'Ingrese un número válido.';
  if(issue.expected==='string')return 'Escriba un texto válido.';
  return 'Revise el valor de este campo.';
 }
 if(issue.code==='too_small'){
  if(issue.type==='string')return `Escriba al menos ${issue.minimum} ${issue.minimum===1?'carácter':'caracteres'}.`;
  if(issue.type==='array')return `Agregue al menos ${issue.minimum} ${issue.minimum===1?'elemento':'elementos'}.`;
  return `Ingrese un valor ${issue.inclusive?'mayor o igual que':'mayor que'} ${issue.minimum}.`;
 }
 if(issue.code==='too_big'){
  if(issue.type==='string')return `Use como máximo ${issue.maximum} caracteres.`;
  if(issue.type==='array')return `Seleccione como máximo ${issue.maximum} elementos.`;
  return `Ingrese un valor ${issue.inclusive?'menor o igual que':'menor que'} ${issue.maximum}.`;
 }
 if(issue.code==='invalid_string'){
  if(field==='time')return 'Ingrese una hora válida (HH:MM).';
  if(field==='firstDate'||field==='effectiveFrom')return 'Ingrese una fecha válida (AAAA-MM-DD).';
  if(field==='timezoneOffset')return 'Ingrese una zona horaria válida (por ejemplo, -06:00).';
  return 'Revise el formato de este campo.';
 }
 if(issue.code==='invalid_enum_value')return 'Seleccione una opción válida.';
 if(issue.code==='not_finite')return 'Ingrese un número finito.';
 return 'Revise el valor de este campo.';
}
export function formatConfigIssues(issues:readonly z.ZodIssue[],input:unknown):RoundConfigIssue[]{
 const data=input&&typeof input==='object'?input as Record<string,unknown>:{};
 return issues.map(issue=>{
  const path=[...issue.path];
  const field=String([...path].reverse().find(part=>typeof part==='string')??'');
  let prefix=fieldLabels[field]??'Configuración de la plantilla';
  if(path[0]==='points'&&typeof path[1]==='number'){
   const index=path[1];
   const point=Array.isArray(data.points)?data.points[index]:undefined;
   const label=typeof point?.label==='string'?point.label.trim():'';
   const code=typeof point?.code==='string'?point.code.trim():'';
   const identity=[label,code?`(${code})`:''].filter(Boolean).join(' ');
   prefix=`Punto ${index+1}${identity?` · ${identity}`:''} — ${prefix}`;
  }
  return {path,message:`${prefix}: ${configIssueMessage(issue,field)}`};
 });
}
export function configValidationIssues(input:unknown):RoundConfigIssue[]{
 const result=configSchema.safeParse(input);
 return result.success?[]:formatConfigIssues(result.error.issues,input);
}
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
