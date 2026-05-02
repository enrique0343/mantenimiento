import { Router } from 'express';
import { authenticate, requireRoles } from '../middleware/auth';
import prisma from '../lib/prisma';

const router = Router();

router.get('/', authenticate, async (req, res) => {
  const where = req.query.active === 'all' ? {} : { active: true };
  const branches = await prisma.branch.findMany({
    where,
    include: { locations: true },
    orderBy: { name: 'asc' },
  });
  res.json(branches);
});

router.get('/:id', authenticate, async (req, res) => {
  const branch = await prisma.branch.findUnique({
    where: { id: req.params.id },
    include: { locations: true },
  });
  if (!branch) { res.status(404).json({ message: 'Sucursal no encontrada' }); return; }
  res.json(branch);
});

router.post('/', authenticate, requireRoles('ADMIN'), async (req, res) => {
  const { companyId, name, city, address, phone, timezone } = req.body;
  const branch = await prisma.branch.create({
    data: { companyId, name, city, address, phone, timezone },
  });
  res.status(201).json(branch);
});

router.put('/:id', authenticate, requireRoles('ADMIN'), async (req, res) => {
  const { name, city, address, phone, timezone, active } = req.body;
  const branch = await prisma.branch.update({
    where: { id: req.params.id },
    data: { name, city, address, phone, timezone, active },
  });
  res.json(branch);
});

// Locations dentro de una sucursal
router.post('/:id/locations', authenticate, requireRoles('ADMIN', 'MAINTENANCE_CHIEF'), async (req, res) => {
  const { building, floor, area } = req.body;
  const location = await prisma.location.create({
    data: { branchId: req.params.id, building, floor, area },
  });
  res.status(201).json(location);
});

export default router;
