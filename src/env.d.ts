/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

type D1Database = import("@cloudflare/workers-types").D1Database;
type R2Bucket = import("@cloudflare/workers-types").R2Bucket;

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

interface Env {
  DB: D1Database;
  R2: R2Bucket;
  JWT_SECRET: string;
  CRON_SECRET: string;
  APP_NAME: string;
  // Email config (cualquier proveedor compatible)
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  // Microsoft 365
  M365_TENANT_ID?: string;
  M365_CLIENT_ID?: string;
  M365_CLIENT_SECRET?: string;
  M365_FROM_ADDRESS?: string;
  // Otros proveedores
  RESEND_API_KEY?: string;
  SENDGRID_API_KEY?: string;
  BREVO_API_KEY?: string;
  SMTP2GO_API_KEY?: string;
}

declare namespace App {
  interface Locals extends Runtime {
    user?: {
      id: number;
      email: string;
      nombre: string;
      rol: import("./lib/schema").Rol;
      especialidad: "general" | "biomedico" | "ambos" | null;
    };
  }
}
