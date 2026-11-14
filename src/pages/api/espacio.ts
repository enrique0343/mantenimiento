// Interruptor «General | Biomédico»: guarda el espacio elegido en la cookie.
// POST con formulario (espacio, volver) → 303 a la misma lista o al panel del espacio.
// POST con JSON { espacio, volver } → { ok, espacio, destino }.
// Un espacio al que el usuario no entra → 403 JSON { error }; nunca se puede forzar.
import type { APIRoute } from "astro";
import { requireUserJson } from "@/lib/auth";
import {
  COOKIE_ESPACIO, ESPACIOS, destinoAlCambiar, opcionesCookieEspacio, parseEspacio, puedeEntrar,
} from "@/lib/espacio";

export const prerender = false;

async function leer(request: Request): Promise<{ espacio: unknown; volver: unknown; json: boolean }> {
  const tipo = request.headers.get("content-type") ?? "";
  if (tipo.includes("application/json")) {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    return { espacio: body?.espacio, volver: body?.volver, json: true };
  }
  const form = await request.formData().catch(() => null);
  return { espacio: form?.get("espacio"), volver: form?.get("volver"), json: false };
}

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUserJson(ctx);
  if (!user) return response;
  const { espacio: pedido, volver, json } = await leer(ctx.request);
  const espacio = parseEspacio(pedido);
  if (!espacio) return Response.json({ error: "Elige General o Biomédico." }, { status: 400 });
  if (!puedeEntrar(user, espacio)) {
    return Response.json({ error: `Tu usuario no tiene acceso al espacio ${ESPACIOS[espacio].etiqueta}.` }, { status: 403 });
  }
  const destino = destinoAlCambiar(volver);
  const seguro = new URL(ctx.request.url).protocol === "https:";
  ctx.cookies.set(COOKIE_ESPACIO, espacio, opcionesCookieEspacio(seguro));
  if (json) return Response.json({ ok: true, espacio, destino });
  return ctx.redirect(destino, 303);
};
