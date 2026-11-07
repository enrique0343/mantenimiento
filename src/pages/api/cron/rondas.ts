import type { APIRoute } from 'astro';
import { getEnv } from '@/lib/db';
import { scheduleRounds } from '@/lib/rondas/scheduler';
export const prerender=false;
export const POST:APIRoute=async(ctx)=>{
 const env=getEnv(ctx);
 if(!env.CRON_SECRET||ctx.request.headers.get('x-cron-secret')!==env.CRON_SECRET)return Response.json({error:'No autorizado'},{status:401});
 if(env.RONDAS_SCHEDULER_ENABLED!=='true')return Response.json({enabled:false});
 return Response.json({enabled:true,...await scheduleRounds(env.DB)});
};
