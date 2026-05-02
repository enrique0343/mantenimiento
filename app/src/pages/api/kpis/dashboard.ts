import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { equipment, workOrders, helpdeskTickets, locations, branches } from '../../../lib/schema';
import { json } from '../../../lib/utils';
import { eq, and, gte, lte, sql } from 'drizzle-orm';

export const GET: APIRoute = async ({ locals, url }) => {
  const env = (locals.runtime as any).env as Env;
  const db  = getDb(env.DB);

  const branchId = url.searchParams.get('branch');
  const from     = url.searchParams.get('from') ?? new Date(Date.now() - 30 * 864e5).toISOString();
  const to       = url.searchParams.get('to')   ?? new Date().toISOString();

  // Equipment counts
  const allEquip = await db.select({
    id: equipment.id, status: equipment.status, locationId: equipment.locationId,
  }).from(equipment).all();

  const activeEquip = allEquip.filter(e => e.status === 'ACTIVE').length;
  const totalEquip  = allEquip.length;

  // Work orders in range
  const wos = await db.select({
    id: workOrders.id, type: workOrders.type, status: workOrders.status,
    priority: workOrders.priority, startedAt: workOrders.startedAt,
    completedAt: workOrders.completedAt, scheduledDate: workOrders.scheduledDate,
    laborHours: workOrders.laborHours, equipmentId: workOrders.equipmentId,
  }).from(workOrders)
    .where(and(gte(workOrders.createdAt, from), lte(workOrders.createdAt, to)))
    .all();

  const preventive     = wos.filter(w => w.type === 'PREVENTIVE');
  const corrective     = wos.filter(w => w.type === 'CORRECTIVE');
  const completedPrev  = preventive.filter(w => ['COMPLETED','VERIFIED','CLOSED'].includes(w.status));
  const overdueBacklog = corrective.filter(w => w.status === 'OPEN' || w.status === 'IN_PROGRESS');

  const avgRepairHours = corrective
    .filter(w => w.laborHours)
    .reduce((acc, w, _, arr) => acc + (w.laborHours ?? 0) / arr.length, 0);

  // Helpdesk tickets
  const tickets = await db.select({
    id: helpdeskTickets.id, status: helpdeskTickets.status,
    createdAt: helpdeskTickets.createdAt, resolvedAt: helpdeskTickets.resolvedAt,
  }).from(helpdeskTickets)
    .where(and(gte(helpdeskTickets.createdAt, from), lte(helpdeskTickets.createdAt, to)))
    .all();

  const resolvedTickets = tickets.filter(t => t.resolvedAt);
  const avgTicketHours  = resolvedTickets.reduce((acc, t, _, arr) => {
    const diff = (new Date(t.resolvedAt!).getTime() - new Date(t.createdAt).getTime()) / 36e5;
    return acc + diff / arr.length;
  }, 0);

  return json({
    equipment: {
      total: totalEquip,
      active: activeEquip,
      availability: totalEquip > 0 ? Math.round((activeEquip / totalEquip) * 100) : 0,
    },
    workOrders: {
      total:         wos.length,
      preventive:    preventive.length,
      corrective:    corrective.length,
      completedPrev: completedPrev.length,
      compliancePct: preventive.length > 0 ? Math.round((completedPrev.length / preventive.length) * 100) : 0,
      backlog:       overdueBacklog.length,
      mttr:          Math.round(avgRepairHours * 10) / 10,
    },
    helpdesk: {
      total:         tickets.length,
      open:          tickets.filter(t => t.status === 'OPEN').length,
      resolved:      resolvedTickets.length,
      avgResponseH:  Math.round(avgTicketHours * 10) / 10,
    },
    period: { from, to },
  });
};
