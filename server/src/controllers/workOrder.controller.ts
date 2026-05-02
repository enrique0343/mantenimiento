import { Response } from 'express';
import { Prisma, WOType, WOStatus, Priority } from '@prisma/client';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { uploadFile } from '../services/storage.service';
import { sendWOAssigned } from '../services/email.service';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function generateCode(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.workOrder.count({
    where: { createdAt: { gte: new Date(`${year}-01-01`) } },
  });
  return `OT-${year}-${String(count + 1).padStart(4, '0')}`;
}

const include = {
  equipment: { include: { location: { include: { branch: true } } } },
  technician: { select: { id: true, name: true, email: true } },
  provider: { select: { id: true, name: true, email: true } },
  spareParts: { include: { sparePart: true } },
} satisfies Prisma.WorkOrderInclude;

// ─── Controllers ─────────────────────────────────────────────────────────────

export async function list(req: AuthRequest, res: Response): Promise<void> {
  const {
    equipmentId, technicianId, providerId, status, type, priority, branchId,
    from, to, search, page = '1', limit = '25',
  } = req.query as Record<string, string>;

  const where: Prisma.WorkOrderWhereInput = {};

  if (equipmentId) where.equipmentId = equipmentId;
  if (technicianId) where.technicianId = technicianId;
  if (providerId) where.providerId = providerId;
  if (type) where.type = type as WOType;
  if (priority) where.priority = priority as Priority;

  if (status) {
    const statuses = status.split(',') as WOStatus[];
    where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
  }

  if (branchId) where.equipment = { location: { branchId } };

  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  if (search) {
    where.OR = [
      { code: { contains: search, mode: 'insensitive' } },
      { equipment: { name: { contains: search, mode: 'insensitive' } } },
      { equipment: { code: { contains: search, mode: 'insensitive' } } },
    ];
  }

  // Técnicos solo ven sus propias OTs
  if (req.user?.role === 'TECHNICIAN') {
    where.technicianId = req.user.userId;
  }

  const p = Math.max(1, parseInt(page));
  const l = Math.min(100, parseInt(limit));

  const [data, total] = await Promise.all([
    prisma.workOrder.findMany({
      where, include, skip: (p - 1) * l, take: l,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.workOrder.count({ where }),
  ]);

  res.json({ data, total, page: p, limit: l });
}

export async function getById(req: AuthRequest, res: Response): Promise<void> {
  const wo = await prisma.workOrder.findUnique({ where: { id: req.params.id }, include });
  if (!wo) { res.status(404).json({ message: 'Orden de trabajo no encontrada' }); return; }
  res.json(wo);
}

export async function create(req: AuthRequest, res: Response): Promise<void> {
  const {
    type, priority, equipmentId, technicianId, providerId,
    helpdeskTicketId, scheduledDate, estimatedHours, notes,
    checklistTemplate, maintenancePlanId,
  } = req.body;

  const code = await generateCode();

  // Obtener checklist de un plan de mantenimiento si aplica
  let checklist = checklistTemplate ?? [];
  if (maintenancePlanId) {
    const plan = await prisma.maintenancePlan.findUnique({
      where: { id: maintenancePlanId },
      select: { checklistTemplate: true },
    });
    if (plan) checklist = plan.checklistTemplate;
  }

  const wo = await prisma.workOrder.create({
    data: {
      code,
      type,
      priority: priority ?? 'MEDIUM',
      status: 'OPEN',
      equipmentId,
      technicianId: technicianId ?? null,
      providerId: providerId ?? null,
      helpdeskTicketId: helpdeskTicketId ?? null,
      scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
      estimatedHours: estimatedHours ? Number(estimatedHours) : null,
      notes: notes ?? null,
      checklist,
    },
    include,
  });

  // Notificar al técnico asignado
  if (technicianId) {
    const tech = await prisma.user.findUnique({ where: { id: technicianId } });
    if (tech?.email) {
      sendWOAssigned({
        to: tech.email,
        technicianName: tech.name,
        woCode: code,
        equipmentName: wo.equipment.name,
        scheduledDate: scheduledDate,
      }).catch(() => {});
    }
  }

  res.status(201).json(wo);
}

export async function updateStatus(req: AuthRequest, res: Response): Promise<void> {
  const { status, notes } = req.body;
  const { id } = req.params;

  const current = await prisma.workOrder.findUnique({
    where: { id },
    select: { status: true, startedAt: true },
  });
  if (!current) { res.status(404).json({ message: 'OT no encontrada' }); return; }

  const data: Prisma.WorkOrderUpdateInput = { status, notes };

  if (status === 'IN_PROGRESS' && !current.startedAt) {
    data.startedAt = new Date();
  }

  const wo = await prisma.workOrder.update({ where: { id }, data, include });
  res.json(wo);
}

export async function updateChecklist(req: AuthRequest, res: Response): Promise<void> {
  const { checklist } = req.body;
  const wo = await prisma.workOrder.update({
    where: { id: req.params.id },
    data: { checklist },
    select: { id: true, checklist: true },
  });
  res.json(wo);
}

export async function uploadImages(req: AuthRequest, res: Response): Promise<void> {
  const { id } = req.params;
  const type = req.body.type as 'before' | 'after';
  const file = req.file;

  if (!file) { res.status(400).json({ message: 'Archivo requerido' }); return; }
  if (!['before', 'after'].includes(type)) {
    res.status(400).json({ message: 'type debe ser "before" o "after"' }); return;
  }

  const wo = await prisma.workOrder.findUnique({
    where: { id },
    select: { beforeImages: true, afterImages: true },
  });
  if (!wo) { res.status(404).json({ message: 'OT no encontrada' }); return; }

  const images = type === 'before' ? wo.beforeImages : wo.afterImages;
  if (images.length >= 2) {
    res.status(400).json({ message: `Ya hay 2 imágenes del ${type === 'before' ? 'antes' : 'después'}` });
    return;
  }

  const url = await uploadFile(file.buffer, file.mimetype, `work-orders/${id}/${type}`);

  const updated = await prisma.workOrder.update({
    where: { id },
    data: type === 'before'
      ? { beforeImages: { push: url } }
      : { afterImages: { push: url } },
    select: { id: true, beforeImages: true, afterImages: true },
  });

  res.json(updated);
}

export async function saveSignatures(req: AuthRequest, res: Response): Promise<void> {
  const { id } = req.params;
  const { type, dataUrl, signerName, signerRole } = req.body;

  if (!['tech', 'client'].includes(type)) {
    res.status(400).json({ message: 'type debe ser "tech" o "client"' }); return;
  }

  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  const buffer = Buffer.from(base64, 'base64');
  const url = await uploadFile(buffer, 'image/png', `work-orders/${id}/signatures`);

  const data: Prisma.WorkOrderUpdateInput = type === 'tech'
    ? { techSignature: url }
    : { clientSignature: url, signerName: signerName ?? null, signerRole: signerRole ?? null };

  const wo = await prisma.workOrder.update({ where: { id }, data, include });
  res.json(wo);
}

export async function addSpareParts(req: AuthRequest, res: Response): Promise<void> {
  const { id } = req.params;
  const { sparePartId, quantity } = req.body;

  const wo = await prisma.workOrder.findUnique({
    where: { id },
    select: { id: true, equipment: { select: { location: { select: { branchId: true } } } } },
  });
  if (!wo) { res.status(404).json({ message: 'OT no encontrada' }); return; }

  const branchId = wo.equipment.location.branchId;

  // Upsert el registro en WOSparePart
  await prisma.wOSparePart.upsert({
    where: { workOrderId_sparePartId: { workOrderId: id, sparePartId } },
    create: { workOrderId: id, sparePartId, quantity },
    update: { quantity },
  });

  // Descontar del stock de la sucursal
  await prisma.sparePartStock.updateMany({
    where: { sparePartId, branchId },
    data: { quantity: { decrement: quantity } },
  });

  // Registrar movimiento
  await prisma.sparePartMovement.create({
    data: {
      sparePartId, branchId,
      type: 'OUT', quantity,
      workOrderId: id,
      createdById: req.user!.userId,
      notes: `Consumo en OT ${id}`,
    },
  });

  const updated = await prisma.workOrder.findUnique({ where: { id }, include });
  res.json(updated);
}

export async function removeSparePart(req: AuthRequest, res: Response): Promise<void> {
  const { id, sparePartId } = req.params;

  const entry = await prisma.wOSparePart.findUnique({
    where: { workOrderId_sparePartId: { workOrderId: id, sparePartId } },
  });
  if (!entry) { res.status(404).json({ message: 'Repuesto no encontrado en la OT' }); return; }

  const wo = await prisma.workOrder.findUnique({
    where: { id },
    select: { equipment: { select: { location: { select: { branchId: true } } } } },
  });
  const branchId = wo!.equipment.location.branchId;

  await prisma.wOSparePart.delete({ where: { workOrderId_sparePartId: { workOrderId: id, sparePartId } } });

  // Devolver al stock
  await prisma.sparePartStock.updateMany({
    where: { sparePartId, branchId },
    data: { quantity: { increment: entry.quantity } },
  });

  const updated = await prisma.workOrder.findUnique({ where: { id }, include });
  res.json(updated);
}

export async function closeWO(req: AuthRequest, res: Response): Promise<void> {
  const { id } = req.params;

  const wo = await prisma.workOrder.findUnique({
    where: { id },
    select: {
      status: true, beforeImages: true, afterImages: true,
      techSignature: true, clientSignature: true, startedAt: true,
    },
  });
  if (!wo) { res.status(404).json({ message: 'OT no encontrada' }); return; }

  if (!['IN_PROGRESS', 'OPEN'].includes(wo.status)) {
    res.status(400).json({ message: 'Solo se pueden cerrar OTs en progreso' }); return;
  }
  if (wo.beforeImages.length < 2) {
    res.status(400).json({ message: 'Se requieren 2 imágenes del antes' }); return;
  }
  if (wo.afterImages.length < 2) {
    res.status(400).json({ message: 'Se requieren 2 imágenes del después' }); return;
  }
  if (!wo.techSignature) {
    res.status(400).json({ message: 'Se requiere la firma del técnico' }); return;
  }
  if (!wo.clientSignature) {
    res.status(400).json({ message: 'Se requiere la firma de quien recibe' }); return;
  }

  const completedAt = new Date();
  const laborHours = wo.startedAt
    ? (completedAt.getTime() - wo.startedAt.getTime()) / 3600000
    : null;

  const updated = await prisma.workOrder.update({
    where: { id },
    data: {
      status: 'COMPLETED',
      completedAt,
      laborHours: laborHours ? Math.round(laborHours * 100) / 100 : null,
    },
    include,
  });

  res.json(updated);
}

export async function getPDF(req: AuthRequest, res: Response): Promise<void> {
  const wo = await prisma.workOrder.findUnique({
    where: { id: req.params.id },
    include: {
      ...include,
      helpdeskTicket: { select: { code: true } },
    },
  });
  if (!wo) { res.status(404).json({ message: 'OT no encontrada' }); return; }

  const company = await prisma.company.findFirst({
    select: { name: true, logoUrl: true, nit: true },
  });

  res.json({ workOrder: wo, company });
}
