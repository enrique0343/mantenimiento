import { Response } from 'express';
import { subMonths, startOfMonth, endOfMonth, format } from 'date-fns';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';

// GET /kpis/dashboard
export async function dashboard(req: AuthRequest, res: Response) {
  try {
    const { branchId } = req.query as Record<string, string>;
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    const equipWhere: any = {};
    const woWhere: any = {};
    const ticketWhere: any = {};
    const stockWhere: any = {};

    if (branchId) {
      equipWhere.location = { branchId };
      woWhere.equipment = { location: { branchId } };
      ticketWhere.branchId = branchId;
      stockWhere.branchId = branchId;
    }

    // ── Equipment availability ────────────────────────────────────────────────
    const [equipTotal, equipActive] = await Promise.all([
      prisma.equipment.count({ where: { ...equipWhere, status: { not: 'DECOMMISSIONED' } } }),
      prisma.equipment.count({ where: { ...equipWhere, status: 'ACTIVE' } }),
    ]);

    // ── Work orders ────────────────────────────────────────────────────────────
    const [openWOs, inProgressWOs, thisMonthTotal, thisMonthCompleted, thisMonthPreventive, thisMonthPreventiveDone] = await Promise.all([
      prisma.workOrder.count({ where: { ...woWhere, status: 'OPEN' } }),
      prisma.workOrder.count({ where: { ...woWhere, status: 'IN_PROGRESS' } }),
      prisma.workOrder.count({ where: { ...woWhere, createdAt: { gte: monthStart, lte: monthEnd } } }),
      prisma.workOrder.count({ where: { ...woWhere, status: { in: ['COMPLETED', 'VERIFIED', 'CLOSED'] }, completedAt: { gte: monthStart, lte: monthEnd } } }),
      prisma.workOrder.count({ where: { ...woWhere, type: 'PREVENTIVE', scheduledDate: { gte: monthStart, lte: monthEnd } } }),
      prisma.workOrder.count({ where: { ...woWhere, type: 'PREVENTIVE', status: { in: ['COMPLETED', 'VERIFIED', 'CLOSED'] }, scheduledDate: { gte: monthStart, lte: monthEnd } } }),
    ]);

    // ── MTTR (avg repair time in hours for CORRECTIVE WOs completed this month) ──
    const corrective = await prisma.workOrder.findMany({
      where: {
        ...woWhere,
        type: 'CORRECTIVE',
        status: { in: ['COMPLETED', 'VERIFIED', 'CLOSED'] },
        completedAt: { gte: monthStart, lte: monthEnd },
        laborHours: { not: null },
      },
      select: { laborHours: true },
    });
    const avgMTTR = corrective.length
      ? corrective.reduce((sum, wo) => sum + Number(wo.laborHours ?? 0), 0) / corrective.length
      : null;

    // ── Helpdesk ──────────────────────────────────────────────────────────────
    const [openTickets, resolvedThisMonth] = await Promise.all([
      prisma.helpdeskTicket.count({ where: { ...ticketWhere, status: { in: ['OPEN', 'IN_PROGRESS', 'ESCALATED'] } } }),
      prisma.helpdeskTicket.count({ where: { ...ticketWhere, status: { in: ['RESOLVED', 'CLOSED'] }, resolvedAt: { gte: monthStart, lte: monthEnd } } }),
    ]);

    // ── Stock alerts ──────────────────────────────────────────────────────────
    const allStocks = await prisma.sparePartStock.findMany({
      where: { ...stockWhere, sparePart: { active: true }, minStock: { gt: 0 } },
    });
    const stockAlerts = allStocks.filter(s => s.quantity <= s.minStock).length;

    // ── WOs by status (for pie chart) ─────────────────────────────────────────
    const statusGroups = await prisma.workOrder.groupBy({
      by: ['status'],
      where: woWhere,
      _count: { id: true },
    });
    const woByStatus = statusGroups.map(g => ({ status: g.status, count: g._count.id }));

    // ── WOs by type per month (last 6 months) ─────────────────────────────────
    const woByTypePerMonth: Array<{ month: string; PREVENTIVE: number; CORRECTIVE: number; PREDICTIVE: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const mStart = startOfMonth(subMonths(now, i));
      const mEnd = endOfMonth(subMonths(now, i));
      const groups = await prisma.workOrder.groupBy({
        by: ['type'],
        where: { ...woWhere, createdAt: { gte: mStart, lte: mEnd } },
        _count: { id: true },
      });
      const entry: any = { month: format(mStart, 'MMM yy') };
      entry.PREVENTIVE = groups.find(g => g.type === 'PREVENTIVE')?._count.id ?? 0;
      entry.CORRECTIVE = groups.find(g => g.type === 'CORRECTIVE')?._count.id ?? 0;
      entry.PREDICTIVE = groups.find(g => g.type === 'PREDICTIVE')?._count.id ?? 0;
      woByTypePerMonth.push(entry);
    }

    // ── Top 5 equipment by WO count ───────────────────────────────────────────
    const topEquipRaw = await prisma.workOrder.groupBy({
      by: ['equipmentId'],
      where: woWhere,
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 5,
    });
    const topEquipIds = topEquipRaw.map(e => e.equipmentId);
    const topEquipInfo = await prisma.equipment.findMany({
      where: { id: { in: topEquipIds } },
      select: { id: true, name: true, code: true },
    });
    const topEquipment = topEquipRaw.map(e => ({
      name: topEquipInfo.find(eq => eq.id === e.equipmentId)?.name ?? e.equipmentId,
      code: topEquipInfo.find(eq => eq.id === e.equipmentId)?.code ?? '',
      count: e._count.id,
    }));

    res.json({
      equipmentTotal,
      equipmentActive,
      availabilityPct: equipTotal > 0 ? Math.round((equipActive / equipTotal) * 100) : 0,
      openWOs,
      inProgressWOs,
      thisMonthTotal,
      thisMonthCompleted,
      preventiveCompliance: thisMonthPreventive > 0 ? Math.round((thisMonthPreventiveDone / thisMonthPreventive) * 100) : null,
      avgMTTR: avgMTTR !== null ? Math.round(avgMTTR * 10) / 10 : null,
      openTickets,
      resolvedThisMonth,
      stockAlerts,
      woByStatus,
      woByTypePerMonth,
      topEquipment,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al calcular KPIs' });
  }
}

// GET /kpis/equipment/:id
export async function equipmentKpis(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const { months = '12' } = req.query as Record<string, string>;
    const since = subMonths(new Date(), parseInt(months));

    const [totalWOs, corrective, preventive, avgLaborHours] = await Promise.all([
      prisma.workOrder.count({ where: { equipmentId: id } }),
      prisma.workOrder.count({ where: { equipmentId: id, type: 'CORRECTIVE' } }),
      prisma.workOrder.count({ where: { equipmentId: id, type: 'PREVENTIVE' } }),
      prisma.workOrder.aggregate({
        where: { equipmentId: id, laborHours: { not: null }, completedAt: { gte: since } },
        _avg: { laborHours: true },
      }),
    ]);

    // WOs per month for this equipment
    const perMonth: Array<{ month: string; count: number }> = [];
    for (let i = parseInt(months) - 1; i >= 0; i--) {
      const now = new Date();
      const mStart = startOfMonth(subMonths(now, i));
      const mEnd = endOfMonth(subMonths(now, i));
      const count = await prisma.workOrder.count({
        where: { equipmentId: id, createdAt: { gte: mStart, lte: mEnd } },
      });
      perMonth.push({ month: format(mStart, 'MMM yy'), count });
    }

    res.json({
      totalWOs,
      corrective,
      preventive,
      avgLaborHours: avgLaborHours._avg.laborHours ? Math.round(Number(avgLaborHours._avg.laborHours) * 10) / 10 : null,
      perMonth,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al calcular KPIs del equipo' });
  }
}
