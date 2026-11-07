import { ensure } from './model';
type User={id:number;rol:string};
const word=(b:Uint8Array,p:number)=>b[p]*256+b[p+1];
const u32=(b:Uint8Array,p:number)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(p);
const dimensions=(w:number,h:number)=>w>0&&h>0&&w<=16384&&h<=16384&&w*h<=100_000_000;
function crc32(b:Uint8Array){let crc=0xffffffff;for(const v of b){crc^=v;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
/** Structural validation, not a claim that the image depicts the instrument.
 * The independent reviewer must check that the photo supports the reading. */
export function validPhoto(b:Uint8Array,type:string){
 try{
  if(type==='image/png'){
   if(b.length<57||![137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v))return false;
   let at=8,header=false,data=false;
   while(at+12<=b.length){const size=u32(b,at),end=at+12+size;if(end>b.length)return false;
    const kind=new TextDecoder().decode(b.slice(at+4,at+8));if(crc32(b.slice(at+4,at+8+size))!==u32(b,at+8+size))return false;
    if(!header){if(kind!=='IHDR'||size!==13||!dimensions(u32(b,at+8),u32(b,at+12)))return false;header=true;}
    if(kind==='IDAT'&&size>0)data=true;if(kind==='IEND')return size===0&&data&&end===b.length;at=end;
   }return false;
  }
  if(type==='image/jpeg'){
   if(b.length<24||b[0]!==255||b[1]!==216||b[b.length-2]!==255||b[b.length-1]!==217)return false;
   let at=2,frame=false;
   while(at+4<b.length){if(b[at++]!==255)return false;while(b[at]===255)at++;const marker=b[at++];
    if(marker===218){const size=word(b,at);return frame&&size>=6&&at+size<b.length-2;}
    if(marker===217)return false;if(marker===1||(marker>=208&&marker<=215))continue;
    const size=word(b,at);if(size<2||at+size>b.length)return false;
    if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){if(size<8||!dimensions(word(b,at+5),word(b,at+3)))return false;frame=true;}at+=size;
   }return false;
  }
  if(type==='image/webp'){
   const text=(s:number,n:number)=>new TextDecoder().decode(b.slice(s,s+n));const le=(p:number)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(p,true);
   if(b.length<30||text(0,4)!=='RIFF'||text(8,4)!=='WEBP'||le(4)!==b.length-8)return false;
   for(let at=12;at+8<=b.length;){const kind=text(at,4),size=le(at+4),data=at+8;if(!size||data+size>b.length)return false;
    if(kind==='VP8 '&&size>=10&&b[data+3]===157&&b[data+4]===1&&b[data+5]===42)return dimensions((b[data+6]+256*b[data+7])&16383,(b[data+8]+256*b[data+9])&16383);
    if(kind==='VP8L'&&size>=5&&b[data]===47){const bits=le(data+1);return dimensions((bits&16383)+1,((bits>>>14)&16383)+1);}
    at=data+size+(size%2);
   }return false;
  }
  return false;
 }catch{return false;}
}
export async function uploadEvidence(db:D1Database,r2:R2Bucket,u:User,form:FormData){
 ensure(['admin','jefe','tecnico'].includes(u.rol),403,'El usuario ya no tiene un rol operativo');
 const executionId=Number(form.get('executionId')),pointId=String(form.get('pointId')??''),file=form.get('file');
 ensure(Number.isSafeInteger(executionId)&&executionId>0,400,'Ronda inválida');
 const r=await db.prepare('SELECT * FROM rondas_executions WHERE id=?').bind(executionId).first<any>();
 ensure(r,404,'Ronda inexistente');ensure([r.owner_id,r.backup_id].includes(u.id),403,'Solo el inspector o suplente puede adjuntar evidencia');
 ensure(['pendiente','en_curso','devuelta'].includes(r.status),409,'La ronda ya fue enviada');
 const p=JSON.parse(r.data_json).find((p:any)=>p.id===pointId);ensure(p,404,'Punto inexistente');
 ensure(file&&typeof file!=='string'&&typeof file.arrayBuffer==='function',400,'Seleccione una fotografía');
 ensure(file.size>0&&file.size<=10*1024*1024,400,'La fotografía debe pesar menos de 10 MB');
 const bytes=new Uint8Array(await file.arrayBuffer());ensure(validPhoto(bytes,file.type),400,'Use fotografía JPEG, PNG o WebP válida');
 const key=`rondas/${executionId}/${crypto.randomUUID()}`,date=new Date().toISOString();
 const filename=file.name.replace(/[\r\n\/\\\x00-\x1f]/g,'_').slice(0,180)||'indicador';
 await r2.put(key,bytes,{httpMetadata:{contentType:file.type}});
 try{
  const saved=await db.prepare(`INSERT INTO rondas_evidence(execution_id,point_id,uploaded_by,filename,content_type,byte_size,r2_key,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM rondas_executions WHERE id=? AND revision=? AND status IN ('pendiente','en_curso','devuelta')) RETURNING id`).bind(executionId,pointId,u.id,filename,file.type,bytes.length,key,date,executionId,r.revision).first<any>();
  ensure(saved,409,'La ronda cambió mientras se cargaba la fotografía; actualice');
  return {id:saved.id,url:`/api/rondas/evidence?id=${saved.id}`,nombre:filename,createdAt:date};
 }catch(e){await r2.delete(key).catch(()=>{});throw e;}
}
export async function downloadEvidence(db:D1Database,r2:R2Bucket,u:User,id:number){
 const row=await db.prepare('SELECT e.*,r.owner_id,r.backup_id,r.reviewer_id,r.reviewer_backup_id FROM rondas_evidence e JOIN rondas_executions r ON r.id=e.execution_id WHERE e.id=?').bind(id).first<any>();
 ensure(row,404,'Fotografía no encontrada');
 ensure(['admin','jefe','visualizador'].includes(u.rol)||[row.owner_id,row.backup_id,row.reviewer_id,row.reviewer_backup_id].includes(u.id),403,'Sin acceso a esta evidencia');
 const object=await r2.get(row.r2_key);ensure(object,404,'Fotografía no disponible; no sustituye evidencia por un aprobado');
 return new Response(object.body as unknown as ReadableStream,{headers:{'content-type':row.content_type,'content-length':String(row.byte_size),'cache-control':'private, no-store','x-content-type-options':'nosniff','content-disposition':`inline; filename="${row.filename.replace(/"/g,'_')}"`}});
}
