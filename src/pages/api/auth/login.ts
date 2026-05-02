import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { usuarios } from "@/lib/schema";
import {
  verifyPassword,
  hashPassword,
  createSessionToken,
  setSessionCookie,
} from "@/lib/auth";

export const prerender = false;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  nombre: z.string().min(2).optional(),
});

export const POST: APIRoute = async (ctx) => {
  const body = await ctx.request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Datos invalidos" }, { status: 400 });
  }

  const env = getEnv(ctx);
  const db = getDb(ctx);
  const { email, password, nombre } = parsed.data;

  const existing = await db.select().from(usuarios).limit(1);

  let user;
  if (existing.length === 0) {
    if (!nombre) {
      return Response.json(
        { error: "Bootstrap: incluye 'nombre' para crear el primer admin" },
        { status: 400 }
      );
    }
    const passwordHash = await hashPassword(password);
    const inserted = await db
      .insert(usuarios)
      .values({ email, nombre, passwordHash, rol: "admin" })
      .returning();
    user = inserted[0];
  } else {
    const found = await db.select().from(usuarios).where(eq(usuarios.email, email)).limit(1);
    user = found[0];
    if (!user || !user.activo) {
      return Response.json({ error: "Credenciales invalidas" }, { status: 401 });
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return Response.json({ error: "Credenciales invalidas" }, { status: 401 });
    }
  }

  const token = await createSessionToken(
    { sub: user.id, email: user.email, nombre: user.nombre, rol: user.rol },
    env.JWT_SECRET
  );

  const headers = new Headers({ "content-type": "application/json" });
  setSessionCookie(headers, token);
  return new Response(
    JSON.stringify({ user: { id: user.id, email: user.email, nombre: user.nombre, rol: user.rol } }),
    { status: 200, headers }
  );
};
