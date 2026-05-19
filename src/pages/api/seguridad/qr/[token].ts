import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { extintores, sucursales } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { puedeVerSeguridad } from "@/lib/extintores";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  if (!puedeVerSeguridad(user.rol)) return new Response("Sin permisos", { status: 403 });
  const token = ctx.params.token;
  if (!token) return Response.json({ error: "Token requerido" }, { status: 400 });
  const db = getDb(ctx);

  const [r] = await db
    .select({ e: extintores, s: sucursales })
    .from(extintores)
    .leftJoin(sucursales, eq(sucursales.id, extintores.sucursalId))
    .where(eq(extintores.qrToken, token))
    .limit(1);
  if (!r) return Response.json({ error: "Extintor no encontrado" }, { status: 404 });
  return Response.json({ extintor: r.e, sucursal: r.s ? { id: r.s.id, nombre: r.s.nombre } : null });
};
