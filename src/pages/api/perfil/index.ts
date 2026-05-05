import type { APIRoute } from "astro";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { usuarios } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export const prerender = false;

// GET: perfil del usuario actual
export const GET: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const db = getDb(ctx);
  const [u] = await db
    .select({
      id: usuarios.id,
      email: usuarios.email,
      nombre: usuarios.nombre,
      rol: usuarios.rol,
      telegramChatId: usuarios.telegramChatId,
      calendarToken: usuarios.calendarToken,
    })
    .from(usuarios).where(eq(usuarios.id, user.id)).limit(1);
  return Response.json({ usuario: u });
};

const patchSchema = z.object({
  telegramChatId: z.string().nullable().optional(),
  regenerarCalendarToken: z.boolean().optional(),
});

// PATCH: edita campos de perfil del usuario actual
export const PATCH: APIRoute = async (ctx) => {
  const { user, response } = await requireUser(ctx);
  if (!user) return response;
  const body = await ctx.request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb(ctx);
  const data: Record<string, unknown> = {};

  if ("telegramChatId" in parsed.data) {
    data.telegramChatId = parsed.data.telegramChatId || null;
  }
  if (parsed.data.regenerarCalendarToken) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    data.calendarToken = Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  await db.update(usuarios).set(data).where(eq(usuarios.id, user.id));

  // Devolver perfil actualizado
  const [u] = await db.select({
    telegramChatId: usuarios.telegramChatId,
    calendarToken: usuarios.calendarToken,
  }).from(usuarios).where(eq(usuarios.id, user.id)).limit(1);

  return Response.json({ ok: true, telegramChatId: u.telegramChatId, calendarToken: u.calendarToken });
};
