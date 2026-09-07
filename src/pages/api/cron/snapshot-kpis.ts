import type { APIRoute } from "astro";
import { getEnv } from "@/lib/db";
import { capturarSnapshot, ultimosPeriodos } from "@/lib/metricas";

export const prerender = false;

// Captura el snapshot del mes en curso y el anterior (idempotente). Al correr a
// diario, el mes en curso se va actualizando y queda "congelado" en su último día.
async function capturar(ctx: Parameters<APIRoute>[0]) {
  const periodos = ultimosPeriodos(2); // [mes anterior, mes actual]
  for (const p of periodos) await capturarSnapshot(ctx, p);
  return periodos;
}

export const POST: APIRoute = async (ctx) => {
  const env = getEnv(ctx);
  const expected = (env as any).CRON_SECRET as string | undefined;
  const got = ctx.request.headers.get("x-cron-secret");
  if (!expected || got !== expected) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }
  const periodos = await capturar(ctx);
  return Response.json({ ok: true, periodos });
};

// GET: disparo manual por un admin desde el navegador (para probar).
export const GET: APIRoute = async (ctx) => {
  const { requireUser } = await import("@/lib/auth");
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const periodos = await capturar(ctx);
  return Response.json({ ok: true, periodos, mensaje: `✓ Snapshot capturado para ${periodos.join(", ")}` });
};
