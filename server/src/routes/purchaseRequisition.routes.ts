import { Router } from 'express';
import { authenticate, requireRoles } from '../middleware/auth';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { Response } from 'express';

const router = Router();

async function generateCode(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.purchaseRequisition.count({
    where: { createdAt: { gte: new Date(`${year}-01-01`) } },
  });
  return `REQ-${year}-${String(count + 1).padStart(4, '0')}`;
}

const include = {
  branch: { select: { name: true } },
  createdBy: { select: { name: true } },
  items: { include: { sparePart: { select: { code: true, name: true, unit: true, category: true } } } },
};

// GET /inventory/requisitions
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  const { branchId, status, page = '1', limit = '25' } = req.query as Record<string, string>;
  const where: any = {};
  if (branchId) where.branchId = branchId;
  if (status) where.status = status;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [data, total] = await Promise.all([
    prisma.purchaseRequisition.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip, take: parseInt(limit) }),
    prisma.purchaseRequisition.count({ where }),
  ]);
  res.json({ data, total });
});

// GET /inventory/requisitions/:id
router.get('/:id', authenticate, async (req, res: Response) => {
  const r = await prisma.purchaseRequisition.findUnique({ where: { id: req.params.id }, include });
  if (!r) { res.status(404).json({ message: 'Requisición no encontrada' }); return; }
  res.json(r);
});

// POST /inventory/requisitions — generate automatically from items below reorder point
router.post('/generate', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF'), async (req: AuthRequest, res: Response) => {
  const { branchId, notes } = req.body;
  if (!branchId) { res.status(400).json({ message: 'branchId requerido' }); return; }

  const lowStocks = await prisma.sparePartStock.findMany({
    where: {
      branchId,
      reorderPoint: { gt: 0 },
      quantity: { lte: prisma.sparePartStock.fields.reorderPoint },
    },
    include: { sparePart: { select: { id: true, code: true, name: true, unit: true, category: true } } },
  });

  // Workaround: compare in JS since Prisma doesn't support column comparisons directly
  const needsReorder = await prisma.sparePartStock.findMany({
    where: { branchId, reorderPoint: { gt: 0 } },
    include: { sparePart: { select: { id: true, code: true, name: true, unit: true, category: true } } },
  });
  const belowReorder = needsReorder.filter(s => s.quantity <= s.reorderPoint);

  if (belowReorder.length === 0) {
    res.status(400).json({ message: 'No hay repuestos por debajo del punto de reorden' }); return;
  }

  const code = await generateCode();
  const requisition = await prisma.purchaseRequisition.create({
    data: {
      code,
      branchId,
      notes: notes?.trim() || null,
      createdById: req.user!.userId,
      status: 'DRAFT',
      items: {
        create: belowReorder.map(s => ({
          sparePartId: s.sparePartId,
          quantityNeeded: Math.max(s.reorderPoint - s.quantity + s.safetyStock, 1),
          currentStock: s.quantity,
          reorderPoint: s.reorderPoint,
        })),
      },
    },
    include,
  });

  res.status(201).json(requisition);
});

// POST /inventory/requisitions — manual creation
router.post('/', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF'), async (req: AuthRequest, res: Response) => {
  const { branchId, notes, items } = req.body;
  if (!branchId || !items?.length) { res.status(400).json({ message: 'branchId e items son requeridos' }); return; }

  const code = await generateCode();
  const requisition = await prisma.purchaseRequisition.create({
    data: {
      code,
      branchId,
      notes: notes?.trim() || null,
      createdById: req.user!.userId,
      status: 'DRAFT',
      items: {
        create: items.map((i: any) => ({
          sparePartId: i.sparePartId,
          quantityNeeded: i.quantityNeeded,
          currentStock: i.currentStock ?? 0,
          reorderPoint: i.reorderPoint ?? 0,
          notes: i.notes?.trim() || null,
        })),
      },
    },
    include,
  });
  res.status(201).json(requisition);
});

// PATCH /inventory/requisitions/:id/status
router.patch('/:id/status', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF'), async (req, res: Response) => {
  const { status } = req.body;
  const r = await prisma.purchaseRequisition.update({
    where: { id: req.params.id },
    data: { status },
    include,
  });
  res.json(r);
});

export default router;
