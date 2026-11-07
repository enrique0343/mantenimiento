import type { APIRoute } from 'astro';
import { requireUser } from '@/lib/auth';
import { getEnv } from '@/lib/db';
import { RoundError } from '@/lib/rondas/model';
import { uploadEvidence,downloadEvidence } from '@/lib/rondas/evidence';
export const prerender=false;
const handle:APIRoute=async(ctx)=>{
 const {user,response}=await requireUser(ctx);if(!user)return response;
 try{const env=getEnv(ctx);
  if(ctx.request.method==='GET')return await downloadEvidence(env.DB,env.R2,user,Number(ctx.url.searchParams.get('id')));
  const length=Number(ctx.request.headers.get('content-length'));if(length>11*1024*1024)return Response.json({error:'Archivo demasiado grande'},{status:413});
  return Response.json(await uploadEvidence(env.DB,env.R2,user,await ctx.request.formData()),{status:201});
 }catch(e){if(e instanceof RoundError)return Response.json({error:e.message},{status:e.status});return Response.json({error:'No se pudo guardar la fotografía; el punto sigue pendiente hasta guardar evidencia válida'},{status:500});}
};
export const GET=handle;export const POST=handle;
