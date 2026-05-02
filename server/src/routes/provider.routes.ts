import { Router } from 'express';
import { authenticate, requireRoles } from '../middleware/auth';
import prisma from '../lib/prisma';

const router = Router();

router.get('/', authenticate, async (_req, res) => {
  const providers = await prisma.provider.findMany({
    where: { active: true },
    orderBy: { name: 'asc' },
  });
  res.json(providers);
});

router.post('/', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF'), async (req, res) => {
  const { nit, name, contact, email, phone, specialty, city } = req.body;
  const provider = await prisma.provider.create({
    data: { nit, name, contact, email, phone, specialty, city },
  });
  res.status(201).json(provider);
});

router.put('/:id', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF'), async (req, res) => {
  const { nit, name, contact, email, phone, specialty, city, active } = req.body;
  const provider = await prisma.provider.update({
    where: { id: req.params.id },
    data: { nit, name, contact, email, phone, specialty, city, active },
  });
  res.json(provider);
});

router.get('/:id/performance', authenticate, async (req, res) => {
  const orders = await prisma.workOrder.findMany({
    where: { providerId: req.params.id },
    select: { id: true, code: true, status: true, completedAt: true, scheduledDate: true, equipment: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(orders);
});

export default router;
