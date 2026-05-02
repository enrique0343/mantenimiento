import { Router } from 'express';
import { authenticate } from '../middleware/auth';

const router = Router();

const stub = (_req: any, res: any) =>
  res.status(501).json({ message: 'Predictivo: implementar en Fase 5' });

router.get('/:equipmentId', authenticate, stub);
router.post('/', authenticate, stub);

export default router;
