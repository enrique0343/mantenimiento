// Helper para enviar mensajes por Telegram Bot API.
// Configuración: variable de entorno TELEGRAM_BOT_TOKEN.
// Cada usuario debe enlazar su cuenta enviando /start al bot, capturando
// su chat_id y guardándolo en usuarios.telegram_chat_id.

interface TelegramEnv {
  TELEGRAM_BOT_TOKEN?: string;
}

// Envía un mensaje. No bloquea la respuesta del API (usar waitUntil).
export async function sendTelegram(
  env: TelegramEnv,
  chatId: string | null | undefined,
  text: string,
  opts?: { linkUrl?: string; linkLabel?: string }
): Promise<{ ok: boolean; error?: string }> {
  if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, error: "TELEGRAM_BOT_TOKEN no configurado" };
  if (!chatId) return { ok: false, error: "Usuario sin chat_id de Telegram" };

  const reply_markup = opts?.linkUrl
    ? { inline_keyboard: [[{ text: opts.linkLabel ?? "Abrir", url: opts.linkUrl }]] }
    : undefined;

  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        ...(reply_markup ? { reply_markup } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Telegram ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

// Genera un código de enlace temporal de 6 dígitos. El usuario lo envía
// al bot con /enlazar XXXXXX y el webhook actualiza su telegram_chat_id.
export function generarCodigoEnlace(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
