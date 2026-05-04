// Email helpers — soporta SMTP directo (genérico) y proveedores REST.
//
// Cloudflare Workers soporta TCP real via cloudflare:sockets, por lo que
// SMTP con host/usuario/contraseña funciona nativamente (port 587 STARTTLS
// o port 465 SSL).
//
// El proveedor activo se decide por la presencia de variables de entorno:
//   1. EMAIL_PROVIDER (opcional): fuerza proveedor
//      ('smtp' | 'm365' | 'resend' | 'sendgrid' | 'brevo')
//   2. Si no, autodetecta por presencia de credenciales
//
// Variables SMTP (recomendado — genérico):
//   SMTP_HOST        e.g. mail.tudominio.com  o  smtp.office365.com
//   SMTP_PORT        587 (STARTTLS) o 465 (SSL) — por defecto 587
//   SMTP_USER        cuenta@tudominio.com
//   SMTP_PASS        contraseña
//   EMAIL_FROM       dirección remitente (puede ser igual a SMTP_USER)
//   EMAIL_FROM_NAME  (opcional) nombre visible

import type { APIContext } from "astro";
import { getDb, getEnv } from "./db";
import { emailLog } from "./schema";
import { sendSmtpWorker } from "./smtp-worker";

interface EmailEnv {
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  // SMTP genérico
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  // M365
  M365_TENANT_ID?: string;
  M365_CLIENT_ID?: string;
  M365_CLIENT_SECRET?: string;
  M365_FROM_ADDRESS?: string;
  // Resend
  RESEND_API_KEY?: string;
  // SendGrid
  SENDGRID_API_KEY?: string;
  // Brevo
  BREVO_API_KEY?: string;
}

export type Proveedor = "smtp" | "m365" | "resend" | "sendgrid" | "brevo" | "ninguno";

export function detectarProveedor(env: EmailEnv): Proveedor {
  const forced = env.EMAIL_PROVIDER?.toLowerCase();
  if (forced === "smtp" || forced === "m365" || forced === "resend" || forced === "sendgrid" || forced === "brevo") {
    return forced as Proveedor;
  }
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) return "smtp";
  if (env.M365_TENANT_ID && env.M365_CLIENT_ID && env.M365_CLIENT_SECRET && env.M365_FROM_ADDRESS) return "m365";
  if (env.RESEND_API_KEY && env.EMAIL_FROM) return "resend";
  if (env.SENDGRID_API_KEY && env.EMAIL_FROM) return "sendgrid";
  if (env.BREVO_API_KEY && env.EMAIL_FROM) return "brevo";
  return "ninguno";
}

export function nombreProveedor(p: Proveedor): string {
  const labels: Record<Proveedor, string> = {
    smtp: "SMTP (genérico)",
    m365: "Microsoft 365 (Graph API)",
    resend: "Resend",
    sendgrid: "SendGrid",
    brevo: "Brevo (Sendinblue)",
    ninguno: "Sin configurar",
  };
  return labels[p];
}

export interface SendMailParams {
  to: string | string[];
  subject: string;
  html: string;
  cc?: string[];
  tipo?: string;
  referencia?: string;
}

let cachedM365Token: { token: string; expiresAt: number } | null = null;

async function getM365Token(env: EmailEnv): Promise<string> {
  if (cachedM365Token && cachedM365Token.expiresAt > Date.now() + 30_000) return cachedM365Token.token;
  const url = `https://login.microsoftonline.com/${env.M365_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: env.M365_CLIENT_ID!,
    client_secret: env.M365_CLIENT_SECRET!,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Token M365 ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cachedM365Token = { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

async function sendViaM365(env: EmailEnv, p: SendMailParams) {
  const token = await getM365Token(env);
  const toList = Array.isArray(p.to) ? p.to : [p.to];
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.M365_FROM_ADDRESS!)}/sendMail`;
  const message = {
    message: {
      subject: p.subject,
      body: { contentType: "HTML", content: p.html },
      toRecipients: toList.map((a) => ({ emailAddress: { address: a } })),
      ccRecipients: (p.cc ?? []).map((a) => ({ emailAddress: { address: a } })),
    },
    saveToSentItems: true,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(message),
  });
  if (!res.ok) throw new Error(`M365 ${res.status}: ${(await res.text()).slice(0, 400)}`);
}

async function sendViaResend(env: EmailEnv, p: SendMailParams) {
  const toList = Array.isArray(p.to) ? p.to : [p.to];
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM_NAME ? `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM}>` : env.EMAIL_FROM,
      to: toList,
      cc: p.cc,
      subject: p.subject,
      html: p.html,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 400)}`);
}

async function sendViaSendGrid(env: EmailEnv, p: SendMailParams) {
  const toList = Array.isArray(p.to) ? p.to : [p.to];
  const body = {
    personalizations: [{ to: toList.map((a) => ({ email: a })), cc: p.cc?.map((a) => ({ email: a })) }],
    from: { email: env.EMAIL_FROM, name: env.EMAIL_FROM_NAME },
    subject: p.subject,
    content: [{ type: "text/html", value: p.html }],
  };
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { authorization: `Bearer ${env.SENDGRID_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 202) throw new Error(`SendGrid ${res.status}: ${(await res.text()).slice(0, 400)}`);
}

async function sendViaBrevo(env: EmailEnv, p: SendMailParams) {
  const toList = Array.isArray(p.to) ? p.to : [p.to];
  const body = {
    sender: { email: env.EMAIL_FROM, name: env.EMAIL_FROM_NAME },
    to: toList.map((a) => ({ email: a })),
    cc: p.cc?.map((a) => ({ email: a })),
    subject: p.subject,
    htmlContent: p.html,
  };
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY!, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 400)}`);
}


export async function sendMail(ctx: APIContext, params: SendMailParams): Promise<{ ok: boolean; error?: string; proveedor?: Proveedor }> {
  const env = getEnv(ctx) as unknown as EmailEnv;
  const db = getDb(ctx);
  const toList = Array.isArray(params.to) ? params.to : [params.to];
  const proveedor = detectarProveedor(env);

  if (proveedor === "ninguno") {
    const error = "No hay proveedor de email configurado";
    await db.insert(emailLog).values({
      destinatario: toList.join(","), asunto: params.subject, tipo: params.tipo,
      referencia: params.referencia, estado: "error", error,
    });
    return { ok: false, error, proveedor };
  }

  try {
    if (proveedor === "smtp") {
      await sendSmtpWorker(
        {
          host: env.SMTP_HOST!,
          port: parseInt(env.SMTP_PORT ?? "587", 10),
          user: env.SMTP_USER!,
          pass: env.SMTP_PASS!,
          from: env.EMAIL_FROM ?? env.SMTP_USER!,
          fromName: env.EMAIL_FROM_NAME,
        },
        { to: toList, subject: params.subject, html: params.html }
      );
    } else if (proveedor === "m365") await sendViaM365(env, params);
    else if (proveedor === "resend") await sendViaResend(env, params);
    else if (proveedor === "sendgrid") await sendViaSendGrid(env, params);
    else if (proveedor === "brevo") await sendViaBrevo(env, params);

    await db.insert(emailLog).values({
      destinatario: toList.join(","), asunto: params.subject, tipo: params.tipo,
      referencia: params.referencia, estado: "enviado",
    });
    return { ok: true, proveedor };
  } catch (e: any) {
    const error = String(e?.message ?? e);
    await db.insert(emailLog).values({
      destinatario: toList.join(","), asunto: params.subject, tipo: params.tipo,
      referencia: params.referencia, estado: "error", error,
    });
    return { ok: false, error, proveedor };
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
