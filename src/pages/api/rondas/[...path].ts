import type { APIRoute } from 'astro';
import { requireUser } from '@/lib/auth';
import { getEnv } from '@/lib/db';
import { RoundError } from '@/lib/rondas/model';
import { listRounds,catalog,saveTemplate,generate,detail,action,createProposal,decideProposal,actionDashboard } from '@/lib/rondas/service';
import { processRoundNotifications,queueOverdueNotifications } from '@/lib/rondas/notifications';
import { listZones,saveZone } from '@/lib/rondas/zones';
export const prerender=false;
const handle:APIRoute=async(ctx)=>{
 const {user,response}=await requireUser(ctx);if(!user)return response;
 try {
  const db=getEnv(ctx).DB,path=ctx.url.pathname.replace(/^\/api\/rondas\/?/,'').replace(/\/$/,'');
  if(ctx.request.method==='GET'){
   if(!path)return Response.json(await listRounds(db,user));
   if(path==='catalog')return Response.json(await catalog(db,user));
   if(path==='actions')return Response.json(await actionDashboard(db,user));
   if(path==='zones')return Response.json(await listZones(db,user));
   const m=path.match(/^executions\/(\d+)$/);if(m)return Response.json(await detail(db,user,+m[1]));
  }else if(ctx.request.method==='POST'){
   const body=await ctx.request.json().catch(()=>null);if(!body)return Response.json({error:'JSON inválido'},{status:400});
   if(path==='templates')return Response.json(await saveTemplate(db,user,body),{status:201});
   if(path==='generate')return Response.json(await generate(db,user,body));
   if(path==='zones')return Response.json(await saveZone(db,user,body),{status:201});
   let m=path.match(/^templates\/(\d+)\/version$/);if(m)return Response.json(await saveTemplate(db,user,body,+m[1]));
   m=path.match(/^zones\/(\d+)\/version$/);if(m)return Response.json(await saveZone(db,user,body,+m[1]));
   m=path.match(/^executions\/(\d+)\/action$/);if(m)return Response.json(await action(db,user,+m[1],body));
   m=path.match(/^executions\/(\d+)\/order$/);if(m)return Response.json(await createProposal(db,user,+m[1],body),{status:201});
   m=path.match(/^proposals\/(\d+)\/decision$/);if(m)return Response.json(await decideProposal(db,user,+m[1],body));
   if(path==='notifications/process'){
    if(!['admin','jefe'].includes(user.rol))return Response.json({error:'Sin permisos'},{status:403});
    await queueOverdueNotifications(db);return Response.json(await processRoundNotifications(db,{dryRun:true}));
   }
  }
  return Response.json({error:'Ruta no encontrada'},{status:404});
 }catch(e:any){
  if(e instanceof RoundError)return Response.json({error:e.message,...e.extra},{status:e.status});
  if(String(e).includes('Round proposal equipment location changed'))return Response.json({error:'El equipo cambió de ubicación durante el guardado. Actualice y revise la plantilla.'},{status:409});
  if(String(e).includes('Round zone physical scope changed'))return Response.json({error:'Una ubicación o sede cambió durante la generación. Actualice y revise el alcance de la zona.'},{status:409});
  if(e?.name==='ZodError')return Response.json({error:e.issues.map((i:any)=>i.message).join('; ')},{status:400});
  console.error('rondas',e);return Response.json({error:'No se pudo guardar. Actualice y compruebe el estado antes de reintentar.'},{status:500});
 }
};
export const GET=handle;export const POST=handle;
