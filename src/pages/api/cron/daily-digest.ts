import type { APIRoute } from "astro";
import { getEnv } from "@/lib/db";
import { enviarDigestDiario } from "@/lib/daily-digest";

export const prerender = false;

// Cron: envía el resumen diario. Se puede correr a cualquier hora — la función
// verifica si ya se envió hoy (hora SV) mirando el email_log. Si quieres
// forzar el reenvío, manda ?force=1 (solo via GET autenticado).
export const POST: APIRoute = async (ctx) => {
  const env = getEnv(ctx);
  const expected = (env as any).CRON_SECRET as string | undefined;
  const got = ctx.request.headers.get("x-cron-secret");
  if (!expected || got !== expected) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }
  const { enviados, razon } = await enviarDigestDiario(ctx);
  return Response.json({ ok: true, enviados, razon });
};

// GET: permite a un admin disparar manualmente el digest desde el navegador
// (útil para probar). Si pasas ?force=1, ignora el check anti-duplicado.
export const GET: APIRoute = async (ctx) => {
  const { requireUser } = await import("@/lib/auth");
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const force = new URL(ctx.request.url).searchParams.get("force") === "1";
  const { enviados, razon } = await enviarDigestDiario(ctx, { force });
  const mensaje = enviados > 0
    ? `✓ Digest enviado a ${enviados} admin(s).`
    : `⏸ Digest no enviado. ${razon ?? ""}`;
  return Response.json({ ok: true, enviados, razon, mensaje });
};
