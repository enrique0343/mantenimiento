// Cron Worker que se dispara cada dia a las 06:00 hora El Salvador (12:00 UTC).
// Hace POST al endpoint /api/cron/generar-preventivos del sitio Pages,
// autenticado con CRON_SECRET.

export interface Env {
  APP_URL: string;
  CRON_SECRET: string;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCron(env));
  },
  async fetch(req: Request, env: Env): Promise<Response> {
    // Endpoint manual para probar el cron sin esperar al horario.
    const url = new URL(req.url);
    if (url.pathname !== "/run") return new Response("OK", { status: 200 });
    const secret = req.headers.get("x-cron-secret");
    if (secret !== env.CRON_SECRET) return new Response("No autorizado", { status: 401 });
    const result = await runCron(env);
    return Response.json(result);
  },
};

async function runCron(env: Env): Promise<unknown> {
  const res = await fetch(`${env.APP_URL}/api/cron/generar-preventivos`, {
    method: "POST",
    headers: {
      "x-cron-secret": env.CRON_SECRET,
      "content-type": "application/json",
    },
    body: "{}",
  });
  const text = await res.text();
  console.log(`[cron] ${res.status} ${text}`);
  try {
    return JSON.parse(text);
  } catch {
    return { status: res.status, body: text };
  }
}
