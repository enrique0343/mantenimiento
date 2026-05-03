import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { planesVehiculo } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeAdministrarFlota } from "@/lib/flota";

export const prerender = false;

export const DELETE: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeAdministrarFlota(user.rol)) return new Response("Sin permisos", { status: 403 });
  const id = Number(ctx.params.id);
  const db = getDb(ctx);
  await db.delete(planesVehiculo).where(eq(planesVehiculo.id, id));
  return Response.json({ ok: true });
};
