import { Router } from 'express';
import { authenticate, requireRoles } from '../middleware/auth';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { Response } from 'express';

const router = Router();

router.get('/', authenticate, async (_req, res: Response) => {
  const templates = await prisma.checklistTemplate.findMany({
    where: { active: true },
    orderBy: { name: 'asc' },
  });
  res.json(templates);
});

router.get('/all', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF'), async (_req, res: Response) => {
  const templates = await prisma.checklistTemplate.findMany({ orderBy: { name: 'asc' } });
  res.json(templates);
});

router.get('/:id', authenticate, async (req, res: Response) => {
  const t = await prisma.checklistTemplate.findUnique({ where: { id: req.params.id } });
  if (!t) { res.status(404).json({ message: 'Plantilla no encontrada' }); return; }
  res.json(t);
});

router.post('/', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF'), async (req: AuthRequest, res: Response) => {
  const { name, description, category, items } = req.body;
  if (!name || !items) { res.status(400).json({ message: 'name e items son requeridos' }); return; }
  const t = await prisma.checklistTemplate.create({
    data: { name: name.trim(), description: description?.trim() || null, category: category?.trim() || null, items },
  });
  res.status(201).json(t);
});

router.put('/:id', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF'), async (req, res: Response) => {
  const { name, description, category, items, active } = req.body;
  const t = await prisma.checklistTemplate.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(description !== undefined && { description: description?.trim() || null }),
      ...(category !== undefined && { category: category?.trim() || null }),
      ...(items !== undefined && { items }),
      ...(active !== undefined && { active: Boolean(active) }),
    },
  });
  res.json(t);
});

router.delete('/:id', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF'), async (req, res: Response) => {
  await prisma.checklistTemplate.update({ where: { id: req.params.id }, data: { active: false } });
  res.json({ ok: true });
});

export default router;
