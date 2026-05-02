import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { workOrders, woSpareParts, spareParts, sparePartStock } from '../../../lib/schema';
import { json } from '../../../lib/utils';
import { eq, and } from 'drizzle-orm';

export const GET: APIRoute = async ({ params, locals, url }) => {
  const env = (locals.runtime as any).env as Env;
  const db  = getDb(env.DB);
  const id  = params.id!;

  const sub = url.searchParams.get('sub');

  if (sub === 'spare-parts') {
    const rows = await db
      .select({ qty: woSpareParts.quantity, code: spareParts.code, name: spareParts.name, unit: spareParts.unit })
      .from(woSpareParts)
      .leftJoin(spareParts, eq(woSpareParts.sparePartId, spareParts.id))
      .where(eq(woSpareParts.workOrderId, id))
      .all();
    return json(rows);
  }

  const [row] = await db.select().from(workOrders).where(eq(workOrders.id, id)).limit(1);
  if (!row) return json({ error: 'No encontrado' }, 404);
  return json(row);
};

export const PATCH: APIRoute = async ({ params, locals, request, url }) => {
  const env  = (locals.runtime as any).env as Env;
  const user = locals.user!;
  const db   = getDb(env.DB);
  const id   = params.id!;

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const sub = url.searchParams.get('sub');

  if (sub === 'status') {
    const { status } = body;
    const updates: any = { status };
    if (status === 'IN_PROGRESS' && !body.startedAt) updates.startedAt = new Date().toISOString();
    if (status === 'COMPLETED' || status === 'CLOSED') updates.completedAt = new Date().toISOString();
    await db.update(workOrders).set(updates).where(eq(workOrders.id, id));
    return json({ ok: true });
  }

  if (sub === 'close') {
    const { signerName, signerRole, techSignatureKey, clientSignatureKey, checklist, notes, laborHours } = body;
    if (!signerName || !techSignatureKey || !clientSignatureKey) {
      return json({ error: 'signerName, techSignatureKey y clientSignatureKey son requeridos' }, 400);
    }
    await db.update(workOrders).set({
      status: 'COMPLETED',
      completedAt: new Date().toISOString(),
      signerName, signerRole,
      techSignatureKey, clientSignatureKey,
      checklist: checklist ? JSON.stringify(checklist) : undefined,
      notes, laborHours,
    }).where(eq(workOrders.id, id));
    return json({ ok: true });
  }

  // Generic PATCH
  delete body.id; delete body.code;
  await db.update(workOrders).set(body).where(eq(workOrders.id, id));
  return json({ ok: true });
};
