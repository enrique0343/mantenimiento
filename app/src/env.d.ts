/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

import type { JwtPayload } from './lib/auth';

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    user?: JwtPayload;
  }
}

interface Env {
  DB:          D1Database;
  R2:          R2Bucket;
  JWT_SECRET:  string;
  BASE_URL:    string;
  SMTP_HOST?:  string;
  SMTP_PORT?:  string;
  SMTP_USER?:  string;
  SMTP_PASS?:  string;
  SMTP_FROM_NAME?: string;
}
