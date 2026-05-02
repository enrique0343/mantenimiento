/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

type D1Database = import("@cloudflare/workers-types").D1Database;
type R2Bucket = import("@cloudflare/workers-types").R2Bucket;

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

interface Env {
  DB: D1Database;
  R2: R2Bucket;
  JWT_SECRET: string;
  APP_NAME: string;
}

declare namespace App {
  interface Locals extends Runtime {
    user?: {
      id: number;
      email: string;
      nombre: string;
      rol: "admin" | "tecnico" | "solicitante";
    };
  }
}
