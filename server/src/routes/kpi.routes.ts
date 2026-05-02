import { Router } from 'express';
import { authenticate } from '../middleware/auth';

const router = Router();

const stub = (_req: any, res: any) =>
  res.status(501).json({ message: 'KPIs: implementar en Fase 6' });

router.get('/dashboard', authenticate, stub);
router.get('/equipment/:id', authenticate, stub);
router.get('/technician/:id', authenticate, stub);

export default router;
