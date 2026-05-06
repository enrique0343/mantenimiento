import type { APIRoute } from "astro";
import { getEnv } from "@/lib/db";
import { enviarRecordatoriosEncuestas } from "@/lib/encuestas-recordatorio";

export const prerender = false;

// Cron: envía recordatorios de encuestas de satisfacción no respondidas
// pasadas 48h del envío original. Protegido por X-Cron-Secret.
export const POST: APIRoute = async (ctx) => {
  const env = getEnv(ctx);
  const expected = (env as any).CRON_SECRET as string | undefined;
  const got = ctx.request.headers.get("x-cron-secret");
  if (!expected || got !== expected) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }
  const { enviados } = await enviarRecordatoriosEncuestas(ctx);
  return Response.json({ ok: true, enviados });
};
