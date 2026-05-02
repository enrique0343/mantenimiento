export function json(data: unknown, status = 200, extra?: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });
}

export function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Returns SLA deadline (business hours) based on priority */
export function slaDueDate(priority: string, from = new Date()): string {
  const hours: Record<string, number> = { CRITICAL: 4, HIGH: 8, MEDIUM: 24, LOW: 72 };
  const h = hours[priority] ?? 24;
  return new Date(from.getTime() + h * 60 * 60 * 1000).toISOString();
}

export function paginate<T>(rows: T[], page: number, size = 20) {
  const total = rows.length;
  const pages = Math.ceil(total / size);
  const data  = rows.slice((page - 1) * size, page * size);
  return { data, total, page, pages };
}

export function requireRole(role: string, allowed: string[]): boolean {
  return allowed.includes(role);
}
