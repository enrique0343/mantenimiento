// Microsoft Graph API - envio de email via OAuth client_credentials.
// Funciona en Cloudflare Workers (no requiere SMTP / nodemailer).
//
// Variables de entorno requeridas (wrangler secrets):
//   M365_TENANT_ID       - El tenant de Azure AD
//   M365_CLIENT_ID       - App registrada en Azure AD con permiso Mail.Send (Application)
//   M365_CLIENT_SECRET   - Client secret
//   M365_FROM_ADDRESS    - Direccion de email del buzon que envia (debe existir en el tenant)
//
// Setup en Azure AD:
//   1. Registrar app → Mail.Send (Application permission, con admin consent)
//   2. Agregar client secret y copiar valor
//   3. Crear/usar un buzon (license M365 / Exchange) para FROM
//   4. Setear los 4 secrets en Cloudflare Pages: wrangler pages secret put M365_*

import type { APIContext } from "astro";
import { getDb, getEnv } from "./db";
import { emailLog } from "./schema";

interface M365Env {
  M365_TENANT_ID?: string;
  M365_CLIENT_ID?: string;
  M365_CLIENT_SECRET?: string;
  M365_FROM_ADDRESS?: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(env: M365Env): Promise<string> {
  if (!env.M365_TENANT_ID || !env.M365_CLIENT_ID || !env.M365_CLIENT_SECRET) {
    throw new Error("M365 no configurado: faltan secrets M365_TENANT_ID/CLIENT_ID/CLIENT_SECRET");
  }
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;

  const tokenUrl = `https://login.microsoftonline.com/${env.M365_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: env.M365_CLIENT_ID,
    client_secret: env.M365_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Token M365 falló: ${res.status} ${t}`);
  }
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

export interface SendMailParams {
  to: string | string[];
  subject: string;
  html: string;
  cc?: string[];
  tipo?: string;
  referencia?: string;
}

export async function sendMail(ctx: APIContext, params: SendMailParams): Promise<{ ok: boolean; error?: string }> {
  const env = getEnv(ctx) as unknown as M365Env;
  const db = getDb(ctx);
  const toList = Array.isArray(params.to) ? params.to : [params.to];
  const ccList = params.cc ?? [];

  if (!env.M365_FROM_ADDRESS) {
    const error = "M365_FROM_ADDRESS no configurado";
    await db.insert(emailLog).values({
      destinatario: toList.join(","),
      asunto: params.subject,
      tipo: params.tipo,
      referencia: params.referencia,
      estado: "error",
      error,
    });
    return { ok: false, error };
  }

  try {
    const token = await getAccessToken(env);
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.M365_FROM_ADDRESS)}/sendMail`;

    const message = {
      message: {
        subject: params.subject,
        body: { contentType: "HTML", content: params.html },
        toRecipients: toList.map((a) => ({ emailAddress: { address: a } })),
        ccRecipients: ccList.map((a) => ({ emailAddress: { address: a } })),
      },
      saveToSentItems: true,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(message),
    });

    if (!res.ok) {
      const error = `Graph ${res.status}: ${(await res.text()).slice(0, 500)}`;
      await db.insert(emailLog).values({
        destinatario: toList.join(","), asunto: params.subject, tipo: params.tipo,
        referencia: params.referencia, estado: "error", error,
      });
      return { ok: false, error };
    }

    await db.insert(emailLog).values({
      destinatario: toList.join(","), asunto: params.subject, tipo: params.tipo,
      referencia: params.referencia, estado: "enviado",
    });
    return { ok: true };
  } catch (e: any) {
    const error = String(e?.message ?? e);
    await db.insert(emailLog).values({
      destinatario: toList.join(","), asunto: params.subject, tipo: params.tipo,
      referencia: params.referencia, estado: "error", error,
    });
    return { ok: false, error };
  }
}

export function emailLayout(title: string, body: string, footer?: string): string {
  return `<!doctype html>
<html><body style="font-family:Arial,sans-serif;background:#f1f5f9;margin:0;padding:24px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden">
    <div style="background:#0a4082;color:#fff;padding:16px 20px"><h1 style="margin:0;font-size:18px">${title}</h1></div>
    <div style="padding:20px;color:#0f172a;line-height:1.5">${body}</div>
    <div style="padding:12px 20px;background:#f8fafc;color:#64748b;font-size:11px;border-top:1px solid #e2e8f0">
      ${footer ?? "Este es un mensaje automático del sistema de mantenimiento."}
    </div>
  </div>
</body></html>`;
}
