import { Router } from 'express';
import { authenticate, requireRoles } from '../middleware/auth';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { Response } from 'express';

const router = Router();

async function generateCode(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.inventoryReception.count({
    where: { createdAt: { gte: new Date(`${year}-01-01`) } },
  });
  return `REC-${year}-${String(count + 1).padStart(4, '0')}`;
}

// GET /inventory/receptions
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  const { branchId, page = '1', limit = '25' } = req.query as Record<string, string>;
  const where: any = {};
  if (branchId) where.branchId = branchId;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [data, total] = await Promise.all([
    prisma.inventoryReception.findMany({
      where,
      include: {
        branch: { select: { name: true } },
        supplier: { select: { name: true } },
        receivedBy: { select: { name: true } },
        items: { include: { sparePart: { select: { code: true, name: true, unit: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit),
    }),
    prisma.inventoryReception.count({ where }),
  ]);
  res.json({ data, total });
});

// GET /inventory/receptions/:id
router.get('/:id', authenticate, async (req, res: Response) => {
  const r = await prisma.inventoryReception.findUnique({
    where: { id: req.params.id },
    include: {
      branch: { select: { name: true } },
      supplier: { select: { name: true } },
      receivedBy: { select: { name: true } },
      items: { include: { sparePart: { select: { code: true, name: true, unit: true } } } },
    },
  });
  if (!r) { res.status(404).json({ message: 'Recepción no encontrada' }); return; }
  res.json(r);
});

// POST /inventory/receptions
router.post('/', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF', 'TECHNICIAN'), async (req: AuthRequest, res: Response) => {
  const { branchId, supplierId, invoiceRef, notes, items } = req.body;

  if (!branchId || !items?.length) {
    res.status(400).json({ message: 'branchId e items son requeridos' }); return;
  }

  const code = await generateCode();

  const reception = await prisma.inventoryReception.create({
    data: {
      code,
      branchId,
      supplierId: supplierId || null,
      invoiceRef: invoiceRef?.trim() || null,
      notes: notes?.trim() || null,
      receivedById: req.user!.userId,
      items: {
        create: items.map((item: { sparePartId: string; quantity: number; unitCostUsd?: number }) => ({
          sparePartId: item.sparePartId,
          quantity: item.quantity,
          unitCostUsd: item.unitCostUsd ?? null,
        })),
      },
    },
    include: {
      items: { include: { sparePart: true } },
    },
  });

  // Update stock and create movements for each item
  for (const item of items as { sparePartId: string; quantity: number }[]) {
    await prisma.sparePartStock.upsert({
      where: { sparePartId_branchId: { sparePartId: item.sparePartId, branchId } },
      create: { sparePartId: item.sparePartId, branchId, quantity: item.quantity },
      update: { quantity: { increment: item.quantity } },
    });

    await prisma.sparePartMovement.create({
      data: {
        sparePartId: item.sparePartId,
        branchId,
        type: 'RECEPTION',
        quantity: item.quantity,
        receptionId: reception.id,
        createdById: req.user!.userId,
        notes: `Recepción ${code}`,
      },
    });
  }

  res.status(201).json(reception);
});

export default router;
