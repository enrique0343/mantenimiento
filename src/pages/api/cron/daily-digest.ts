import type { APIRoute } from "astro";
import { getEnv } from "@/lib/db";
import { enviarDigestDiario } from "@/lib/daily-digest";

export const prerender = false;

// Cron: envía el resumen diario de operaciones a todos los admins.
// Pensado para correr a las 6:00 AM hora El Salvador (= 12:00 UTC).
// Protegido por X-Cron-Secret.
export const POST: APIRoute = async (ctx) => {
  const env = getEnv(ctx);
  const expected = (env as any).CRON_SECRET as string | undefined;
  const got = ctx.request.headers.get("x-cron-secret");
  if (!expected || got !== expected) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }
  const { enviados } = await enviarDigestDiario(ctx);
  return Response.json({ ok: true, enviados });
};

// GET: permite a un admin disparar manualmente el digest desde el navegador
// (útil para probar). Requiere autenticación.
export const GET: APIRoute = async (ctx) => {
  const { requireUser } = await import("@/lib/auth");
  const { user, response } = await requireUser(ctx, ["admin"]);
  if (!user) return response;
  const { enviados } = await enviarDigestDiario(ctx);
  return Response.json({ ok: true, enviados, mensaje: `Digest enviado a ${enviados} admin(s).` });
};
