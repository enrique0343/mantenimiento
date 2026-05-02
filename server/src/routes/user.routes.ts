import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';

const router = Router();

router.get('/', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF'), async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, branchId: true, active: true, branch: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
  res.json(users);
});

router.post('/', authenticate, requireRoles('ADMIN'), async (req: AuthRequest, res: Response) => {
  const { email, name, password, role, branchId } = req.body;
  const hashed = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, name, password: hashed, role, branchId },
    select: { id: true, email: true, name: true, role: true, branchId: true },
  });
  res.status(201).json(user);
});

router.patch('/:id', authenticate, requireRoles('ADMIN'), async (req, res) => {
  const { name, email, branchId, active } = req.body;
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { name, email, branchId, active },
    select: { id: true, email: true, name: true, role: true, branchId: true, active: true },
  });
  res.json(user);
});

router.patch('/:id/role', authenticate, requireRoles('ADMIN'), async (req, res) => {
  const { role } = req.body;
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { role },
    select: { id: true, email: true, name: true, role: true },
  });
  res.json(user);
});

export default router;
