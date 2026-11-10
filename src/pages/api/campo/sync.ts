// Modo técnico · recibe lo que el celular capturó, en el orden en que ocurrió.
import type { APIRoute } from "astro";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { aplicarOperacion, puedeUsarCampo, type OperacionCampo } from "@/lib/campo";

export const prerender = false;

const MAX_OPS = 25;
// D1 permite 50 consultas por invocación en el plan gratuito (un batch cuenta como una).
// Lo que no cabe se queda en la cola del celular y sale en la siguiente vuelta, en orden.
const PRESUPUESTO = 45;
// La emergencia lee además el código de la orden para anotarlo en la bitácora del AOP.
// Iniciar una emergencia sin pasos busca antes su EOP; terminar una intervención lee sus
// liberaciones; la reversa avisa a cada jefatura.
const PESO: Record<string, number> = { "emergencia.abrir": 16, "orden.iniciar": 22, "orden.terminar": 24, "mop.liberacion": 8, "mop.reversa": 20 };
const peso = (op: OperacionCampo) => (op?.tipo === "ronda.lectura" ? (op.resultado === "fuera" ? 15 : op.resultado === "no_verificado" ? 10 : 4) : PESO[op?.tipo] ?? 15);

export const POST: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeUsarCampo(user.rol)) return new Response("Sin permisos", { status: 403 });
  const body: any = await ctx.request.json().catch(() => null);
  const ops: OperacionCampo[] = Array.isArray(body?.ops) ? body.ops.slice(0, MAX_OPS) : [];
  if (!ops.length) return Response.json({ error: "Sin operaciones" }, { status: 400 });
  // Si el reloj del celular está mal, las horas capturadas se corrigen con la
  // diferencia entre su reloj y el del servidor al momento de enviar.
  const relojCelular = typeof body?.reloj === "string" ? Date.parse(body.reloj) : NaN;
  const desfase = Number.isFinite(relojCelular) ? Date.now() - relojCelular : 0;
  if (Math.abs(desfase) > 120_000) {
    for (const op of ops) {
      const ms = typeof op.at === "string" ? Date.parse(op.at) : NaN;
      if (Number.isFinite(ms)) op.at = new Date(ms + desfase).toISOString();
    }
  }
  const db = getDb(ctx);
  const resultados = [];
  let gastado = 3; // sesión y arranque
  for (const op of ops) {
    gastado += peso(op);
    if (resultados.length && gastado > PRESUPUESTO) break;
    try {
      resultados.push(await aplicarOperacion(ctx, db, user, op));
    } catch (e) {
      // Fallo del servidor, no de la operación: se detiene para conservar el orden.
      console.error("campo_sync", op?.tipo, e);
      return Response.json({ resultados, detenido: op?.opId ?? null }, { status: 200 });
    }
  }
  return Response.json({ resultados });
};
