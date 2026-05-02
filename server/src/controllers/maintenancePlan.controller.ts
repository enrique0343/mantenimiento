import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { addDays, addWeeks, addMonths, addYears } from 'date-fns';

const prisma = new PrismaClient();

function calcNextDueDate(current: Date, frequency: string): Date {
  switch (frequency) {
    case 'DAILY':     return addDays(current, 1);
    case 'WEEKLY':    return addWeeks(current, 1);
    case 'MONTHLY':   return addMonths(current, 1);
    case 'QUARTERLY': return addMonths(current, 3);
    case 'BIANNUAL':  return addMonths(current, 6);
    case 'ANNUAL':    return addYears(current, 1);
    default:          return addMonths(current, 1);
  }
}

// GET /maintenance-plans
export async function list(req: AuthRequest, res: Response) {
  try {
    const { equipmentId, branchId, active, page = '1', limit = '50' } = req.query as Record<string, string>;

    const where: any = {};
    if (equipmentId) where.equipmentId = equipmentId;
    if (active !== undefined) where.active = active === 'true';
    if (branchId) {
      where.equipment = { location: { branchId } };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [data, total] = await Promise.all([
      prisma.maintenancePlan.findMany({
        where,
        include: {
          equipment: {
            select: { id: true, name: true, code: true, location: { include: { branch: { select: { name: true } } } } },
          },
          assignedUser: { select: { id: true, name: true } },
          assignedProvider: { select: { id: true, name: true } },
        },
        orderBy: { nextDueDate: 'asc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.maintenancePlan.count({ where }),
    ]);

    res.json({ data, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al listar planes' });
  }
}

// GET /maintenance-plans/upcoming
export async function upcoming(req: AuthRequest, res: Response) {
  try {
    const days = parseInt((req.query.days as string) ?? '30');
    const branchId = req.query.branchId as string | undefined;
    const deadline = addDays(new Date(), days);

    const where: any = {
      active: true,
      nextDueDate: { lte: deadline },
    };
    if (branchId) where.equipment = { location: { branchId } };

    const plans = await prisma.maintenancePlan.findMany({
      where,
      include: {
        equipment: {
          select: { id: true, name: true, code: true, location: { include: { branch: { select: { name: true } } } } },
        },
        assignedUser: { select: { id: true, name: true } },
        assignedProvider: { select: { id: true, name: true } },
      },
      orderBy: { nextDueDate: 'asc' },
    });

    res.json(plans);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener próximos vencimientos' });
  }
}

// GET /maintenance-plans/:id
export async function getById(req: AuthRequest, res: Response) {
  try {
    const plan = await prisma.maintenancePlan.findUnique({
      where: { id: req.params.id },
      include: {
        equipment: {
          select: { id: true, name: true, code: true, location: { include: { branch: { select: { name: true } } } } },
        },
        assignedUser: { select: { id: true, name: true } },
        assignedProvider: { select: { id: true, name: true } },
      },
    });
    if (!plan) return res.status(404).json({ message: 'Plan no encontrado' });
    res.json(plan);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener el plan' });
  }
}

// POST /maintenance-plans
export async function create(req: AuthRequest, res: Response) {
  try {
    const {
      equipmentId, name, frequency, nextDueDate, alertDaysBefore = 7,
      estimatedHours, checklistTemplate = [], assignedToUserId, assignedToProviderId,
    } = req.body;

    if (!equipmentId || !name || !frequency || !nextDueDate) {
      return res.status(400).json({ message: 'Faltan campos requeridos' });
    }

    const plan = await prisma.maintenancePlan.create({
      data: {
        equipmentId,
        name: name.trim(),
        frequency,
        nextDueDate: new Date(nextDueDate),
        alertDaysBefore: parseInt(alertDaysBefore),
        estimatedHours: estimatedHours ? parseFloat(estimatedHours) : null,
        checklistTemplate,
        assignedToUserId: assignedToUserId || null,
        assignedToProviderId: assignedToProviderId || null,
        active: true,
      },
    });

    res.status(201).json(plan);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al crear el plan' });
  }
}

// PUT /maintenance-plans/:id
export async function update(req: AuthRequest, res: Response) {
  try {
    const {
      name, frequency, nextDueDate, alertDaysBefore, estimatedHours,
      checklistTemplate, assignedToUserId, assignedToProviderId, active,
    } = req.body;

    const plan = await prisma.maintenancePlan.findUnique({ where: { id: req.params.id } });
    if (!plan) return res.status(404).json({ message: 'Plan no encontrado' });

    const updated = await prisma.maintenancePlan.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(frequency !== undefined && { frequency }),
        ...(nextDueDate !== undefined && { nextDueDate: new Date(nextDueDate) }),
        ...(alertDaysBefore !== undefined && { alertDaysBefore: parseInt(alertDaysBefore) }),
        ...(estimatedHours !== undefined && { estimatedHours: estimatedHours ? parseFloat(estimatedHours) : null }),
        ...(checklistTemplate !== undefined && { checklistTemplate }),
        ...(assignedToUserId !== undefined && { assignedToUserId: assignedToUserId || null }),
        ...(assignedToProviderId !== undefined && { assignedToProviderId: assignedToProviderId || null }),
        ...(active !== undefined && { active: Boolean(active) }),
      },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar el plan' });
  }
}

// DELETE /maintenance-plans/:id  (soft delete — sets active=false)
export async function deactivate(req: AuthRequest, res: Response) {
  try {
    const plan = await prisma.maintenancePlan.findUnique({ where: { id: req.params.id } });
    if (!plan) return res.status(404).json({ message: 'Plan no encontrado' });

    await prisma.maintenancePlan.update({
      where: { id: req.params.id },
      data: { active: false },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al desactivar el plan' });
  }
}

// Called internally when a preventive WO is closed to advance the plan's dates
export async function advancePlanAfterCompletion(planId: string, completedAt: Date): Promise<void> {
  try {
    const plan = await prisma.maintenancePlan.findUnique({ where: { id: planId } });
    if (!plan) return;

    const nextDueDate = calcNextDueDate(completedAt, plan.frequency);
    await prisma.maintenancePlan.update({
      where: { id: planId },
      data: { nextDueDate, lastExecutedDate: completedAt },
    });
  } catch (err) {
    console.error('Error advancing maintenance plan:', err);
  }
}
