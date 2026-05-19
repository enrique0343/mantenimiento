import type { APIRoute } from "astro";
import { getEnv } from "@/lib/db";
import { enviarResumenSemanalSatisfaccion } from "@/lib/weekly-satisfaccion";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const env = getEnv(ctx);
  const expected = (env as any).CRON_SECRET as string | undefined;
  const got = ctx.request.headers.get("x-cron-secret");
  if (!expected || got !== expected) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }
  const { enviados, razon } = await enviarResumenSemanalSatisfaccion(ctx);
  return Response.json({ ok: true, enviados, razon });
};

export const GET: APIRoute = async (ctx) => {
  const { requireUser } = await import("@/lib/auth");
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const force = new URL(ctx.request.url).searchParams.get("force") === "1";
  const { enviados, razon } = await enviarResumenSemanalSatisfaccion(ctx, { force });
  return Response.json({ ok: true, enviados, razon });
};
