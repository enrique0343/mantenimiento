import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db";
import { usuarios } from "@/lib/schema";
import { sendTelegram } from "@/lib/telegram";

export const prerender = false;

// Webhook que Telegram llama cuando el bot recibe mensajes.
// Configurar con: curl https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<dominio>/api/telegram/webhook
//
// El usuario debe enviar:
//   /enlazar <email>     ← enlaza este chat al usuario con ese email
//   /desenlazar          ← desenlaza
//   /start               ← muestra ayuda

export const POST: APIRoute = async (ctx) => {
  const env = getEnv(ctx) as any;
  const update = await ctx.request.json().catch(() => null);
  if (!update?.message?.text || !update?.message?.chat?.id) {
    return Response.json({ ok: true });
  }

  const chatId = String(update.message.chat.id);
  const text = String(update.message.text).trim();
  const db = getDb(ctx);

  if (text === "/start" || text === "/help" || text === "/ayuda") {
    await sendTelegram(env, chatId,
      "🛠 <b>Bot de Mantenimiento Avante</b>\n\n" +
      "Comandos:\n" +
      "<code>/enlazar tu-email@dominio.com</code> — vincula tu cuenta\n" +
      "<code>/desenlazar</code> — quita la vinculación\n" +
      "<code>/yo</code> — ver estado actual\n\n" +
      "Una vez enlazado, recibirás notificaciones de tus OTs, asignaciones y vencimientos."
    );
    return Response.json({ ok: true });
  }

  if (text.startsWith("/enlazar")) {
    const email = text.replace("/enlazar", "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      await sendTelegram(env, chatId, "❌ Uso: <code>/enlazar tu-email@dominio.com</code>");
      return Response.json({ ok: true });
    }
    const [u] = await db.select().from(usuarios).where(eq(usuarios.email, email)).limit(1);
    if (!u) {
      await sendTelegram(env, chatId, `❌ No encontré ningún usuario con email <code>${email}</code>.`);
      return Response.json({ ok: true });
    }
    if (!u.activo) {
      await sendTelegram(env, chatId, `❌ Tu cuenta está desactivada.`);
      return Response.json({ ok: true });
    }
    await db.update(usuarios).set({ telegramChatId: chatId }).where(eq(usuarios.id, u.id));
    await sendTelegram(env, chatId,
      `✅ Cuenta enlazada a <b>${u.nombre}</b> (${u.email}).\n\nA partir de ahora recibirás notificaciones aquí.`
    );
    return Response.json({ ok: true });
  }

  if (text === "/desenlazar") {
    await db.update(usuarios).set({ telegramChatId: null }).where(eq(usuarios.telegramChatId, chatId));
    await sendTelegram(env, chatId, "🔕 Tu cuenta ha sido desenlazada de este chat.");
    return Response.json({ ok: true });
  }

  if (text === "/yo") {
    const [u] = await db.select({ nombre: usuarios.nombre, email: usuarios.email })
      .from(usuarios).where(eq(usuarios.telegramChatId, chatId)).limit(1);
    if (u) {
      await sendTelegram(env, chatId, `👤 Estás enlazado como <b>${u.nombre}</b> (${u.email}).`);
    } else {
      await sendTelegram(env, chatId, `🔓 No hay cuenta enlazada a este chat. Usa <code>/enlazar tu-email@dominio.com</code>`);
    }
    return Response.json({ ok: true });
  }

  await sendTelegram(env, chatId, "🤖 Comando no reconocido. Usa /ayuda para ver los disponibles.");
  return Response.json({ ok: true });
};
