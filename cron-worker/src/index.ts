// Preventivos diarios a las 06:00 de El Salvador (12:00 UTC).
// El horario adicional publica exclusivamente cortes SGO cuando está habilitado.

export interface Env {
  APP_URL: string;
  CRON_SECRET: string;
  SGO_INTEGRATION_ENABLED?: string;
  SGO_API_ORIGIN?: string;
  SGO_PUBLISH_SECRET?: string;
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const dailyPreventives = event.cron === "0 12 * * *";
    const hourlySnapshot = event.cron === "5 * * * *";
    if (dailyPreventives) ctx.waitUntil(runCron(env));
    if ((dailyPreventives || hourlySnapshot) && env.SGO_INTEGRATION_ENABLED === "true") {
      ctx.waitUntil(publishSgoSnapshot(env));
    }
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

// Separate from /run and the preventive-maintenance credentials/APP_URL. Only
// trusted Worker configuration can choose this origin; no request input is used.
async function publishSgoSnapshot(env: Env): Promise<void> {
  const timeoutMs = 10_000;
  const responseLimit = 4_096;
  const controller = new AbortController();
  let timedOut = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let code = "configuration_invalid";
  try {
    const origin = new URL(env.SGO_API_ORIGIN ?? "");
    const secret = env.SGO_PUBLISH_SECRET;
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.port ||
      origin.pathname !== "/" || origin.search || origin.hash || !secret ||
      secret.length < 32 || secret.length > 4_096 || /[\r\n]/.test(secret)) {
      throw new Error("invalid_configuration");
    }
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error("timeout"));
      }, timeoutMs);
    });
    code = "request_failed";
    await Promise.race([deadline, (async () => {
      const response = await fetch(new URL("/api/cron/sgo-snapshot", origin), {
        method: "POST",
        headers: { "X-SGO-Publish-Secret": secret },
        redirect: "manual",
        signal: controller.signal,
      });
      if (controller.signal.aborted) throw new Error("aborted");
      if (!response.ok) {
        code = response.status >= 300 && response.status < 400 ? "redirect_rejected" : "http_error";
        void response.body?.cancel().catch(() => {});
        throw new Error("http_error");
      }
      const declaredLength = response.headers.get("content-length");
      if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > responseLimit)) {
        code = "response_too_large";
        void response.body?.cancel().catch(() => {});
        throw new Error("response_too_large");
      }
      reader = response.body?.getReader();
      if (!reader) { code = "response_invalid"; throw new Error("response_invalid"); }
      let size = 0;
      const parts: Uint8Array[] = [];
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > responseLimit) { code = "response_too_large"; throw new Error("response_too_large"); }
        parts.push(part.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
      code = "response_invalid";
      const result = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
      if (result?.ok !== true || typeof result.snapshot_id !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(result.snapshot_id)) {
        throw new Error("response_invalid");
      }
    })()]);
    console.log("[sgo-snapshot] published");
  } catch {
    // Never serialize remote bodies, URLs, configuration, tokens or raw errors.
    const safeCode = timedOut ? "timeout" : code;
    console.error(`[sgo-snapshot] ${safeCode}`);
    throw new Error(`SGO_SNAPSHOT_${safeCode.toUpperCase()}`);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
    // Cancellation must not extend the bounded job when a peer stalls a stream.
    if (reader) void reader.cancel().catch(() => {});
  }
}

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
