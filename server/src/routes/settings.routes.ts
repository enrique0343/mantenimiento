import { Router } from 'express';
import { authenticate, requireRoles } from '../middleware/auth';
import prisma from '../lib/prisma';

const router = Router();

router.get('/', authenticate, async (_req, res) => {
  const company = await prisma.company.findFirst();
  res.json(company ?? {});
});

router.put('/', authenticate, requireRoles('ADMIN'), async (req, res) => {
  const { name, nit, address, phone, email } = req.body;
  const existing = await prisma.company.findFirst();
  const company = existing
    ? await prisma.company.update({ where: { id: existing.id }, data: { name, nit, address, phone, email } })
    : await prisma.company.create({ data: { name, nit, address, phone, email } });
  res.json(company);
});

// El upload de logo se implementa en Fase 2 (requiere multer + Supabase)
router.post('/logo', authenticate, requireRoles('ADMIN'), (_req, res) => {
  res.status(501).json({ message: 'Upload de logo: implementar en Fase 2' });
});

export default router;
